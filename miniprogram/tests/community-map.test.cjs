const {test} = require('node:test');
const assert = require('node:assert/strict');

test('the live map zooms into a cluster and pages through observations at a shared location', async () => {
  let component;
  global.Component = value => { component = value; };
  require('../.test-build/components/field-map/index.js');
  const service = require('../.test-build/services/community.js');
  const original = service.api;
  const requests = [];
  const cluster = {latitude:39.9,longitude:116.4,minLatitude:39.9,maxLatitude:39.9,
    minLongitude:116.38,maxLongitude:116.42,count:320};
  service.api = async (path, method, data) => {
    requests.push(data);
    if (data.zoom) return {total:320,clusters:[cluster]};
    return {items:[{id:data.cursor?'second':'first'}],nextCursor:data.cursor?'':'next'};
  };
  global.wx = {createMapContext:() => ({
    getRegion:options => options.success({southwest:{latitude:39,longitude:116},northeast:{latitude:40,longitude:117}}),
    getScale:options => options.success({scale:8})
  })};
  const instance = {data:structuredClone(component.data),...component.methods,
    setData(changes, done){Object.assign(this.data, changes);done?.();}};
  try {
    await instance.load();
    assert.equal(requests[0].zoom,8);
    assert.equal(instance.data.markers[0].callout.content,'320 条');
    let reloads=0;
    instance.queueLoad=()=>{reloads++;};
    instance.marker({detail:{markerId:1}});
    assert.equal(instance.data.scale,10);
    assert.equal(reloads,1);
    instance.data._groups=[{...cluster,minLongitude:116.4,maxLongitude:116.4}];
    instance.marker({detail:{markerId:1}});
    await new Promise(resolve=>setImmediate(resolve));
    instance.more();
    await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(instance.data.selected.map(row=>row.id),['first','second']);
    assert.equal(requests.at(-1).minLongitude,116.4);
    assert.equal(requests.at(-1).maxLongitude,116.4);
  } finally { service.api=original; }
});

test('native zoom and render events refresh the settled viewport and discard late cluster responses', async context => {
  let component;
  global.Component = value => { component = value; };
  const entry = require.resolve('../.test-build/components/field-map/index.js');
  delete require.cache[entry];
  require(entry);
  context.mock.timers.enable({apis:['setTimeout']});
  const service = require('../.test-build/services/community.js');
  const requests = [];
  context.mock.method(service,'api',(_path,_method,query)=>new Promise(resolve=>requests.push({query,resolve})));
  let zoom = 5;
  let west = 116;
  global.wx = {createMapContext:()=>({
    getRegion:options=>options.success({southwest:{latitude:39,longitude:west},northeast:{latitude:40,longitude:117}}),
    getScale:options=>options.success({scale:zoom})
  })};
  const instance = {data:structuredClone(component.data),...component.methods,
    setData(changes){Object.assign(this.data,changes);}};
  const settle = async()=>{context.mock.timers.tick(300);await new Promise(resolve=>setImmediate(resolve));};
  const first = instance.load();
  await settle();
  zoom = 8;
  instance.moved({type:'end',causedBy:'scale',detail:{}});
  await settle();
  assert.deepEqual(requests.map(request=>request.query.zoom),[5,8]);
  zoom = 10;
  instance.moved({type:'regionchange',detail:{type:'end'}});
  zoom = 12;
  instance.moved({type:'regionchange',detail:{type:'end',causedBy:'scale'}});
  await settle();
  assert.deepEqual(requests.map(request=>request.query.zoom),[5,8,12]);
  requests[2].resolve({total:30,clusters:[]});
  requests[1].resolve({total:20,clusters:[]});
  requests[0].resolve({total:10,clusters:[]});
  await first;
  assert.equal(instance.data.total,30);
  instance.data.listOpen=true;
  instance.mapUpdated();
  await settle();
  assert.equal(requests.length,3);
  assert.equal(instance.data.listOpen,true);
  west=116.4;
  instance.moved({type:'end',detail:{causedBy:'drag'}});
  await settle();
  assert.equal(instance.data.listOpen,false);
  assert.equal(requests[3].query.minLongitude,116.4);
  instance.moved({type:'end'});
  component.lifetimes.detached.call(instance);
  requests[3].resolve({total:40,clusters:[]});
  await settle();
  assert.equal(requests.length,4);
  assert.equal(instance.data.total,30);
});

