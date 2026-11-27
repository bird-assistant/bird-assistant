const {test}=require('node:test');
const assert=require('node:assert/strict');
const model=require('../.test-build/services/journal-model.js');
const shelf=require('../.test-build/services/journal-shelf.js');
const storage=require('../.test-build/services/journal-storage.js');
const community=require('../.test-build/services/community.js');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const tap=id=>({currentTarget:{dataset:{id}}});
const touch=(id,x=50,y=200)=>({...tap(id),touches:[{clientX:x,clientY:y}]});
function environment(extra={}){
 const values=new Map(),deleted=[];
 const fs={accessSync(){},mkdirSync(){},unlink:o=>deleted.push(o.filePath),saveFile:o=>o.success({savedFilePath:o.filePath||'/user/saved.jpg'}),getFileInfo:o=>o.fail?.({})};
 global.wx={getStorageSync:k=>structuredClone(values.get(k)??''),setStorageSync:(k,v)=>values.set(k,structuredClone(v)),removeStorageSync:k=>values.delete(k),env:{USER_DATA_PATH:'/user'},getFileSystemManager:()=>fs,
  getWindowInfo:()=>({windowWidth:412,windowHeight:931,screenHeight:931,statusBarHeight:36,safeArea:{bottom:910}}),getMenuButtonBoundingClientRect:()=>({top:42,bottom:74,left:290}),getDeviceInfo:()=>({platform:'android',model:'Pura 70 Pro+'}),getAppBaseInfo:()=>({version:'8.test',SDKVersion:'3.17.1'}),
  nextTick:f=>f(),pageScrollTo(){},canIUse:()=>false,createCameraContext:()=>({}),showToast(){},hideKeyboard(){},setNavigationBarTitle(){},...extra};
 return {values,fs,deleted};
}
function page(path){let definition;global.Page=value=>definition=value;const file=require.resolve('../.test-build/'+path+'/index.js');delete require.cache[file];require(file);
 const p={data:structuredClone(definition.data),getTabBar:()=>({setData(){}}),setData(values,done){Object.assign(this.data,values);done?.();}};
 for(const[k,v]of Object.entries(definition))if(k!=='data')p[k]=typeof v==='function'?v.bind(p):structuredClone(v);return p;
}
const assets=n=>Array.from({length:n},(_,i)=>({id:'a'+i,src:'/assets/samples/field-'+i%4+'.png',label:'照片 '+i,notes:'',sample:true,selected:true}));
test('a text destination with no usable space stops before generating a suggestion that cannot be applied',()=>{
 const {journalWritingBrief}=require('../.test-build/services/journal-writing.js'),d=model.makeJournal([],'No space');
 const box=model.element('text',{text:'已有文字',x:840,y:1195,w:50,h:1,fontSize:64});d.elements.push(box);const before=JSON.stringify(d);
 assert.throws(()=>journalWritingBrief(d,{destination:'selected',selectedId:box.id,placement:2,includeTitle:false,includeCaptions:false,purpose:'观察正文',prompt:'整理文字',photoIds:[]}),/放不下建议文字/);
 assert.equal(JSON.stringify(d),before);
});
function map(t,extra={}){
 const e=environment(extra);let definition;global.Component=value=>definition=value;const file=require.resolve('../.test-build/components/field-map/index.js');delete require.cache[file];require(file);
 const p={data:structuredClone(definition.data),...definition.methods,setData(values,done){Object.assign(this.data,values);done?.();}};
 t.after(()=>definition.lifetimes.detached.call(p));return {...e,p,definition};
}

