const {test}=require('node:test');
const assert=require('node:assert/strict');
const service=require('../.test-build/services/community.js');
const history=require('../.test-build/services/trip-history.js');
const {presentTrip}=require('../.test-build/services/trip-plan.js');
const {speciesResultsHeight}=require('../.test-build/services/map-presentation.js');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const tap=(data)=>({currentTarget:{dataset:data}});
function page(path){let definition;global.Page=d=>definition=d;const file=require.resolve('../.test-build/'+path+'/index.js');delete require.cache[file];require(file);const p={data:structuredClone(definition.data),setData(value,done){Object.assign(this.data,value);done?.();}};for(const [key,value] of Object.entries(definition))if(key!=='data')p[key]=typeof value==='function'?value.bind(p):structuredClone(value);return p;}
function storage(){const data=new Map();global.wx={getStorageSync:key=>data.get(key),setStorageSync:(key,value)=>data.set(key,structuredClone(value)),canIUse:()=>false,pageScrollTo(){},setNavigationBarTitle(){}};return data;}
const plan=(n=1)=>({turn:'turn-'+n,answer:'请在公共步道安静观察。',start:'2026-11-26T07:00:00+08:00',end:'2026-11-26T09:00:00+08:00',sources:[],stops:[],parks:[],stages:[],guideCards:[],weatherCards:[]});
const conditions={point:{latitude:40,longitude:116.3},place:'当前地图中心',date:'2026-11-26',hour:7,hours:2,radius:30,species:'',speciesLabel:'所有鸟种'};

