const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {registerPage}=require('./helpers/page-lifecycle.cjs');
const {acceptPickedMedia,audioContainer}=require('../.test-build/services/media-import.js');
const {choosePhoto}=require('../.test-build/services/media.js');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const tap=id=>({currentTarget:{dataset:{id}}});
function environment(){
  const dialogs=[],reads=[],saved=new Map();
  const wav=Buffer.alloc(48);wav.write('RIFF');wav.write('WAVE',8);
  global.wx={canIUse:()=>false,nextTick:f=>f(),pageScrollTo(){},setNavigationBarTitle(){},getStorageSync:key=>saved.get(key),setStorageSync:(key,value)=>saved.set(key,structuredClone(value)),showModal:o=>{dialogs.push(o);o.success?.({confirm:true});},
    getWindowInfo:()=>({windowWidth:390,windowHeight:844,statusBarHeight:24,safeArea:{bottom:810}}),getMenuButtonBoundingClientRect:()=>({top:30,bottom:62}),
    getImageInfo:o=>o.src.includes('bad')?o.fail({errMsg:'decode failed'}):o.success({width:640,height:480,type:'jpeg'}),
    getVideoInfo:o=>o.src.includes('bad')?o.fail({errMsg:'decode failed'}):o.success({width:640,height:480,duration:5}),
    getFileSystemManager:()=>({getFileInfo:o=>o.success({size:48}),readFile:o=>{reads.push(o.filePath);const bytes=o.filePath.includes('forged')?Buffer.from('PK\x03\x04not-audio'):wav;o.success({data:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length)});}})};
  return {dialogs,reads,saved};
}
function page(name){let d;global.Page=value=>d=value;const path=require.resolve('../.test-build/'+name+'/index.js');delete require.cache[path];require(path);const patches=[],p={data:structuredClone(d.data),setData(value,done){patches.push(structuredClone(value));Object.assign(this.data,value);done?.();}};for(const[k,v]of Object.entries(d))if(k!=='data')p[k]=typeof v==='function'?v.bind(p):structuredClone(v);return {p:registerPage(p),patches};}
function card(){let d;global.Component=value=>d=value;const path=require.resolve('../.test-build/components/photo-card/index.js');delete require.cache[path];require(path);const p={data:{...structuredClone(d.data),fileInfo:{title:'Device'},manualInfo:null},setData(value){Object.assign(this.data,value);}};for(const[k,v]of Object.entries(d.methods))p[k]=v.bind(p);return p;}

