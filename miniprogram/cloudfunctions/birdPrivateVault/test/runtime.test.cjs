const {test}=require('node:test'),assert=require('node:assert/strict');
// Offline tests may use only their own loopback HTTP fixture; SDK/metadata/cloud egress is disabled.
const http=require('node:http'),https=require('node:https');
function loopbackOnly(original){return function(...args){const value=args[0],host=typeof value==='string'||value instanceof URL?new URL(value).hostname:value?.hostname||value?.host;if(host!=='127.0.0.1')throw Error('External and instance-metadata access disabled in offline SDK tests');return original.apply(this,args);};}
http.request=loopbackOnly(http.request);http.get=loopbackOnly(http.get);
https.request=https.get=()=>{throw Error('External and instance-metadata access disabled in offline SDK tests');};
global.fetch=async()=>{throw Error('External and instance-metadata access disabled in offline SDK tests');};
const {documentStore}=require('../store.cjs');

test('maintained Lodash adapters preserve ordinary SDK paths and block string/array prototype traversal',()=>{
 const set=require('lodash.set'),unset=require('lodash.unset'),object={};set(object,'items[0].name','lake');assert.equal(object.items[0].name,'lake');assert.equal(unset(object,['items','0','name']),true);assert.equal(object.items[0].name,undefined);
 for(const path of ['__proto__.birdPolluted','constructor.prototype.birdPolluted',['__proto__','birdPolluted'],['constructor','prototype','birdPolluted']])set({},path,'bad');assert.equal(Object.prototype.birdPolluted,undefined);
 Object.prototype.birdGuard='keep';try{unset({},['constructor','prototype','birdGuard']);assert.equal(Object.prototype.birdGuard,'keep');}finally{delete Object.prototype.birdGuard;}
 assert.equal(require('lodash/package.json').version,'4.18.1');
});
test('patched legacy Axios keeps Node request/response behavior for the SDK transport',async t=>{
 const http=require('node:http'),axios=require('axios'),server=http.createServer((req,res)=>{let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({method:req.method,payload:JSON.parse(body)}));});});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const result=await axios.post('http://127.0.0.1:'+server.address().port+'/sdk-fixture',{safe:'owned local test'},{proxy:false,timeout:2000});assert.deepEqual(result.data,{method:'POST',payload:{safe:'owned local test'}});assert.equal(require('axios/package.json').version,'0.34.0');
});
test('the pinned Node SDK serializes the store adapter into bounded document reads and conditional writes',async t=>{
 const {Db}=require('@cloudbase/database'),previous=Db.reqClass,requests=[];
 Db.reqClass=class {async send(action,params){requests.push({action,params});if(action==='database.getDocument')return {data:{list:[]}};if(action==='database.insertDocument')return {data:{insertedIds:['owner']}};if(action==='database.modifyDocument')return {data:{updated:1}};throw Error('unexpected SDK request');}};
 t.after(()=>Db.reqClass=previous);const db=new Db({env:'offline-parser-fixture'}),store=documentStore(db);assert.equal(await store.read('owner'),null);assert.equal(await store.compareAndSwap('owner',0,{revision:1}),true);assert.equal(await store.compareAndSwap('owner',7,{revision:8}),true);
 const update=requests.find(r=>r.action==='database.modifyDocument');assert.equal(update.params.upsert,false);assert.match(JSON.stringify(update.params.query),/revision/);assert.match(JSON.stringify(update.params.query),/owner/);assert.equal(requests.length,3);
});
test('the SDK entry point rejects unconfigured or wrong-AppID invocation before a database request',async t=>{
 const keys=['BIRD_VAULT_ENABLED','BIRD_VAULT_APP_ID','WX_CONTEXT_KEYS','WX_OPENID','WX_APPID'],previous=Object.fromEntries(keys.map(k=>[k,process.env[k]]));t.after(()=>{for(const k of keys)if(previous[k]===undefined)delete process.env[k];else process.env[k]=previous[k];});
 const sdk=require('wx-server-sdk'),initialize=sdk.init;sdk.init=()=>{};t.after(()=>sdk.init=initialize);const {main}=require('../index');delete process.env.BIRD_VAULT_ENABLED;assert.equal((await main({action:'read'})).error.code,'VAULT_NOT_CONFIGURED');
 process.env.BIRD_VAULT_ENABLED='true';process.env.BIRD_VAULT_APP_ID='approved-app';process.env.WX_CONTEXT_KEYS='WX_OPENID,WX_APPID';process.env.WX_OPENID='alice';process.env.WX_APPID='wrong-app';assert.equal((await main({action:'read',OPENID:'alice',APPID:'approved-app'})).error.code,'VAULT_IDENTITY');
});
