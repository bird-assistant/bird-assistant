const {test}=require('node:test');
const assert=require('node:assert/strict');
const {postImage,checkPostImages}=require('../.test-build/services/post-media.js');
const drafts=require('../.test-build/services/post-draft.js');
const service=require('../.test-build/services/community.js');
const tap=(id,index=0)=>({currentTarget:{dataset:{id,index}}});
function environment(){
  const storage=new Map(),files=new Map([['/tmp/original.jpg','original-exif-bytes'],['/tmp/second.png','second-original']]),deleted=[],copies=[];
  const fs={mkdirSync(){},accessSync(path){if(!files.has(path)&&path!=='/user/bird-post-draft/')throw Error('missing file');},readdirSync:()=>[...files.keys()].filter(p=>p.startsWith('/user/bird-post-draft/')).map(p=>p.split('/').pop()),
    copyFile(options){copies.push(options);files.set(options.destPath,files.get(options.srcPath));options.success();},unlinkSync(path){deleted.push(path);files.delete(path);}};
  global.wx={env:{USER_DATA_PATH:'/user'},getFileSystemManager:()=>fs,getStorageSync:key=>structuredClone(storage.get(key)||''),setStorageSync:(key,value)=>storage.set(key,structuredClone(value)),removeStorageSync:key=>storage.delete(key),showToast(){},getImageInfo:o=>o.success({width:640,height:480,type:'jpeg'}),getWindowInfo:()=>({windowWidth:390,windowHeight:844,safeArea:{bottom:844}}),getMenuButtonBoundingClientRect:()=>({top:28,height:32,right:380}),pageScrollTo(){},canIUse:()=>false};
  return{storage,files,deleted,copies,fs};
}
function input(images){return{version:2,title:'A real observation',body:'Keep the words',images,writing:{purpose:2,instructions:'Keep uncertainty',includeImage:false}};}
function page(path='pages/community/index'){
  let definition;global.Page=value=>definition=value;const module=require.resolve('../.test-build/'+path+'.js');delete require.cache[module];require(module);
  const p={data:structuredClone(definition.data),setData(value,done){Object.assign(this.data,value);done?.();}};
  for(const[key,value]of Object.entries(definition))if(key!=='data')p[key]=typeof value==='function'?value.bind(p):structuredClone(value);
  return p;
}
test('a post permits nine visual attachments including at most three journal pages',()=>{
  const photos=Array.from({length:9},(_,i)=>postImage('photo-'+i));checkPostImages(photos);
  assert.throws(()=>checkPostImages([...photos,postImage('extra')]),/9/);
  assert.throws(()=>checkPostImages(Array.from({length:4},(_,i)=>postImage('j'+i,'journal','Page '+i))),/3/);
});
test('post drafts copy originals intact, reuse saved paths, and reclaim only unreferenced owned files',async()=>{
  const e=environment(),image=postImage('/tmp/original.jpg');image.manualCamera={iso:'800',focusMode:'AF-C'};
  const first=await drafts.savePostDraft(input([image]));assert.equal(e.files.get('/tmp/original.jpg'),'original-exif-bytes');assert.equal(e.files.get(first.images[0].path),'original-exif-bytes');
  assert.equal(first.images[0].manualCamera.iso,'800');assert.equal(e.copies.length,1);
  await drafts.savePostDraft(input(first.images));assert.equal(e.copies.length,1);
  e.files.set('/user/observation-photo.jpg','private observation');
  await drafts.savePostDraft(input([]));assert.deepEqual(e.deleted,[first.images[0].path]);assert.ok(e.files.has('/user/observation-photo.jpg'));assert.equal(drafts.readPostDraft().images.length,0);
});
test('quota failure rolls back new copies, keeps the old full draft and restores the latest words and parameters',async()=>{
  const e=environment(),old=await drafts.savePostDraft(input([postImage('/tmp/original.jpg')]));
  const a=postImage('/tmp/original.jpg'),b=postImage('/tmp/second.png');b.manualCamera={iso:'1600'};
  let count=0;e.fs.copyFile=options=>{if(++count===2){options.fail({errMsg:'storage limit exceeded'});return;}e.files.set(options.destPath,'partial');options.success();};
  await assert.rejects(drafts.savePostDraft({...input([a,b]),body:'Latest unsaved observation'}),/文字与参数已保存/);
  assert.deepEqual(e.storage.get(drafts.POST_DRAFT_KEY),old);assert.ok(e.files.has(old.images[0].path));assert.ok(e.files.has('/tmp/original.jpg'));
  const recovered=drafts.readPostDraft();assert.equal(recovered.body,'Latest unsaved observation');assert.equal(recovered.missingMedia,2);assert.ok(recovered.images.every(item=>item.path===''));assert.equal(recovered.images[1].manualCamera.iso,'1600');
  assert.equal([...e.files.values()].filter(v=>v==='partial').length,0);
});
test('manifest storage failure rolls back its copied file and never claims success',async()=>{
  const e=environment();global.wx.setStorageSync=(key,value)=>{if(key===drafts.POST_DRAFT_KEY)throw Error('storage quota');e.storage.set(key,structuredClone(value));};
  await assert.rejects(drafts.savePostDraft(input([postImage('/tmp/original.jpg')])),/未保存/);assert.equal(e.files.size,2);assert.equal(drafts.readPostDraft().body,'Keep the words');
});
test('a complete manifest remains readable if removing its matching recovery key fails',async()=>{
  environment();global.wx.removeStorageSync=()=>{throw Error('locked');};const saved=await drafts.savePostDraft(input([postImage('/tmp/original.jpg')]));
  assert.deepEqual(drafts.readPostDraft().images,saved.images);
});
test('legacy single-photo drafts migrate without losing manual metadata',()=>{
  const e=environment();e.storage.set('bird-assistant.post-draft.v1',{title:'Old',body:'Still here',image:'/tmp/original.jpg',manualCamera:{iso:'800'}});
  const restored=drafts.readPostDraft();assert.equal(restored.images[0].manualCamera.iso,'800');assert.equal(restored.images[0].path,'/tmp/original.jpg');
});
test('composer appends photos, previews full originals, edits per-photo settings and rejects late picker results',async()=>{
  environment();let picker,preview;global.wx.chooseImage=options=>picker=options;global.wx.previewImage=options=>preview=options;
  const p=page();p.attach();assert.equal(picker.count,9);await picker.success({tempFilePaths:['/tmp/original.jpg','/tmp/second.png']});
  assert.equal(p.data.attachments.length,2);p.photoDetails({detail:{iso:'800'}});p.attachmentDetails(tap(p.data.attachments[1].id));p.photoDetails({detail:{iso:'1600'}});
  assert.equal(p.data.attachments[0].manualCamera.iso,'800');assert.equal(p.data.attachments[1].manualCamera.iso,'1600');
  p.previewAttachment(tap(p.data.attachments[0].id));assert.deepEqual(preview.urls,['/tmp/original.jpg','/tmp/second.png']);assert.equal(p.data.attachments.length,2);
  p.attach();p.onUnload();await picker.success({tempFilePaths:['late.jpg']});assert.equal(p.data.attachments.length,2);
});
test('missing recovered media cannot silently disappear when opening publication preview',()=>{
  environment();const p=page(),image=postImage('');p.setImages([image]);p.data.body='Recovered words';p.publish();assert.match(p.data.error,/重新添加/);assert.equal(p.data.body,'Recovered words');
});
test('an old server blocks a multi-image preview before any photo upload',async t=>{
  environment();const p=page('field/hub/index');p.data.publishAttachments=[postImage('a'),postImage('b')];p.data.photo='a';p.data.body='Two photos';
  t.mock.method(service,'api',async()=>{throw Error('404');});t.mock.method(service,'uploadPhoto',()=>assert.fail('unsupported galleries must not upload'));
  await p.prepare(tap(''));assert.match(p.data.error,/多图/);assert.equal(p.data.publishAttachments.length,2);assert.equal(p.data.preview,null);
});
test('gallery preview preserves order and per-image parameters and reuses uploads on retry',async t=>{
  environment();const p=page('field/hub/index'),first=postImage('a'),second=postImage('b','journal','Journal page');first.manualCamera={iso:'800'};
  p.data.publishAttachments=[first,second];p.data.photo='a';p.data.body='A photo and a journal';p.data.shareCamera=true;
  const uploaded=[],sent=[];t.mock.method(service,'uploadPhoto',async path=>{uploaded.push(path);return{id:'media-'+path,camera:{iso:'800'}};});
  t.mock.method(service,'api',async(path,method,data)=>{if(path.endsWith('/capabilities'))return{postGallery:1,maxImages:9};sent.push(data);return{id:'preview',display:{post:{media:true}}};});
  await p.prepare(tap(''));assert.equal(p.data.error,'');assert.deepEqual(sent[0].gallery.map(item=>item.media),['media-a','media-b']);assert.equal(sent[0].gallery[0].manual_camera.iso,'800');assert.equal(sent[0].gallery[1].kind,'journal');
  await p.prepare(tap(''));assert.deepEqual(uploaded,['a','b']);assert.equal(sent.length,2);
});

