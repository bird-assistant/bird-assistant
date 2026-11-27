const {test}=require('node:test');
const assert=require('node:assert/strict');
const service=require('../.test-build/services/community.js');
const {navigate}=require('../.test-build/services/navigation.js');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function stackHarness(t){
  const pages=[{route:'pages/community/index',options:{},data:{}}],failures=[],channels=[];
  const make=url=>{const [route,query]=url.replace(/^\//,'').split('?'),options=Object.fromEntries(new URLSearchParams(query));return {route,options,data:{screen:options.screen,body:''}};};
  t.mock.method(global,'getCurrentPages',()=>pages);
  global.wx={showToast:o=>failures.push(o.title),navigateTo(o){if(pages.length===10){o.fail?.({errMsg:'navigateTo:fail webview count limit exceed'});return;}pages.push(make(o.url));channels.push(o.events);o.success?.({eventChannel:{emit(){}}});},redirectTo(o){pages.splice(-1,1,make(o.url));},navigateBack(o){pages.splice(pages.length-(o.delta||1));},switchTab(){pages.splice(1);}};
  return {pages,failures,channels};
}
global.getCurrentPages=()=>[];
test('related links survive 120 consecutive visits, reuse existing details, and do not lock after a failure',t=>{
  const h=stackHarness(t);
  for(let i=0;i<120;i++)navigate({url:'/field/hub/index?screen=record&id='+i});
  assert.equal(h.pages.length,9);assert.equal(h.pages.at(-1).options.id,'119');assert.deepEqual(h.failures,[]);
  navigate({url:'/field/hub/index?id=0&screen=record'});assert.equal(h.pages.length,2);
  global.wx.navigateTo=o=>o.fail({errMsg:'transient native failure'});navigate({url:'/field/hub/index?screen=species&id=next'});assert.equal(h.failures.length,1);
  let called=0;global.wx.navigateTo=()=>called++;navigate({url:'/field/hub/index?screen=species&id=next'});assert.equal(called,1);
});
test('detail navigation preserves an unsent reply and reserves the last slot for event-channel pickers',t=>{
  const h=stackHarness(t);navigate({url:'/field/hub/index?screen=record&id=original'});navigate({url:'/field/hub/index?screen=record&id=reply'});h.pages.at(-1).data.body='unsent reply';
  navigate({url:'/field/hub/index?screen=record&id=original'});assert.equal(h.pages.length,4);assert.equal(h.pages[2].data.body,'unsent reply');
  for(let i=0;i<30;i++)navigate({url:'/field/hub/index?screen=species&id='+i});assert.equal(h.pages.length,9);
  const receive=()=>{};navigate({url:'/field/picker/index',events:{point:receive}});assert.equal(h.pages.length,10);assert.equal(h.channels.at(-1).point,receive);assert.equal(h.pages[2].data.body,'unsent reply');
});
const cell=(latitude,longitude,count=1)=>({latitude,longitude,count,minLatitude:latitude,maxLatitude:latitude,minLongitude:longitude,maxLongitude:longitude});
test('projected circles never overlap, conserve every count, split on zoom in and merge on zoom out',()=>{
  const {spacedClusters,mapPixel}=require('../.test-build/services/map-clusters.js');
  const cells=Array.from({length:36},(_,i)=>cell(39.9+Math.floor(i/6)*.001,116.3+(i%6)*.001,i+1));
  const total=cells.reduce((sum,row)=>sum+row.count,0),counts=[];
  for(const zoom of [10,11,12,13,14,15,16,17]){
    const groups=spacedClusters(cells,zoom);counts.push(groups.length);assert.equal(groups.reduce((sum,row)=>sum+row.count,0),total);
    for(let i=0;i<groups.length;i++)for(let j=i+1;j<groups.length;j++){const a=mapPixel(groups[i],zoom),b=mapPixel(groups[j],zoom);assert.ok(Math.hypot(a.x-b.x,a.y-b.y)>=44-.0001);}
  }
  assert.ok(counts.at(-1)>counts[0]);assert.equal(spacedClusters(cells,10).length,1);
  const wrapped=spacedClusters([cell(0,179.999,2),cell(0,-179.999,3)],8)[0];assert.equal(wrapped.count,5);assert.equal(wrapped.minLongitude,179.999);assert.equal(wrapped.maxLongitude,-179.999);
  const same=spacedClusters([cell(39.99,116.32),cell(39.99,116.32)],20)[0];assert.equal(same.minLongitude,116.32);assert.equal(same.maxLongitude,116.32);
  assert.equal(spacedClusters(Array.from({length:100},()=>cell(40,116)),20).length,1);
});
function map(t,context){
  let definition;global.Component=value=>definition=value;const path=require.resolve('../.test-build/components/field-map/index.js');delete require.cache[path];require(path);
  global.wx={createMapContext:()=>context,hideKeyboard(){},getStorageSync(){},nextTick:f=>f()};
  const instance={data:structuredClone(definition.data),...definition.methods,setData(patch,done){Object.assign(this.data,patch);done?.();}};
  t.after(()=>definition.lifetimes.detached.call(instance));return {instance,definition};
}
test('a zoom end payload wins over stale native getScale/getRegion and works without a drag or begin event',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const queries=[];
  t.mock.method(service,'api',async(_p,_m,q)=>{queries.push(q);return {total:4,clusters:[cell(40,116,4)]};});
  const old={southwest:{latitude:39,longitude:115},northeast:{latitude:41,longitude:117}},fresh={southwest:{latitude:39.99,longitude:115.99},northeast:{latitude:40.01,longitude:116.01}};
  const {instance}=map(t,{getRegion:o=>o.success(old),getScale:o=>o.success({scale:8})});await instance.load();
  instance.moved({type:'end',causedBy:'scale',detail:{scale:15,region:fresh,centerLocation:{latitude:40,longitude:116}}});t.mock.timers.tick(1);await settle();
  assert.equal(queries.at(-1).zoom,15);assert.equal(queries.at(-1).minLatitude,39.99);
  await instance.updateViewport(false);assert.equal(instance.data._zoom,15);assert.equal(queries.length,2);
});
test('a visible map observes zoom-only API changes, releases its native surface when hidden and remounts on return',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});let scale=8;const queries=[];
  t.mock.method(service,'api',async(_p,_m,q)=>{queries.push(q);return {total:0,clusters:[]};});
  const {instance,definition}=map(t,{getRegion:o=>o.success({southwest:{latitude:39,longitude:115},northeast:{latitude:41,longitude:117}}),getScale:o=>o.success({scale})});await instance.load();instance.watchViewport();
  scale=12;t.mock.timers.tick(240);await settle();assert.equal(queries.at(-1).zoom,12);
  definition.pageLifetimes.hide.call(instance);assert.equal(instance.data.nativeActive,false);const before=queries.length;t.mock.timers.tick(5000);await settle();assert.equal(queries.length,before);
  definition.pageLifetimes.show.call(instance);await settle();assert.equal(instance.data.nativeActive,true);assert.equal(queries.length,before+1);
});
test('a lost native viewport callback times out and a later retry still succeeds',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const context={getRegion(){},getScale(){}};const {instance}=map(t,context);
  instance.data.loading=true;instance.data._seq=5;const pending=instance.load();t.mock.timers.tick(1800);await pending;assert.match(instance.data.error,/加载失败/);assert.equal(instance.data.loading,false);
  context.getRegion=o=>o.success({southwest:{latitude:39,longitude:115},northeast:{latitude:41,longitude:117}});context.getScale=o=>o.success({scale:12});
  t.mock.method(service,'api',async()=>({total:7,clusters:[]}));await instance.load();assert.equal(instance.data.total,7);assert.equal(instance.data.error,'');
});
test('author photography settings survive the old-server caption format and never include undeclared EXIF fields',()=>{
  const {withPhotoDetails,readPhotoDetails,cleanPhotoDetails}=require('../.test-build/services/photo-details.js');
  const camera={device:'Sony α7 IV',resolution:'6000 × 4000 px',iso:'800',exposure:'1/2000 s',focusMode:'AF-C',whiteBalance:'AWB',exposureBias:'+0.3 EV',serial:'private',latitude:'39.9'};
  const expected=cleanPhotoDetails(camera),body=withPhotoDetails('原始正文',camera);assert.equal(expected.serial,undefined);assert.equal(expected.latitude,undefined);
  assert.deepEqual(readPhotoDetails(body),{body:'原始正文',camera:expected});assert.throws(()=>withPhotoDetails('x'.repeat(1999),camera),/2000/);
  const view=require('../.test-build/services/forum.js').forumPost({body});assert.equal(view.body,'原始正文');assert.deepEqual(view.manualCamera,expected);
  const info=require('../.test-build/services/photo-info.js').photoInfo(view.manualCamera,'作者填写');assert.equal(info.source,'作者填写');assert.ok(info.settings.some(row=>row.key==='focusMode'&&row.value==='AF-C'));
});

