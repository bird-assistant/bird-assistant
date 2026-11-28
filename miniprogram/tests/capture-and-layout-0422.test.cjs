const {test}=require('node:test'),assert=require('node:assert/strict');
const {CaptureWindow,CAPTURE_LIMITS,frameQuality}=require('../.test-build/services/capture-window.js');
const {CameraBuffer}=require('../.test-build/services/camera-buffer.js');
const journal=require('../.test-build/services/journal-model.js');
const {editorPanes,EDITOR_CHROME_HEIGHT}=require('../.test-build/services/layout.js');
const frame=(at,n=at)=>({id:'f'+n,at,width:8,height:8,image:new ArrayBuffer(100),score:20+n%20,signature:[n%255,(n*3)%255]});
function page(path){let d;global.Page=v=>d=v;const name=require.resolve('../.test-build/'+path+'/index.js');delete require.cache[name];require(name);const p={data:structuredClone(d.data),setData(v,done){Object.assign(this.data,v);done?.();}};for(const[k,v]of Object.entries(d))if(k!=='data')p[k]=typeof v==='function'?v.bind(p):structuredClone(v);return p;}
function environment(){const kv=new Map();global.wx={canIUse:()=>false,getStorageSync:k=>kv.get(k)||'',setStorageSync:(k,v)=>kv.set(k,structuredClone(v)),getWindowInfo:()=>({windowWidth:365,windowHeight:814,screenHeight:814,statusBarHeight:24}),getMenuButtonBoundingClientRect:()=>({left:260,top:30,bottom:62}),pageScrollTo(){}};return kv;}
function cameraEnvironment(){let deliver,started=0,stopped=0,query;const writes=[];environment();const canvas={width:0,height:0,getContext:()=>({createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData(){}}),toDataURL:()=>'data:image/jpeg;base64,AA=='};
 global.wx.base64ToArrayBuffer=()=>new ArrayBuffer(100);global.wx.request=()=>assert.fail('local replay must not use the network');global.wx.getFileSystemManager=()=>({writeFileSync:()=>writes.push('file')});
 global.wx.createSelectorQuery=()=>{const q={in:()=>q,select:()=>q,node:()=>q,exec:fn=>{query=()=>fn([{node:canvas}]);}};return q;};
 const camera={onCameraFrame:fn=>{deliver=fn;return {start:()=>started++,stop:()=>stopped++};}};
 const pixels=new Uint8Array(16*16*4);for(let i=0;i<pixels.length;i+=4){pixels[i]=i%256;pixels[i+1]=(i*7)%256;pixels[i+2]=(i*3)%256;pixels[i+3]=255;}
 return {camera,canvas,send:()=>deliver({width:16,height:16,data:pixels.buffer}),query:()=>query?.(),counts:()=>({started,stopped,writes:writes.length})};}

