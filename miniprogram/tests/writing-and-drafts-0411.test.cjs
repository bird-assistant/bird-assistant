const {test,afterEach}=require('node:test');
const assert=require('node:assert/strict');
const drafts=require('../.test-build/services/post-draft.js');
const {postImage}=require('../.test-build/services/post-media.js');
const journal=require('../.test-build/services/journal-model.js');
const writing=require('../.test-build/services/journal-writing.js');
const history=require('../.test-build/services/writing-history.js');
const library=require('../.test-build/services/journal-library.js');
const ai=require('../.test-build/services/journal-ai.js');
const {postWritingBrief}=require('../.test-build/services/post-writing.js');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const tap=(id,key)=>({currentTarget:{dataset:{id,key}}});
const input=(key,value)=>({currentTarget:{dataset:{key}},detail:{value}});
const pages=[];
function environment(){
  const storage=new Map(),files=new Map([['/tmp/a.jpg','unaltered-exif-a'],['/tmp/b.png','unaltered-exif-b']]),deleted=[],copies=[];
  const fileSystem={mkdirSync(){},accessSync(path){if(path!=='/user/bird-post-draft/'&&!files.has(path))throw Error('missing');},copyFile(o){copies.push(o);files.set(o.destPath,files.get(o.srcPath));o.success();},unlinkSync(path){deleted.push(path);files.delete(path);}};
  global.wx={env:{USER_DATA_PATH:'/user'},getFileSystemManager:()=>fileSystem,getStorageSync:key=>structuredClone(storage.get(key)??''),setStorageSync:(key,value)=>storage.set(key,structuredClone(value)),removeStorageSync:key=>storage.delete(key),canIUse:()=>false,nextTick:f=>f(),pageScrollTo(){},showToast(){},getWindowInfo:()=>({windowWidth:390,windowHeight:844,statusBarHeight:24,safeArea:{bottom:810}}),getMenuButtonBoundingClientRect:()=>({top:30,bottom:62,left:290}),getImageInfo:o=>o.success({width:640,height:480,type:'jpeg'})};
  return {storage,files,deleted,copies,fileSystem};
}
function page(name){
  let definition;global.Page=d=>definition=d;const path=require.resolve('../.test-build/pages/'+name+'/index.js');delete require.cache[path];require(path);
  const patches=[],p={data:structuredClone(definition.data),getTabBar:()=>({setData(){}}),setData(values,done){patches.push(structuredClone(values));for(const[key,value]of Object.entries(values)){const parts=key.replace(/\[(\d+)\]/g,'.$1').split('.');let cursor=this.data;for(const part of parts.slice(0,-1))cursor=cursor[part];cursor[parts.at(-1)]=value;}done?.();}};
  for(const[key,value]of Object.entries(definition))if(key!=='data')p[key]=typeof value==='function'?value.bind(p):structuredClone(value);
  p.onLoad();pages.push(p);return {p,patches};
}
afterEach(async()=>{for(const p of pages.splice(0)){p.onUnload();await p._draftSave;await p._saveJob;clearTimeout(p._draftTimer);clearTimeout(p._autosave);}ai.installJournalAiTransport(null);});
const assets=n=>Array.from({length:n},(_,i)=>({id:'p'+i,src:'/assets/samples/field-'+(i%3)+'.png',selected:true,sample:true,label:'片段 '+(i+1),notes:''}));
function options(d,changes={}){return {destination:'new',selectedId:'',placement:1,includeTitle:false,includeCaptions:false,purpose:'观察感想',prompt:'自然简短地整理已有事实，不补写经历。',photoIds:d.elements.filter(e=>e.type==='photo').map(e=>e.id).slice(0,4),...changes};}
function suggestion(id='result',changes={}){return {version:1,requestId:id,title:'枝头的一只鸟',body:'鸟停在枝头，周围是绿色的叶子。',design:{style:'nature',variant:1},...changes};}

