const {test}=require('node:test');
const assert=require('node:assert/strict');
const {SpeechCapture}=require('../.test-build/services/speech-capture.js');
const network=require('../.test-build/services/vision-network.js');
const asr=require('../.test-build/services/transcription-network.js');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const origin='https://api.auroraliu.cn:8080';
function recorder(){const callbacks={},calls=[];const native={onStart:fn=>callbacks.start=fn,onStop:fn=>callbacks.stop=fn,onError:fn=>callbacks.error=fn,start:value=>calls.push(['start',value]),stop:()=>calls.push(['stop'])};global.wx={getRecorderManager:()=>native};return{native,callbacks,calls};}
test('release before native microphone startup stops the late recording and returns no clip',()=>{
  const e=recorder(),clips=[],states=[];const capture=new SpeechCapture(state=>states.push(state),clip=>clips.push(clip),()=>{});
  capture.start();capture.release();assert.equal(e.calls.length,1);e.callbacks.start();assert.deepEqual(e.calls.at(-1),['stop']);e.callbacks.stop({tempFilePath:'late.wav',duration:2000});assert.deepEqual(clips,[]);assert.equal(states.at(-1),'idle');assert.equal(e.calls[0][1].format,'wav');assert.equal(e.calls[0][1].duration,30000);
});
test('recorder ownership survives disposal until stop acknowledgement and cannot send a cancelled clip to the next owner',()=>{
  const e=recorder(),first=[],second=[],errors=[];const a=new SpeechCapture(()=>{},clip=>first.push(clip),()=>{}),b=new SpeechCapture(()=>{},clip=>second.push(clip),message=>errors.push(message));
  a.start();e.callbacks.start();a.dispose();b.start();assert.equal(errors.length,1);assert.equal(e.calls.filter(row=>row[0]==='start').length,1);e.callbacks.stop({tempFilePath:'cancelled.wav',duration:3000});assert.deepEqual(first,[]);
  b.start();e.callbacks.start();b.release();e.callbacks.stop({tempFilePath:'kept.wav',duration:2000});assert.deepEqual(second,[{path:'kept.wav',durationMs:2000}]);
});
test('normal recording, swipe cancellation, permission failure and too-short audio settle without replacing a kept clip',()=>{
  const e=recorder(),clips=[],errors=[];const capture=new SpeechCapture(()=>{},clip=>clips.push(clip),message=>errors.push(message));
  capture.start();e.callbacks.start();capture.release();e.callbacks.stop({tempFilePath:'kept.wav',duration:2000});assert.equal(clips.length,1);
  capture.start();e.callbacks.start();capture.release(true);e.callbacks.stop({tempFilePath:'cancelled.wav',duration:2000});assert.equal(clips.length,1);
  capture.start();e.callbacks.start();capture.setCancelled(true);e.callbacks.stop({tempFilePath:'automatic-stop-while-swiped-left.wav',duration:30000});assert.equal(clips.length,1);
  capture.start();e.callbacks.error();assert.match(errors.at(-1),/麦克风/);capture.start();e.callbacks.start();capture.release();e.callbacks.stop({tempFilePath:'tiny.wav',duration:50});assert.match(errors.at(-1),/1–30/);assert.equal(clips.length,1);
});
function transport(t){const calls=[];global.wx={getExtConfigSync:()=>({}),getFileSystemManager:()=>({getFileInfo:o=>o.success({size:100}),readFile:o=>o.success({data:new ArrayBuffer(100)})}),arrayBufferToBase64:value=>Buffer.from(value).toString('base64'),request:o=>{calls.push(o);o.success({statusCode:200,data:{version:1,requestId:o.data.requestId,text:'树麻雀和 tree sparrow'}});return{abort(){calls.push('abort');}};}};
  t.mock.method(network,'connectBusiness',async()=>({origin,header:{Authorization:'Bearer session'}}));return calls;}
