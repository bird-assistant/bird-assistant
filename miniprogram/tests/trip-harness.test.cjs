const {test}=require('node:test');
const assert=require('node:assert/strict');

test('a trip retry reuses its request id, a followup uses its parent, and new consultations clear history',async()=>{
  let config;
  global.Page=value=>{config=value;};
  const requests=[];
  global.wx={getStorageSync(){return '';},login:options=>options.success({code:'test'}),request(options){
    if(options.url.endsWith('/auth/wechat'))return options.success({statusCode:200,data:{access_token:'test',expires_in:3600}});
    requests.push(structuredClone(options.data));
    if(requests.length===1)return options.fail({errMsg:'timeout'});
    options.success({statusCode:200,data:{turn:'turn'+requests.length,answer:'回答',stops:[],parks:[],
      start:'2026-11-25T07:00:00+08:00',end:'2026-11-25T09:00:00+08:00'}});
  }};
  require('../.test-build/field/trip/index.js');
  const instance={...config,data:structuredClone(config.data),setData(change){Object.assign(this.data,change);}};
  instance.onLoad({lat:'39.9',lon:'116.4'});
  instance.setData({question:'明早去哪里？'});
  await instance.ask();assert.equal(instance.data.question,'明早去哪里？');
  await instance.ask();assert.equal(requests[0].requestId,requests[1].requestId);
  instance.setData({question:'带孩子呢？'});await instance.ask();
  assert.equal(requests[2].parentTurn,'turn2');assert.equal(instance.data.exchanges.length,1);
  instance.restart();assert.equal(instance.data.answer,null);assert.deepEqual(instance.data.exchanges,[]);
});