test('waiting mode selects real pre-tap and post-tap sources without inventing a cold-start replay',()=>{
 const p=new CaptureWindow('wait',0);for(let at=0;at<=7000;at+=500)p.add(frame(at));p.trigger(7000);
 for(let at=7200;at<=12000;at+=200)p.add(frame(at));assert.equal(p.tick(11999),'');assert.equal(p.tick(12000),'burst');
 const selected=p.selected();assert.ok(selected.some(f=>f.at>=2000&&f.at<=7000));assert.ok(selected.some(f=>f.at>7000&&f.at<=12000));assert.ok(selected.length<=3);
 const cold=new CaptureWindow('wait',0);cold.trigger(100);cold.add(frame(500));cold.tick(5100);assert.deepEqual(cold.selected().map(f=>f.at),[500]);
});
test('quick sessions end at one minute and offer fallback only when no manual shutter was used',()=>{
 for(const manual of [false,true]){const p=new CaptureWindow('quick',0);p.add(frame(4000));p.add(frame(15000));if(manual)p.trigger(20000);
 assert.equal(p.tick(59999),'');assert.equal(p.tick(60000),'expired');assert.equal(p.expired,true);assert.equal(p.selected().length>0,!manual);assert.equal(p.due(70000),false);}
});
test('long waiting sessions and repeated triggers stay within the encoded-memory budget and clear completely',()=>{
 const p=new CaptureWindow('wait',0);for(let at=0;at<180000;at+=200){if(at%12000===6000)p.trigger(at);p.add({...frame(at),image:new ArrayBuffer(CAPTURE_LIMITS.frameBytes)});p.tick(at);assert.ok(p.bytes<=CAPTURE_LIMITS.bytes);}
 p.trigger(180000);assert.equal(p.selected().length,0);p.clear();assert.equal(p.bytes,0);assert.equal(p.bursting,false);
});
test('uniform dark frames are rejected by the texture heuristic; it is not a bird confidence score',()=>{
 assert.equal(frameQuality(new ArrayBuffer(16*16*4),16,16).score,0);assert.equal(frameQuality(new ArrayBuffer(4),16,16).score,0);
});
test('native replay owns one listener, gates samples and performs no persistence or upload by itself',t=>{
 t.mock.timers.enable({apis:['setInterval']});let now=1000;t.mock.method(Date,'now',()=>now);const env=cameraEnvironment(),updates=[],engine=new CameraBuffer(env.camera,env.canvas,'wait',(...args)=>updates.push(args),()=>{},assert.fail);engine.start();
 for(let i=0;i<40;i++){env.send();now+=25;}assert.ok(engine.policy.bytes>0);assert.ok(engine.policy.bytes<=200);assert.deepEqual(env.counts(),{started:1,stopped:0,writes:0});
 engine.trigger();now+=5000;t.mock.timers.tick(250);assert.ok(updates.some(([kind])=>kind==='burst'));engine.stop();assert.equal(engine.policy.bytes,0);const count=updates.length;env.send();t.mock.timers.tick(1000);assert.equal(updates.length,count);assert.equal(env.counts().stopped,1);
});
test('manual photo work blocks both local encoding and live forwarding until native capture completes',t=>{
 t.mock.timers.enable({apis:['setInterval']});const env=cameraEnvironment();let blocked=true,forwarded=0;const e=new CameraBuffer(env.camera,env.canvas,'wait',()=>{},()=>forwarded++,assert.fail,()=>blocked);e.start();env.send();assert.equal(forwarded,0);assert.equal(e.policy.bytes,0);blocked=false;env.send();assert.equal(forwarded,1);assert.ok(e.policy.bytes>0);e.stop();
});
test('late encoder preparation after hide cannot create a listener or retain camera frames',()=>{
 const env=cameraEnvironment(),p=page('pages/identify');p._camera=env.camera;p.data.cameraReady=true;p.startCaptureBuffer();p.onHide();env.query();assert.equal(env.counts().started,0);assert.equal(p.data.bufferReady,false);assert.equal(p._buffer,null);
});
test('one-minute pause preserves selected fallback in RAM and an explicit resume creates a fresh native session',t=>{
 t.mock.timers.enable({apis:['setInterval']});let now=1000;t.mock.method(Date,'now',()=>now);const env=cameraEnvironment(),p=page('pages/identify');p._camera=env.camera;p.data.cameraReady=true;p.startCaptureBuffer();env.query();env.send();now=61000;t.mock.timers.tick(250);
 assert.equal(p.data.paused,true);assert.equal(p.data.bufferCount,1);assert.equal(p._buffer,null);assert.equal(env.counts().stopped,1);p.cameraStopped();assert.equal(p.data.bufferCount,1);
 p.data.paused=false;p.data.cameraReady=true;p.startCaptureBuffer();env.query();assert.equal(env.counts().started,2);p.onHide();assert.equal(env.counts().stopped,2);assert.equal(p.data.bufferCount,0);
});
test('side text survives ratio changes and serialized storage, keeps photo bytes and has no photo overlap',()=>{
 for(const ratio of ['3:4','1:1','4:3'])for(const count of [1,2,4,6])for(const side of ['left-of-photos','right-of-photos']){
 const d=journal.makeJournal(Array.from({length:count},(_,i)=>({id:'p'+i,src:'/original/'+i+'.jpg',label:'片段 '+i,selected:true,sample:true})), 'Lakeside',ratio);
 const text=journal.element('text',{text:'两只鸟停在湖边。',fontSize:22,maxLines:0});d.elements.push(text);const changed=journal.positionJournalText(d,text.id,side);assert.equal(journal.validJournal(JSON.parse(JSON.stringify(changed))),true);
 const box=changed.elements.find(e=>e.id===text.id);assert.equal(journal.textLayout(box,changed).overflow,false);for(const p of changed.elements.filter(e=>e.type==='photo')){assert.ok(!(box.x<p.x+p.w&&p.x<box.x+box.w&&box.y<p.y+p.h&&p.y<box.y+box.h));assert.equal(p.src,d.elements.find(e=>e.id===p.id).src);assert.ok(p.y+p.h<=changed.height);}
 journal.changeJournalRatio(changed,'1:1');assert.equal(changed.elements.find(e=>e.id===text.id).text,text.text);
 }
});
test('oversized side text refuses atomically and the original authored document stays unchanged',()=>{
 const d=journal.makeJournal([{id:'p',src:'original.jpg',label:'Photo',sample:true,selected:true}],'Keep');const e=journal.element('text',{text:'很长的记录'.repeat(800),maxLines:0});d.elements.push(e);const before=JSON.stringify(d);assert.throws(()=>journal.positionJournalText(d,e.id,'left-of-photos'),/放不下/);assert.equal(JSON.stringify(d),before);
});
test('editor reserves name row, toolbar and caption across narrow phones and wide windows',()=>{
 assert.equal(EDITOR_CHROME_HEIGHT,128);for(const h of [190,320,480,650,1080])for(const document of [180,900,1600]){const b=editorPanes(h,document);assert.ok(b.stageHeight>=0);assert.ok(b.controlsHeight>=0);assert.ok(b.stageHeight+b.controlsHeight+128<=h+.01);}
});
test('signed-in My profile uses the server identity and rejects a stale response after logout',async t=>{
 const kv=environment(),community=require('../.test-build/services/community.js');community.setSession(true);let finish;t.mock.method(community,'api',()=>new Promise(resolve=>finish=resolve));const p=page('pages/profile');p.onShow();finish({id:'same-wechat-member',profile:{nickname:'Community Bird',handle:'bird_1',avatar:'finch'}});await Promise.resolve();assert.equal(p.data.communityName,'Community Bird');assert.equal(p.data.communityMemberId,'same-wechat-member');
 p.onShow();community.setSession(false);finish({id:'old-member',profile:{nickname:'Stale',handle:'old',avatar:'owl'}});await Promise.resolve();assert.notEqual(p.data.communityName,'Stale');p.onHide();assert.equal(kv.get('bird-assistant.community.session.v1'),'out');
});

