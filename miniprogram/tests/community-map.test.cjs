const {test} = require('node:test');
const assert = require('node:assert/strict');
const service=require('../.test-build/services/community.js');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function mapInstance(context,extra={}){
  let definition;global.Component=value=>definition=value;
  const entry=require.resolve('../.test-build/components/field-map/index.js');delete require.cache[entry];require(entry);
  global.wx={hideKeyboard:()=>{},getWindowInfo:()=>({windowWidth:390,windowHeight:844,screenHeight:844,statusBarHeight:24,safeArea:{bottom:810}}),getMenuButtonBoundingClientRect:()=>({top:30,bottom:62}),...extra};
  const instance={data:structuredClone(definition.data),...definition.methods,setData(changes,done){Object.assign(this.data,changes);done?.();}};
  context.after(()=>definition.lifetimes.detached.call(instance));
  return {instance,definition};
}
const group=(count=320)=>({latitude:39.9,longitude:116.4,minLatitude:39.9,maxLatitude:39.9,minLongitude:116.38,maxLongitude:116.42,count});
const nativeMap=(zoom=()=>8,west=()=>116)=>()=>({getRegion:o=>o.success({southwest:{latitude:39,longitude:west()},northeast:{latitude:40,longitude:117}}),getScale:o=>o.success({scale:zoom()})});

