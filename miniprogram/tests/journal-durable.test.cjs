const {test}=require('node:test');
const assert=require('node:assert/strict');
const {registerPage}=require('./helpers/page-lifecycle.cjs');
const journal=require('../.test-build/services/journal-model.js');
const resize=require('../.test-build/services/journal-resize.js');
const ai=require('../.test-build/services/journal-ai.js');
const assets=()=>[{id:'a',src:'/assets/samples/field-0.png',label:'观察',selected:true,sample:true}];
const tap=id=>({currentTarget:{dataset:{id}}});
function page(extra={},storage=new Map()){
  let definition;
  global.wx={getStorageSync:k=>structuredClone(storage.get(k)||''),setStorageSync:(k,v)=>storage.set(k,structuredClone(v)),
    getWindowInfo:()=>({windowWidth:390,windowHeight:844,screenHeight:844,statusBarHeight:24,safeArea:{bottom:810}}),
    getMenuButtonBoundingClientRect:()=>({top:30,bottom:62,left:290}),nextTick:f=>f(),pageScrollTo:()=>{},showToast:()=>{},...extra};
  global.Page=d=>definition=d;const file=require.resolve('../.test-build/pages/journal/index.js');delete require.cache[file];require(file);
  const p={data:structuredClone(definition.data),getTabBar:()=>({setData(){}}),setData(value){for(const[k,v]of Object.entries(value)){const match=/^renderElements\[(\d+)\]$/.exec(k);if(match)this.data.renderElements[+match[1]]=v;else this.data[k]=v;}}};
  for(const[k,v]of Object.entries(definition))if(k!=='data')p[k]=typeof v==='function'?v.bind(p):structuredClone(v);
  registerPage(p);p.onLoad();return {p,storage};
}
test('current, original and free resize modes have distinct stable semantics at both page edges',()=>{
  const d=journal.makeJournal(assets(),'Ratios'),p=d.elements.find(e=>e.type==='photo');
  Object.assign(p,{x:70,y:90,w:300,h:200,iw:1200,ih:900});
  resize.setRatioLock(p,'current',d);
  for(let i=1;i<50;i++){resize.resizePhoto(p,'w',200+i*1.7,d);resize.resizePhoto(p,'h',150+i*1.1,d);assert.ok(Math.abs(p.w/p.h-1.5)<.0002);}
  resize.setRatioLock(p,'original',d);assert.ok(Math.abs(p.w/p.h-4/3)<.0002);d.variant=3;journal.reflowJournalPhotos(d);assert.ok(Math.abs(p.w/p.h-4/3)<.0002);journal.changeJournalRatio(d,'1:1');assert.ok(Math.abs(p.w/p.h-4/3)<.0002);
  resize.resizePhoto(p,'h',9999,d);assert.ok(p.y+p.h<=d.height+.01&&p.x+p.w<=d.width+.01);
  resize.setRatioLock(p,'free',d);const height=p.h;resize.resizePhoto(p,'w',222,d);assert.equal(p.w,222);assert.equal(p.h,height);
  resize.setRatioLock(p,'current',d);const current=p.w/p.h;resize.resizePhoto(p,'h',200,d);assert.ok(Math.abs(p.w/p.h-current)<.0002);
  assert.ok(Object.values(resize.pixelValues(p)).every(Number.isInteger));
});
test('autosave persists media once, coalesces later edits and recovers the latest clicked draft',async()=>{
  let release,moves=0;
  const {p,storage}=page({getFileSystemManager:()=>({saveFile:o=>{moves++;release=()=>o.success({savedFilePath:'wxfile://durable/photo'});}})});
  const doc=journal.makeJournal([{...assets()[0],src:'wxfile://temporary',sample:false}],'Recover');p.openDocument(doc,true);
  const writing=doc.elements.find(e=>e.title);p.select(tap(writing.id));const pending=p.persistDraft();
  p.text({currentTarget:{dataset:{key:'text'}},detail:{value:'The edit made during file persistence'}});release();await pending;await p.persistDraft();
  assert.equal(moves,1);assert.equal(p.data.renderElements.find(e=>e.type==='photo').src,'wxfile://durable/photo');assert.equal(storage.get(journal.JOURNAL_KEY).length,1);assert.equal(p.data.dirty,false);
  const saved=storage.get(journal.JOURNAL_KEY)[0];assert.equal(saved.elements.find(e=>e.type==='photo').src,'wxfile://durable/photo');assert.match(saved.elements.find(e=>e.id===writing.id).text,/during/);
  const second=journal.makeJournal(assets(),'Second');storage.set(journal.JOURNAL_KEY,[saved,second]);p.loadDrafts();p.openDraft(tap(second.id));
  const fresh=page({},storage).p;fresh.onShow();assert.equal(fresh.data.doc.id,second.id);fresh.resume();assert.equal(fresh.data.view,'editor');p.onUnload();fresh.onUnload();
});
test('an autosave storage failure keeps the previous copy and retries the already durable media',async t=>{
  const warnings=[];t.mock.method(console,'warn',(_message,error)=>warnings.push(error));
  let moves=0,fail=true;const previous=journal.makeJournal(assets(),'Previously saved'),storage=new Map([[journal.JOURNAL_KEY,[previous]]]);
  const {p}=page({setStorageSync:(k,v)=>{if(k===journal.JOURNAL_KEY&&fail)throw Error('quota');storage.set(k,structuredClone(v));},
    getFileSystemManager:()=>({saveFile:o=>{moves++;o.success({savedFilePath:'wxfile://durable/retry'});}})},storage);
  p.openDocument(journal.makeJournal([{...assets()[0],src:'wxfile://temp',sample:false}],'New'),true);
  assert.equal(await p.persistDraft(),false);assert.ok(warnings.some(e=>e.message==='quota'));assert.equal(p.data.dirty,true);assert.deepEqual(storage.get(journal.JOURNAL_KEY),[previous]);assert.equal(p.data.doc.elements.find(e=>e.type==='photo').src,'wxfile://durable/retry');
  fail=false;assert.equal(await p.persistDraft(),true);assert.equal(moves,1);assert.equal(storage.get(journal.JOURNAL_KEY).length,2);p.onUnload();
});
test('template previews do not mutate the journal, and paper/ratio choices are saved and undoable',async()=>{
  const {p,storage}=page();p.openDocument(journal.makeJournal([...assets(),{...assets()[0],id:'b'}],'Pair'),true);
  const before=structuredClone(p.data.doc);p.chooseTemplate();assert.equal(p.data.templateOptions.length,3);assert.deepEqual(p.data.doc,before);
  p.applyTemplate(tap(2));assert.equal(p.data.doc.variant,2);p.undo();assert.deepEqual(p.data.doc,before);
  p.paper(tap('grid'));assert.equal(p.data.paperSource,'/assets/papers/grid.png');await p.persistDraft();assert.equal(storage.get(journal.JOURNAL_KEY)[0].paper,'grid');p.undo();assert.equal(p.data.doc.paper,'fiber');p.onUnload();
});
test('autosave timestamps cannot stale an AI suggestion but a real document edit does',async()=>{
  let resolve;ai.installJournalAiTransport({generate:input=>({result:new Promise(r=>{resolve=()=>r({version:1,requestId:input.requestId,title:'Suggestion',body:'User-provided observation, polished.',design:{style:'nature',variant:2}});}),cancel(){}})});
  try{
    const {p}=page();p.openDocument(journal.makeJournal(assets(),'Before'),true);p.openAi();p.prompt({detail:{value:'Polish what is visible'}});const pending=p.prepareAi();await p.persistDraft();resolve();await pending;p.applyAi({currentTarget:{dataset:{}}});assert.equal(p.data.doc.title,'Suggestion');assert.equal(p.data.ai,false);p.onUnload();
  }finally{ai.installJournalAiTransport(null);}
});
test('a malformed older journal is retained and never overwritten by autosave',async t=>{
  const warnings=[];t.mock.method(console,'warn',(_message,error)=>warnings.push(error));
  const malformed=[{version:1,id:'legacy',elements:[]}],storage=new Map([[journal.JOURNAL_KEY,malformed]]);
  const {p}=page({},storage);p.openDocument(journal.makeJournal(assets(),'Keep my edit'),true);
  assert.equal(await p.persistDraft(),false);assert.deepEqual(storage.get(journal.JOURNAL_KEY),malformed);assert.ok(warnings.some(e=>/已有草稿未覆盖/.test(e.message)));assert.equal(p.data.dirty,true);p.onUnload();
});
test('mixed portrait and landscape photos fit all ratios and templates without covering headings or captions',()=>{
  const overlap=(a,b)=>a.x<b.x+b.w-.02&&b.x<a.x+a.w-.02&&a.y<b.y+b.h-.02&&b.y<a.y+a.h-.02;
  for(const a of [.25,.55,1,1.33,1.78,3])for(const b of [.25,.55,1,1.33,1.78,3])for(const ratio of ['3:4','1:1','4:3'])for(const variant of [1,2,3]){
    const d=journal.makeJournal([{...assets()[0],width:1000*a,height:1000},{...assets()[0],id:'b',width:1000*b,height:1000}],'A short observation title',ratio,'nature',variant);
    const photos=d.elements.filter(e=>e.type==='photo');
    for(const p of photos){assert.ok(p.x>=0&&p.y>=0&&p.x+p.w<=d.width+.01&&p.y+p.h<=d.height+.01);for(const text of d.elements.filter(e=>e.type==='text'))assert.equal(overlap(p,text),false);}
    assert.equal(overlap(photos[0],photos[1]),false);
  }
});

