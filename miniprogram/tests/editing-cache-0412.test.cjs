const {test,afterEach}=require('node:test');
const assert=require('node:assert/strict');
const m=require('../.test-build/services/journal-model.js');
const state=require('../.test-build/services/journal-storage.js');
const drafts=require('../.test-build/services/post-draft.js');
const ai=require('../.test-build/services/journal-ai.js');
const records=require('../.test-build/services/writing-history.js');
const pages=[];
const tap=(id,key)=>({currentTarget:{dataset:{id,key}}});
const input=(key,value)=>({currentTarget:{dataset:{key}},detail:{value}});
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function environment(){
  const store=new Map(),files=new Map([['/tmp/original.jpg','original bytes and EXIF']]),moves=[],deleted=[];
  const fileSystem={saveFile(o){const dest='/user/original-'+moves.length+'.jpg';moves.push([o.tempFilePath,dest]);files.set(dest,files.get(o.tempFilePath));files.delete(o.tempFilePath);o.success({savedFilePath:dest});},accessSync(path){if(!files.has(path))throw Error('missing');},mkdirSync(){},unlinkSync(path){deleted.push(path);files.delete(path);}};
  global.wx={getStorageSync:k=>structuredClone(store.get(k)??''),setStorageSync:(k,v)=>store.set(k,structuredClone(v)),removeStorageSync:k=>store.delete(k),env:{USER_DATA_PATH:'/user'},getFileSystemManager:()=>fileSystem,canIUse:()=>false,nextTick:f=>f(),showToast(){},pageScrollTo(){},getWindowInfo:()=>({windowWidth:390,windowHeight:844,statusBarHeight:24,safeArea:{bottom:810}}),getMenuButtonBoundingClientRect:()=>({top:30,bottom:62,left:290})};
  return {store,files,fileSystem,moves,deleted};
}
function page(name='journal'){
  let definition;global.Page=p=>definition=p;const path=require.resolve('../.test-build/pages/'+name+'/index.js');delete require.cache[path];require(path);
  const patches=[],p={data:structuredClone(definition.data),getTabBar:()=>({setData(){}}),setData(values,done){patches.push(structuredClone(values));for(const[key,value]of Object.entries(values)){const parts=key.replace(/\[(\d+)\]/g,'.$1').split('.');let cursor=this.data;for(const part of parts.slice(0,-1))cursor=cursor[part];cursor[parts.at(-1)]=value;}done?.();}};
  // Native Page free data is cloned; JSON round-tripping exposes non-simple defaults.
  for(const[key,value]of Object.entries(definition))if(key!=='data')p[key]=typeof value==='function'?value.bind(p):JSON.parse(JSON.stringify(value));
  const record={p,wx:global.wx,closed:false};const unload=p.onUnload;p.onUnload=()=>{if(record.closed)return;record.closed=true;unload();};pages.push(record);p.onLoad();return {p,definition,patches};
}
afterEach(async()=>{const wx=global.wx;for(const record of pages.splice(0).reverse()){global.wx=record.wx;record.p.onUnload();await record.p._saveJob;await record.p._draftSave;clearTimeout(record.p._autosave);clearTimeout(record.p._draftTimer);}global.wx=wx;ai.installJournalAiTransport(null);});
const assets=()=>[{id:'a',src:'/assets/samples/field-0.png',label:'片段1',sample:true,selected:true,notes:''}];
const document=(title='Journal')=>m.makeJournal(assets(),title);
const open=(p,d=document())=>{p.openDocument(d,true);return d;};
const sentence=(p,text)=>{const box=p.data.doc.elements.find(e=>e.photoId);p.select(tap(box.id));p.text(input('text',text));p.endTextEdit();return box.id;};

