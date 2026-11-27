const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const model=require('../.test-build/services/journal-model.js');
const storage=require('../.test-build/services/journal-storage.js');
const service=require('../.test-build/services/community.js');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const tap=(key,value)=>({currentTarget:{dataset:{[key]:value}}});
const touch=(id,x=100,y=300)=>({...tap('id',id),touches:[{clientX:x,clientY:y}]});
function environment(extra={}){
  const values=new Map();global.wx={getStorageSync:key=>structuredClone(values.get(key)??''),setStorageSync:(key,value)=>values.set(key,structuredClone(value)),removeStorageSync:key=>values.delete(key),
    getWindowInfo:()=>({windowWidth:390,windowHeight:844,screenHeight:844,statusBarHeight:24,safeArea:{bottom:824}}),getMenuButtonBoundingClientRect:()=>({top:30,bottom:62,left:270}),getDeviceInfo:()=>({platform:'android'}),getAppBaseInfo:()=>({}),
    getFileSystemManager:()=>({accessSync(){},mkdirSync(){},unlink(){}}),env:{USER_DATA_PATH:'/user'},nextTick:fn=>fn(),pageScrollTo(){},hideKeyboard(){},showToast(){},setNavigationBarTitle(){},canIUse:()=>false,...extra};return values;
}
function page(path){let definition;global.Page=value=>definition=value;const file=require.resolve('../.test-build/'+path+'/index.js');delete require.cache[file];require(file);const p={data:structuredClone(definition.data),getTabBar:()=>({setData(){}}),setData(values,done){Object.assign(this.data,values);done?.();}};for(const[k,v]of Object.entries(definition))if(k!=='data')p[k]=typeof v==='function'?v.bind(p):structuredClone(v);return p;}
function component(path,properties={}){let definition;global.Component=value=>definition=value;const file=require.resolve('../.test-build/components/'+path+'/index.js');delete require.cache[file];require(file);const events=[];const defaults=Object.fromEntries(Object.entries(definition.properties||{}).map(([key,value])=>[key,structuredClone(value.value)]));const p={data:{...defaults,...structuredClone(definition.data),...properties},...definition.methods,setData(value,done){Object.assign(this.data,value);done?.();},triggerEvent(name,detail){events.push({name,detail});}};return {p,definition,events};}
function journal(t,count=1){t.mock.timers.enable({apis:['Date','setTimeout'],now:1000});environment();const p=page('pages/journal');p.onLoad();for(let i=0;i<count;i++)storage.saveJournalState(model.makeJournal([],'Journal '+i),storage.editorHistory([],[]));p.onShow();t.after(()=>p.onUnload());return p;}

test('calendar month cells handle leap days, Monday columns, month boundaries and constrained dates',()=>{
  const calendar=require('../.test-build/services/calendar.js');
  assert.equal(calendar.calendarDate('2024-02-29'),true);assert.equal(calendar.calendarDate('2026-02-29'),false);assert.equal(calendar.calendarDate('2026-13-01'),false);
  assert.equal(calendar.calendarMonth('2026-12-15',1),'2027-01-01');assert.equal(calendar.calendarMonth('2026-01-31',-1),'2025-12-01');
  const rows=calendar.calendarCells('2026-11-01','2026-11-03','2026-11-08','2026-11-02','2026-11-09');assert.equal(rows.length,42);assert.equal(rows[6].value,'2026-11-01');assert.equal(rows[6].disabled,true);
  assert.equal(rows.find(cell=>cell.value==='2026-11-05').within,true);assert.equal(rows.find(cell=>cell.value==='2026-11-08').end,true);assert.deepEqual(calendar.orderedDates('2026-12-01','2026-11-25'),{from:'2026-11-25',to:'2026-12-01'});
});

