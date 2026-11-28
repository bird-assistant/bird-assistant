const {test}=require('node:test');
const assert=require('node:assert/strict');
const model=require('../.test-build/services/journal-model.js');
const store=require('../.test-build/services/journal-storage.js');
const shelf=require('../.test-build/services/journal-shelf.js');
const community=require('../.test-build/services/community.js');
const tap=id=>({currentTarget:{dataset:{id}}});
const touch=(id,x=100,y=300)=>({...tap(id),touches:[{clientX:x,clientY:y}]});
const asset={id:'a',src:'/assets/samples/field-1.png',label:'Photo',notes:'',sample:true,selected:true};
function environment(extra={}){
  const values=new Map(),files=new Map(),removed=[];
  const fs={readdirSync:()=>[...files.keys()].filter(path=>path.startsWith('/user/journal-previews/')).map(path=>path.slice('/user/journal-previews/'.length)),
    statSync:path=>({size:files.get(path),isFile:()=>true}),unlinkSync:path=>{removed.push(path);files.delete(path);},
    accessSync(){},mkdirSync(){},unlink(){},saveFile:o=>o.success({savedFilePath:o.filePath})};
  global.wx={getStorageSync:k=>structuredClone(values.get(k)??''),setStorageSync:(k,v)=>values.set(k,structuredClone(v)),removeStorageSync:k=>values.delete(k),
    getStorageInfoSync:()=>({keys:[...values.keys()],currentSize:20,limitSize:10240}),getFileSystemManager:()=>fs,env:{USER_DATA_PATH:'/user'},
    getWindowInfo:()=>({windowWidth:412,windowHeight:931,statusBarHeight:36}),getMenuButtonBoundingClientRect:()=>({top:42,bottom:74,left:290}),
    getDeviceInfo:()=>({platform:'android'}),getAppBaseInfo:()=>({}),nextTick:f=>f(),canIUse:()=>false,pageScrollTo(){},showToast(){},hideKeyboard(){},setNavigationBarTitle(){},...extra};
  community.setDraft(null);return {values,files,fs,removed};
}
function page(path){let definition;global.Page=value=>definition=value;const file=require.resolve('../.test-build/'+path+'/index.js');delete require.cache[file];require(file);
  const p={data:structuredClone(definition.data),getTabBar:()=>({setData(){}}),setData(values,done){Object.assign(this.data,values);done?.();}};
  for(const [key,value]of Object.entries(definition))if(key!=='data')p[key]=typeof value==='function'?value.bind(p):structuredClone(value);return p;
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function journal(t){t.mock.timers.enable({apis:['Date','setTimeout'],now:1000});const e=environment(),p=page('pages/journal');p.onLoad();const doc=model.makeJournal([asset],'Gesture');e.values.set(model.JOURNAL_KEY,[doc]);p.data.libraryRows=[{id:doc.id,title:doc.title}];t.after(()=>p.onUnload());return {...e,p,doc};}

test('paper physics caps visual travel and requires distance and vertical intent, without a fast-fling shortcut',()=>{
  const {paperDrag}=require('../.test-build/services/paper-gesture.js');
  assert.equal(paperDrag(0,-90,568).action,'');assert.equal(paperDrag(0,-140,568).action,'share');assert.equal(paperDrag(0,180,931).action,'');assert.equal(paperDrag(0,220,931).action,'delete');
  assert.equal(paperDrag(100,-150,931).action,'');assert.equal(paperDrag(80,4).cancel,true);assert.equal(paperDrag(NaN,20).cancel,true);
  const y=Number(/translateY\((-?[\d.]+)px/.exec(paperDrag(0,800).style)[1]);assert.ok(y>0&&y<116);
});

test('moving before the hold deadline cancels arming even if the finger later returns',t=>{
  const {p,doc}=journal(t);p.deckTouchStart(touch(doc.id));t.mock.timers.tick(600);p.deckTouchMove(touch(doc.id,112,300));p.deckTouchMove(touch(doc.id));t.mock.timers.tick(600);assert.equal(p.data.paperArmedId,'');p.deckTouchEnd();
});

test('multi-touch and page hiding cancel a pending hold and an already armed drag',t=>{
  const {p,doc}=journal(t);p.deckTouchStart(touch(doc.id));p.onHide();t.mock.timers.tick(1000);assert.equal(p.data.paperArmedId,'');p._active=true;
  p.deckTouchStart(touch(doc.id));t.mock.timers.tick(1000);assert.equal(p.data.paperArmedId,doc.id);p.deckTouchMove({...touch(doc.id),touches:[{},{}]});assert.equal(p.data.paperArmedId,'');p.deckTouchEnd();
});

test('only current and adjacent shelf rows are mounted; a normal tap opens, and a deliberate horizontal swipe settles to the next card',t=>{
  const {p,doc}=journal(t);p.data.libraryRows=Array.from({length:60},(_,i)=>({id:i?String(i):doc.id,title:'Journal '+i}));p.projectDeck();assert.equal(p.data.deckSlots.length,2);
  let opened=0;p.openDraft=()=>opened++;p.deckTouchStart(touch(doc.id));p.deckTouchEnd();p.deckCard({...tap(doc.id),currentTarget:{dataset:{id:doc.id,index:0}}});assert.equal(opened,1);
  p.deckTouchStart(touch(doc.id));p.deckTouchMove(touch(doc.id,-30,305));p.deckTouchEnd();assert.equal(p.data.deckIndex,0);assert.equal(p.data.deckSettling,true);t.mock.timers.tick(220);assert.equal(p.data.deckIndex,1);assert.equal(p.data.deckSlots.length,3);assert.deepEqual(p.data.deckSlots.map(row=>row.id),[doc.id,'1','2']);
});

test('horizontal cancellation while armed never shares, deletes or advances the deck',t=>{
  const {p,doc}=journal(t);p.data.libraryRows.push({id:'next'});let actions=0;p.shareJournal=p.deleteJournal=()=>actions++;
  p.deckTouchStart(touch(doc.id));t.mock.timers.tick(1000);p.deckTouchMove(touch(doc.id,180,305));p.deckTouchEnd();assert.equal(p.data.paperArmedId,'');assert.equal(p.data.deckIndex,0);assert.equal(actions,0);
});

test('sharing opens an app sheet with a complete page projection and does not invoke a native action-sheet chooser or export',t=>{
  const {p,doc}=journal(t);global.wx.showActionSheet=()=>assert.fail('native destination chooser');doc.elements[1].text='Edited overview';store.saveJournalState(doc,store.editorHistory([],[]));
  p.shareJournal(tap(doc.id));assert.equal(p.data.shareOpen,true);assert.equal(p.data.shareTitle,'Gesture');assert.equal(p.data.sharePreview.elements.length,doc.elements.length);assert.ok(p.data.sharePreview.elements.some(element=>element.rows.some(row=>row.text==='Edited overview')));assert.equal(p.data.exporting,false);
});

test('closing the share sheet during canvas preparation prevents album writes, forum drafts and system sharing',async t=>{
  environment();const p=page('pages/journal');p.onLoad();const doc=model.makeJournal([asset],'Cancel export');store.saveJournalState(doc,store.editorHistory([],[]));
  const canvas=require('../.test-build/services/canvas.js'),render=require('../.test-build/services/journal-render.js');let resolveCanvas,rendered=0;
  t.mock.method(canvas,'getCanvas',()=>new Promise(resolve=>resolveCanvas=resolve));t.mock.method(render,'renderJournal',async()=>rendered++);
  global.wx.saveImageToPhotosAlbum=global.wx.showShareImageMenu=()=>assert.fail('external share after closing');
  p.shareJournal(tap(doc.id));const work=p.shareJournalImage(doc.id,0);p.closeShare();resolveCanvas({});await work;assert.equal(rendered,0);assert.equal(p.data.exporting,false);p.onUnload();
});

test('a missing cached share bitmap falls back to the actual journal composition',()=>{
  environment();const p=page('pages/journal');const doc=model.makeJournal([asset],'Fallback');store.saveJournalState(doc,store.editorHistory([],[]));p.data.deckThumbnails[doc.id]='/gone.png';p.shareJournal(tap(doc.id));assert.equal(p.data.sharePreview,null);p.sharePreviewFailed();assert.equal(p.data.shareBitmap,'');assert.equal(p.data.sharePreview.id,doc.id);p.onUnload();
});

test('saved locations preserve GCJ-02 coordinates, deduplicate the same place, and never invent a visit',()=>{
  const e=environment(),places=require('../.test-build/services/saved-places.js'),input={name:'上海迪士尼乐园',address:'上海市浦东新区',latitude:31.1434,longitude:121.658};
  const first=places.savePlace(input),again=places.savePlace({...input,address:'Updated address'});assert.equal(first.id,again.id);assert.equal(places.readSavedPlaces().length,1);assert.equal(again.latitude,input.latitude);assert.equal(again.longitude,input.longitude);assert.ok(!('checked' in again));assert.equal(e.values.has('bird-assistant.place-demo.v1'),false);
  assert.throws(()=>places.savePlace({...input,longitude:181}),/有效地点/);places.removeSavedPlace(first.id);assert.deepEqual(places.readSavedPlaces(),[]);
});

test('an unreadable saved-place collection is preserved instead of overwritten',()=>{
  const e=environment(),places=require('../.test-build/services/saved-places.js'),bad={version:2,items:[]};e.values.set(places.SAVED_PLACES_KEY,bad);assert.throws(()=>places.savePlace({name:'Place',address:'',latitude:0,longitude:0}),/未覆盖/);assert.deepEqual(e.values.get(places.SAVED_PLACES_KEY),bad);
});

test('a location picker may finish while hidden, but cannot update a page that has been unloaded',async()=>{
  for(const unloaded of [false,true]){let resolve;const e=environment({chooseLocation:()=>new Promise(done=>resolve=done)}),p=page('pages/profile');p.data.view='places';p._visible=true;const work=p.addPlace();if(unloaded)p.onUnload();else p.onHide();resolve({name:'Wetland',address:'Park',latitude:40,longitude:116});await work;assert.equal(e.values.has('bird-assistant.saved-places.v1'),!unloaded);}
});

test('opening a saved location uses the real map handoff with the exact point and label',()=>{
  let switched;environment({switchTab:o=>switched=o.url});const p=page('pages/profile');p.data.savedPlaces=[{id:'place',name:'Wetland',latitude:31.14,longitude:121.66}];p.openPlace(tap('place'));const focus=community.takeMapFocus();assert.equal(switched,'/pages/home/index');assert.equal(focus.latitude,31.14);assert.equal(focus.longitude,121.66);assert.equal(focus.scale,15);assert.match(focus.focusLabel,/Wetland/);
});

test('preview cleanup retains originals, history, current/legacy draft references, avatars and unrelated vision cache',()=>{
  const e=environment(),cache=require('../.test-build/services/preview-cache.js'),doc=model.makeJournal([asset],'Protected');
  const path=name=>'/user/journal-previews/'+name+'.png';doc.elements[0].src=path('current');doc.editHistory={version:1,past:[{document:{...structuredClone(doc),elements:[model.element('photo',{src:path('undo')})]},selected:''}],future:[],selected:''};e.values.set(model.JOURNAL_KEY,[doc]);
  e.values.set('bird-assistant.post-draft.v1',{title:'Old',body:'',image:path('draft')});e.values.set('bird-assistant.profile.v1',{version:1,profile:{name:'Me',avatar:path('avatar')}});
  e.values.set(shelf.JOURNAL_SHELF_KEY,{version:1,rows:[]});e.values.set('bird-assistant.journal.preview.v1.one',{cached:true});e.values.set('private.keep',{secret:'local-only'});
  for(const name of ['current','undo','draft','avatar','rebuild'])e.files.set(path(name),2048);e.files.set('/user/vision-frame.png',4096);e.files.set('/user/original.jpg',4096);
  const before=JSON.stringify([...e.values].filter(([key])=>key!==shelf.JOURNAL_SHELF_KEY&&!key.startsWith('bird-assistant.journal.preview.')));
  assert.deepEqual(cache.previewCacheInfo(),{files:1,kilobytes:2,entries:2,protectedFiles:4});const result=cache.clearPreviewCache();assert.equal(result.removed,1);assert.equal(result.failed,0);assert.deepEqual(e.removed,[path('rebuild')]);assert.equal(e.files.has('/user/vision-frame.png'),true);assert.equal(JSON.stringify([...e.values]),before);
});

test('preview cleanup fails closed on malformed source collections and never deletes files if index removal fails',()=>{
  const cache=require('../.test-build/services/preview-cache.js');let e=environment();e.files.set('/user/journal-previews/rebuild.png',1024);e.values.set(model.JOURNAL_KEY,{broken:true});assert.throws(()=>cache.clearPreviewCache());assert.deepEqual(e.removed,[]);
  e=environment();e.values.set(shelf.JOURNAL_SHELF_KEY,{version:1,rows:[]});e.files.set('/user/journal-previews/rebuild.png',1024);global.wx.removeStorageSync=()=>{throw new Error('locked');};const result=cache.clearPreviewCache();assert.equal(result.failed,1);assert.equal(result.removed,0);assert.deepEqual(e.removed,[]);
});

test('clearing disposable previews allows the shelf to rebuild from unchanged editable journals',()=>{
  const e=environment(),cache=require('../.test-build/services/preview-cache.js'),doc=model.makeJournal([asset],'Rebuild');store.saveJournalState(doc,store.editorHistory([],[]));const before=JSON.stringify(e.values.get(model.JOURNAL_KEY));cache.clearPreviewCache();assert.equal(shelf.readJournalShelf()[0].title,'Rebuild');assert.equal(JSON.stringify(e.values.get(model.JOURNAL_KEY)),before);
});

test('writing readiness checks send no media or model request, surface the deployment failure, and ignore results after hiding',async t=>{
  const e=environment(),network=require('../.test-build/services/vision-network.js'),writing=require('../.test-build/services/writing-network.js');community.setSession(true);const p=page('pages/profile');p._visible=true;let resolve,checks=0;
  t.mock.method(network,'connectBusiness',async()=>({origin:'https://business.test',header:{Authorization:'Bearer local-test'}}));
  t.mock.method(writing,'writingReadiness',()=>{checks++;return new Promise(done=>resolve=done);});
  const work=p.checkWriting();await tick();assert.equal(checks,1);assert.equal(p.data.writingChecking,true);p.onHide();resolve();await work;assert.equal(p.data.writingReady,false);assert.equal(p.data.writingChecking,false);
  p._visible=true;t.mock.method(writing,'writingReadiness',async()=>{throw new Error('手机写作服务尚未上线');});await p.checkWriting();assert.match(p.data.writingStatus,/尚未上线/);assert.equal(p.data.writingChecking,false);p.onUnload();assert.ok(e.values.size);
});

test('writing checks require an active community session and never trigger an implicit sign-in',async t=>{
  environment();const network=require('../.test-build/services/vision-network.js');t.mock.method(network,'connectBusiness',()=>assert.fail('implicit sign-in'));const p=page('pages/profile');p._visible=true;await p.checkWriting();assert.match(p.data.writingStatus,/先登录/);assert.equal(p.data.writingChecking,false);p.onUnload();
});

test('a late chat acknowledgment preserves a newer draft; a hidden completion cannot erase it or navigate',async t=>{
  environment();community.setSession(true);const p=page('field/social');p._visible=true;p.data.screen='chat';p.data.id='peer';p.data.text='First';let resolve;
  t.mock.method(community,'api',()=>new Promise(done=>resolve=done));p.refresh=async()=>{};
  const work=p.send();p.input({currentTarget:{dataset:{field:'text'}},detail:{value:'Second'}});resolve({id:'sent'});await work;assert.equal(p.data.text,'Second');assert.equal(p.data.working,false);
  const later=p.send();p.onHide();resolve({id:'sent-again'});await later;assert.equal(p.data.text,'Second');assert.equal(p.data.working,false);p.onUnload();
});


test('a share or discovery sheet hides bottom navigation and restores it on closing without losing the selected tab',()=>{
  environment();const tabs=require('../.test-build/services/tabs.js');assert.equal(tabs.navigationFocused({view:'home',shareOpen:true}),true);assert.equal(tabs.navigationFocused({view:'feed',moreOpen:true}),true);assert.equal(tabs.navigationFocused({view:'home'}),false);
  const p=page('pages/community'),bar={};p.getTabBar=()=>({setData:values=>Object.assign(bar,values)});p.moreSections();assert.equal(bar.hidden,true);p.closeMore();assert.equal(bar.hidden,false);
  const j=page('pages/journal'),doc=model.makeJournal([asset],'Navigation');store.saveJournalState(doc,store.editorHistory([],[]));j.getTabBar=p.getTabBar;j.shareJournal(tap(doc.id));assert.equal(bar.hidden,true);j.closeShare();assert.equal(bar.hidden,false);j.onUnload();
});

test('saving a temporary original while the share sheet is open preserves the preview contract and still exports',async t=>{
  const e=environment(),p=page('pages/journal'),doc=model.makeJournal([{...asset,src:'/tmp/original.jpg',sample:false,persisted:false}],'Durable share');p.onLoad();p.data.doc=doc;p.data.dirty=true;
  e.fs.saveFile=o=>o.success({savedFilePath:'/user/durable-original.jpg'});
  const canvas=require('../.test-build/services/canvas.js'),render=require('../.test-build/services/journal-render.js');let saved=0;
  t.mock.method(canvas,'getCanvas',async()=>({}));t.mock.method(canvas,'exportCanvas',async()=>'/tmp/export.png');t.mock.method(render,'renderJournal',async(_canvas,document)=>assert.equal(document.elements.find(e=>e.type==='photo').src,'/user/durable-original.jpg'));
  global.wx.saveImageToPhotosAlbum=async()=>saved++;p.shareJournal(tap(doc.id));await p.shareJournalImage(doc.id,0);assert.equal(p.data.shareError,'');assert.equal(saved,1);assert.equal(p.data.shareOpen,true);p.onUnload();
});
