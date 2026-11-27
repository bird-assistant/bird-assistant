const {test}=require('node:test');
const assert=require('node:assert/strict');
const {registerPage}=require('./helpers/page-lifecycle.cjs');
const journal=require('../.test-build/services/journal-model.js');
const canvas=require('../.test-build/services/canvas.js');
const {MapIconCache,drawClusterIcon}=require('../.test-build/services/map-icons.js');
const {cameraZoomProfile,zoomShortcuts}=require('../.test-build/services/camera-zoom.js');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const tap=data=>({currentTarget:{dataset:data}});
function environment(){const saved=new Map();global.wx={getStorageSync:key=>saved.get(key),setStorageSync:(key,value)=>saved.set(key,structuredClone(value)),canIUse:()=>false,pageScrollTo(){},nextTick:fn=>fn(),setNavigationBarTitle(){},getWindowInfo:()=>({windowWidth:390,windowHeight:844,statusBarHeight:24,safeArea:{bottom:810}}),getMenuButtonBoundingClientRect:()=>({top:30,bottom:62})};return saved;}
function page(path){let definition;global.Page=value=>definition=value;const file=require.resolve('../.test-build/'+path+'/index.js');delete require.cache[file];require(file);const p={data:structuredClone(definition.data),setData(value,done){Object.assign(this.data,value);done?.();}};for(const [key,value]of Object.entries(definition))if(key!=='data')p[key]=typeof value==='function'?value.bind(p):structuredClone(value);return registerPage(p);}
function map(){let d;global.Component=value=>d=value;const file=require.resolve('../.test-build/components/field-map/index.js');delete require.cache[file];require(file);const p={data:structuredClone(d.data),setData(value,done){Object.assign(this.data,value);done?.();}};for(const[key,value]of Object.entries(d.methods))p[key]=value.bind(p);p.queueLoad=()=>{};return p;}
function pictureContext(){const calls=[];const ctx={clearRect(){},beginPath(){},arc(...value){calls.push(['circle',...value]);},fill(){},stroke(){},font:'',measureText(text){return {width:text.length*parseInt(this.font.match(/\d+px/)[0])*.65};},fillText(...value){calls.push(['text',...value,this.font,this.textAlign,this.textBaseline]);}};return {canvas:{getContext:()=>ctx},ctx,calls};}