test('audio signatures distinguish supported containers from documents and renamed content',()=>{
  const wave=Buffer.alloc(16);wave.write('RIFF');wave.write('WAVE',8);const mp4=Buffer.alloc(16);mp4.write('ftyp',4);
  assert.equal(audioContainer(wave),'wav');assert.equal(audioContainer(mp4),'mp4');assert.equal(audioContainer(Buffer.from('OggSdata')),'ogg');assert.equal(audioContainer(Buffer.from('ID3\0\0\0\0\0\0\0')),'mp3');
  assert.equal(audioContainer(Uint8Array.from([255,251,144,0])),'mp3');assert.equal(audioContainer(Uint8Array.from([255,241,80,128,0,0,0])),'aac');assert.equal(audioContainer(Buffer.from('PK\x03\x04document')),'');assert.equal(audioContainer(Buffer.from('%PDF-1.7')),'');
});
test('mixed file selection keeps valid files in order and reports invalid files in one popup',async()=>{
  const {dialogs,reads}=environment();const files=[{path:'bird.jpg',kind:'photo'},{path:'bad.pdf',kind:'photo'},{path:'bad.mp4',kind:'video'},{path:'notes.docx',kind:'audio',name:'notes.docx'},{path:'forged.wav',kind:'audio',name:'renamed.wav'},{path:'bird.wav',kind:'audio',name:'鸟鸣.wav'}];
  assert.deepEqual((await acceptPickedMedia(files)).map(f=>f.path),['bird.jpg','bird.wav']);assert.equal(dialogs.length,1);assert.match(dialogs[0].content,/bad.pdf/);assert.match(dialogs[0].content,/notes.docx/);assert.match(dialogs[0].content,/实际内容/);assert.ok(!reads.includes('notes.docx'));
});
test('an audio extension must match its actual container',async()=>{
  const {dialogs}=environment();assert.deepEqual(await acceptPickedMedia([{path:'wave.mp3',name:'wave.mp3',kind:'audio'}]),[]);assert.match(dialogs[0].content,/格式不符/);
  const long={path:'bird.wav',name:'鸟鸣'.repeat(70)+'.wav',kind:'audio'};assert.deepEqual(await acceptPickedMedia([long]),[long]);
});
test('the identify picker rejects a non-image even if the native picker calls it an image',async()=>{
  const {dialogs}=environment(),{p}=page('pages/identify');p.data.view='import';let picker;global.wx.chooseMedia=o=>picker=o;p.chooseFiles();picker.success({tempFiles:[{fileType:'image',tempFilePath:'bad.pdf',size:10},{fileType:'image',tempFilePath:'bird.jpg',size:100}]});await settle();
  assert.equal(dialogs.length,1);assert.deepEqual(p.data.assets.map(a=>a.path),['bird.jpg']);assert.equal(p.data.picking,false);
});
test('audio selection reaches the native bridge for every card after switching modes',async()=>{
  environment();const {p,patches}=page('pages/identify');p.data.view='import';p._pickToken=1;await p.receiveFiles([{path:'bird.wav',name:'鸟鸣.wav',kind:'audio'}],1);p.addEvidence('bird.jpg','photo','album');
  p.importMode(tap('audio'));assert.equal(p.data.assets[0].included,true);assert.equal(p.data.assets[1].included,false);assert.deepEqual(patches.at(-1),{'assets[0].included':true,'assets[1].included':false});
  p.importMode(tap('both'));assert.equal(p.data.assets[0].included,true);assert.equal(p.data.assets[1].included,true);p.toggleImportEvidence(tap(p.data.assets[0].id));assert.equal(p.data.assets[0].included,false);
});
test('a validation finishing after unload adds no file or popup',async()=>{
  const {dialogs}=environment(),{p}=page('pages/identify');let decode;global.wx.getImageInfo=o=>decode=o;p.data.view='import';p._pickToken=1;const work=p.receiveFiles([{path:'late.jpg',kind:'photo'}],1);p.onUnload();decode.fail({errMsg:'late failure'});await work;assert.deepEqual(p.data.assets,[]);assert.equal(dialogs.length,0);
});
test('fallback photo and avatar selection reject an unreadable image before returning a path',async()=>{
  const {dialogs}=environment();global.wx.chooseImage=o=>o.success({tempFilePaths:['bad.pdf']});assert.equal(await choosePhoto(['album']),null);assert.equal(dialogs.length,1);
});
test('a verified video stays a video while a document cannot enter the video deck',async()=>{
  const {dialogs}=environment();const result=await acceptPickedMedia([{path:'clip.mp4',kind:'video'},{path:'bad.docx',kind:'video'}]);assert.deepEqual(result.map(f=>f.path),['clip.mp4']);assert.equal(result[0].kind,'video');assert.equal(dialogs.length,1);
});
test('empty and unreadable audio files are rejected before they can become materials',async()=>{
  const {dialogs}=environment();global.wx.getFileSystemManager=()=>({getFileInfo:o=>o.filePath==='empty.wav'?o.success({size:0}):o.fail({errMsg:'not found'})});assert.deepEqual(await acceptPickedMedia([{path:'empty.wav',kind:'audio'},{path:'missing.wav',kind:'audio'}]),[]);assert.equal(dialogs.length,1);assert.match(dialogs[0].content,/为空/);assert.match(dialogs[0].content,/无法读取/);
});
test('tapping the parameter face flips back without scrolling to its bottom',()=>{
  environment();const p=card();p.tapCard();assert.equal(p.data.flipped,true);p.touchStart({touches:[{clientX:20,clientY:30}]});p.tapCard();assert.equal(p.data.flipped,false);
});
test('vertical scrolling and its trailing tap do not flip the card; an explicit return remains available',t=>{
  environment();let now=1000;t.mock.method(Date,'now',()=>now);const p=card();p.flip();p.touchStart({touches:[{clientX:20,clientY:100}]});p.touchMove({touches:[{clientX:20,clientY:50}]});p.parametersScrolled();p.tapCard();assert.equal(p.data.flipped,true);p.flip();assert.equal(p.data.flipped,false);
  now+=250;p.touchStart({touches:[{clientX:20,clientY:50}]});p.tapCard();assert.equal(p.data.flipped,true);
});
test('every custom sheet keeps its close header outside the bounded scrolling body',()=>{
  let total=0;
  for(const name of ['community','journal','home']){const markup=fs.readFileSync('miniprogram/pages/'+name+'/index.wxml','utf8'),headers=[...markup.matchAll(/class="[^"]*\bsheet-header-fixed\b[^"]*"/g)],bodies=[...markup.matchAll(/<scroll-view\b[^>]*class="[^"]*\bsheet-scroll\b[^"]*"[^>]*>([\s\S]*?)<\/scroll-view>/g)];assert.equal(headers.length,bodies.length,name);for(const body of bodies){assert.doesNotMatch(body[1],/sheet-header-fixed|aria-label="关闭/);}total+=headers.length;}
  assert.equal(total,12);
});
test('post image validation preserves the existing draft and excludes unreadable selections',async()=>{
  const {dialogs}=environment(),{p}=page('pages/community');p.data.body='Keep my observation';let picker;global.wx.chooseImage=o=>picker=o;p.attach();await picker.success({tempFilePaths:['bad.pdf','bird.jpg']});assert.equal(p.data.body,'Keep my observation');assert.deepEqual(p.data.attachments.map(a=>a.path),['bird.jpg']);assert.equal(dialogs.length,1);assert.equal(p.data.picking,false);
});
test('journal photo validation cannot insert a late photo into a different document',async()=>{
  environment();const {p}=page('pages/journal');p.sample();p.generate();await p.persistDraft();let picker,decode;global.wx.chooseImage=o=>picker=o;global.wx.getImageInfo=o=>decode=o;p.addPhoto();const running=picker.success({tempFilePaths:['late.jpg']});const count=p.data.doc.elements.length;p.data.doc.id='different-document';decode.success({width:20,height:20});await running;assert.equal(p.data.doc.elements.length,count);
});