test('location picker results survive hide/show in either native callback order and stale viewport reads cannot replace the destination',async t=>{
 for(const beforeShow of [false,true]){
  let choose,center={latitude:40,longitude:116.3};const moves=[];
  const {p,definition,values}=map(t,{chooseLocation:()=>new Promise(resolve=>choose=resolve),createMapContext:()=>({moveToLocation:o=>{moves.push(o);},getCenterLocation:o=>o.success(center),getScale:o=>o.success({scale:16}),getRegion:o=>o.success({southwest:{latitude:center.latitude-.01,longitude:center.longitude-.01},northeast:{latitude:center.latitude+.01,longitude:center.longitude+.01}})})});
  const selected={latitude:31.14,longitude:121.66,name:'上海迪士尼乐园'};
  const task=p.place();definition.pageLifetimes.hide.call(p);
  if(beforeShow){choose(selected);await task;definition.pageLifetimes.show.call(p);}else{definition.pageLifetimes.show.call(p);choose(selected);await task;}
  assert.equal(p.data.latitude,selected.latitude);assert.equal(p.data.longitude,selected.longitude);assert.equal(p.data.focusLabel,selected.name);assert.equal(moves.length,1);
  await p.updateViewport(false);assert.equal(p.data.latitude,selected.latitude);assert.ok([...values.values()].some(value=>value?.latitude===selected.latitude));definition.lifetimes.detached.call(p);
 }
});

test('a sighting location action centers and highlights that displayed region without claiming a public precise capture point',t=>{
 const {p}=map(t,{createMapContext:()=>({moveToLocation(){}})});
 p.data.selected=[{id:'public1',speciesName:'丑鸭',placeName:'北京',date:'2017-02-20',visibility:'public',displayLocation:{latitude:40,longitude:116.4},precisionLabel:'约十公里公开区域'}];
 p.focusRecord(tap('public1'));assert.equal(p.data.scale,12);assert.match(p.data.focusLabel,/公开区域/);p.renderClusters(12);assert.ok(p.data.markers.some(marker=>marker.id===2147483600&&marker.latitude===40));
});

test('distance choice stays selected against an older service and missing distances use only displayed region coordinates',async t=>{
 environment();const p=page('field/hub');p.data.id='bird';p.data.placePoint={latitude:40,longitude:116};
 t.mock.method(community,'api',async()=>({sort:'recent',placeCount:2,recordCount:2,items:[{id:'far',latest:'2026-11-26',displayLocation:{latitude:50,longitude:116}},{id:'near',latest:'2006-01-01',displayLocation:{latitude:40,longitude:116}}]}));
 p.sortPlaces({currentTarget:{dataset:{sort:'distance'}}});await settle();assert.equal(p.data.placeSort,'distance');assert.equal(p.data.places[0].id,'near');assert.equal(p.data.places[0].km,0);assert.match(p.data.placesError,/服务尚未支持/);p.onUnload();
});

test('one sighting uses a smaller drawer, while larger sets retain bounded scrolling',()=>{
 const {recordPane}=require('../.test-build/services/map-presentation.js');const short=recordPane(300,78,1,false),long=recordPane(300,78,60,true);
 assert.equal(short.sheetHeight,200);assert.equal(long.sheetHeight,300);assert.equal(short.listHeight+78,short.sheetHeight);
});

test('phone photo imports use the working original-photo selector and accept a return while hidden',async()=>{
 let picker;environment({chooseImage:o=>picker=o,getImageInfo:o=>o.success({width:4096,height:3072})});const p=page('pages/identify');p.onLoad();p.data.view='import';p.chooseFiles();assert.deepEqual(picker.sizeType,['original']);p.onHide();
 picker.success({tempFilePaths:['/album/original.jpg'],tempFiles:[{size:3000000}]});await settle();assert.equal(p.data.assets.length,1);assert.equal(p.data.assets[0].path,'/album/original.jpg');assert.equal(p.data.photoFallback,false);assert.equal(p.data.view,'import');p.onUnload();
});

test('original capture is durably saved once, stays in the viewfinder, and later saves update that observation',async()=>{
 const e=environment();const p=page('pages/identify');p.onLoad();p.saveAlbum=()=>{};
 const a=p.addEvidence('/temp/original.jpg','photo','camera');a.observedDate='2026-11-27';a.observedTime='12:00';p.data.captureCard={id:a.id,path:a.path,title:'Saving',status:'Saving'};
 await p.persistCapture(a,false);assert.equal(p.data.view,'live');assert.equal(a.persisted,true);assert.ok(a.observationId);assert.equal(e.values.get('bird-assistant.records.v1').records.length,1);
 p.data.birdName='我的判断';p.data.notes='保留原图';p.save();await settle();const records=e.values.get('bird-assistant.records.v1').records;assert.equal(records.length,1);assert.equal(records[0].birdName,'我的判断');assert.equal(records[0].imagePath,'/user/saved.jpg');p.onUnload();
});