test('editing a caption title and multiline body keeps authored lines through reflow and persistence',async()=>{
  environment();const p=page('pages/journal');p.sample();p.generate();
  const caption=p.data.doc.elements.find(e=>e.photoId);caption.y=300;caption.w=500;p.data.selectedId=caption.id;p.refresh();
  p.text({...tap({key:'title'}),detail:{value:'湖边的观察'}});p.text({...tap({key:'text'}),detail:{value:'第一行\n第二行\n第三行'}});p.endTextEdit();
  let layout=journal.textLayout(caption,p.data.doc);assert.deepEqual(layout.rows.map(r=>r.text),['湖边的观察','第一行','第二行','第三行']);assert.equal(layout.overflow,false);
  journal.reflowJournalPhotos(p.data.doc);assert.equal(caption.maxLines,0);assert.equal(await p.persistDraft(),true);
  const reopened=journal.readJournals().find(d=>d.id===p.data.doc.id),saved=reopened.elements.find(e=>e.id===caption.id);saved.y=300;
  assert.equal(saved.text,'第一行\n第二行\n第三行');assert.equal(journal.textLayout(saved,reopened).overflow,false);
});
test('new and sample journals clear the previous setup title without rewriting the saved journal',async()=>{
  environment();const p=page('pages/journal');p.sample();p.data.title='仅属于第一本';p.generate();assert.equal(await p.persistDraft(),true);const id=p.data.doc.id;
  p.newJournal();assert.equal(p.data.title,'');assert.equal(journal.readJournals().find(d=>d.id===id).title,'仅属于第一本');p.data.title='另一个旧标题';p.sample();assert.equal(p.data.title,'');
});
test('audio deck highlights match exactly the materials sent in each import mode',async()=>{
  environment();const p=page('pages/identify');p.data.view='review';const photo=p.addEvidence('a.jpg','photo','album'),audio=p.addEvidence('a.mp3','audio','album');p.addEvidence('a.mp4','video','album');
  for(const mode of ['media','audio','both']){p.importMode(tap({id:mode}));const expected=p.data.assets.filter(a=>a.included).map(a=>a.id),sent=[];p.analyse=async()=>{sent.push(p.data.currentId);return true;};await p.analyseSelected();assert.deepEqual(sent,expected);assert.equal(audio.included,mode!=='media');assert.equal(photo.included,mode!=='audio');}
  p.toggleImportEvidence(tap({id:audio.id}));assert.equal(audio.included,false);assert.equal(audio.selected,false);
});
test('a late camera start after page hide is stopped and never creates a recording timer or material',()=>{
  environment();let start,stops=0;const p=page('pages/identify');p._camera={startRecord:o=>start=o,stopRecord:()=>stops++};p.data.cameraReady=true;p._holding=true;p.startVideo();assert.equal(p.data.busy,true);
  p.onHide();assert.equal(stops,1);assert.equal(p.data.pageVisible,false);start.success();assert.equal(stops,2);assert.equal(p.data.recording,false);assert.equal(p.data.busy,false);assert.equal(p.data.assets.length,0);
});
test('hiding during photo capture or stopping a video discards late results and releases busy state',()=>{
  environment();const p=page('pages/identify');let photo,video;let stops=0;p._camera={takePhoto:o=>photo=o,stopRecord:o=>{video=o;stops++;}};p.data.cameraReady=true;p.shutterPhoto();p.onHide();photo.success({tempImagePath:'late.jpg'});assert.equal(p.data.assets.length,0);assert.equal(p.data.busy,false);
  p._visible=true;p.data.view='live';p.data.recording=true;p.stopVideo();const pending=video;p.onHide();assert.equal(stops,2);pending.success({tempVideoPath:'late.mp4'});assert.equal(p.data.assets.length,0);assert.equal(p.data.busy,false);
});
test('leaving the capture view releases a pending microphone start and ignores its eventual clip',()=>{
  environment();const listeners={};let stops=0;global.wx.getRecorderManager=()=>({onStart:fn=>listeners.start=fn,onStop:fn=>listeners.stop=fn,onError:fn=>listeners.error=fn,start(){},stop(){stops++;}});
  const p=page('pages/identify');p.recordAudio();assert.equal(p.data.audioRecording,true);p.import();listeners.start();assert.equal(stops,1);listeners.stop({tempFilePath:'late.mp3',duration:3000});assert.equal(p.data.assets.length,0);assert.equal(p.data.audioRecording,false);assert.equal(p._audioCapture,null);
});
test('zoom shortcut taps work after dragging and Huawei profiles prefer 3.5 without claiming lens selection',()=>{
  environment();const p=page('pages/identify');p.data.demo=true;p.data.paused=false;p.updateZoomView(1);p._zoomSuppressTap=true;p.zoomPreset(tap({zoom:3.5}));assert.equal(p.data.zoom,3.5);p.zoomPreset(tap({zoom:2}));assert.equal(p.data.zoom,2);
  for(const device of [{brand:'HUAWEI',model:'Pura 70 Pro+'},{brand:'HUAWEI',model:'future-model'}]){const levels=zoomShortcuts(10,cameraZoomProfile(device)).map(v=>v.value);assert.ok(levels.includes(3.5));assert.ok(!levels.includes(3));}
  assert.ok(zoomShortcuts(10,cameraZoomProfile({brand:'Apple',model:'iPhone'})).some(v=>v.value===3));
});
test('clue panels support taps as well as swipes without a swipe being toggled twice',()=>{
  environment();const p=page('pages/identify');p.measureClues=()=>{};const before=p.data.clueCollapsed;p.toggleClues();assert.equal(p.data.clueCollapsed,!before);
  p.clueStart({touches:[{clientX:100,clientY:100}]});p.clueMove({touches:[{clientX:100,clientY:150}]});p.clueEnd();p.toggleClues();assert.equal(p.data.clueCollapsed,true);
  p.clueStart({touches:[{clientX:100,clientY:100}]});p.clueEnd();p.toggleClues();assert.equal(p.data.clueCollapsed,false);
});
test('cluster digits are drawn into the same image as the circle and long counts fit the image',()=>{
  for(const count of [1,29,17773,987654321]){const {canvas,ctx,calls}=pictureContext();drawClusterIcon(canvas,count);assert.equal(canvas.width,96);assert.equal(canvas.height,96);assert.deepEqual(calls[0].slice(0,4),['circle',48,48,44]);const text=calls[1];assert.deepEqual(text.slice(0,4),['text',String(count),48,49]);assert.equal(text.at(-2),'center');assert.equal(text.at(-1),'middle');assert.ok(ctx.measureText(String(count)).width<=72);}
});
test('marker images are serialized, reused and cleaned up when their owning map closes',async t=>{
  const {canvas:node}=pictureContext(),removed=[];let exports=0;
  t.mock.method(canvas,'exportCanvas',async()=>{exports++;await settle();return 'marker-'+exports+'.png';});const cache=new MapIconCache(async()=>node,path=>removed.push(path));
  await Promise.all([cache.prepare([1,29,29]),cache.prepare([29,17773])]);assert.equal(exports,3);assert.equal(cache.get(29),'marker-2.png');cache.close();assert.deepEqual(removed,['marker-1.png','marker-2.png','marker-3.png']);assert.equal(cache.get(29),undefined);
});
test('an image export finishing after the map closes is removed and never cached',async t=>{
  const {canvas:node}=pictureContext(),removed=[];let done;t.mock.method(canvas,'exportCanvas',()=>new Promise(resolve=>done=resolve));const cache=new MapIconCache(async()=>node,path=>removed.push(path));const work=cache.prepare([10]);await settle();cache.close();done('late.png');await work;assert.equal(cache.get(10),undefined);assert.deepEqual(removed,['late.png']);
});
test('locating requests GCJ02 high accuracy, zooms to street level, and cannot move a hidden map',async()=>{
  const saved=environment(),p=map();let options,resolve;global.wx.getLocation=o=>{options=o;return new Promise(r=>resolve=r);};const work=p.position();assert.equal(options.type,'gcj02');assert.equal(options.isHighAccuracy,true);resolve({latitude:40.000123,longitude:116.300456,accuracy:12});await work;assert.equal(p.data.scale,16);assert.equal(p.data.longitude,116.300456);assert.equal(p.data.showUserLocation,true);assert.equal(saved.get('bird-assistant.map-view.v1').latitude,40.000123);
  const late=p.position();p.suspend();resolve({latitude:20,longitude:100,accuracy:10});await late;assert.equal(p.data.latitude,40.000123);assert.equal(p.data.locating,false);
});
test('the advisor receives an approximate area while the native map keeps its own precise location',async()=>{
  environment();const p=map();let url;global.getCurrentPages=()=>[];global.wx.navigateTo=o=>url=o.url;global.wx.createMapContext=()=>({getCenterLocation:o=>o.success({latitude:40.000123,longitude:116.300456})});await p.planTrip();assert.match(url,/lat=40\.0&lon=116\.3/);
});
test('journal failures distinguish local image preparation, missing deployment and provider authorization',async t=>{
  environment();const {journalGatewayTransport}=require('../.test-build/services/journal-gateway.js');const input={requestId:'phone-diagnostic',prompt:'只整理原稿',purpose:'手帐',maxChars:120,images:[]};let calls=0;
  const local=journalGatewayTransport({endpoint:'https://team.example/api/v1/journal/suggestions',session:async()=> 'test-only',prepare:async()=>{throw new Error('画布初始化超时，请重试。');}});
  global.wx.request=()=>calls++;await assert.rejects(local.generate(input).result,error=>error.code==='IMAGE_PREPARATION'&&/画布初始化/.test(error.message));assert.equal(calls,0);
  const warnings=[];t.mock.method(console,'warn',(...value)=>warnings.push(value));
  for(const [status,code,message] of [[404,undefined,/尚未部署/],[503,'PROVIDER_AUTH',/模型授权/],[503,'MODEL_UNAVAILABLE',/模型未启用/]]){
    global.wx.request=options=>{calls++;options.success({statusCode:status,data:{error:{code,message:'PRIVATE UPSTREAM BODY'}}});return {abort(){}};};
    const transport=journalGatewayTransport({endpoint:'https://team.example/api/v1/journal/suggestions',session:async()=> 'test-only',prepare:async()=>[]});await assert.rejects(transport.generate(input).result,error=>message.test(error.message)&&!/PRIVATE/.test(error.message));
  }
  assert.equal(calls,3);assert.doesNotMatch(JSON.stringify(warnings),/test-only|PRIVATE UPSTREAM BODY|只整理原稿/);assert.match(JSON.stringify(warnings),/phone-diagnostic/);
});