test('ornament ratio lock is undoable, survives saving and constrains width and corner drags',async()=>{
  const {p,storage}=page();p.openDocument(journal.makeJournal(assets(),'Ornament'),true);p.addDecoration(tap('leaf'));
  const id=p.data.selectedId;assert.equal(p.data.selected.ornamentRatioLocked,false);
  p.adjust({currentTarget:{dataset:{key:'w'}},detail:{value:160}});assert.equal(p.data.selected.h,80);
  p.toggleOrnamentRatio();assert.equal(p.data.selected.h,160);assert.equal(p.data.selected.ornamentRatioLocked,true);
  p.undo();assert.equal(p.data.selected.w,160);assert.equal(p.data.selected.h,80);assert.equal(p.data.selected.ornamentRatioLocked,false);p.redo();
  p.adjust({currentTarget:{dataset:{key:'w'}},detail:{value:190}});assert.equal(p.data.selected.w,p.data.selected.h);
  const touch=(x,y)=>({currentTarget:{dataset:{id,resize:'yes'}},touches:[{clientX:x,clientY:y}]});
  p.dragStart(touch(0,0));p.dragMove(touch(90,10));p.dragEnd();assert.equal(p.data.selected.w,p.data.selected.h);
  const element=p.data.selected;element.x=p.data.doc.width-100;element.y=p.data.doc.height-70;
  resize.resizeOrnament(element,'w',9999,p.data.doc);assert.equal(element.w,70);assert.equal(element.h,70);
  await p.persistDraft();const saved=journal.readJournals().find(d=>d.id===p.data.doc.id).elements.find(e=>e.id===id);assert.equal(saved.ornamentRatioLocked,true);
  p.toggleOrnamentRatio();p.adjust({currentTarget:{dataset:{key:'w'}},detail:{value:80}});assert.equal(p.data.selected.w,80);assert.equal(p.data.selected.h,70);
  assert.equal(storage.get(journal.JOURNAL_KEY)[0].elements.find(e=>e.id===id).ornamentRatioLocked,true);p.onUnload();
});
test('older ornaments remain freely resizable until the user explicitly locks their original ratio',()=>{
  const d=journal.makeJournal(assets(),'Legacy'),e=journal.element('leaf',{x:0,y:0,w:100,h:70});d.elements.push(e);
  resize.resizeOrnament(e,'w',200,d);assert.equal(e.h,70);assert.equal(e.ornamentRatioLocked,undefined);
  e.ornamentOriginalRatio=2;e.ornamentRatioLocked=true;resize.resizeOrnament(e,'h',100,d);assert.equal(e.w,200);assert.equal(e.h,100);
});