test('a partial journal render keeps completed snapshots and retries only the remaining selection',async t=>{
  environment();const p=page();p._journalDocuments=[{id:'one',width:900,height:1200,title:'One'},{id:'two',width:900,height:1200,title:'Two'}];
  p.data.journalPicker=true;p.data.journalChosen=2;p.data.journalChoices=p._journalDocuments.map(item=>({...item,selected:true}));
  const canvas=require('../.test-build/services/canvas.js'),renderer=require('../.test-build/services/journal-render.js');
  t.mock.method(canvas,'getCanvas',async()=>({}));let exports=0;t.mock.method(canvas,'exportCanvas',async()=>'/tmp/journal-'+(++exports)+'.png');
  const rendered=[];let fail=true;t.mock.method(renderer,'renderJournal',async(_canvas,document)=>{rendered.push(document.id);if(document.id==='two'&&fail){fail=false;throw Error('image unavailable');}});
  await p.addJournals();assert.equal(p.data.attachments.length,1);assert.equal(p.data.journalChosen,1);assert.equal(p.data.journalPicker,true);
  await p.addJournals();assert.deepEqual(p.data.attachments.map(item=>item.journalId),['one','two']);assert.deepEqual(rendered,['one','two','two']);assert.equal(p.data.journalPicker,false);
});