test('draft shelves show both timestamps, keep unknown legacy dates honest, and prioritize modified time then creation',()=>{
  const e=environment();const make=(id,createdAt,updatedAt)=>({version:2,id,title:id,body:'Words',images:[],createdAt,updatedAt,writing:{purpose:1,instructions:'',includeImage:false}});
  const old=make('legacy',undefined,undefined),a=make('older-created-newer-edited','2026-11-01T01:00:00Z','2026-11-27T01:02:00Z'),b=make('newer-created','2026-11-27T01:00:00Z','2026-11-27T01:01:00Z'),c=make('tie-created-later','2026-11-26T01:00:00Z',a.updatedAt);
  e.store.set(drafts.POST_DRAFTS_KEY,{version:3,items:[old,b,a,c],lastId:a.id});const {p}=page('community');assert.deepEqual(p.data.draftRows.map(d=>d.id),[c.id,a.id,b.id,old.id]);
  assert.equal(p.data.draftRows.at(-1).created,'未记录');assert.equal(p.data.draftRows.at(-1).modified,'未记录');assert.match(p.data.draftRows[0].created,/2026-11-26/);assert.match(p.data.draftRows[0].modified,/2026-11-27/);
  assert.equal(drafts.readPostDraft(old.id).createdAt,undefined);
});

test('legacy drafts retain unknown creation time but receive a real modification time when edited',async()=>{
  const e=environment();e.store.set('bird-assistant.post-draft.v1',{title:'Old',body:'Original',image:''});const {p}=page('community');p.loadDraft();p.change(input('body','Edited now'));await p.saveDraft();p.refreshDrafts();const row=p.data.draftRows[0];assert.equal(row.created,'未记录');assert.notEqual(row.modified,'未记录');assert.equal(drafts.readPostDraft(row.id).createdAt,undefined);
});

test('Undo and Redo survive multiple fresh pages and another document does not inherit their stacks',async()=>{
  const e=environment(),{p}=page();const d=open(p);sentence(p,'First');sentence(p,'Second');p.undo();const selected=p.data.selectedId,first=m.journalFingerprint(p.data.doc);await p.save();p.onUnload();
  const {p:fresh}=page();fresh.onShow();fresh.resume();assert.equal(m.journalFingerprint(fresh.data.doc),first);assert.equal(fresh.data.selectedId,selected);assert.equal(fresh.data.canRedo,true);assert.equal(fresh.data.canUndo,true);fresh.redo();assert.equal(fresh.data.selected.text,'Second');fresh.onHide();await fresh._saveJob;fresh.onUnload();
  const {p:third}=page();third.onShow();third.resume();assert.equal(third.data.selected.text,'Second');third.undo();assert.equal(third.data.selected.text,'First');third.redo();assert.equal(third.data.selected.text,'Second');assert.equal(third.data.doc.id,d.id);
  const other=document('Independent');state.saveJournalState(other,state.editorHistory([],[]));third.openDocument(m.readJournals().find(item=>item.id===other.id),false);assert.equal(third.data.canUndo,false);assert.equal(third.data.canRedo,false);assert.equal(m.readJournals().length,2);assert.ok(e.store.get(m.JOURNAL_KEY).some(item=>item.id===d.id));
});

test('closing immediately after Undo stores Redo before its normal debounce runs',async()=>{
  environment();const {p}=page();open(p);sentence(p,'Before closing');await p.save();sentence(p,'Later text');await p.save();p.undo();p.onUnload();
  const {p:fresh}=page();fresh.onShow();fresh.resume();assert.equal(fresh.data.selected.text,'Before closing');assert.equal(fresh.data.canRedo,true);fresh.redo();assert.equal(fresh.data.selected.text,'Later text');
});

test('a new edit after restored Undo discards the old Redo branch and persists that decision',async()=>{
  environment();const {p}=page();open(p);sentence(p,'A');sentence(p,'B');p.undo();await p.save();p.onUnload();const {p:fresh}=page();fresh.onShow();fresh.resume();assert.equal(fresh.data.canRedo,true);sentence(fresh,'C');await fresh.save();fresh.onUnload();const {p:again}=page();again.onShow();again.resume();assert.equal(again.data.selected.text,'C');assert.equal(again.data.canRedo,false);
});