test('a circle tap zooms a spread cluster and immediately opens a paged shared-location list',async t=>{
  let cluster=group();const requests=[];
  t.mock.method(service,'api',async(_p,_m,q)=>{requests.push(q);return q.zoom?{total:320,clusters:[cluster]}:{items:[{id:q.cursor?'second':'first'}],nextCursor:q.cursor?'':'next',total:320};});
  const {instance}=mapInstance(t,{createMapContext:nativeMap()});await instance.load();
  assert.equal(requests[0].zoom,8);assert.equal(instance.data.markers[0].callout.content,'320 条');assert.equal(instance.data.markers[0].label,undefined);
  let queued=0;instance.queueLoad=()=>queued++;
  instance.marker({detail:{markerId:instance.data.markers[0].id}});assert.equal(instance.data.scale,10);assert.equal(queued,1);
  cluster={...group(),minLongitude:116.4,maxLongitude:116.4};await instance.load();
  instance.marker({detail:{markerId:instance.data.markers[0].id}});assert.equal(instance.data.listOpen,true);assert.equal(instance.data.recordsLoading,true);
  await settle();instance.more();await settle();assert.deepEqual(instance.data.selected.map(x=>x.id),['first','second']);assert.equal(requests.at(-1).minLongitude,116.4);
});
test('zoom-only gestures update during movement despite continuous render events, and late responses cannot win',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const requests=[];let zoom=5;
  t.mock.method(service,'api',(_p,_m,q)=>new Promise(resolve=>requests.push({q,resolve})));
  const {instance}=mapInstance(t,{createMapContext:nativeMap(()=>zoom)});
  const first=instance.load();await settle();instance.moved({type:'begin',causedBy:'scale',detail:{}});zoom=8;
  for(let i=0;i<5;i++){instance.mapUpdated();t.mock.timers.tick(40);await settle();}
  assert.deepEqual(requests.map(x=>x.q.zoom),[5,8]);
  zoom=10;t.mock.timers.tick(160);await settle();
  zoom=12;instance.moved({type:'regionchange',detail:{type:'end',causedBy:'scale'}});t.mock.timers.tick(30);await settle();
  assert.deepEqual(requests.map(x=>x.q.zoom),[5,8,10,12]);
  for(const r of requests.toReversed())r.resolve({total:r.q.zoom,clusters:[]});await first;await settle();assert.equal(instance.data.total,12);
  for(let i=0;i<10;i++){instance.mapUpdated();t.mock.timers.tick(40);await settle();}assert.equal(requests.length,4);
});
test('an open drawer compacts through pan, follows the new region, expands with fresh records and survives late responses',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const requests=[];let west=116;
  t.mock.method(service,'api',(_p,_m,q)=>new Promise(resolve=>requests.push({q,resolve})));
  const {instance,definition}=mapInstance(t,{createMapContext:nativeMap(()=>12,()=>west)});
  const loaded=instance.load();await settle();requests[0].resolve({total:20,clusters:[]});await loaded;
  instance.list();requests[1].resolve({items:[{id:'old'}],nextCursor:'next',total:20});await settle();
  instance.moved({type:'regionchange',detail:{type:'begin',causedBy:'drag'}});assert.equal(instance.data.listOpen,true);assert.equal(instance.data.sheetCollapsed,true);
  west=116.4;t.mock.timers.tick(170);await settle();
  const during=requests.find(x=>x.q.limit&&x.q.minLongitude===116.4);assert.ok(during);during.resolve({items:[{id:'moving'}],nextCursor:'',total:7});await settle();assert.equal(instance.data.sheetCollapsed,true);
  instance.moved({type:'end',detail:{causedBy:'drag'}});t.mock.timers.tick(30);await settle();
  const final=requests.filter(x=>x.q.limit).at(-1);assert.notEqual(final,during);final.resolve({items:[{id:'new'}],nextCursor:'',total:7});await settle();
  assert.equal(instance.data.listOpen,true);assert.equal(instance.data.sheetCollapsed,false);assert.equal(instance.data.listTotal,7);assert.equal(instance.data.listTitle,'本区域观察');assert.equal(instance.data.selected[0].id,'new');
  instance.more();instance.closeList();definition.pageLifetimes.hide.call(instance);
  requests.filter(x=>x.q.zoom&&x!==requests[0]).forEach(x=>x.resolve({total:99,clusters:[]}));await settle();t.mock.timers.tick(1000);assert.equal(instance.data.total,20);assert.equal(instance.data.listOpen,false);
});
test('circle taps remain responsive while clusters refresh and retain the marker filter snapshot',async t=>{
  const requests=[];t.mock.method(service,'api',(_p,_m,q)=>new Promise(resolve=>requests.push({q,resolve})));
  const {instance}=mapInstance(t,{createMapContext:nativeMap()});const cluster={...group(1),minLongitude:116.4,maxLongitude:116.4};
  const first=instance.load();await settle();requests[0].resolve({total:1,clusters:[cluster]});await first;const id=instance.data.markers[0].id;
  instance.data.species='new-filter';const next=instance.load();await settle();assert.equal(instance.data.dirty,true);
  instance.marker({detail:{markerId:id}});assert.equal(instance.data.listOpen,true);assert.equal(requests[2].q.speciesId,'');assert.equal(requests[2].q.minLongitude,116.4);
  requests[1].resolve({total:0,clusters:[]});requests[2].resolve({items:[{id:'tapped'}],nextCursor:'',total:1});await next;await settle();assert.equal(instance.data.selected[0].id,'tapped');
});
test('the first native string-ID tap opens records and uses native fitting even when the bound zoom has not changed',async t=>{
  const fits=[];t.mock.method(service,'api',async(_p,_m,q)=>q.zoom?{total:320,clusters:[group()]}:{items:[{id:'first',placeName:'Beijing'}],total:320,nextCursor:''});
  const native=nativeMap();const {instance}=mapInstance(t,{createMapContext:()=>({...native(),includePoints:options=>fits.push(options)})});
  await instance.load();const id=instance.data.markers[0].id;
  for(let i=0;i<20;i++)instance.renderClusters(8);
  assert.equal(instance.data.markers[0].id,id);instance.data.scale=10;
  instance.marker({detail:{markerId:String(id)}});
  assert.equal(instance.data.listOpen,true);assert.equal(instance.data.recordsLoading,true);assert.equal(fits.length,1);
  assert.equal(fits[0].points[0].longitude,116.38);await settle();assert.equal(instance.data.selected[0].placeName,'北京');
});
test('a user-collapsed drawer stays collapsed after pan and repeated render events do not reload its records',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});let west=116;const queries=[];
  t.mock.method(service,'api',async(_p,_m,q)=>{queries.push(q);return q.zoom?{total:1,clusters:[]}:{items:[{id:'one'}],total:1,nextCursor:''};});
  const {instance}=mapInstance(t,{createMapContext:nativeMap(()=>12,()=>west)});await instance.load();instance.list();await settle();instance.expandList();
  instance.moved({type:'begin',detail:{causedBy:'drag'}});west=116.5;instance.moved({type:'end',detail:{causedBy:'drag'}});t.mock.timers.tick(100);await settle();
  assert.equal(instance.data.listOpen,true);assert.equal(instance.data.sheetCollapsed,true);const count=queries.length;
  for(let i=0;i<5;i++){instance.mapUpdated();t.mock.timers.tick(100);await settle();}assert.equal(queries.length,count);
  instance.expandList();assert.equal(instance.data.sheetCollapsed,false);
});
test('native viewport failure is handled and an explicit retry can recover without an unhandled rejection',async t=>{
  let failed=true;const native=nativeMap();
  const {instance}=mapInstance(t,{createMapContext:()=>({...native(),getScale:o=>failed?o.fail(null):o.success({scale:12})})});
  t.mock.method(service,'api',async()=>({total:3,clusters:[]}));await instance.load();assert.match(instance.data.error,/加载失败/);assert.equal(instance.data.loading,false);
  failed=false;await instance.load();assert.equal(instance.data.error,'');assert.equal(instance.data.total,3);assert.equal(instance.data.dirty,false);
});
test('a shared-location list ignores closed requests and pages without duplicate records',async t=>{
  const pending=[];t.mock.method(service,'api',(_p,_m,q)=>new Promise(resolve=>pending.push({resolve,q})));
  const {instance}=mapInstance(t,{createMapContext:nativeMap(()=>20)});const loaded=instance.load();await settle();pending[0].resolve({total:200,clusters:[{...group(2),minLongitude:116.4,maxLongitude:116.4}]});await loaded;
  instance.marker({detail:{markerId:instance.data.markers[0].id}});assert.equal(instance.data.listTotal,2);assert.equal(instance.data.listTitle,'此位置观察');
  instance.closeList();pending[1].resolve({items:[{id:'late'}],nextCursor:'late',total:2});await settle();assert.deepEqual(instance.data.selected,[]);
  instance.list();pending[2].resolve({items:[{id:'a'}],nextCursor:'next',total:200});await settle();
  instance.more();instance.more();assert.equal(pending.length,4);assert.equal(pending[3].q.cursor,'next');pending[3].resolve({items:[{id:'a'},{id:'b'}],nextCursor:'',total:200});await settle();assert.deepEqual(instance.data.selected.map(x=>x.id),['a','b']);
});
test('boundary drawers meet the tab bar with no clear footer while keeping at least half the phone map',()=>{
  const {mapPanes,clusterMarker,INDIVIDUAL_PIN_ZOOM}=require('../.test-build/services/map-presentation.js');
  for(const [width,height] of [[320,330],[390,676],[768,850],[1024,260],[1440,700]]){
    const p=mapPanes(width,height);assert.equal(p.toolbarHeight+p.mapHeight,height);assert.equal(p.creditReserve,0);assert.ok(p.listHeight>0);
    if(!p.wide)assert.ok(p.sheetHeight<=p.mapHeight*.46);assert.equal(p.listHeight+p.sheetHeaderHeight+p.creditReserve,p.sheetHeight);
  }
  const single=clusterMarker({latitude:39,longitude:116,count:1},0,INDIVIDUAL_PIN_ZOOM-1);assert.equal(single.callout.content,'1 条');assert.equal(single.label,undefined);
  const pin=clusterMarker({latitude:39,longitude:116,count:1},0,INDIVIDUAL_PIN_ZOOM);assert.equal(pin.label,undefined);assert.equal(pin.width,40);assert.ok(!pin.iconPath.endsWith('pin.png'));
  const fs=require('node:fs'),markup=fs.readFileSync('miniprogram/components/field-map/index.wxml','utf8');assert.match(markup,/height:\{\{mapHeight\}\}px/);assert.doesNotMatch(markup,/mapHeight-sheetHeight|catch(?:touch|:touch)/);
});
test('species search dismisses the keyboard and discards a late response after edit, close and page hide',async t=>{
  const requests=[];t.mock.method(service,'api',()=>new Promise(resolve=>requests.push(resolve)));
  let hidden=0;const {instance,definition}=mapInstance(t,{hideKeyboard:()=>hidden++});
  instance.data.keyword='喜鹊';const first=instance.search();instance.input({detail:{value:'鸳鸯'}});requests[0]({items:[{id:'old',name:'喜鹊'}]});await first;assert.deepEqual(instance.data.matches,[]);
  const second=instance.search();instance.closeSearch();requests[1]({items:[{id:'closed'}]});await second;assert.deepEqual(instance.data.matches,[]);assert.equal(hidden,1);
  const third=instance.search();definition.pageLifetimes.hide.call(instance);requests[2]({items:[{id:'hidden'}]});await third;assert.deepEqual(instance.data.matches,[]);assert.equal(instance.data.searching,false);
});