test('budget pressure retains at least one pre-tap source even when later frames score higher',()=>{
 const p=new CaptureWindow('wait',0);for(let at=0;at<=5000;at+=500)p.add({...frame(at),score:10,image:new ArrayBuffer(CAPTURE_LIMITS.frameBytes)});p.trigger(5000);
 for(let at=5200;at<=10000;at+=200)p.add({...frame(at),score:100+at,image:new ArrayBuffer(CAPTURE_LIMITS.frameBytes)});p.tick(10000);assert.ok(p.bytes<=CAPTURE_LIMITS.bytes);assert.ok(p.selected().some(f=>f.at<=5000));assert.ok(p.selected().some(f=>f.at>5000));
});
test('selected wait-window analysis sends at most two in-memory JPEGs and never saves a private observation',async t=>{
 const kv=environment(),network=require('../.test-build/services/vision-network.js'),fixture=require('./fixtures/recognition.json'),sent=[];t.mock.method(network,'connectVision',async()=>({origin:'https://example.invalid',header:{}}));
 t.mock.method(network,'photoTransport',(_c,image,fields)=>({upload(request,success){sent.push({image,fields,request});success({statusCode:200,data:JSON.stringify(fixture.photo),header:{}});return {abort(){}};}}));
 const p=page('pages/identify');p.data.liveActive=true;p._bufferResults=new Map();const sources=[frame(1000),frame(2000),frame(3000)];await p.analyseBufferFrames(sources);
 assert.equal(sent.length,2);assert.equal(p._bufferResults.size,2);assert.ok(sent.every(s=>s.request.filePath.startsWith('memory://')));assert.equal(kv.size,0);assert.equal(p.data.assets.length,0);assert.match(p.data.bufferStatus,/2\/3/);
});
test('map tilt and rotation track native gestures; reset restores north-up without changing zoom or center',()=>{
 environment();let definition;global.Component=v=>definition=v;const file=require.resolve('../.test-build/components/field-map/index.js');delete require.cache[file];require(file);const p={data:structuredClone(definition.data),setData(v){Object.assign(this.data,v);}};for(const[k,v]of Object.entries(definition.methods))p[k]=v.bind(p);p.queueLoad=()=>{};p.data._ready=true;p.data.scale=13.4;const center=[p.data.latitude,p.data.longitude];
 p.moved({detail:{type:'end',rotate:-10,skew:45}});assert.equal(p.data.rotate,350);assert.equal(p.data.skew,45);p.resetPerspective();assert.equal(p.data.rotate,0);assert.equal(p.data.skew,0);assert.equal(p.data.scale,13.4);assert.deepEqual([p.data.latitude,p.data.longitude],center);
});

test('fast-mode camera deadline works even when native frame sampling is unavailable',t=>{
 t.mock.timers.enable({apis:['setTimeout']});environment();const p=page('pages/identify');p._camera={};p.data.cameraReady=true;p.startCaptureBuffer();assert.equal(p.data.bufferReady,false);t.mock.timers.tick(60000);assert.equal(p.data.paused,true);assert.equal(p.data.cameraReady,false);assert.equal(p._quickFallbackTimer,0);p.onHide();
});