test('calendar selection is a cancellable draft and can span months without changing its owner early',()=>{
  environment();const {p,definition,events}=component('date-calendar',{from:'2026-11-25',to:'2026-11-27'});definition.observers.open.call(p,true);
  p.select(tap('date','2026-11-28'));p.monthChange(tap('delta',1));p.select(tap('date','2026-12-03'));assert.equal(events.length,0);assert.equal(p.data.from,'2026-11-25');
  p.apply();assert.deepEqual(events[0],{name:'change',detail:{from:'2026-11-28',to:'2026-12-03'}});p.close();assert.equal(events[1].name,'close');
});

test('calendar drag selects a backward date range and ignores the synthetic tap after release',()=>{
  environment({createSelectorQuery:()=>({in(){return this;},select(){return this;},boundingClientRect(fn){fn({left:0,top:0,width:280,height:252});return this;},exec(){}})});
  const {p,definition,events}=component('date-calendar',{from:'2026-11-10'});definition.observers.open.call(p,true);p.select(tap('date','2026-11-12'));p.dragStart({...tap('date','2026-11-12'),touches:[{clientX:140,clientY:84}]});
  const index=p.data.cells.findIndex(cell=>cell.value==='2026-11-05');p.dragMove({touches:[{clientX:(index%7)*40+20,clientY:Math.floor(index/7)*42+20}]});p.dragEnd();p.select(tap('date','2026-11-05'));p.apply();
  assert.deepEqual(events.at(-1).detail,{from:'2026-11-05',to:'2026-11-12'});
});

test('reopening a calendar releases an interrupted drag and short outer screens retain a bounded scroller',()=>{
  environment({getWindowInfo:()=>({windowHeight:327})});const {p,definition,events}=component('date-calendar',{from:'2026-11-10'});p.data.dragging=true;definition.observers.open.call(p,false);definition.observers.open.call(p,true);assert.equal(p.data.dragging,false);assert.equal(p.data.bodyHeight,117);assert.equal(events.length,0);
});

test('map custom choices apply the selected scope and dismiss without changing an untouched filter',()=>{
  environment();const {p,events}=component('field-map');let loads=0;p.load=()=>loads++;p.openFilter(tap('field','scope'));assert.deepEqual(p.data.filterOptions,['公开与我的','公开鸟讯','我的标记']);p.closeFilter();assert.equal(p.data.scope,0);assert.equal(loads,0);
  p.openFilter(tap('field','scope'));p.chooseFilter({detail:{value:2}});assert.equal(p.data.scope,2);assert.equal(p.data.filterOpen,false);assert.equal(loads,1);assert.equal(events.at(-1).detail.open,false);
});

test('map save-place entry stores the actual chosen GCJ02 point and does not invent a check-in',async()=>{
  const values=environment({chooseLocation:async()=>({name:'湿地公园',address:'入口',latitude:31.15,longitude:121.67})});const {p}=component('field-map');await p.saveMapPlace();const saved=require('../.test-build/services/saved-places.js').readSavedPlaces();assert.equal(saved.length,1);assert.equal(saved[0].longitude,121.67);assert.equal('checked' in saved[0],false);assert.equal(values.has('bird-assistant.place-demo.v1'),false);
});

test('journal filter sheets and confirmed ranges use the existing library without native pickers',t=>{
  const p=journal(t,2);p.openJournalChoice(tap('key','libraryOrder'));p.chooseJournalChoice({detail:{value:1}});assert.equal(p.data.libraryOrder,1);assert.equal(p.data.filterOpen,false);
  p.openCalendar(tap('target','library'));p.closeCalendar();assert.equal(p.data.libraryFrom,'');p.openCalendar(tap('target','library'));p.calendarChange({detail:{from:'2026-11-01',to:'2026-11-30'}});assert.equal(p.data.libraryFrom,'2026-11-01');assert.equal(p.data.calendarOpen,false);
});