test('legacy drafts remain discoverable beside independent new drafts after reopening; media and selection stay attached to the right draft',async()=>{
  const e=environment();e.storage.set('bird-assistant.post-draft.v1',{title:'Old saved draft',body:'Original words',image:'/tmp/a.jpg',manualCamera:{iso:'800'}});
  const old=drafts.readPostDrafts()[0];assert.equal(old.id,'legacy-post-draft');assert.equal(old.createdAt,undefined);
  const savedOld=await drafts.savePostDraft(old),fresh=drafts.newPostDraft(),photo=postImage('/tmp/b.png');fresh.title='Second draft';fresh.body='Different words';fresh.images=[photo];fresh.activeAttachment=photo.id;fresh.writing.imageIds=[photo.id];fresh.writing.includeImage=true;
  const savedNew=await drafts.savePostDraft(fresh);assert.notEqual(savedNew.id,savedOld.id);assert.equal(drafts.readPostDrafts().length,2);
  assert.equal(drafts.readPostDraft(savedOld.id).images[0].manualCamera.iso,'800');assert.equal(savedOld.createdAt,undefined,'migration must not invent creation time');
  const {p}=page('community');assert.equal(p.data.draftCount,2);p.loadDraft(savedNew.id);assert.equal(p.data.body,'Different words');assert.equal(p.data.activeAttachment,photo.id);assert.deepEqual(p.data.writingPhotoIds,[photo.id]);assert.equal(e.files.get(p.data.attachments[0].path),'unaltered-exif-b');
  p.loadDraft(savedOld.id);assert.equal(p.data.body,'Original words');assert.equal(p.data.manualCamera.iso,'800');
});

test('concurrent saves retain both drafts, and deleting a shared attachment reclaims only its final owned reference',async()=>{
  const e=environment(),a={...drafts.newPostDraft(),body:'First',images:[postImage('/tmp/a.jpg')]};
  const first=await drafts.savePostDraft(a),shared=first.images[0].path;
  const b={...drafts.newPostDraft(),body:'Second',images:first.images},c={...drafts.newPostDraft(),body:'Third',images:[postImage('/tmp/b.png')]};
  await Promise.all([drafts.savePostDraft(b),drafts.savePostDraft(c)]);assert.equal(drafts.readPostDrafts().length,3);
  await drafts.deletePostDraft(first.id);assert.ok(e.files.has(shared));assert.equal(drafts.readPostDraft(first.id),null);
  await drafts.deletePostDraft(b.id);assert.ok(!e.files.has(shared));assert.ok(e.files.has('/tmp/a.jpg'));assert.equal(drafts.readPostDraft(c.id).body,'Third');assert.equal(e.deleted.filter(path=>path===shared).length,1);
});

test('a queued save cannot overwrite newer synchronous recovery when the app closes during another media copy',async()=>{
  const e=environment(),a={...drafts.newPostDraft(),body:'First',images:[postImage('/tmp/a.jpg')]},b={...drafts.newPostDraft(),body:'Earlier text',images:[]};
  let finish;e.fileSystem.copyFile=o=>{finish=()=>{e.files.set(o.destPath,e.files.get(o.srcPath));o.success();};};
  const saveA=drafts.savePostDraft(a);await settle();const saveB=drafts.savePostDraft(b);
  drafts.cachePostDraft({...b,body:'LATEST AFTER QUEUE'});drafts.cachePostDraft({...a,body:'LATEST DURING COPY'});finish();await Promise.all([saveA,saveB]);
  assert.equal(drafts.readPostDraft(b.id).body,'LATEST AFTER QUEUE');assert.equal(e.storage.get(drafts.POST_DRAFTS_KEY).items.find(item=>item.id===b.id).body,'Earlier text');
  assert.equal(drafts.readPostDraft(a.id).body,'LATEST DURING COPY');assert.equal(drafts.readPostDraft(a.id).images[0].path,e.storage.get(drafts.POST_DRAFTS_KEY).items.find(item=>item.id===a.id).images[0].path);
});