test('a delayed original-save acknowledgment cannot replace a newer capture card or restart recognition after hiding',async()=>{
 for(const failed of [false,true]){
 const e=environment();let finish;e.fs.saveFile=o=>finish=o;const p=page('pages/identify');p.onLoad();p.saveAlbum=()=>{};let jobs=0;p.analyseCaptureQueue=()=>jobs++;
 const a=p.addEvidence('/tmp/first.jpg','photo','camera');p.data.captureCard={id:a.id,path:a.path,title:'Saving',status:'Saving'};const pending=p.persistCapture(a,true);p.onHide();p._visible=true;
 p.data.captureCard={id:'newer',path:'/tmp/newer.jpg',title:'New photo',status:'Saving'};p.data.busy=true;
 if(failed)finish.fail({errMsg:'disk full'});else finish.success({savedFilePath:'/user/first.jpg'});await pending;
 assert.equal(p.data.captureCard.id,'newer');assert.equal(p.data.busy,true);assert.equal(jobs,0);assert.equal(e.values.get('bird-assistant.records.v1')?.records.length||0,failed?0:1);p.onUnload();
 }
});

test('private updates preserve original identity/bytes and keep model evidence separate from per-target confirmation',()=>{
 const values=new Map();const {createRepository}=require('../.test-build/services/repository.js');const repo=createRepository({read:k=>values.get(k),write:(k,v)=>values.set(k,structuredClone(v))},()=> '2026-11-27T06:00:00Z',()=> 'observation');
 const saved=repo.save({imagePath:'/private/original.jpg',source:'camera',birdName:'',notes:'Original',targetConfirmations:[{rank:1,name:'初次保存的判断',analysis:null,species:null}]}),analysis={analysisId:'photo-analysis',candidates:[{name:'候选甲'}]};
 assert.equal(repo.list()[0].targetConfirmations[0].name,'初次保存的判断');
 const updated=repo.update(saved.id,{birdName:'我确认的鸟',analysis,targetConfirmations:[{rank:2,species:'bird-b',name:'我确认的鸟',analysis:'photo-analysis'}]});
 assert.equal(updated.id,saved.id);assert.equal(updated.imagePath,saved.imagePath);assert.equal(updated.createdAt,saved.createdAt);assert.equal(updated.notes,'Original');assert.equal(updated.analysis.candidates[0].name,'候选甲');assert.equal(updated.targetConfirmations[0].rank,2);assert.equal(repo.list().length,1);
});

test('waiting sampling backs off on stable targets, recovers on scene change and always respects the server interval',()=>{
 const {LiveSampling}=require('../.test-build/services/live-sampling.js');const p=new LiveSampling(),still=new Uint8Array(256).buffer,moving=new Uint8Array(256).fill(200).buffer;
 assert.equal(p.allow(0,'wait',500,still),true);for(let i=0;i<5;i++)p.feedback([{id:1,appearance:'confirmed'}]);assert.equal(p.interval('wait',500),4000);assert.equal(p.allow(1800,'wait',500,still),false);assert.equal(p.allow(2400,'wait',500,moving),true);
 assert.equal(p.allow(2500,'wait',6000,moving),false);assert.equal(p.allow(8400,'wait',6000,moving),true);assert.equal(p.allow(8500,'quick',500,moving),false);
});