test('metadata arriving during a draft save preserves the managed file path and the newly read fields',async t=>{
  environment();const p=page(),image=postImage('/tmp/original.jpg');p.setImages([image]);p.data.body='Still writing';
  let finish;t.mock.method(drafts,'savePostDraft',value=>new Promise(resolve=>finish=()=>resolve({...value,images:[{...image,path:'/user/bird-post-draft/saved.jpg'}]})));
  const job=p.saveDraft();const fileMetadata={state:'ready',format:'jpeg',camera:{iso:'800'},hasExif:true};
  p.setData({attachments:[{...p.data.attachments[0],fileMetadata}],activeMetadata:fileMetadata});finish();await job;
  assert.equal(p.data.attachments[0].path,'/user/bird-post-draft/saved.jpg');assert.equal(p.data.attachments[0].fileMetadata.camera.iso,'800');assert.equal(p.data.body,'Still writing');
});
test('late file metadata follows its own attachment and cannot revive removed or unloaded composer content',async t=>{
  environment();const metadata=require('../.test-build/services/photo-metadata.js'),pending=[];
  t.mock.method(metadata,'readLocalPhotoMetadata',path=>new Promise(resolve=>pending.push({path,resolve})));
  const p=page(),a=postImage('a.jpg'),b=postImage('b.jpg'),meta={state:'ready',format:'jpeg',camera:{iso:'800'},hasExif:true};p.setImages([a,b],b.id);p.readImageMetadata([a,b]);
  pending[0].resolve(meta);await new Promise(resolve=>setImmediate(resolve));assert.equal(p.data.activeMetadata,null);assert.equal(p.data.attachments[0].fileMetadata.camera.iso,'800');
  p.removeAttachment(tap(b.id));pending[1].resolve(meta);await new Promise(resolve=>setImmediate(resolve));assert.equal(p.data.attachments.length,1);
  const c=postImage('c.jpg');p.setImages([c]);p.readImageMetadata([c]);p.onUnload();pending[2].resolve(meta);await new Promise(resolve=>setImmediate(resolve));assert.equal(p.data.attachments[0].fileMetadata,undefined);
});
