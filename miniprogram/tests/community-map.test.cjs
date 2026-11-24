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
  instance.mapUpdated();
  await settle();
  assert.equal(requests[3].query.minLongitude,116.4);
  instance.moved({type:'end'});
  component.lifetimes.detached.call(instance);
  requests[3].resolve({total:40,clusters:[]});
  await settle();
  assert.equal(requests.length,4);
  assert.equal(instance.data.total,30);
});
