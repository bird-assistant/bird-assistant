const {test} = require('node:test');
const assert = require('node:assert/strict');

function openPage(screen, id, dispatch) {
  let config;
  const urls = [];
  const storage = new Map();
  global.Page = options => { config = options; };
  global.wx = {
    getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value),
    setNavigationBarTitle() {}, navigateTo: options => urls.push(options.url),
    showModal: options => options.success({confirm:true}),
    login: options => options.success({code:'test-code'}),
    request(options) {
      const path = new URL(options.url).pathname;
      if(path.endsWith('/auth/wechat')) return options.success({statusCode:200, data:{access_token:'test', expires_in:3600}});
      const reply = dispatch(path.replace('/api/v1/community',''),options);
      options.success({statusCode:reply.status || 200, data:reply.data});
    }
  };
  const pagePath = require.resolve('../.test-build/field/social/index.js');
  delete require.cache[pagePath];
  require(pagePath);
  const instance = {...config, data: structuredClone(config.data), setData(values){Object.assign(this.data,values);}};
  instance.onLoad({screen,id});instance.onShow();
  return {instance,urls};
}

test('community registration preserves the requested friends page and logout clears private results',async()=>{
  let profile=null;
  const {instance,urls}=openPage('friends','',(path,options)=>{
    if(path==='/account'){
      if(options.method==='PUT')profile={...options.data,id:'mine'};
      return {data:{id:'mine',profile}};
    }
    if(path==='/friends')return {data:{items:[{id:'peer',nickname:'蓝鹊',relationship:'incoming'}]}};
    throw new Error(path);
  });
  try{
    assert.equal(instance.data.active,false);
    await instance.login();assert.equal(instance.data.registered,false);
    instance.setData({form:{...instance.data.form,nickname:'山雀',handle:'tit_22'}});
    await instance.save();assert.equal(instance.data.screen,'friends');
    assert.equal(instance.data.incoming[0].nickname,'蓝鹊');
    instance.go({currentTarget:{dataset:{screen:'member',id:'peer'}}});
    assert.match(urls[0],/field\/social\/index\?screen=member&id=peer$/);
    await instance.logout();assert.equal(instance.data.active,false);assert.equal(instance.data.incoming.length,0);
    const service=require('../.test-build/services/community.js');
    await assert.rejects(service.api(service.community+'/inbox'),/重新登录/);
  } finally {instance.onUnload();}
});

test('a failed message retains its draft and reuses the same request identifier on retry',async()=>{
  const references=[];
  const {instance}=openPage('chat','peer',(path,options)=>{
    if(path==='/account')return {data:{id:'mine',profile:{id:'mine',nickname:'本人'}}};
    if(path==='/members/peer')return {data:{profile:{id:'peer',nickname:'夜鹭'},canMessage:true}};
    if(path==='/messages/peer' && options.method==='POST'){
      references.push(options.data.reference);return {status:references.length===1?503:201,data:{id:'sent'}};
    }
    if(path==='/messages/peer')return {data:{items:[{id:'hello',sender:'peer',created:'2026-11-24T01:00:00Z',body:'你好'}]}};
    if(path==='/messages/peer/read/hello')return {data:{read:true}};
    throw new Error(path);
  });
  try{
    await instance.login();assert.equal(instance.data.lines.length,1);
    assert.match(instance.data.lines[0].timeLabel,/09:00/);
    instance.input({currentTarget:{dataset:{field:'text'}},detail:{value:'明天见'}});
    await instance.send();assert.equal(instance.data.text,'明天见');
    await instance.send();assert.equal(instance.data.text,'');assert.equal(instance.data.lines.length,1);
    assert.ok(references[0]);assert.deepEqual(references,[references[0],references[0]]);
  } finally {instance.onUnload();}
});