test('cached snapshots are nonrecursive, limited and budgeted without deleting any journal content',()=>{
  const e=environment(),d=document(),past=[];for(let i=0;i<35;i++){const before=m.snapshot(d,'');past.push(before);d.elements[1].text='说明'.repeat(900)+i;}
  const saved=state.saveJournalState(d,state.editorHistory(past,[]));assert.equal(saved.editHistory,undefined);let raw=e.store.get(m.JOURNAL_KEY)[0];assert.ok(raw.editHistory.past.length<=20);assert.ok(raw.editHistory.past.every(step=>step.document.editHistory===undefined));
  for(let i=0;i<9;i++){const another=document('Other '+i);state.saveJournalState(another,state.editorHistory(past.map(step=>({...step,document:{...step.document,id:another.id}})),[]));}
  const rows=m.readJournals();assert.equal(rows.length,10);assert.equal(rows.find(item=>item.id===d.id).elements[1].text,d.elements[1].text);const total=rows.reduce((sum,item)=>sum+(item.editHistory?Buffer.byteLength(JSON.stringify(item.editHistory)):0),0);assert.ok(total<=state.JOURNAL_HISTORY_BYTES);assert.ok(rows.every(item=>item.editHistory.past.length+item.editHistory.future.length<=20));
});

test('document/history storage failure keeps the prior content and Redo intact',()=>{
  const e=environment(),d=document(),before=m.snapshot(d,'');d.elements[1].text='Changed';state.saveJournalState(d,state.editorHistory([], [before]));const original=structuredClone(e.store.get(m.JOURNAL_KEY));global.wx.setStorageSync=(key,value)=>{if(key===m.JOURNAL_KEY)throw Error('quota');e.store.set(key,structuredClone(value));};d.elements[1].text='Unsaved';assert.throws(()=>state.saveJournalState(d,state.editorHistory([before],[])),/quota/);assert.deepEqual(e.store.get(m.JOURNAL_KEY),original);assert.equal(state.restoreEditorHistory(m.readJournals()[0]).future.length,1);
});

test('malformed cached edits cannot replace the actual document or crash opening a saved journal',()=>{
  const e=environment(),d=document('Keep words');d.editHistory={version:1,past:[{document:{broken:true},selected:''}],future:[],selected:''};e.store.set(m.JOURNAL_KEY,[d]);const {p}=page();p.openDocument(m.readJournals()[0],false);assert.equal(p.data.doc.title,'Keep words');assert.match(p.data.error,/编辑历史.*不能恢复/);assert.equal(p.data.canUndo,false);assert.deepEqual(e.store.get(m.JOURNAL_KEY),[d]);
});

test('a moved temporary photo updates every journal image consumer, and an Undo-only photo is durable too',async()=>{
  const e=environment(),{p}=page(),a={id:'picked',src:'/tmp/original.jpg',label:'Photo',sample:false,selected:true,notes:''};p._catalog=[a];p.setData({assets:[structuredClone(a)],picked:[structuredClone(a)]});const d=m.makeJournal([a],'Moved photo');open(p,d);p.openAi();const photo=p.data.doc.elements.find(e=>e.type==='photo');p.setData({templateOptions:[{id:1,name:'test',photos:[{src:a.src,style:'',imageStyle:''}]}]});p.select(tap(photo.id));p.remove();await p.save();assert.equal(e.moves.length,1);assert.equal(e.files.has('/tmp/original.jpg'),false);const durable=e.moves[0][1];assert.equal(p.data.aiPhotos[0].src,durable);assert.equal(p.data.assets[0].src,durable);assert.equal(p.data.picked[0].src,durable);assert.equal(p.data.templateOptions[0].photos[0].src,durable);assert.equal(p._catalog[0].src,durable);p.onUnload();
  const {p:fresh}=page();fresh.onShow();fresh.resume();assert.equal(fresh.data.doc.elements.some(e=>e.type==='photo'),false);fresh.undo();const restored=fresh.data.doc.elements.find(e=>e.type==='photo');assert.equal(restored.src,durable);assert.equal(e.files.get(restored.src),'original bytes and EXIF');
});