test('a collection quota failure preserves both prior complete drafts and the newest words for the failed save',async()=>{
  const e=environment(),a=await drafts.savePostDraft({...drafts.newPostDraft(),body:'A',images:[postImage('/tmp/a.jpg')]}),b=await drafts.savePostDraft({...drafts.newPostDraft(),body:'B'}),before=structuredClone(e.storage.get(drafts.POST_DRAFTS_KEY));
  global.wx.setStorageSync=(key,value)=>{if(key===drafts.POST_DRAFTS_KEY)throw Error('quota');e.storage.set(key,structuredClone(value));};
  await assert.rejects(drafts.savePostDraft({...a,body:'A latest',images:[postImage('/tmp/b.png')]}),/已有完整草稿未覆盖/);
  assert.deepEqual(e.storage.get(drafts.POST_DRAFTS_KEY),before);assert.equal(drafts.readPostDraft(a.id).body,'A latest');assert.equal(drafts.readPostDraft(b.id).body,'B');assert.ok(e.files.has(a.images[0].path));assert.equal([...e.files.values()].filter(value=>value==='unaltered-exif-b').length,1,'partial owned copy must be reclaimed');
});

test('corrupt collections stop writes instead of replacing recoverable saved drafts',async()=>{
  const e=environment();e.storage.set(drafts.POST_DRAFTS_KEY,{version:3,items:[{bad:true}],lastId:'old'});const before=structuredClone(e.storage);
  await assert.rejects(drafts.savePostDraft({...drafts.newPostDraft(),body:'new'}),/未覆盖/);assert.deepEqual(e.storage,before);
});

test('composer autosave recovery survives a new page before media copying finishes and never overwrites newer edits',async()=>{
  const e=environment(),{p}=page('community');await p.compose();p.change(input('body','First edit'));const id=p.data.draftId;
  p.setImages([postImage('/tmp/a.jpg')]);let finish;e.fileSystem.copyFile=o=>{finish=()=>{e.files.set(o.destPath,e.files.get(o.srcPath));o.success();};};
  const pending=p.persistPostDraft(true);await settle();p.change(input('body','CANCEL-KEEP-123 newest words'));p.onHide();
  const {p:fresh}=page('community');assert.equal(fresh.data.draftCount,1);fresh.loadDraft(id);assert.equal(fresh.data.body,'CANCEL-KEEP-123 newest words');assert.equal(fresh.data.attachments[0].path,'');assert.match(fresh.data.error,/照片/);
  finish();await pending;await settle();assert.equal(p.data.body,'CANCEL-KEEP-123 newest words');assert.ok(p.data.attachments[0].path.startsWith('/user/bird-post-draft/'));assert.equal(drafts.readPostDraft(id).body,'CANCEL-KEEP-123 newest words');assert.equal(drafts.readPostDraft(id).images[0].path,p.data.attachments[0].path,'latest text recovery reuses a completed original with the same attachment ID');
});

test('selected text is sent as context; applying it changes only that text box and keeps its existing title and saved name',()=>{
  const d=journal.makeJournal(assets(1),'MY JOURNAL'),box=d.elements.find(e=>e.photoId);box.title='Existing caption';box.text='Only this original sentence';const original=structuredClone(d);
  const {input:brief,context}=writing.journalWritingBrief(d,options(d,{destination:'selected',selectedId:box.id}));assert.deepEqual(JSON.parse(brief.prompt).existingText,{title:box.title,body:box.text});
  const result=writing.applyJournalWriting(d,context,suggestion());assert.deepEqual(d,original);assert.equal(result.document.title,'MY JOURNAL');assert.equal(writing.journalHeading(result.document).title,'MY JOURNAL');assert.equal(result.document.elements.find(e=>e.id===box.id).title,'Existing caption');assert.equal(result.document.elements.find(e=>e.id===box.id).text,suggestion().body);
  assert.throws(()=>writing.journalWritingBrief(d,options(d,{destination:'selected'})),/先选择/);
});