test('deck sizing uses its measured position and safe area, and never resizes underneath a held card',t=>{
  const p=journal(t);let callback;global.wx.createSelectorQuery=()=>({select(){return this;},boundingClientRect(fn){callback=fn;return this;},exec(){}});p.fitDeck();callback({top:400});assert.equal(p.data.deckHeight,346);assert.equal(p.data.deckPreviewHeight,182);p.data.paperPhase='armed';p.data.deckHeight=300;p.fitDeck();callback({top:450});assert.equal(p.data.deckHeight,300);
});

test('deliberate sharing finishes departure before opening the sheet, stays hidden, and returns without glow',t=>{
  const p=journal(t),id=p.data.libraryRows[0].id;p.deckTouchStart(touch(id));t.mock.timers.tick(1000);p.deckTouchMove(touch(id,100,50));p.deckTouchEnd();
  assert.equal(p.data.shareOpen,false);assert.equal(p.data.paperPhase,'depart-share');assert.match(p.data.paperDragStyle,/scale\(\.08\)/);t.mock.timers.tick(359);assert.equal(p.data.shareOpen,false);t.mock.timers.tick(1);
  assert.equal(p.data.shareOpen,true);assert.equal(p.data.paperPhase,'hidden');assert.equal(p.data.paperVisualId,id);assert.equal(p.data.paperArmedId,'');p.closeShare();assert.equal(p.data.paperPhase,'returning');assert.equal(p.data.shareOpen,false);t.mock.timers.tick(340);assert.equal(p.data.paperPhase,'');assert.equal(p.data.paperVisualId,'');
});

test('aborting a departure by hiding cannot open a late share and an idle armed card releases page input',t=>{
  const p=journal(t),id=p.data.libraryRows[0].id;p.deckTouchStart(touch(id));t.mock.timers.tick(1000);p.deckTouchMove(touch(id,100,50));p.deckTouchEnd();p.onHide();t.mock.timers.tick(1000);assert.equal(p.data.shareOpen,false);assert.equal(p.data.paperPhase,'');
  p.onShow();p.deckTouchStart(touch(id));t.mock.timers.tick(1000);p.deckTouchEnd();t.mock.timers.tick(45000);assert.equal(p.data.paperArmedId,'');assert.equal(p.data.deckSettling,false);assert.equal(p._paperTouch,null);
});

test('cancelled deletion returns the original card and does not delete the saved journal',t=>{
  const p=journal(t),id=p.data.libraryRows[0].id;global.wx.showModal=options=>options.success({confirm:false});p.departPaper(id,'delete');t.mock.timers.tick(360);assert.equal(p.data.paperPhase,'returning');assert.equal(model.readJournals().length,1);assert.equal(p.data.paperArmedId,'');
});

test('a journal removed while its share animation runs releases the hidden-card state',t=>{
  const p=journal(t),id=p.data.libraryRows[0].id;p.departPaper(id,'share');storage.deleteJournalState(id);t.mock.timers.tick(360);
  assert.equal(p.data.shareOpen,false);assert.equal(p.data.paperPhase,'returning');assert.match(p.data.error,/手帐未找到/);t.mock.timers.tick(340);assert.equal(p.data.paperVisualId,'');assert.equal(p.data.paperPhase,'');
});

test('deleting the focused card selects its right neighbour or falls back to the left',async t=>{
  const p=journal(t,3),ids=p.data.libraryRows.map(row=>row.id);p.data.deckIndex=1;await p.confirmDeleteJournal(ids[1]);assert.equal(p.data.libraryRows[p.data.deckIndex].id,ids[2]);assert.equal(p.data.deckArrival,'right');
  await p.confirmDeleteJournal(ids[2]);assert.equal(p.data.libraryRows[p.data.deckIndex].id,ids[0]);assert.equal(p.data.deckArrival,'left');assert.equal(model.readJournals().length,1);
});