test('one option uses one row, three rows bound long searches and small viewports stay bounded',()=>{
  assert.equal(speciesResultsHeight(1,false,500),44);assert.equal(speciesResultsHeight(100,true,500),132);assert.equal(speciesResultsHeight(2,true,500),132);assert.equal(speciesResultsHeight(1,false,30),30);assert.equal(speciesResultsHeight(0,false,500),0);
});
test('all imported photos are selected independently of the active audio preview, failure does not lose later results',async()=>{
  storage();const p=page('pages/identify');p.data.view='import';
  const a=p.addEvidence('a.jpg','photo','album'),b=p.addEvidence('b.jpg','photo','album'),audio=p.addEvidence('temporary.mp3','audio','album',false,{name:'林间鸟鸣-清晨.mp3',size:102400});
  assert.equal(p.data.currentId,audio.id);assert.equal(a.selected&&b.selected&&audio.selected,true);assert.equal(audio.name,'林间鸟鸣-清晨.mp3');assert.match(audio.sizeLabel,/100 KB/);
  const sent=[];p.analyse=async()=>{sent.push(p.data.currentId);if(p.data.currentId===a.id){p.setData({error:'网络超时'});return false;}b.analysis={state:'candidate'};return true;};
  await p.sendImported();assert.deepEqual(sent,[a.id,b.id]);assert.match(a.status,/网络超时/);assert.match(b.status,/候选/);assert.match(p.data.batchProgress,/已完成 1 \/ 2/);assert.equal(p.data.view,'import');
  p.toggleImportEvidence(tap({id:a.id}));assert.equal(a.selected,false);p.activateEvidence(a.id);assert.equal(b.selected,true);
});
test('cancelled batch never starts its next photo and preserves completed and unprocessed materials',async()=>{
  storage();const p=page('pages/identify');p.data.view='import';const a=p.addEvidence('a.jpg','photo','album'),b=p.addEvidence('b.jpg','photo','album');
  let resolve;const sent=[];p.analyse=()=>{sent.push(p.data.currentId);return new Promise(r=>resolve=r);};
  const work=p.sendImported();await settle();const duplicate=p.sendImported();assert.equal(sent.length,1);p.cancelAnalysis();resolve(true);await Promise.all([work,duplicate]);
  assert.deepEqual(sent,[a.id]);assert.equal(p.data.assets.find(item=>item.id===b.id).status,'未识别');assert.match(p.data.assets[0].status,/已取消/);assert.equal(p.data.batching,false);
});
test('audio original filename survives saving and reopening a local record',async()=>{
  const stored=storage(),p=page('pages/identify');const a=p.addEvidence('wxfile://saved/audio.mp3','audio','album',false,{name:'校园西侧鸟鸣很长的名字.mp3'});a.persisted=true;p.setData({persisted:true});global.wx.showToast=()=>{};p.save();await settle();
  const row=stored.get('bird-assistant.records.v1').records[0];assert.equal(row.mediaName,'校园西侧鸟鸣很长的名字.mp3');assert.equal(row.mediaKind,'audio');
});
test('late media picker callbacks cannot add files after the identification page unloads',()=>{
  storage();let picker;global.wx.chooseMessageFile=o=>picker=o;const p=page('pages/identify');p.data.importKind='audio';p.chooseFiles();p.onUnload();picker.success({tempFiles:[{path:'late.mp3',name:'late.mp3'}]});assert.equal(p.data.assets.length,0);
});
test('detail and feed reactions have independent pending operations and cannot roll each other back',async t=>{
  storage();for(const path of ['field/hub','pages/community']){
    const requests=[];t.mock.method(service,'api',(_url,_method)=>new Promise((resolve,reject)=>requests.push({resolve,reject})));
    const p=page(path),detail=path==='field/hub';p.data.id='post';if(detail)p.data.record={id:'post',reactions:[],liked:false,bookmarked:false,likes:3,hasLikes:true};else p.data.remotePosts=[{id:'post',liked:false,favorited:false,likes:3,hasLikes:true}];
    const react=kind=>detail?p.action(tap({op:kind})):p.react(tap({id:'post',kind}));
    const like=react('like'),bookmark=react('bookmark');void react('like');assert.equal(requests.length,2);assert.equal(p.data.busy,false);
    requests[1].resolve({active:true,bookmarked:true,reactions:['bookmark'],likes:999});await bookmark;
    let row=detail?p.data.record:p.data.remotePosts[0];assert.equal(row.likes,3);assert.equal(detail?row.bookmarked:row.favorited,true);
    requests[0].resolve({active:true,reactions:['like'],bookmarked:false,likes:4});await like;
    row=detail?p.data.record:p.data.remotePosts[0];assert.equal(row.likes,4);assert.equal(row.liked,true);assert.equal(detail?row.bookmarked:row.favorited,true);
    const failure=react('bookmark');requests[2].reject(new Error('offline'));await failure;row=detail?p.data.record:p.data.remotePosts[0];assert.equal(detail?row.bookmarked:row.favorited,true);assert.match(p.data.error,/offline/);t.mock.restoreAll();
  }
});
test('species controls remain usable while independent place or discussion requests are pending',async t=>{
  storage();const p=page('field/hub'),requests=[];p.data.screen='species';p.data.id='bird';p.data.busy=true;p.data.placePoint={latitude:40,longitude:116};
  p.changeTab(tap({tab:'places'}));assert.equal(p.data.tab,'places');p.changeTab(tap({tab:'posts'}));assert.equal(p.data.tab,'posts');
  t.mock.method(service,'api',(_url,_method,body)=>new Promise(resolve=>requests.push({resolve,body})));
  p.data.placeSort='distance';const near=p.loadPlaces(false);p.data.placeSort='recent';const recent=p.loadPlaces(false);assert.equal(requests[0].body.sort,'distance');
  requests[1].resolve({sort:'recent',items:[{id:'new',placeName:'Ningxia Hui',km:2}],placeCount:1,recordCount:1});await recent;
  requests[0].resolve({sort:'distance',items:[{id:'stale'}],placeCount:9});await near;
  assert.equal(p.data.placeSort,'recent');assert.equal(p.data.places[0].id,'new');assert.equal(p.data.places[0].placeName,'宁夏');assert.match(p.data.places[0].distanceLabel,/2.0/);
});
test('read-only comparison recovers at a deep detail stack without an unnecessary event channel',()=>{
  storage();const pages=Array.from({length:9},(_,i)=>({route:'field/hub/index',options:{screen:'record',id:'r'+i},data:{screen:'record',body:''}}));global.getCurrentPages=()=>pages;let target;
  global.wx.redirectTo=value=>target=value;global.wx.navigateTo=()=>assert.fail('stack should be recovered');require('../.test-build/services/field-guide.js').compareBirds(['bird']);assert.match(target.url,/field\/compare/);global.getCurrentPages=()=>[];
});
test('legacy A references expand their own source labels and never inherit a card position as coordinates',()=>{
  const old=presentTrip({...plan(),answer:'先看A3区域，再到P1。',sources:[{id:'A3',label:'北京附近公开区域'},{id:'P1',label:'颐和园'}],stops:[{name:'北京',point:{latitude:40,longitude:116}}]});
  assert.doesNotMatch(old.answer,/\b[AP]\d/);assert.match(old.answer,/颐和园/);assert.equal(old.referenceMap,undefined);assert.match(old.legacyWarning,/坐标/);
  const fresh=presentTrip({...plan(),answer:'先到P1。',referenceMap:[{id:'P1',name:'颐和园',point:{latitude:40,longitude:116.3},kind:'park'}]});assert.equal(fresh.answer,'先到颐和园。');assert.equal(fresh.legacyWarning,'');
});
test('consultations are bounded, account-separated, and corrupt history is never overwritten',()=>{
  const stored=storage();for(let i=0;i<22;i++)history.saveTripHistory('owner-a',{id:'c'+i,updated:new Date().toISOString(),conditions,turns:Array.from({length:8},(_,n)=>({question:'问题'+n,plan:plan(n),saved:new Date().toISOString()}))});
  const rows=history.readTripHistory('owner-a');assert.equal(rows.length,20);assert.equal(rows[0].id,'c21');assert.equal(rows[0].turns.length,6);assert.deepEqual(history.readTripHistory('owner-b'),[]);
  const key=[...stored.keys()][0];stored.set(key,{version:9,items:[]});assert.throws(()=>history.saveTripHistory('owner-a',rows[0]),/未覆盖/);assert.equal(stored.get(key).version,9);
});
test('saved consultations reopen after leaving, expired conversations start fresh, and logout blocks late writes',async t=>{
  const stored=storage(),requests=[];let pending,delay=false;
  t.mock.method(service,'api',async(url,_method,body)=>{if(url.endsWith('/me'))return{id:'account-a'};requests.push(body);if(delay)return new Promise(resolve=>pending=resolve);return plan(requests.length);});
  const p=page('field/trip');p.onLoad({});p.setData(conditions);p.data.question='明天看什么？';await p.ask();assert.match(p.data.historySaved,/已保存/);const key=[...stored.keys()].find(key=>key.includes('trip-history'));assert.ok(key);
  const first=stored.get(key);first.items[0].turns[0].saved='2026-01-01T00:00:00Z';stored.set(key,first);
  const next=page('field/trip');await next.openHistory(tap({id:first.items[0].id}));assert.equal(next.data.asked,'明天看什么？');assert.match(next.data.historyNotice,/历史/);next.data.question='换个时间呢？';await next.ask();assert.equal(requests[1].parentTurn,null);assert.equal(stored.get(key).items.length,1);assert.equal(stored.get(key).items[0].turns.length,2);
  delay=true;next.data.question='延迟回答';const late=next.ask();await settle();const before=JSON.stringify(stored.get(key));service.setSession(false);pending(plan(3));await late;assert.equal(JSON.stringify(stored.get(key)),before);service.setSession(true);
});