test('recovery frames retain at most two useful bounded copies, expire and release everything when cleared',()=>{
 const {RecoveryFrames}=require('../.test-build/services/live-sampling.js'),r=new RecoveryFrames(20000,250),base=Date.parse('2026-11-27T06:00:00Z');
 const frame=(id,size=100)=>({id,capturedAt:new Date(base).toISOString(),image:new ArrayBuffer(size)});
 r.add(frame('no-bird'),0,base);assert.equal(r.list(base).length,0);for(let i=0;i<10;i++)r.add(frame('frame'+i),i+1,base);assert.deepEqual(r.list(base).map(f=>f.id),['frame9','frame8']);r.add(frame('oversized',1000),100,base);assert.equal(r.list(base).length,2);
 assert.equal(r.list(base+20001).length,0);r.add(frame('again'),1,base);r.clear();assert.equal(r.list(base).length,0);
});

test('hosted writing readiness failure prevents photo preparation and provider requests, and phones ignore the local-helper flag',async t=>{
 const gateway=require('../.test-build/services/journal-gateway.js'),network=require('../.test-build/services/vision-network.js'),writing=require('../.test-build/services/writing-network.js');const requests=[];let preparations=0;
 environment({getStorageSync:()=>true,request:o=>{requests.push(o);o.success({statusCode:404,data:{}});return {abort(){}};}});
 t.mock.method(network,'connectBusiness',async()=>({origin:network.businessOrigin(),header:{Authorization:'Bearer test-session'}}));t.mock.method(gateway,'prepareJournalPhotos',async()=>{preparations++;return [];});
 const job=writing.teamWritingTransport({}).generate({version:1,requestId:'test',prompt:'Text',purpose:'test',maxChars:80,images:[{id:'image',path:'/private.jpg',label:'Photo'}]});await assert.rejects(job.result,/手机写作服务尚未上线/);
 assert.equal(preparations,0);assert.equal(requests.length,1);assert.match(requests[0].url,/\/journal\/capabilities$/);assert.ok(!requests[0].url.includes('127.0.0.1'));assert.equal(requests[0].method,'GET');
});

test('keyboard and rotation measurements keep the entire scroll body within the usable viewport without reserving empty height',()=>{
 const sheets=require('../.test-build/services/adaptive-sheets.js');let keyboardListener,height=931,content=2000;
 environment({onKeyboardHeightChange:f=>keyboardListener=f,offKeyboardHeightChange:f=>assert.equal(f,keyboardListener),getWindowInfo:()=>({windowHeight:height,statusBarHeight:36}),createSelectorQuery:()=>({in(){return this;},selectAll(){return this;},fields(){return this;},exec(done){done([[{height:content,dataset:{sheetId:'ai'}}],[{height:80,dataset:{sheetId:'ai'}}]]);}})});
 const p={data:{},setData(v,done){Object.assign(this.data,v);done?.();}};sheets.installAdaptiveSheets(p);keyboardListener({height:320});assert.ok(p.data.sheetHeights.ai+80<=931-320-36-56);
 height=611;sheets.fitAdaptiveSheets(p);assert.ok(p.data.sheetHeights.ai>200,'do not subtract the same keyboard twice');keyboardListener({height:0});height=400;sheets.fitAdaptiveSheets(p);content=80;p.setData({short:true});assert.equal(p.data.sheetHeights.ai,80);sheets.stopAdaptiveSheets(p);
});

test('shelf cache failures never undo a saved journal, and an old render cannot replace a newer thumbnail revision',()=>{
 const e=environment(),d=model.makeJournal(assets(1),'Keep');storage.saveJournalState(d,storage.editorHistory([],[]));const old=shelf.readJournalShelf()[0].revision;
 d.elements[1].text='Changed during render';storage.saveJournalState(d,storage.editorHistory([],[]));assert.equal(shelf.saveJournalThumbnail(d.id,old,'/stale.png'),false);
 const original=global.wx.setStorageSync;global.wx.setStorageSync=(key,value)=>{if(key!==model.JOURNAL_KEY)throw Error('cache quota');original(key,value);};d.elements[1].text='Still saved';storage.saveJournalState(d,storage.editorHistory([],[]));assert.equal(model.readJournals()[0].elements[1].text,'Still saved');assert.ok(e.values.has(model.JOURNAL_KEY));
});