test('cancellation in each external share destination closes the sheet and clears the armed state',async t=>{
  environment();const p=page('pages/journal');p.onLoad();const doc=model.makeJournal([],'Cancelled');storage.saveJournalState(doc,storage.editorHistory([],[]));
  const canvas=require('../.test-build/services/canvas.js'),render=require('../.test-build/services/journal-render.js'),drafts=require('../.test-build/services/post-draft.js');t.mock.method(canvas,'getCanvas',async()=>({}));t.mock.method(canvas,'exportCanvas',async()=>'/tmp/page.png');t.mock.method(render,'renderJournal',async()=>{});
  const cancellation=()=>Promise.reject({errMsg:'operation:fail cancel'});global.wx.saveImageToPhotosAlbum=cancellation;global.wx.showShareImageMenu=options=>options.fail({errMsg:'share:fail cancel'});t.mock.method(drafts,'savePostDraft',cancellation);
  for(const destination of [0,1,2]){p.data.paperVisualId=doc.id;p.data.paperPhase='hidden';p.shareJournal(tap('id',doc.id),true);await p.shareJournalImage(doc.id,destination);assert.equal(p.data.shareOpen,false);assert.equal(p.data.paperArmedId,'');assert.equal(p.data.exporting,false);}
  p.onUnload();
});

test('native deadline releases a lost callback, aborts its task and discards a late completion',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const {nativeDeadline}=require('../.test-build/services/native-deadline.js');let finish,aborted=0;const work=nativeDeadline(resolve=>{finish=resolve;return {abort:()=>aborted++};},100,'expired');const rejection=assert.rejects(work,/expired/);t.mock.timers.tick(100);await rejection;finish('late');assert.equal(aborted,1);assert.equal(await nativeDeadline(resolve=>resolve('new'),100,'expired'),'new');
});

test('a missing WeChat login callback no longer poisons the shared login promise; the next call can recover',async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout'],now:1000});environment({login(){}});const network=require('../.test-build/services/vision-network.js');network.forgetConnection();const pending=network.connectBusiness();const rejection=assert.rejects(pending,/登录响应超时/);t.mock.timers.tick(12000);await rejection;
  global.wx.login=options=>options.success({code:'local-test'});global.wx.request=options=>{options.success({statusCode:200,data:{access_token:'test-only',expires_in:60}});return {abort(){}};};assert.equal((await network.connectBusiness()).header.Authorization,'Bearer test-only');network.forgetConnection();
});

test('an hour of idle map fallback checks stays bounded and page hiding stops the native bridge work',async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout'],now:1000});let reads=0;environment({createMapContext:()=>({getRegion:options=>{reads++;options.success({southwest:{latitude:39,longitude:115},northeast:{latitude:41,longitude:117}});},getScale:options=>options.success({scale:12}),getCenterLocation:options=>options.success({latitude:40,longitude:116})})});
  t.mock.method(service,'api',async()=>({total:0,clusters:[]}));const {p,definition}=component('field-map');t.after(()=>definition.lifetimes.detached.call(p));await p.load();p.watchViewport();
  for(let interval=0;interval<1440;interval++){t.mock.timers.tick(2500);await tick();}
  assert.ok(reads<=1442&&reads>=1440);const before=reads;definition.pageLifetimes.hide.call(p);t.mock.timers.tick(3600000);await tick();assert.equal(reads,before);assert.equal(p.data.loading,false);assert.equal(p.data.nativeActive,false);
});

test('forum tabs render mine and bookmarks in place and ignore an old list finishing after switching',async t=>{
  environment();const p=page('pages/community');p.refreshDrafts=()=>{};let resolveOld;const requests=[];t.mock.method(service,'api',(path)=>{requests.push(path);if(path.endsWith('/posts'))return new Promise(resolve=>resolveOld=resolve);return Promise.resolve({items:[{id:path.endsWith('/mine')?'mine':'saved',channel:'post',body:'正文',reactions:['like'],likes:3,poll:{total:2,candidates:[]}}]});});
  const old=p.loadFeed();p.switchFeed(tap('tab','mine'));await tick();assert.equal(p.data.view,'feed');assert.equal(p.data.feedTabIndex,1);assert.equal(p.data.remotePosts[0].id,'mine');resolveOld({items:[{id:'stale'}]});await old;assert.equal(p.data.remotePosts[0].id,'mine');
  p.switchFeed(tap('tab','bookmarks'));await tick();assert.equal(p.data.feedTabIndex,2);assert.equal(p.data.remotePosts[0].liked,true);assert.equal(p.data.remotePosts[0].poll.total,2);assert.ok(requests.some(path=>path.endsWith('/bookmarks')));p.onUnload();
});

