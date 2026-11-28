const {test}=require('node:test'),assert=require('node:assert/strict');
const {handleGateway}=require('../cloudfunctions/birdGateway/handler.cjs');
const token='test-only-business-session',options=(fetch)=>({appId:'test-app',context:{APPID:'test-app',OPENID:'cloud-user'},writingEnabled:false,fetch});
test('prepared cloud gateway rejects unknown actions, missing configuration, identity mismatch and missing business bearer before network',async()=>{
 let calls=0;const config=options(async()=>calls++);for(const event of [null,{action:'arbitraryURL',url:'https://invalid'},{action:'socialInbox'}])assert.equal((await handleGateway(event,config)).ok,false);assert.equal((await handleGateway({action:'socialInbox',token},{...config,appId:''})).error.code,'GATEWAY_NOT_CONFIGURED');assert.equal((await handleGateway({action:'socialInbox',token},{...config,context:{APPID:'foreign',OPENID:'member'}})).status,401);assert.equal(calls,0);
});
test('cloud gateway uses only the fixed business origin, forwards the normal bearer and preserves a route deployment error',async()=>{
 const config=options(async(url,request)=>{assert.equal(url,'https://api.auroraliu.cn:8080/api/v1/journal/capabilities');assert.equal(request.headers.Authorization,'Bearer '+token);assert.equal(request.redirect,'error');return new Response(JSON.stringify({detail:'Not Found'}),{status:404});});const result=await handleGateway({action:'writingCapabilities',token,url:'https://attacker.invalid',openid:'spoof'},config);assert.equal(result.status,404);assert.equal(result.error.code,'BUSINESS_HTTP_404');assert.equal(JSON.stringify(result).includes(token),false);
});
test('cloud generation is disabled unless a maintainer opts in; invalid payloads never call the provider',async()=>{
 let calls=0;const config=options(async()=>{calls++;return new Response('{}');});assert.equal((await handleGateway({action:'writingSuggestions',token,payload:{}},config)).error.code,'WRITING_DISABLED');assert.equal((await handleGateway({action:'writingSuggestions',token,payload:{text:'x'.repeat(2*1024*1024)}},{...config,writingEnabled:true})).status,413);assert.equal(calls,0);
});
test('sequential cloud invocations never retain another users token or content',async()=>{
 const seen=[],config=options(async(_url,request)=>{seen.push(request.headers.Authorization);return new Response(JSON.stringify({items:[]}));});await handleGateway({action:'socialInbox',token},config);await handleGateway({action:'socialInbox',token:'second-test-business-token'},config);assert.deepEqual(seen,['Bearer '+token,'Bearer second-test-business-token']);
});
test('inherited object names are not gateway actions',async()=>{
 let calls=0;const config=options(async()=>{calls++;return new Response('{}');});for(const action of ['__proto__','constructor','toString'])assert.equal((await handleGateway({action,token},config)).error.code,'GATEWAY_ACTION');assert.equal(calls,0);
});