function page(name){
  let definition;global.Page=value=>definition=value;const file=require.resolve('../.test-build/'+name+'/index.js');delete require.cache[file];require(file);
  const result={data:structuredClone(definition.data),setData(values,done){Object.assign(this.data,values);done?.();}};
  for(const [key,value] of Object.entries(definition))if(key!=='data')result[key]=typeof value==='function'?value.bind(result):structuredClone(value);
  return result;
}
function windowFake(){return {getWindowInfo:()=>({windowWidth:390,windowHeight:844,screenHeight:844,statusBarHeight:24}),getMenuButtonBoundingClientRect:()=>({top:30,bottom:62}),nextTick:f=>f(),pageScrollTo(){},setNavigationBarTitle(){},showToast(){}};}
test('the pull header appears during the gesture and a hidden stale refresh cannot clear a newer refresh',async t=>{
  global.wx=windowFake();const requests=[];t.mock.method(service,'api',()=>new Promise(resolve=>requests.push(resolve)));
  const p=page('pages/community');p.onLoad();p.pulling({detail:{dy:20}});assert.ok(p.data.pullProgress>0);assert.equal(p.data.pullReady,false);
  p.pulling({detail:{dy:70}});assert.equal(p.data.pullReady,true);const first=p.pullRefresh();assert.equal(p.data.refreshing,true);await p.pullRefresh();assert.equal(requests.length,1);
  p.onHide();p.onShow();const latest=p.pullRefresh();requests[0]({items:[]});await first;assert.equal(p.data.refreshing,true);
  requests[2]({items:[{id:'fresh'}]});await latest;requests[1]({items:[{id:'stale'}]});await settle();assert.equal(p.data.refreshing,false);assert.equal(p.data.remotePosts[0].id,'fresh');p.onUnload();
});
test('optional camera settings survive a durable compose draft and the unchanged old-server preview contract',async t=>{
  const storage=new Map();global.wx={...windowFake(),setStorageSync:(key,value)=>storage.set(key,structuredClone(value)),getStorageSync:key=>storage.get(key)};
  t.mock.method(service,'hub',()=>{});const p=page('pages/community');p.onLoad();p.data.title='观察';p.data.body='我的笔记';p.setImages([require('../.test-build/services/post-media.js').postImage('/assets/bird.jpg')]);p.photoDetails({detail:{device:'Nikon Z8',iso:'1600',focusMode:'AF-C'}});p.saveDraft();await settle();
  const fresh=page('pages/community');fresh.onLoad();fresh.loadDraft();assert.equal(fresh.data.manualCamera.iso,'1600');fresh.publish();
  const h=page('field/hub');h.onLoad({screen:'publish',id:'compose'});h.data.shareCamera=true;
  t.mock.method(service,'uploadPhoto',async()=>({id:'photo',camera:{model:'Nikon Z8',iso:'1600',exposure:'0.0005'}}));
  const sent=[];t.mock.method(service,'api',async(path,method,data)=>{sent.push({path,method,data});return {id:'preview',display:{post:data}};});
  await h.prepare({currentTarget:{dataset:{}}});assert.equal(h.data.error,'');assert.ok(h.data.preview);
  const request=sent[0].data;assert.equal(request.camera,undefined);assert.equal(request.share_camera,true);
  const post=require('../.test-build/services/forum.js').forumPost({body:request.body});assert.equal(post.body,'我的笔记');assert.equal(post.manualCamera.focusMode,'AF-C');assert.equal(post.embeddedCamera.iso,'1600');
  assert.equal(post.embeddedCamera.model,undefined);p.onUnload();fresh.onUnload();h.onUnload();
});
test('private map links request a close view while coarse public links keep their precision label',()=>{
  global.wx={...windowFake(),switchTab(){}};const h=page('field/hub');
  h.data.record={visibility:'private',displayLocation:{latitude:39.991234,longitude:116.312345}};h.viewMap();const precise=service.takeMapFocus();assert.equal(precise.scale,17);assert.equal(precise.latitude,39.991234);assert.equal(precise.scope,2);
  h.data.record={visibility:'public',precisionLabel:'约一公里公开网格',displayLocation:{latitude:39.99,longitude:116.31}};h.viewMap();const publicPoint=service.takeMapFocus();assert.equal(publicPoint.scale,13);assert.match(publicPoint.focusLabel,/非精确拍摄点/);
});
test('a forum author can open the authorized original point and a hidden page cannot trigger a late map jump',async t=>{
  global.wx={...windowFake(),switchTab(){}};const pending=[];
  t.mock.method(service,'api',(path)=>new Promise(resolve=>pending.push({path,resolve})));
  const p=page('field/hub');p.data.record={ownedSighting:'obs_owner',displayLocation:{latitude:39.9,longitude:116.3},visibility:'public'};
  const first=p.viewMap();assert.equal(pending[0].path,'/api/v1/map/observations/obs_owner');
  pending[0].resolve({id:'obs_owner',visibility:'private',displayLocation:{latitude:39.991234,longitude:116.312345}});await first;
  const focus=service.takeMapFocus();assert.equal(focus.scale,17);assert.equal(focus.latitude,39.991234);assert.equal(focus.scope,2);assert.equal(p.data.mapOpening,false);
  const late=p.viewMap();p.onHide();assert.equal(p.data.mapOpening,false);
  pending[1].resolve({id:'obs_owner',visibility:'private',displayLocation:{latitude:40,longitude:116}});await late;assert.equal(service.takeMapFocus(),null);p.onUnload();
});
test('a slow trip-center read cannot navigate after leaving, and a lost callback has a bounded fallback',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const callbacks=[],visits=[];
  const {instance,definition}=map(t,{getCenterLocation:o=>callbacks.push(o)});global.wx.navigateTo=o=>visits.push(o.url);
  const first=instance.planTrip();definition.pageLifetimes.hide.call(instance);callbacks[0].success({latitude:40,longitude:116});await first;assert.deepEqual(visits,[]);
  instance.data._visible=true;const retry=instance.planTrip();t.mock.timers.tick(1800);await retry;assert.deepEqual(visits,['/field/trip/index']);
  callbacks[1].success({latitude:40,longitude:116});await settle();assert.equal(visits.length,1);
});
test('zoom and clue controls collapse independently without pausing the camera or removing the shutter',()=>{
  global.wx={...windowFake(),createCameraContext:()=>({})};const p=page('pages/identify');p.onLoad();assert.equal(p.data.zoomOpen,false);assert.equal(p.data.clueCollapsed,true);
  p.toggleClues();assert.equal(p.data.clueCollapsed,false);p.toggleZoom();assert.equal(p.data.zoomOpen,true);assert.equal(p.data.paused,false);
  p.clueStart({touches:[{clientX:30,clientY:30}]});p.clueMove({touches:[{clientX:32,clientY:75}]});p.clueEnd();p.toggleClues();assert.equal(p.data.clueCollapsed,true);assert.equal(p.data.zoomOpen,true);p.onUnload();
});