test('both journal AI entry points stay blank and idle until explicit generation, and AI records restore only a preview',async()=>{
  environment();let calls=0;ai.installJournalAiTransport({generate:request=>{calls++;return {result:Promise.resolve({version:1,requestId:request.requestId,title:'Preview',body:'Only visible details.',design:{style:'nature',variant:1}}),cancel(){}};}});const {p}=page();p._catalog=assets().map(a=>({...a,sample:false,persisted:true}));await p.generateFromPhotos();assert.equal(p.data.ai,true);assert.equal(p.data.prompt,'');assert.equal(p.data.aiBusy,false);assert.equal(calls,0);await p.prepareAi();assert.equal(calls,1);assert.equal(p.data.prompt,'');assert.equal(p.data.error,'');const unchanged=m.journalFingerprint(p.data.doc);p.openAiHistory();assert.equal(p.data.aiHistory.length,1);p.restoreAiHistory(tap(p.data.aiHistory[0].id));assert.equal(calls,1);assert.equal(m.journalFingerprint(p.data.doc),unchanged);p.closeAi();p.openAi();assert.equal(p.data.prompt,'');assert.equal(calls,1);
});

test('native-cloned page fields initialize their own Maps/Sets onLoad and failures do not leak across pages',()=>{
  environment();const first=page();assert.equal(first.definition._failedPhotos,null);assert.equal(first.definition._failedCovers,null);open(first.p);const photo=first.p.data.doc.elements.find(e=>e.type==='photo');first.p.imageFailed(tap(photo.id));assert.equal(first.p._failedPhotos.get(photo.id),photo.src);const second=page();assert.equal(second.p._failedPhotos.size,0);const community=page('community');assert.equal(community.definition._failedThumbnails,null);assert.ok(community.p._failedThumbnails instanceof Set);
});

test('the journal deck projects only nearby composed pages and remembers failed thumbnail paths without changing saved media',()=>{
  environment();const {p}=page();const documents=Array.from({length:12},(_,i)=>document('Journal '+i));p._documents=documents;p.filterLibrary();
  assert.equal(Object.keys(p.data.deckPreviews).length,2);assert.ok(p.data.deckPreviews[p.data.libraryRows[0].id].elements.some(e=>e.type==='text'));
  p.deckChange({detail:{current:5}});assert.equal(Object.keys(p.data.deckPreviews).length,3);
  const id=p.data.libraryRows[5].id,photo=p.data.deckPreviews[id].elements.find(e=>e.type==='photo'),source=photo.src;
  p.deckImageFailed({currentTarget:{dataset:{doc:id,id:photo.id}}});assert.equal(p.data.deckPreviews[id].elements.find(e=>e.id===photo.id).src,'');p.projectDeck();assert.equal(p.data.deckPreviews[id].elements.find(e=>e.id===photo.id).src,'');
  assert.equal(documents.find(d=>d.id===id).elements.find(e=>e.id===photo.id).src,source);
});

test('the direct editor AI records entry opens this journal history without generating or changing its content',()=>{
  environment();const {p}=page();open(p);const before=m.journalFingerprint(p.data.doc);p.openAiRecords();assert.equal(p.data.ai,true);assert.equal(p.data.aiHistoryOpen,true);assert.equal(p.data.aiHistory.length,0);assert.equal(p.data.aiBusy,false);assert.equal(m.journalFingerprint(p.data.doc),before);
});