test('thumbnail preparation downsizes only temporary copies and cleans them without touching original media or journal geometry',async()=>{
 const e=environment({getImageInfo:async()=>({width:4096,height:3072}),compressImage:async o=>{assert.equal(o.src,'/private/original.jpg');assert.equal(o.compressedWidth,640);return {tempFilePath:'/tmp/derivative.jpg'};}});
 const d=model.makeJournal([{...assets(1)[0],src:'/private/original.jpg'}],'Original'),before=JSON.stringify(d),prepared=await shelf.prepareThumbnailDocument(d);assert.equal(JSON.stringify(d),before);assert.equal(prepared.document.elements.find(e=>e.type==='photo').src,'/tmp/derivative.jpg');prepared.release();assert.deepEqual(e.deleted,['/tmp/derivative.jpg']);
});

test('paper gestures arm after one second, resist short drags, cancel sideways and act only on deliberate release',t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:0});
 const e=environment(),p=page('pages/journal');p.onLoad();const d=model.makeJournal(assets(1),'Paper');e.values.set(model.JOURNAL_KEY,[d]);p.data.libraryRows=[{id:d.id}];const actions=[];p.shareJournal=()=>actions.push('share');p.deleteJournal=()=>actions.push('confirm-delete');
 p.deckTouchStart(touch(d.id));t.mock.timers.tick(999);assert.equal(p.data.paperArmedId,'');p.deckTouchEnd();assert.deepEqual(actions,[]);
 p.deckTouchStart(touch(d.id));t.mock.timers.tick(1000);assert.equal(p.data.paperArmedId,d.id);p.deckTouchMove(touch(d.id,50,110));p.deckTouchEnd();assert.deepEqual(actions,[]);assert.equal(p.data.paperArmedId,d.id);
 p.deckTouchStart(touch(d.id));p.deckTouchMove(touch(d.id,50,-50));assert.equal(p._paperLatest.action,'share');assert.deepEqual(actions,[]);p.deckTouchEnd();assert.deepEqual(actions,['share']);
 p.deckTouchStart(touch(d.id));t.mock.timers.tick(1000);p.deckTouchMove(touch(d.id,50,450));p.deckTouchEnd();assert.deepEqual(actions,['share','confirm-delete']);assert.equal(model.readJournals().length,1);
 p.deckTouchStart(touch(d.id));t.mock.timers.tick(1000);p.deckTouchMove(touch(d.id,200,205));assert.equal(p.data.paperArmedId,'');p.deckTouchEnd();assert.equal(actions.length,2);p.onUnload();
});

test('sharing a composed journal creates a local forum draft and never publishes or alters the editable journal',async t=>{
 const e=environment(),p=page('pages/journal');p.onLoad();const d=model.makeJournal(assets(1),'Share me');storage.saveJournalState(d,storage.editorHistory([],[]));const before=JSON.stringify(model.readJournals()[0]);let saved,switched;
 const canvas=require('../.test-build/services/canvas.js'),render=require('../.test-build/services/journal-render.js'),drafts=require('../.test-build/services/post-draft.js'),handoff=require('../.test-build/services/draft-navigation.js');
 t.mock.method(canvas,'getCanvas',async()=>({}));t.mock.method(render,'renderJournal',async()=>{});t.mock.method(canvas,'exportCanvas',async()=>'/tmp/finished.png');t.mock.method(drafts,'savePostDraft',async value=>{saved=value;return value;});global.wx.switchTab=o=>switched=o.url;t.mock.method(community,'api',()=>assert.fail('must not publish'));
 await p.shareJournalImage(d.id,1);assert.equal(saved.images[0].kind,'journal');assert.equal(saved.images[0].path,'/tmp/finished.png');assert.equal(saved.body,'');assert.equal(handoff.takePostDraft(),saved.id);assert.equal(switched,'/pages/community/index');assert.equal(JSON.stringify(model.readJournals()[0]),before);p.onUnload();
});