test('an unavailable observation image collapses its media box and a refreshed record can try again',async context=>{
  const service=require('../.test-build/services/community.js');
  context.mock.method(service,'api',async()=>({id:'obs_1',speciesName:'灰喜鹊',source:'iNaturalist',image:'https://example.invalid/photo.jpg',visibility:'public'}));
  context.mock.method(service,'sessionState',()=> 'out');
  context.mock.method(service,'imageUrl',value=>value||'');
  let definition;global.Page=value=>definition=value;global.wx={getWindowInfo:()=>({windowWidth:390})};
  const entry=require.resolve('../.test-build/field/hub/index.js');delete require.cache[entry];require(entry);
  const page={...definition,data:{...structuredClone(definition.data),screen:'record',id:'obs_1'},setData(changes){Object.assign(this.data,changes);}};
  await page.load();page.photoLoaded({detail:{width:1200,height:400}});assert.ok(page.data.photoHeight<120);
  page.photoError();assert.equal(page.data.photoFailed,true);
  const fs=require('node:fs'),markup=fs.readFileSync('miniprogram/field/hub/index.wxml','utf8');assert.match(markup,/wx:if="\{\{photo && !photoFailed\}\}"/);assert.match(markup,/class="photo-unavailable"/);
  await page.load();assert.equal(page.data.photoFailed,false);assert.ok(page.data.photo);page.onUnload();
});