test('transcription sends only explicit local audio and session auth and accepts the matching transcript',async t=>{
  const calls=transport(t);assert.equal(await asr.startTranscription('voice.wav','speech-a').result,'树麻雀和 tree sparrow');assert.equal(calls.length,1);assert.equal(calls[0].url,origin+'/api/v1/journal/transcriptions');assert.deepEqual(Object.keys(calls[0].data),['version','requestId','wav']);assert.equal(calls[0].header.Authorization,'Bearer session');
});
test('large local files never upload and cancellation before or after native request discards late text',async t=>{
  const calls=transport(t);global.wx.getFileSystemManager=()=>({getFileInfo:o=>o.success({size:asr.SPEECH_MAX_BYTES+1})});await assert.rejects(asr.startTranscription('large.wav','speech-a').result,e=>e.code==='AUDIO_TOO_LARGE');assert.equal(calls.length,0);
  transport(t);let finishLogin;t.mock.method(network,'connectBusiness',()=>new Promise(resolve=>finishLogin=resolve));global.wx.request=()=>assert.fail('cancelled auth must not upload');const before=asr.startTranscription('voice.wav','speech-b');await settle();const cancelled=assert.rejects(before.result,e=>e.code==='CANCELLED');before.cancel();finishLogin({origin,header:{}});await cancelled;await settle();
  t.mock.restoreAll();const next=transport(t);let request;global.wx.request=o=>{request=o;return{abort(){next.push('abort');}};};const after=asr.startTranscription('voice.wav','speech-c');await settle();const reject=assert.rejects(after.result,e=>e.code==='CANCELLED');after.cancel();request.success({statusCode:200,data:{version:1,requestId:'speech-c',text:'too late'}});await reject;assert.equal(next.filter(value=>value==='abort').length,1);
});
test('wrong references and provider errors never expose remote debug messages',async t=>{
  transport(t);global.wx.request=o=>{o.success({statusCode:200,data:{version:1,requestId:'other-recording',text:'not mine'}});return{abort(){}};};await assert.rejects(asr.startTranscription('voice.wav','speech-a').result,e=>e.code==='INVALID_OUTPUT');
  for(const code of ['NOT_CONFIGURED','__proto__','toString']){global.wx.request=o=>{o.success({statusCode:503,data:{error:{code,message:'private-provider-debug'}}});return{abort(){}};};await assert.rejects(asr.startTranscription('voice.wav','speech-a').result,error=>!error.message.includes('private-provider-debug')&&!error.message.includes('function'));}
});
function component(){let definition;global.Component=value=>definition=value;const file=require.resolve('../.test-build/components/speech-note/index.js');delete require.cache[file];require(file);const events=[],patches=[],p={data:{...structuredClone(definition.data),acceptedId:''},setData(value){patches.push(value);Object.assign(this.data,value);},triggerEvent:(...value)=>events.push(value)};for(const[key,value]of Object.entries(definition.methods))p[key]=value.bind(p);definition.lifetimes.created.call(p);return{p,definition,events,patches};}
test('speech preview requires explicit confirmation, keeps user edits, acknowledges one application and ignores late hidden results',async t=>{
  let finish,cancelled=0;t.mock.method(asr,'startTranscription',()=>({result:new Promise(resolve=>finish=resolve),cancel(){cancelled++;}}));
  const {p,definition,events}=component();p.data.clipPath='voice.wav';const job=p.transcribe();finish('灰喜鹊和 tree sparrow');await job;assert.equal(events.length,0);p.edit({detail:{value:'树麻雀和 tree sparrow'}});p.confirm();assert.equal(events[0][1].text,'树麻雀和 tree sparrow');p.data.acceptedId=events[0][1].id;p.confirm();assert.equal(events.length,1);
  const late=p.transcribe();definition.pageLifetimes.hide.call(p);finish('late');await late;assert.equal(cancelled,1);assert.equal(p.data.transcript,'树麻雀和 tree sparrow');assert.equal(p.data.clipPath,'voice.wav');
});
test('detaching the speech component cancels its job and prevents late bridge writes',async t=>{
  let finish;t.mock.method(asr,'startTranscription',()=>({result:new Promise(resolve=>finish=resolve),cancel(){}}));const {p,definition,patches}=component();p.data.clipPath='voice.wav';const work=p.transcribe();definition.lifetimes.detached.call(p);const count=patches.length;finish('late');await work;assert.equal(patches.length,count);
});
function page(name){let definition;global.Page=value=>definition=value;const file=require.resolve('../.test-build/pages/'+name+'/index.js');delete require.cache[file];require(file);const p={data:structuredClone(definition.data),setData:value=>Object.assign(p.data,value)};for(const[key,value]of Object.entries(definition))if(key!=='data')p[key]=typeof value==='function'?value.bind(p):structuredClone(value);return p;}
test('journal and forum append only confirmed speech once, keep prior text, and reject late or overflowing applications',()=>{
  for(const name of ['journal','community']){const p=page(name),journal=name==='journal',method=journal?'confirmSpeech':'confirmWritingSpeech',field=journal?'prompt':'writingInstructions',receipt=journal?'speechApplied':'writingSpeechApplied',panel=journal?'ai':'writingOpen',max=journal?2000:1200;p.data[panel]=true;p._active=true;p._visible=true;p.data[field]='Existing user words';
    const event={detail:{id:'confirmed-a',text:'混合 English 术语'}};p[method](event);p[method](event);assert.equal(p.data[field],'Existing user words\n混合 English 术语');assert.equal(p.data[receipt],'confirmed-a');
    p.data[field]='x'.repeat(max);p[method]({detail:{id:'overflow',text:'extra'}});assert.equal(p.data[field].length,max);assert.equal(p.data[receipt],'confirmed-a');p.data[panel]=false;p[method]({detail:{id:'late',text:'late'}});assert.equal(p.data[field].length,max);
  }
});