test('public forum links target that record, while private observations never yield a private sharing path',()=>{
 environment();const p=page('field/hub');p.data.screen='record';p.data.record={id:'post-id',visibility:'public',title:'A good post',channel:'post'};assert.equal(p.onShareAppMessage().path,'/field/hub/index?screen=record&id=post-id');p.data.record.visibility='private';assert.ok(!p.onShareAppMessage().path.includes('post-id'));p.onUnload();
});

test('writing briefs expose source shape and layout constraints, use a fit-derived budget and preserve the user request verbatim',()=>{
 const writing=require('../.test-build/services/journal-writing.js');
 for(const ratio of ['3:4','1:1','4:3']){const d=model.makeJournal(assets(2),'Saved name',ratio),before=JSON.stringify(d);const o={destination:'new',selectedId:'',placement:1,includeTitle:false,includeCaptions:false,purpose:'照片手帐',prompt:'Use plain English, one concise paragraph.',photoIds:d.elements.filter(e=>e.type==='photo').map(e=>e.id)};
 const {input,context}=writing.journalWritingBrief(d,o),request=JSON.parse(input.prompt);assert.equal(request.instructions,o.prompt);assert.equal(request.layoutPlan.ratio,ratio);assert.equal(request.layoutPlan.keepSavedName,true);assert.ok(input.maxChars>=20&&input.maxChars<=120);assert.ok(input.prompt.length<=2000);
 writing.applyJournalWriting(d,context,{version:1,requestId:input.requestId,title:'',body:'字'.repeat(input.maxChars),design:{style:'nature',variant:1}});assert.equal(JSON.stringify(d),before);}
});

test('fault summaries retain useful categories and frame locations without copying keys, precise locations, private paths or user text',()=>{
 environment();const {faultSummary,diagnosticText}=require('../.test-build/services/diagnostics.js');const error=new Error('auth failed SECRET_KEY lat=39.991234 /private/image.jpg user private text');error.stack='at run (app.js:12:4)';for(let i=0;i<25;i++)faultSummary('app-error',error);const report=diagnosticText();assert.ok(!/SECRET_KEY|39.991234|private\/image|user private/.test(report));const data=JSON.parse(report);assert.equal(data.faults.length,20);assert.equal(data.faults[0].kind,'认证失败');assert.deepEqual(data.faults[0].frames,['app.js:12:4']);
});

test('returning from a species region link restores its species and privacy filters as well as the map coordinates',t=>{
 const {p,definition}=map(t,{createMapContext:()=>({moveToLocation(){}}),switchTab(){}});community.openMap({latitude:31.2,longitude:121.5},'bird-id','目标鸟种',1,{scale:11,precisionLabel:'约十公里公开区域'});definition.pageLifetimes.show.call(p);
 assert.equal(p.data.species,'bird-id');assert.equal(p.data.speciesLabel,'目标鸟种');assert.equal(p.data.scope,1);assert.equal(p.data.scale,11);assert.match(p.data.focusLabel,/公开区域/);
});

test('reopening a captured private observation retains its original publication reference and independent target judgments',()=>{
 const e=environment(),p=page('pages/identify');p.onLoad();const repo=require('../.test-build/services/repository.js').localRepository();const saved=repo.save({imagePath:'/user/original.jpg',source:'camera',birdName:'确认乙',notes:'Still private',analysis:{analysisId:'original-analysis'},communityDraft:{reference:'original-capture',path:'/user/original.jpg',point:{latitude:40,longitude:116,system:'WGS84'}},observedDate:'2026-11-27',observedTime:'12:00'});
 repo.update(saved.id,{targetConfirmations:[{rank:1,name:'确认甲',species:'a',analysis:'original-analysis'},{rank:2,name:'确认乙',species:'b',analysis:'original-analysis'}]});p.restoreObservation(saved.id);
 assert.equal(p.data.view,'review');assert.equal(p.data.currentId,'original-capture');assert.equal(p.data.birdName,'确认乙');assert.equal(p.data.assets[0].confirmedTargets.length,2);assert.equal(p.draftObservation().reference,'original-capture');assert.equal(p.draftObservation().target,2);p.onUnload();
});