test('a generated preview can create a box above or below the photo region, retaining original image IDs, sources and crops across all ratios',()=>{
  for(const ratio of ['3:4','1:1','4:3'])for(const count of [1,2,4])for(const placement of [0,1]){
    const d=journal.makeJournal(assets(count),'SAVED NAME',ratio);const photos=d.elements.filter(e=>e.type==='photo');photos[0].zoom=1.7;photos[0].cropX=71;const sources=photos.map(p=>[p.id,p.src,p.zoom,p.cropX]);
    const {context}=writing.journalWritingBrief(d,options(d,{placement})),result=writing.applyJournalWriting(d,context,suggestion()),box=result.document.elements.find(e=>e.id===result.targetId),laid=result.document.elements.filter(e=>e.type==='photo');
    assert.equal(result.document.title,d.title);assert.equal(writing.journalHeading(result.document).title,d.title);assert.deepEqual(laid.map(p=>[p.id,p.src,p.zoom,p.cropX]),sources);assert.equal(journal.textLayout(box,result.document).overflow,false);
    for(const p of laid)assert.ok(placement===0?box.y+box.h<=p.y:p.y+p.h<=box.y,ratio+'/'+count+'/'+placement);
  }
});

test('overview and selected-photo captions are separate, fully visible, and stale or oversized application is atomic',()=>{
  for(const ratio of ['3:4','1:1','4:3'])for(const count of [1,2,4]){
    const d=journal.makeJournal(assets(count),'J2 Test',ratio),photos=d.elements.filter(e=>e.type==='photo'),ids=photos.map(p=>p.id);const {context}=writing.journalWritingBrief(d,options(d,{destination:'overview',includeTitle:true,includeCaptions:true,purpose:'照片手帐'}));
    const answer=suggestion('captioned',{body:'几张照片记录了鸟在不同环境中的样子。',captions:ids.map((id,index)=>({id,text:'照片'+(index+1)+'里能看到一只鸟，停在枝条上，周围有树叶。'}))});
    const result=writing.applyJournalWriting(d,context,answer).document;assert.equal(result.title,'J2 Test');assert.equal(writing.journalHeading(result).title,answer.title);
    for(const id of ids){const caption=result.elements.find(e=>e.photoId===id);assert.equal(caption.text,answer.captions.find(p=>p.id===id).text);assert.equal(journal.textLayout(caption,result).overflow,false);}
    const original=structuredClone(d);d.elements[0].text='Changed since request';assert.throws(()=>writing.applyJournalWriting(d,context,answer),/已修改/);assert.equal(d.title,original.title);
  }
  const d=journal.makeJournal(assets(4),'Keep','4:3'),{context}=writing.journalWritingBrief(d,options(d,{destination:'overview',includeTitle:true})),before=structuredClone(d);
  assert.throws(()=>writing.applyJournalWriting(d,context,suggestion('too-long',{body:'这是非常长的一段正文。'.repeat(50)})),/空间不足/);assert.deepEqual(d,before);
});

test('caption parsing rejects null, unknown, duplicate and oversized labels while retaining backwards-compatible old responses',()=>{
  const brief={version:1,requestId:'caption-check',prompt:'Natural notes',purpose:'照片手帐',maxChars:120,images:[{id:'a',path:'/tmp/a.jpg',label:'A'}]};
  assert.equal(ai.parseJournalSuggestion(suggestion(brief.requestId),brief).captions,undefined);
  const valid=ai.parseJournalSuggestion(suggestion(brief.requestId,{captions:[{id:'a',text:'Visible detail'}],path:'injected'}),brief);assert.deepEqual(valid.captions,[{id:'a',text:'Visible detail'}]);assert.equal(valid.path,undefined);
  for(const captions of [[null],[{id:'other',text:'No'}],[{id:'a',text:'one'},{id:'a',text:'two'}],[{id:'a',text:'长'.repeat(81)}],[{id:'a',text:' '}]])assert.throws(()=>ai.parseJournalSuggestion(suggestion(brief.requestId,{captions}),brief),/所选图片/);
});