test('profile and discovery links to saved or authored posts hand off to the existing forum tab',()=>{
  let destination='';environment({switchTab:options=>{destination=options.url;}});service.hub('bookmarks');assert.equal(destination,'/pages/community/index');assert.equal(service.takeForumTab(),'bookmarks');assert.equal(service.takeForumTab(),'');service.hub('mine');assert.equal(service.takeForumTab(),'mine');
});

test('poll choice waits for explicit confirmation; a failed vote keeps the choice and withdrawal uses DELETE',async t=>{
  environment();const p=page('field/hub');p.data.id='post';p.data.record={poll:{total:1,candidates:[{id:'owl',name:'短耳鸮',votes:1}],mine:null,result:null}};let fail=true;const calls=[];
  t.mock.method(service,'api',async(path,method,body)=>{calls.push({path,method,body});if(fail)throw Error('offline');return {total:method==='DELETE'?0:1,candidates:[],mine:method==='DELETE'?null:'owl',result:null};});
  p.openPoll();p.choosePollSpecies({detail:{id:'owl',name:'短耳鸮'}});assert.equal(calls.length,0);await p.submitPollVote();assert.equal(p.data.pollSelection,'owl');assert.match(p.data.pollError,/offline/);fail=false;await p.submitPollVote();assert.equal(p.data.record.poll.mine,'owl');await p.retractPollVote();assert.equal(calls.at(-1).method,'DELETE');assert.equal(p.data.record.poll.mine,null);assert.equal(p.data.record.poll.total,0);assert.equal(p.data.pollBusy,false);p.onUnload();
});

test('votes finishing after hide cannot overwrite the next visible state',async t=>{
  environment();const p=page('field/hub');p.data.id='post';p.data.record={poll:{total:0,candidates:[],mine:null,result:null}};p.data.pollSelection='owl';let resolve;t.mock.method(service,'api',()=>new Promise(done=>resolve=done));const work=p.submitPollVote();p.onHide();resolve({total:1,mine:'owl',candidates:[]});await work;assert.equal(p.data.record.poll.total,0);assert.equal(p.data.pollBusy,false);assert.equal(p.data.pollOpen,false);p.onUnload();
});

test('an older deployed vote service returning 405 keeps the existing ballot and explains the missing withdrawal route',async t=>{
  environment();const p=page('field/hub');p.data.id='post';p.data.record={poll:{total:1,candidates:[],mine:'owl',result:null}};t.mock.method(service,'api',async()=>{throw Object.assign(new Error('request failed'),{statusCode:405});});await p.retractPollVote();assert.equal(p.data.record.poll.mine,'owl');assert.match(p.data.pollError,/尚未更新撤票接口/);assert.equal(p.data.pollBusy,false);p.onUnload();
});

test('new native component styles avoid unsupported attribute and element selectors',()=>{
  for(const name of ['field-map','choice-sheet','date-calendar','species-search']){const css=readFileSync('miniprogram/components/'+name+'/index.wxss','utf8').replace(/\/\*[\s\S]*?\*\//g,'');for(const match of css.matchAll(/([^{}]+)\{/g)){const selector=match[1].trim();if(selector.startsWith('@'))continue;assert.ok(!selector.includes('['),name+': '+selector);assert.ok(!/(^|[\s>,+])(?:button|image|text|view|input|textarea)\b/.test(selector),name+': '+selector);}}
});
