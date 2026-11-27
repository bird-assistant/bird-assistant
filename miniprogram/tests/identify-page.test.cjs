const {test}=require('node:test');
const assert=require('node:assert/strict');

const flush=()=>new Promise(resolve=>setImmediate(resolve));
function page(){
  let options;global.Page=value=>{options=value;};
  const path=require.resolve('../.test-build/pages/identify/index.js');delete require.cache[path];require(path);
  const instance={data:structuredClone(options.data),setData(value){Object.assign(this.data,value);}};
  for(const [key,value]of Object.entries(options))if(key!=='data')instance[key]=typeof value==='function'?value.bind(instance):value;
  return instance;
}

test('only an explicit shutter requests original quality and starts that photo persistence while remaining in the viewfinder',()=>{
  for(const live of [false,true]){
    const p=page(),calls=[];p.setData({cameraReady:true,paused:false,liveActive:live,demo:false});
    p._camera={takePhoto:options=>{assert.equal(options.quality,'original');assert.equal(options.captureMetadata,true);options.success({tempImagePath:'full.jpg'});}};
    p.persistCapture=(asset,analyze)=>calls.push({path:asset.path,analyze});p.review=()=>assert.fail('capture must not force review');
    p.shutterPhoto();assert.deepEqual(calls,[{path:'full.jpg',analyze:live}]);assert.equal(p.data.view,'live');
  }
});

test('the guide returns an offered species to the original photo and subject only',()=>{
  let navigation;
  global.wx={navigateTo:options=>{navigation=options;}};
  const p=page(),box={x1:0.2,y1:0.3,x2:0.7,y2:0.8};
  const candidates=[{speciesId:'bird-a',rank:1},{speciesId:'bird-b',rank:2}];
  p.setData({imagePath:'local.jpg',currentId:'asset',analysis:{analysisId:'analysis1',subjects:[{rank:2,box,candidates}]}});
  const choices=[];p.selectCandidate=(subject,rank)=>choices.push([subject,rank]);
  p.compareTarget({currentTarget:{dataset:{rank:2}}});
  assert.match(navigation.url,/ids=bird-a,bird-b/);
  navigation.success({eventChannel:{emit:(event,data)=>{assert.equal(event,'subject');assert.deepEqual(data,{src:'local.jpg',box});}}});
  navigation.events.choose({id:'unrelated'});
  navigation.events.choose({id:'bird-b'});
  p.data.analysis.analysisId='analysis2';
  navigation.events.choose({id:'bird-a'});
  assert.deepEqual(choices,[[2,2]]);
});

test('a storage failure after file persistence retains the durable photo and notes, then retries without moving the vanished temp path again',async(t)=>{
  const warnings=[];t.mock.method(console,'warn',(...args)=>warnings.push(args));
  const data=new Map(),toasts=[];let fail=true,copies=0;
  global.wx={getFileSystemManager:()=>({saveFile:options=>{copies++;options.success({savedFilePath:'wxfile://saved/photo.jpg'});}}),getStorageSync:key=>data.get(key),setStorageSync(key,value){if(fail)throw new Error('test quota failure');data.set(key,structuredClone(value));},showToast:value=>toasts.push(value)};
  const p=page();p.setData({imagePath:'wxfile://temp/photo.jpg',birdName:'雨燕（待复核）',notes:'Waited quietly for a long time.'});
  p.save();await flush();
  assert.equal(copies,1);assert.equal(p.data.persisted,true);assert.equal(p.data.imagePath,'wxfile://saved/photo.jpg');assert.equal(p.data.notes,'Waited quietly for a long time.');assert.equal(p.data.busy,false);assert.equal(toasts.length,0);
  assert.equal(warnings[0][1].message,'test quota failure');
  fail=false;p.save();await flush();
  assert.equal(copies,1);const records=data.get('bird-assistant.records.v1').records;assert.equal(records.length,1);assert.equal(records[0].birdName,'雨燕（待复核）');assert.equal(records[0].imagePath,'wxfile://saved/photo.jpg');assert.equal(toasts.length,1);assert.equal(p.data.imagePath,'');
});

test('save cannot race a pending picker, and cancellation retains the previous image and text',async()=>{
  let picker,copies=0;
  global.wx={chooseImage:value=>{picker=value;},getFileSystemManager:()=>({saveFile:()=>{copies++;}})};
  const p=page();p.setData({imagePath:'old.jpg',notes:'Keep this note.',observedDate:'2026-10-29',placeName:'Keep this place'});p.choose({currentTarget:{dataset:{source:'album'}}});assert.equal(p.data.picking,true);p.save();assert.equal(copies,0);
  picker.fail({errMsg:'chooseImage:fail cancel'});await flush();assert.equal(p.data.picking,false);assert.equal(p.data.imagePath,'old.jpg');assert.equal(p.data.notes,'Keep this note.');assert.equal(p.data.observedDate,'2026-10-29');assert.equal(p.data.placeName,'Keep this place');assert.equal(p.data.error,'');
});