test('writing histories survive reopening, isolate document and feature scopes, omit media bytes/paths, and are bounded and explicitly deletable',()=>{
  const e=environment(),brief={version:1,requestId:'history-1',prompt:JSON.stringify({instructions:'Use plain Chinese'}),purpose:'照片手帐',maxChars:120,images:[{id:'a',path:'/private/photo.jpg',dataUrl:'data:image/jpeg;base64,PRIVATE',label:'Photo A'}]};
  history.rememberWriting('journal','doc-a',brief,suggestion(brief.requestId,{captions:[{id:'a',text:'Photo note'}]}));assert.equal(history.readWritingHistory('forum','doc-a').length,0);assert.equal(history.readWritingHistory('journal','doc-b').length,0);
  let record=history.readWritingHistory('journal','doc-a')[0];assert.equal(record.displayPrompt,'Use plain Chinese');history.markWritingApplied('journal','doc-a',record.id);assert.equal(history.readWritingHistory('journal','doc-a')[0].applied,true);
  const stored=JSON.stringify(e.storage.get(history.WRITING_HISTORY_KEY));assert.doesNotMatch(stored,/PRIVATE|private\/photo|dataUrl/);
  for(let i=0;i<85;i++)history.rememberWriting('forum','post-a',{...brief,requestId:'history-'+i},suggestion('history-'+i));assert.equal(e.storage.get(history.WRITING_HISTORY_KEY).items.length,80);assert.equal(history.readWritingHistory('forum','post-a')[0].id,'history-84');
  history.deleteWritingRecord('forum','post-a','history-84');assert.equal(history.readWritingHistory('forum','post-a')[0].id,'history-83');
  e.storage.set(history.WRITING_HISTORY_KEY,{version:1,items:[{broken:true}]});const original=structuredClone(e.storage.get(history.WRITING_HISTORY_KEY));assert.throws(()=>history.rememberWriting('journal','doc-a',brief,suggestion(brief.requestId)),/未覆盖/);assert.deepEqual(e.storage.get(history.WRITING_HISTORY_KEY),original);
});

test('the journal shelf filters names, ratio and creation/modified dates without sending whole documents to the renderer',()=>{
  const a=journal.makeJournal(assets(1),'Lake visit','3:4'),b=journal.makeJournal(assets(1),'Branch study','1:1'),legacy=journal.makeJournal(assets(1),'Old lake','4:3');
  a.createdAt='2026-11-20T12:00:00Z';a.updatedAt='2026-11-26T13:00:00Z';b.createdAt='2026-11-25T12:00:00Z';b.updatedAt='2026-11-25T13:00:00Z';delete legacy.createdAt;
  const rows=library.journalLibrary([a,b,legacy],{...library.EMPTY_LIBRARY_QUERY,text:'LAKE',ratio:'3:4',from:'2026-11-26',to:'2026-11-26'});assert.deepEqual(rows.map(r=>r.id),[a.id]);assert.equal(rows[0].elements,undefined);assert.equal(rows[0].createdLabel,'2026-11-20');
  assert.deepEqual(library.journalLibrary([a,b,legacy],{...library.EMPTY_LIBRARY_QUERY,order:'created',from:'2026-11-24'}).map(r=>r.id),[b.id]);assert.equal(library.journalLibrary([legacy],library.EMPTY_LIBRARY_QUERY)[0].createdLabel,'未记录');
});

test('opening AI starts with a blank prompt; editing a preview, moving its destination and restoring history do not request another generation',async()=>{
  environment();let calls=0;ai.installJournalAiTransport({generate:brief=>{calls++;return {result:Promise.resolve(suggestion(brief.requestId)),cancel(){}};}});const {p}=page('journal');p.openDocument(journal.makeJournal(assets(1),'TEST'),false);p.openAi();assert.equal(p.data.prompt,'');p.prompt(input('', 'Make a short plain observation'));await p.prepareAi();const first=p.data.aiSuggestion.requestId;
  p.editAiSuggestion(input('body','My edited observation.'));p.chooseAiDestination(tap('new'));p.aiChoice(input('placement',0));p.applyAi({currentTarget:{dataset:{design:'no'}}});assert.equal(calls,1);assert.equal(p.data.doc.title,'TEST');assert.ok(p.data.doc.elements.some(e=>e.text==='My edited observation.'));
  p.undo();p.openAi();assert.equal(p.data.prompt,'');p.openAiHistory();assert.equal(p.data.aiHistory.length,1);p.restoreAiHistory(tap(first));assert.equal(calls,1);assert.ok(p.data.aiSuggestion);assert.equal(p.data.doc.title,'TEST');
});