function mapInstance(context,extra={}){
  let definition;global.Component=value=>definition=value;
  const entry=require.resolve('../.test-build/components/field-map/index.js');delete require.cache[entry];require(entry);
  global.wx={hideKeyboard:()=>{},getWindowInfo:()=>({windowWidth:390,windowHeight:844,screenHeight:844,statusBarHeight:24,safeArea:{bottom:810}}),getMenuButtonBoundingClientRect:()=>({top:30,bottom:62}),...extra};
  const instance={data:structuredClone(definition.data),...definition.methods,setData(changes,done){Object.assign(this.data,changes);done?.();}};
  context.after(()=>definition.lifetimes.detached.call(instance));
  return {instance,definition};
}
test('map panes fit short, phone, tablet and desktop with an attribution-bearing map beside or above the sheet',()=>{
  const {mapPanes}=require('../.test-build/services/map-presentation.js');
  for(const [width,height]of [[320,330],[390,676],[768,850],[1024,260],[1440,700]]){
    const pane=mapPanes(width,height);assert.equal(pane.toolbarHeight+pane.mapHeight,height);
    if(pane.wide){assert.equal(pane.sheetHeight,pane.mapHeight);assert.ok(pane.drawerWidth<width);}
    else assert.ok(pane.mapHeight-pane.sheetHeight>=120);
    assert.ok(pane.listHeight>0);
    assert.equal(pane.sheetHeaderHeight+pane.listHeight+12,pane.sheetHeight);assert.equal(pane.wide,width>=700);
  }
  assert.equal(mapPanes(1024,260).compact,true);
});
test('species search dismisses the keyboard and discards a late response after edit, close and page hide',async context=>{
  const service=require('../.test-build/services/community.js'),requests=[];
  context.mock.method(service,'api',()=>new Promise(resolve=>requests.push(resolve)));
  let hidden=0;const {instance,definition}=mapInstance(context,{hideKeyboard:()=>hidden++});
  instance.data.keyword='喜鹊';const first=instance.search();instance.input({detail:{value:'鸳鸯'}});requests[0]({items:[{id:'old',name:'喜鹊'}]});await first;assert.deepEqual(instance.data.matches,[]);
  const second=instance.search();instance.closeSearch();requests[1]({items:[{id:'closed'}]});await second;assert.deepEqual(instance.data.matches,[]);assert.equal(hidden,1);
  const third=instance.search();definition.pageLifetimes.hide.call(instance);requests[2]({items:[{id:'hidden'}]});await third;assert.deepEqual(instance.data.matches,[]);assert.equal(instance.data.searching,false);
});
test('a shared-location list uses its own count, ignores closed requests, then pages without duplicate records',async context=>{
  const service=require('../.test-build/services/community.js'),pending=[];
  context.mock.method(service,'api',(_path,_method,query)=>new Promise(resolve=>pending.push({resolve,query})));
  const {instance}=mapInstance(context);instance.data.total=200;instance.data._zoom=20;
  instance.data._groups=[{latitude:39.9,longitude:116.4,minLatitude:39.9,maxLatitude:39.9,minLongitude:116.4,maxLongitude:116.4,count:2}];
  instance.marker({detail:{markerId:1}});assert.equal(instance.data.listTotal,2);assert.equal(instance.data.listTitle,'此位置观察');
  instance.closeList();pending[0].resolve({items:[{id:'late'}],nextCursor:'late',total:2});await new Promise(resolve=>setImmediate(resolve));assert.equal(instance.data.listOpen,false);assert.deepEqual(instance.data.selected,[]);
  instance.list();pending[1].resolve({items:[{id:'a'}],nextCursor:'next',total:200});await new Promise(resolve=>setImmediate(resolve));assert.equal(instance.data.listTotal,200);assert.equal(instance.data.listTitle,'本区域观察');
  instance.more();instance.more();assert.equal(pending.length,3);assert.equal(pending[2].query.cursor,'next');pending[2].resolve({items:[{id:'a'},{id:'b'}],nextCursor:'',total:200});await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(instance.data.selected.map(x=>x.id),['a','b']);
});
test('map markers avoid persistent labels and component controls do not capture native map gestures',()=>{
  const {clusterMarker}=require('../.test-build/services/map-presentation.js'),fs=require('node:fs');
  const cluster=clusterMarker({latitude:39,longitude:116,count:320},0),single=clusterMarker({latitude:39,longitude:116,count:1},1);
  assert.equal(cluster.callout.display,'BYCLICK');assert.equal(cluster.label.content,'320');assert.equal(single.label,undefined);assert.equal(single.width,26);
  const markup=fs.readFileSync('miniprogram/components/field-map/index.wxml','utf8');
  assert.match(markup,/<scroll-view[^>]*class="record-scroll"[^>]*height:\{\{listHeight\}\}px/);assert.doesNotMatch(markup,/catch(?:touch|:touch)/);
  const css=fs.readFileSync('miniprogram/components/field-map/index.wxss','utf8');assert.doesNotMatch(css,/(?:^|[},])\s*(?:button|view|input|text|picker)(?:\W|$)/m);assert.doesNotMatch(css,/53vh/);
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