test('each review material retains its own name and notes across additions, selection, removal and save',async()=>{
  const data=new Map();
  global.wx={getStorageSync:key=>data.get(key),setStorageSync:(key,value)=>data.set(key,structuredClone(value)),showToast(){}};
  const p=page(),tap=id=>({currentTarget:{dataset:{id}}}),value=value=>({detail:{value}});
  const first=p.addEvidence('/assets/samples/field-0.png','photo','album',true);
  p.changeName(value('照片里的鸟（待复核）'));p.changeNotes(value('第一张的笔记'));
  const second=p.addEvidence('wxfile://saved/song.mp3','audio','album');second.persisted=true;
  assert.equal(p.data.birdName,'');assert.equal(p.data.notes,'');
  p.changeName(value('另一种声音'));p.changeNotes(value('录音的笔记'));
  p.selectEvidence(tap(first.id));assert.equal(p.data.notes,'第一张的笔记');assert.equal(p.data.birdName,'照片里的鸟（待复核）');
  const third=p.addEvidence('wxfile://other.jpg','photo','album');p.removeEvidence(tap(third.id));
  assert.equal(p.data.birdName,'');assert.equal(p.data.notes,'');assert.equal(p.data.albumStatus,'');
  p.selectEvidence(tap(first.id));p.save();await flush();
  assert.equal(data.get('bird-assistant.records.v1').records[0].notes,'第一张的笔记');assert.equal(p.data.assets.length,1);
  p.selectEvidence(tap(second.id));assert.equal(p.data.birdName,'另一种声音');assert.equal(p.data.notes,'录音的笔记');
  p.save();await flush();const records=data.get('bird-assistant.records.v1').records;
  assert.equal(records[0].mediaKind,'audio');assert.equal(records[0].notes,'录音的笔记');assert.equal(p.data.assets.length,0);
});

test('late album acknowledgements cannot replace a different selected material status',()=>{
  let album;
  global.wx={saveImageToPhotosAlbum:options=>{album=options;}};
  const p=page(),a=p.addEvidence('wxfile://photo.jpg','photo','camera');p.saveAlbum(a);
  p.addEvidence('wxfile://audio.mp3','audio','album');assert.equal(p.data.albumStatus,'保留设备原件');
  album.fail();assert.equal(p.data.albumStatus,'保留设备原件');
  p.selectEvidence({currentTarget:{dataset:{id:a.id}}});assert.equal(p.data.albumStatus,'相册保存未完成 · 素材仍保留');
});

test('saving keeps its original draft even if another capture completes before filesystem acknowledgement',async()=>{
  let persist;const data=new Map();
  global.wx={getFileSystemManager:()=>({saveFile:options=>{persist=options;}}),getStorageSync:key=>data.get(key),setStorageSync:(key,value)=>data.set(key,structuredClone(value)),showToast(){}};
  const p=page(),a=p.addEvidence('wxfile://temp/first.jpg','photo','camera');
  p.changeName({detail:{value:'第一张'}});p.changeNotes({detail:{value:'保存中的原笔记'}});p.changeContext({currentTarget:{dataset:{key:'observedDate'}},detail:{value:'2026-10-29'}});p.changeContext({currentTarget:{dataset:{key:'placeName'}},detail:{value:'原来的地点'}});p.save();
  p.changeNotes({detail:{value:'迟到输入不得覆盖'}});assert.equal(p.data.notes,'保存中的原笔记');
  const b=p.addEvidence('wxfile://temp/second.mp3','audio','album');
  persist.success({savedFilePath:'wxfile://saved/first.jpg'});await flush();
  const record=data.get('bird-assistant.records.v1').records[0];
  assert.equal(record.birdName,'第一张');assert.equal(record.notes,'保存中的原笔记');assert.equal(record.mediaKind,'photo');
  assert.equal(record.observedDate,'2026-10-29');assert.equal(record.placeName,'原来的地点');assert.equal(p.data.placeName,'');
  assert.equal(record.imagePath,'wxfile://saved/first.jpg');assert.equal(p.data.currentId,b.id);
  assert.equal(p.data.assets.some(item=>item.id===a.id),false);assert.equal(p.data.imagePath,b.path);assert.equal(p.data.notes,'');
});
