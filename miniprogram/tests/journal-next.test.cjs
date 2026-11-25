const {test}=require('node:test');
const assert=require('node:assert/strict');
const {registerPage}=require('./helpers/page-lifecycle.cjs');
const journal=require('../.test-build/services/journal-model.js');
const ai=require('../.test-build/services/journal-ai.js');
const provider=require('../.test-build/services/recognition-provider.js');
const fixture=require('./fixtures/recognition.json');
const assets=n=>Array.from({length:n},(_,i)=>({id:'p'+i,src:'/assets/samples/field-'+i+'.png',selected:true,label:'观察 '+i,notes:'',sample:true}));
const tap=id=>({currentTarget:{dataset:{id}}});
function page(extra={}){
  let definition;const storage=new Map();global.wx={canIUse:()=>false,getWindowInfo:()=>({windowWidth:390,windowHeight:844,screenHeight:844,statusBarHeight:24,safeArea:{bottom:810}}),getMenuButtonBoundingClientRect:()=>({top:30,bottom:62,left:290}),getStorageSync:k=>structuredClone(storage.get(k)||''),setStorageSync:(k,v)=>storage.set(k,structuredClone(v)),nextTick:f=>f(),pageScrollTo:()=>{},...extra};
  global.Page=d=>definition=d;const path=require.resolve('../.test-build/pages/journal/index.js');delete require.cache[path];require(path);
  const patches=[],p={data:structuredClone(definition.data),getTabBar:()=>({setData:()=>{}}),setData(v){patches.push(structuredClone(v));for(const [k,value]of Object.entries(v)){const indexed=/^renderElements\[(\d+)\]$/.exec(k);if(indexed)this.data.renderElements[Number(indexed[1])]=value;else this.data[k]=value;}}};
  for(const [k,v]of Object.entries(definition))if(k!=='data')p[k]=typeof v==='function'?v.bind(p):structuredClone(v);
  registerPage(p);p.onLoad();return {p,patches};
}
test('photo-to-journal sends selected copies, previews a bounded suggestion, then applies one undoable edit',async t=>{
  let sent;ai.installJournalAiTransport({generate:input=>{sent=input;return {result:Promise.resolve({version:1,requestId:input.requestId,title:'枝头的一刻',body:'鸟停在枝头，羽色映着周围的绿。',design:{style:'minimal',variant:2}}),cancel(){}};}});
  t.after(()=>ai.installJournalAiTransport(null));
  const {p}=page();p._catalog=assets(2).map(a=>({...a,src:'wxfile://'+a.id+'.jpg',sample:false,persisted:true}));
  await p.generateFromPhotos();assert.equal(sent.purpose,'照片手帐');assert.equal(sent.images.length,2);assert.equal(sent.maxChars,60);
  assert.ok(p.data.aiSuggestion);assert.notEqual(p.data.doc.title,'枝头的一刻');
  const before=structuredClone(p.data.doc);p.applyAi({currentTarget:{dataset:{design:'yes'}}});
  assert.equal(p.data.doc.title,'枝头的一刻');assert.equal(p.data.doc.style,'minimal');assert.deepEqual(p.data.doc.elements.filter(e=>e.type==='photo').map(e=>e.src),before.elements.filter(e=>e.type==='photo').map(e=>e.src));
  p.undo();assert.deepEqual(p.data.doc,before);p.onUnload();
});
test('single and paired photo layouts are distinct for all three ratios, preserve sources/crops and clear the title',()=>{
  const overlap=(a,b)=>a.x<b.x+b.w&&b.x<a.x+a.w&&a.y<b.y+b.h&&b.y<a.y+a.h;
  for(const n of [1,2])for(const ratio of ['3:4','1:1','4:3'])for(const style of ['nature','magazine','minimal']){
    const layouts=new Set();
    for(const variant of [1,2,3]){
      const d=journal.makeJournal(assets(n),'这一刻的观察与长一点的标题'.repeat(3),ratio,style,variant),photos=d.elements.filter(e=>e.type==='photo');
      layouts.add(JSON.stringify(photos.map(p=>[p.x,p.y,p.w,p.h])));
      for(const p of photos){assert.ok(p.w>=65&&p.h>=65);assert.ok(p.x>=0&&p.y>=0&&p.x+p.w<=d.width+.01&&p.y+p.h<=d.height+.01);for(const header of d.elements.filter(e=>e.type==='text'&&!e.photoId))assert.equal(overlap(p,header),false);}
      for(const c of d.elements.filter(e=>e.photoId)){assert.ok(c.y+c.h<=d.height+.01);for(const p of photos)assert.equal(overlap(c,p),false);}
      photos[0].zoom=2.15;photos[0].cropX=81.32;const ids=photos.map(p=>[p.id,p.src]);journal.changeJournalRatio(d,ratio==='1:1'?'3:4':'1:1');assert.deepEqual(d.elements.filter(e=>e.type==='photo').map(p=>[p.id,p.src]),ids);assert.equal(photos[0].zoom,2.15);assert.equal(photos[0].cropX,81.32);
    }
    assert.equal(layouts.size,3,n+ratio+style);
  }
});
test('ratio and composition actions reveal the whole page, work repeatedly and undo preserves custom content',()=>{
  const {p}=page();p.openDocument(journal.makeJournal(assets(1),'Keep'),false);const photo=p.data.doc.elements.find(e=>e.type==='photo');p.select(tap(photo.id));
  const before=structuredClone(p.data.doc),shape=[photo.w,photo.h];p.rearrange();assert.notDeepEqual([photo.w,photo.h],shape);assert.equal(p.data.selectedId,'');assert.equal(p.data.overview,true);assert.ok(p.data.shownHeight<=p.data.stageHeight+.01);p.undo();assert.deepEqual(p.data.doc,before);
  p.applyRatio('4:3');assert.equal(p.data.doc.height,675);assert.equal(p.data.doc.ratio,'4:3');assert.equal(p.data.selectedId,'');assert.ok(p.data.shownHeight<=p.data.stageHeight+.01);p.undo();assert.deepEqual(p.data.doc,before);
});
test('a 100-event slider burst patches one element, coalesces bridge writes and commits one exact undo step',()=>{
  const {p,patches}=page();p.openDocument(journal.makeJournal(assets(2),'Keep'),false);const photo=p.data.doc.elements.find(e=>e.type==='photo');p.select(tap(photo.id));const before=structuredClone(p.data.doc);patches.length=0;
  const event=value=>({currentTarget:{dataset:{key:'w',control:'slider'}},detail:{value}});
  for(let i=0;i<100;i++)p.previewAdjust(event(180+i*.21));p.flushPendingPreview();
  assert.ok(patches.length<=3,'burst must not flood setData');assert.ok(patches.every(patch=>!('doc'in patch)&&!('renderElements'in patch)&&!('labels'in patch)));assert.ok(JSON.stringify(patches).length<10000);assert.equal(p._past.length,0);
  p.adjust(event(200.79));assert.equal(p.data.selected.w,200.79);assert.equal(p._past.length,1);p.undo();assert.deepEqual(p.data.doc,before);p.onUnload();
});
test('crop and drag preview queues cancel cleanly and cannot paint a different document later',()=>{
  const {p}=page();p.openDocument(journal.makeJournal(assets(1),'First'),false);p.select(tap(p.data.doc.elements.find(e=>e.type==='photo').id));const before=structuredClone(p.data.doc);
  p.openCrop();for(let i=0;i<50;i++)p.previewCrop({currentTarget:{dataset:{key:'cropX'}},detail:{value:i}});p.cancelCrop();p.flushPendingPreview();assert.deepEqual(p.data.doc,before);
  p.openDocument(journal.makeJournal(assets(2),'Second'),false);const second=structuredClone(p.data.doc);p.flushPendingPreview();assert.deepEqual(p.data.doc,second);p.onUnload();
});
test('AI results require preview and explicit apply; applying is one reversible edit and original photos remain',async t=>{
  t.after(()=>ai.installJournalAiTransport(null));let sent;
  ai.installJournalAiTransport({generate:input=>{sent=structuredClone(input);return {result:Promise.resolve({version:1,requestId:input.requestId,title:'一页发现',body:'把这一刻留在纸上。',design:{style:'minimal',variant:2},elements:[{src:'remote-injected'}]}),cancel(){}};}});
  const {p}=page();p.openDocument(journal.makeJournal(assets(2),'Keep'),false);const before=structuredClone(p.data.doc);p.openAi();p.aiPhoto(tap(p.data.aiPhotos[1].id));p.prompt({detail:{value:'用简短文字整理，不增加物种或天气。'}});await p.prepareAi();
  assert.equal(sent.images.length,1);assert.deepEqual(p.data.doc,before);assert.ok(p.data.aiSuggestion);p.applyAi({currentTarget:{dataset:{design:'yes'}}});assert.equal(p.data.doc.style,'minimal');assert.equal(p._past.length,1);assert.deepEqual(p.data.doc.elements.filter(e=>e.type==='photo').map(e=>e.src),before.elements.filter(e=>e.type==='photo').map(e=>e.src));p.undo();assert.deepEqual(p.data.doc,before);
});
test('AI close/cancel and later document edits ignore stale results without overwriting text',async t=>{
  t.after(()=>ai.installJournalAiTransport(null));let resolve,cancelled=0,request;
  ai.installJournalAiTransport({generate:input=>{request=input;return {result:new Promise(r=>resolve=r),cancel:()=>cancelled++};}});
  const {p}=page();p.openDocument(journal.makeJournal(assets(1),'Keep'),false);p.openAi();p.prompt({detail:{value:'简短感想'}});const running=p.prepareAi(),before=structuredClone(p.data.doc);p.closeAi();assert.equal(cancelled,1);resolve({version:1,requestId:request.requestId,title:'Late',body:'Late result',design:{style:'nature',variant:1}});await running;assert.equal(p.data.aiSuggestion,null);assert.deepEqual(p.data.doc,before);
  ai.installJournalAiTransport({generate:input=>({result:Promise.resolve({version:1,requestId:input.requestId,title:'New',body:'Suggested words',design:{style:'nature',variant:1}}),cancel(){}})});p.openAi();await p.prepareAi();p.data.doc.title='Changed meanwhile';p.applyAi({currentTarget:{dataset:{}}});assert.match(p.data.error,/已修改/);assert.equal(p.data.doc.title,'Changed meanwhile');
});
test('recognition handoff uses the existing contract parser and cancellation semantics without owning a Page',async t=>{
  t.after(()=>provider.installRecognitionProvider(null));assert.throws(()=>provider.recognizeWithProvider({kind:'photo',filePath:'local',reference:'x'}),/尚未安装/);assert.throws(()=>provider.installRecognitionProvider({contract:'wrong',createTransport(){}}));
  let success,aborted=0;
  provider.installRecognitionProvider({contract:'bird-recognition/1',kinds:['photo'],createTransport:()=>({upload(request,ok){assert.equal(request.path,'/api/v1/vision/analyses');success=ok;return {abort:()=>aborted++};}})});
  assert.equal(provider.recognitionAvailable('audio'),false);assert.throws(()=>provider.recognizeWithProvider({kind:'audio',filePath:'audio',reference:'x'}),e=>e.code==='UNSUPPORTED_KIND');
  const job=provider.recognizeWithProvider({kind:'photo',filePath:'wxfile://photo',reference:'capture-1'});job.cancel();success({statusCode:200,data:JSON.stringify(fixture.photo)});await assert.rejects(job.result,e=>e.code==='CANCELLED');assert.equal(aborted,1);
});
test('Qwen gateway validates auth, selected media, JSON and schema without leaking upstream details',async()=>{
  const {createQwenJournalHandler,validateJournalRequest}=await import('../server/journal-qwen.mjs');
  const jpeg='data:image/jpeg;base64,'+Buffer.from([255,216,255,224,0,0]).toString('base64'),input={version:1,requestId:'j-1',prompt:'简短感想，不增加事实。',purpose:'观察感想',maxChars:60,images:[{id:'a',label:'我的照片',dataUrl:jpeg}]};let calls=0;
  const suggestion={title:'一页发现',body:'把这一刻留在纸上。',design:{style:'nature',variant:2}};
  const create=overrides=>createQwenJournalHandler({authenticate:async context=>context.user,consumeQuota:async()=>true,apiKey:'synthetic-test-key',baseUrl:'https://example.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',fetchImpl:async(url,options)=>{calls++;assert.match(url,/aliyuncs.com\/compatible-mode\/v1\/chat\/completions$/);const sent=JSON.parse(options.body);assert.equal(sent.model,'qwen3-vl-plus');assert.equal(sent.enable_thinking,false);assert.deepEqual(sent.response_format,{type:'json_object'});assert.equal(sent.messages[0].content.filter(p=>p.type==='image_url').length,1);return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(suggestion)}}]}));},...overrides});
  assert.throws(()=>createQwenJournalHandler(),/authenticated/);await assert.rejects(create()(input,{}),e=>e.code==='AUTH_REQUIRED');assert.equal(calls,0);
  assert.equal((await create()(input,{user:'u1'})).requestId,input.requestId);assert.equal(calls,1);
  assert.throws(()=>validateJournalRequest({...input,images:[{...input.images[0],dataUrl:'https://private-server/image'}]}),e=>e.code==='INVALID_IMAGE');
  await assert.rejects(create({consumeQuota:async()=>false})(input,{user:'u1'}),e=>e.code==='RATE_LIMITED');assert.equal(calls,1);
  await assert.rejects(create({fetchImpl:async()=>new Response('secret backend detail',{status:500})})(input,{user:'u1'}),e=>e.code==='UPSTREAM_FAILED'&&!e.message.includes('secret'));
  await assert.rejects(create({fetchImpl:async()=>new Response(JSON.stringify({choices:[{finish_reason:'length',message:{content:'{}'}}]}))})(input,{user:'u1'}),e=>e.code==='INVALID_OUTPUT');
  await assert.rejects(create({fetchImpl:async()=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({...suggestion,design:{style:'javascript',variant:99}})}}]}))})(input,{user:'u1'}),e=>e.code==='INVALID_OUTPUT');
  await assert.rejects(create({fetchImpl:async(url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted')))),timeoutMs:5})(input,{user:'u1'}),e=>e.code==='TIMEOUT');
});
test('native journal gateway sends only selected prepared copies and session auth, and cancel before upload sends nothing',async()=>{
  const {journalGatewayTransport}=require('../.test-build/services/journal-gateway.js');
  let sent,finish;global.wx={request:options=>{sent=options;queueMicrotask(()=>options.success({statusCode:200,data:{ok:true}}));return {abort(){}};}};
  const input={version:1,requestId:'j-1',prompt:'Keep it short',purpose:'观察感想',maxChars:60,images:[{id:'selected',path:'wxfile://private-original',label:'Only this'}]};
  const transport=journalGatewayTransport({endpoint:'https://team.example/api/v1/journal/suggestions',session:async()=> 'test-session',prepare:async input=>input.images.map(p=>({id:p.id,label:p.label,dataUrl:'data:image/jpeg;base64,copy'}))});
  await transport.generate(input).result;assert.equal(sent.header.Authorization,'Bearer test-session');assert.equal(sent.data.images.length,1);assert.equal(JSON.stringify(sent.data).includes('wxfile://'),false);assert.equal(JSON.stringify(sent.data).includes('test-session'),false);
  sent=null;const slow=journalGatewayTransport({endpoint:'https://team.example/api/v1/journal/suggestions',session:()=>new Promise(r=>finish=r),prepare:async()=>{throw new Error('Must not prepare after cancellation');}}).generate(input);slow.cancel();finish('test-session');await assert.rejects(slow.result);assert.equal(sent,null);
  assert.throws(()=>journalGatewayTransport({endpoint:'https://dashscope.aliyuncs.com/compatible-mode/v1',session:async()=>'',prepare:async()=>[]}),/team HTTPS/);
});