test('returning to an open consultation after account switch hides the previous account content',async t=>{
  storage();const p=page('field/trip');p._owner='old-owner';p.data.answer=plan();p.data.question='私人的追问';p.data.point={latitude:40,longitude:116.3};
  p.onHide();assert.equal(p.data.accountChecking,true);t.mock.method(history,'tripHistoryOwner',async()=> 'different-owner');await p.checkAccount();assert.equal(p.data.answer,null);assert.equal(p.data.question,'');assert.equal(p.data.point,null);assert.equal(p.data.accountChecking,false);
});
test('late consultation responses retain their original conditions and cannot enter the new consultation',async t=>{
  const stored=storage(),p=page('field/trip');let finish;
  t.mock.method(service,'api',async(url)=>url.endsWith('/me')?{id:'owner'}:new Promise(resolve=>finish=resolve));p.setData(conditions);p.data.question='旧问题';const job=p.ask();await settle();p.changed();p.setData({point:{latitude:31,longitude:121},place:'新的区域'});finish(plan());await job;
  assert.equal(p.data.answer,null);const saved=[...stored.values()].find(value=>value?.items)?.items[0];assert.equal(saved.conditions.place,'当前地图中心');assert.equal(saved.turns[0].question,'旧问题');assert.equal(p._conversation,null);
});

test('resizing an open one-result search preserves its content-sized height',()=>{
  storage();global.wx.getWindowInfo=()=>({windowWidth:390,windowHeight:844,screenHeight:844,statusBarHeight:24,safeArea:{bottom:810}});global.wx.getMenuButtonBoundingClientRect=()=>({top:30,bottom:62});
  let definition;global.Component=value=>definition=value;const file=require.resolve('../.test-build/components/field-map/index.js');delete require.cache[file];require(file);
  const p={data:structuredClone(definition.data),setData(value){Object.assign(this.data,value);}};p.data.matches=[{id:'duck'}];definition.methods.resizeMap.call(p);assert.equal(p.data.searchHeight,44);
});