test('forum photo association supports a subset and all four independently of the active preview; a fifth is rejected before generation',async()=>{
  environment();let sent,calls=0;ai.installJournalAiTransport({generate:brief=>{sent=brief;calls++;return {result:Promise.resolve(suggestion(brief.requestId)),cancel(){}};}});const {p}=page('community');await p.compose();p.change(input('body','Not sure what bird this is.'));const photos=Array.from({length:5},(_,i)=>postImage('/assets/samples/field-'+(i%3)+'.png'));p.setImages(photos);p.openWriting();p.writingImagesAll();assert.equal(p.data.writingPhotoCount,4);
  p.writingImage(tap(photos[1].id));p.attachmentDetails(tap(photos[4].id));assert.equal(p.data.writingPhotoCount,3);await p.prepareWriting();assert.equal(calls,1);assert.deepEqual(sent.images.map(p=>p.id),[photos[0].id,photos[2].id,photos[3].id]);assert.match(JSON.parse(sent.prompt).body,/Not sure/);
  p.writingImage(tap(photos[1].id));p.writingImage(tap(photos[4].id));await p.prepareWriting();assert.equal(calls,1);assert.match(p.data.writingError,/5.*最多.*4/);
  const ids=photos.map(p=>({id:p.id,path:p.path,label:p.label}));assert.throws(()=>postWritingBrief({title:'A',body:'B',instructions:'',purpose:1,image:'',includeImage:true,pictures:ids}),/5.*4/);
});

test('a failed writing request can be retried without fallback; cancelling a later completion preserves the composer marker',async()=>{
  environment();let calls=0,finish;ai.installJournalAiTransport({generate:brief=>{calls++;return {result:calls===1?Promise.reject(null):calls===2?Promise.resolve(suggestion(brief.requestId)):new Promise(resolve=>finish=()=>resolve(suggestion(brief.requestId))),cancel(){}};}});const {p}=page('community');await p.compose();p.change(input('body','CANCEL-KEEP-123'));p.openWriting();await p.prepareWriting();assert.match(p.data.writingError,/原文与照片仍保留/);assert.equal(p.data.body,'CANCEL-KEEP-123');await p.prepareWriting();assert.ok(p.data.writingSuggestion);assert.equal(calls,2);
  const pending=p.prepareWriting();p.closeWriting();finish();await pending;assert.equal(p.data.body,'CANCEL-KEEP-123');assert.equal(p.data.writingSuggestion,null);
});

test('repeated failed-image events stop bridge churn, retain original sources and allow an explicit retry',()=>{
  environment();const {p,patches}=page('journal');p.openDocument(journal.makeJournal(assets(1),'Keep'),false);const photo=p.data.doc.elements.find(e=>e.type==='photo');patches.length=0;p.imageFailed(tap(photo.id));const count=patches.length;assert.ok(count>0);p.imageFailed(tap(photo.id));p.imageFailed(tap(photo.id));assert.equal(patches.length,count);assert.equal(p.data.doc.elements.find(e=>e.id===photo.id).src,photo.src);p.retryPhoto(tap(photo.id));assert.equal(p._failedPhotos.has(photo.id),false);
});

test('forum gallery errors replace only the failed image and do not repeatedly patch the bridge',()=>{
  environment();const {p,patches}=page('community');p.setData({remotePosts:[{id:'post-a',image:'bad-url',gallery:[{image:'bad-url'},{image:'good-url'}]},{id:'post-b',image:'other-url',gallery:[{image:'other-url'}]}]});patches.length=0;
  const event={currentTarget:{dataset:{id:'post-a',url:'bad-url'}}};p.thumbnailFailed(event);assert.equal(p.data.remotePosts[0].gallery[0].image,'');assert.equal(p.data.remotePosts[0].gallery[1].image,'good-url');assert.equal(p.data.remotePosts[1].gallery[0].image,'other-url');const count=patches.length;p.thumbnailFailed(event);assert.equal(patches.length,count);
});