test('delete requires confirmation, removes only the chosen journal/history and cannot be resurrected by an in-flight save',async()=>{
  const e=environment(),other=document('Other');state.saveJournalState(other,state.editorHistory([],[]));let modal;global.wx.showModal=o=>modal=o;const {p}=page();const a={id:'a',src:'/tmp/original.jpg',label:'A',sample:false,selected:true};open(p,m.makeJournal([a],'Delete me'));const id=p.data.doc.id;p.deleteJournal();modal.success({confirm:false});assert.ok(p.data.doc);let finish;e.fileSystem.saveFile=o=>finish=()=>{const saved='/user/keep.jpg';e.files.set(saved,e.files.get(o.tempFilePath));e.files.delete(o.tempFilePath);o.success({savedFilePath:saved});};
  const save=p.persistDraft();const deleting=p.confirmDeleteJournal(id);assert.equal(p.data.busy,true);finish();await Promise.all([save,deleting]);p.onUnload();await settle();assert.equal(p.data.doc,null);assert.equal(m.readJournals().some(item=>item.id===id),false);assert.equal(m.readJournals().find(item=>item.id===other.id).title,'Other');assert.equal(e.files.get('/user/keep.jpg'),'original bytes and EXIF');assert.equal(e.deleted.length,0);
});

test('deleting one journal removes its AI records while retaining other journals and forum records',async()=>{
  const e=environment(),{p}=page();const d=open(p),other=document('Keep');await p.save();state.saveJournalState(other,state.editorHistory([],[]));const record=(feature,scope,id)=>records.rememberWriting(feature,scope,{version:1,requestId:id,prompt:'Notes',purpose:'观察正文',maxChars:100,images:[]},{version:1,requestId:id,title:'Title',body:'Notes',design:{style:'nature',variant:1}});record('journal',d.id,'delete-record');record('journal',other.id,'keep-record');record('forum',d.id,'forum-record');await p.confirmDeleteJournal(d.id);assert.equal(records.readWritingHistory('journal',d.id).length,0);assert.equal(records.readWritingHistory('journal',other.id).length,1);assert.equal(records.readWritingHistory('forum',d.id).length,1);assert.ok(e.store.get(m.JOURNAL_KEY).every(item=>item.id!==d.id));
});

test('editing a page heading remains independent of the saved name and library renames are reversible after reopening',async()=>{
  environment();const {p}=page();const d=open(p,document('Name')),heading=d.elements.find(e=>e.title);p.select(tap(heading.id));p.text(input('title','Page heading'));p.endTextEdit();assert.equal(p.data.doc.title,'Name');await p.save();p.setData({view:'home'});let modal;global.wx.showModal=o=>modal=o;p.renameJournal(tap(d.id));modal.success({confirm:true,content:'Renamed journal'});p.openDraft(tap(d.id));assert.equal(p.data.doc.title,'Renamed journal');assert.equal(p.data.doc.elements.find(e=>e.id===heading.id).title,'Page heading');p.undo();assert.equal(p.data.doc.title,'Name');
});

test('a late autosave cannot replace a newer synchronous close checkpoint',async()=>{
  const e=environment(),{p}=page();const d=document('Latest stays');d.elements.push(m.element('photo',{src:'/tmp/original.jpg',photoNumber:2}));open(p,d);p.select(tap(d.elements.at(-1).id));p.remove();let finish;e.fileSystem.saveFile=o=>finish=()=>o.success({savedFilePath:'/user/delayed.jpg'});const pending=p.persistDraft();
  for(let i=0;i<25;i++)sentence(p,'Newest words '+i);p.onHide();const checkpoint=e.store.get(m.JOURNAL_KEY)[0];assert.equal(checkpoint.elements.find(e=>e.photoId).text,'Newest words 24');finish();await pending;await settle();assert.equal(e.store.get(m.JOURNAL_KEY)[0].elements.find(e=>e.photoId).text,'Newest words 24');assert.equal(p.data.dirty,false);
});
