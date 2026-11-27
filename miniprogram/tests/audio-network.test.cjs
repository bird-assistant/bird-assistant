const {test}=require('node:test');
const assert=require('node:assert/strict');
const audio=require('../.test-build/services/audio-network.js');
const network=require('../.test-build/services/vision-network.js');
const fixtures=require('./fixtures/recognition.json');
const origin='https://api.auroraliu.cn:8080',input={kind:'audio',filePath:'wxfile://recording.mp3',reference:'wx-demo-1'};
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function environment(t){const calls=[];global.wx={getExtConfigSync:()=>({}),getFileSystemManager:()=>({getFileInfo:o=>o.success({size:1024}),readFile:o=>o.success({data:Uint8Array.from([73,68,51,4]).buffer})}),request:o=>{calls.push(['ready',o]);o.success({statusCode:200,data:{status:'ready',models:[{ready:true}]},header:{}});return{abort(){calls.push(['abort-ready']);}};},uploadFile:o=>{calls.push(['upload',o]);o.success({statusCode:200,data:JSON.stringify(fixtures.audio)});return{abort(){calls.push(['abort-upload']);}};}};
  t.mock.method(network,'connectBusiness',async()=>{calls.push(['login']);return{origin,header:{Authorization:'Bearer session'}};});return calls;}
test('audio preflights its public route and sends the exact recording with its own reference and session',async t=>{
  const calls=environment(t),result=await audio.startAudioRecognition(input).result;assert.deepEqual(calls.map(row=>row[0]),['ready','login','upload']);const upload=calls[2][1];
  assert.equal(upload.url,origin+'/api/v1/audio/analyses');assert.equal(upload.filePath,input.filePath);assert.equal(upload.name,'audio');assert.equal(upload.formData.client_reference,input.reference);assert.equal(upload.header.Authorization,'Bearer session');assert.equal(result.kind,'audio');assert.equal(result.example,false);assert.deepEqual(result.subjects,[]);
});
test('unavailable or malformed readiness never logs in or uploads a recording',async t=>{
  for(const reply of [{statusCode:404,data:''},{statusCode:502,data:''},{statusCode:200,data:{}},{statusCode:200,data:{status:'ready',models:[{ready:false}]}}]){
    const calls=environment(t);global.wx.request=o=>{calls.push(['ready']);o.success({...reply,header:{}});return{abort(){}};};await assert.rejects(audio.startAudioRecognition(input).result);assert.deepEqual(calls.map(row=>row[0]),['ready']);t.mock.restoreAll();
  }
});
test('size, sample and known unsupported OGG failures stay local and preserve the original',async t=>{
  const calls=environment(t);global.wx.getFileSystemManager=()=>({getFileInfo:o=>o.success({size:audio.AUDIO_MAX_BYTES+1})});await assert.rejects(audio.startAudioRecognition(input).result,e=>e.code==='AUDIO_TOO_LARGE');
  await assert.rejects(audio.startAudioRecognition({...input,sample:true}).result,e=>e.code==='EXAMPLE_MEDIA');
  global.wx.getFileSystemManager=()=>({getFileInfo:o=>o.success({size:1024}),readFile:o=>o.success({data:Uint8Array.from([79,103,103,83]).buffer})});await assert.rejects(audio.startAudioRecognition(input).result,/OGG/);assert.equal(calls.length,0);
});
test('cancel while readiness or login is pending cannot start a late recording upload',async t=>{
  const calls=environment(t);let ready;global.wx.request=o=>{ready=o;return{abort(){calls.push(['abort-ready']);}};};
  const first=audio.startAudioRecognition(input);await settle();const rejected=assert.rejects(first.result,e=>e.code==='CANCELLED');first.cancel();ready.success({statusCode:200,data:{status:'ready',models:[{ready:true}]}});await rejected;assert.deepEqual(calls.map(row=>row[0]),['abort-ready']);
  t.mock.restoreAll();calls.length=0;environment(t);let login;global.wx.request=o=>{o.success({statusCode:200,data:{status:'ready',models:[{ready:true}]}});return{abort(){}};};t.mock.method(network,'connectBusiness',()=>new Promise(resolve=>login=resolve));
  global.wx.uploadFile=()=>assert.fail('cancelled login must never upload');const second=audio.startAudioRecognition(input);await settle();const pending=assert.rejects(second.result,e=>e.code==='CANCELLED');second.cancel();login({origin,header:{Authorization:'Bearer session'}});await pending;await settle();
});
test('cancel aborts one active upload and a wrong recording reference is never accepted',async t=>{
  const calls=environment(t);let upload;global.wx.uploadFile=o=>{upload=o;return{abort(){calls.push(['abort-upload']);}};};const first=audio.startAudioRecognition(input);await settle();const rejected=assert.rejects(first.result,e=>e.code==='CANCELLED');first.cancel();first.cancel();upload.success({statusCode:200,data:JSON.stringify(fixtures.audio)});await rejected;assert.equal(calls.filter(row=>row[0]==='abort-upload').length,1);
  global.wx.uploadFile=o=>{o.success({statusCode:200,data:JSON.stringify({...fixtures.audio,client_reference:'another-recording'})});return{abort(){}};};await assert.rejects(audio.startAudioRecognition(input).result,e=>e.code==='INVALID_RESPONSE');
});
