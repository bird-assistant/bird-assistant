const {test}=require('node:test');
const assert=require('node:assert/strict');
const service=require('../.test-build/services/community.js');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function page(name,extra={}){
  global.wx={getWindowInfo:()=>({windowWidth:390,windowHeight:844,screenHeight:844,statusBarHeight:24,safeArea:{bottom:810}}),getMenuButtonBoundingClientRect:()=>({top:30,bottom:62}),createCameraContext:()=>({}),pageScrollTo:()=>{},...extra};
  let definition;global.Page=value=>definition=value;
  const path=require.resolve('../.test-build/pages/'+name+'/index.js');delete require.cache[path];require(path);
  const p={data:structuredClone(definition.data),setData(patch){Object.assign(this.data,patch);}};
  for(const [key,value] of Object.entries(definition))if(key!=='data')p[key]=typeof value==='function'?value.bind(p):structuredClone(value);
  p.onLoad?.();return p;
}
const touch=(x,y)=>({touches:[{clientX:x,clientY:y}]});
const tap=id=>({currentTarget:{dataset:{id}}});

test('Pura 70 Pro+ gets a bounded 3.5× shortcut and the readout follows the actual camera response',()=>{
  const {cameraZoomProfile,zoomShortcuts}=require('../.test-build/services/camera-zoom.js');
  assert.equal(cameraZoomProfile({brand:'HUAWEI',model:'Pura 70 Pro+'}),'pura70proplus');
  assert.equal(cameraZoomProfile({model:'Huawei Pura70ProPlus'}),'pura70proplus');
  assert.equal(cameraZoomProfile({model:'unknown'}),'default');
  assert.deepEqual(zoomShortcuts(10,'pura70proplus').map(x=>x.value),[1,2,3.5,5,10]);
  assert.deepEqual(zoomShortcuts(3.4,'pura70proplus').map(x=>x.value),[1,2]);
  const requests=[],p=page('identify',{getDeviceInfo:()=>({brand:'HUAWEI',model:'Pura 70 Pro+'}),createCameraContext:()=>({setZoom:o=>requests.push(o)})});
  p.cameraReady({detail:{maxZoom:10}});p.zoom({currentTarget:{dataset:{zoom:3.5}}});assert.equal(requests[0].zoom,3.5);
  requests[0].success({zoom:3.4});assert.equal(p.data.zoomText,'3.4');assert.equal(p.data.zoom,3.4);p.onUnload();
});
test('vertical zoom gestures reveal and hide the ruler without sending zoom commands; horizontal drags still zoom',()=>{
  const requests=[],p=page('identify',{createCameraContext:()=>({setZoom:o=>requests.push(o)})});p.cameraReady({detail:{maxZoom:5}});
  p.zoomStart(touch(180,200));p.zoomMove(touch(173,156));p.zoomEnd();assert.equal(p.data.zoomOpen,true);assert.equal(requests.length,0);
  p.toggleZoom();assert.equal(p.data.zoomOpen,true); // A synthetic tap after the swipe cannot undo it.
  p.zoomStart(touch(210,150));p.zoomMove(touch(66,155));p.zoomEnd();assert.equal(requests.length,1);assert.equal(requests[0].zoom,2);requests[0].success({zoom:1.9});assert.equal(p.data.zoomText,'1.9');
  p.zoomStart(touch(120,140));p.zoomMove(touch(123,190));p.zoomEnd();assert.equal(p.data.zoomOpen,false);assert.equal(requests.length,1);
  p.onHide();p.zoomStart(touch(100,120));p.zoomMove(touch(-300,120));p.zoomEnd();assert.equal(requests.length,1);p.onUnload();
});
test('the styled forum menu preserves every destination, dismisses on back and hides with the page',t=>{
  const visits=[];t.mock.method(service,'hub',id=>visits.push(id));const p=page('community');let drafts=0;p.loadDraft=()=>drafts++;
  for(const item of p.data.moreItems){p.moreSections();assert.equal(p.data.moreOpen,true);p.moreSection(tap(item.id));assert.equal(p.data.moreOpen,false);}
  assert.deepEqual(visits,['library','external','friends','inbox','groups']);assert.equal(drafts,1);
  p.moreSections();p.back();assert.equal(p.data.moreOpen,false);assert.equal(p.data.view,'feed');
  p.moreSections();p.onHide();assert.equal(p.data.moreOpen,false);p.onUnload();
});
test('forum reaction locks belong to each page instance and reject a duplicate pending tap',async t=>{
  const requests=[];t.mock.method(service,'api',()=>new Promise(resolve=>requests.push(resolve)));
  const a=page('community'),b=page('community');
  for(const p of [a,b])p.data.remotePosts=[{id:'same',liked:false,favorited:false,likes:0,hasLikes:true}];
  const event={currentTarget:{dataset:{id:'same',kind:'like'}}},first=a.react(event);void a.react(event);const second=b.react(event);assert.equal(requests.length,2);
  a.onHide();requests.forEach(resolve=>resolve({active:true,reactions:['like'],likes:1}));await Promise.all([first,second]);assert.equal(a.data.remotePosts[0].liked,false);assert.equal(b.data.remotePosts[0].liked,true);
  a.onUnload();b.onUnload();await settle();
});
test('photo info formats shared EXIF, keeps sparse metadata sparse and never infers absent settings',()=>{
  const {photoInfo}=require('../.test-build/services/photo-info.js');
  assert.equal(photoInfo(null),null);assert.equal(photoInfo({device:'',make:'',model:''}),null);assert.equal(photoInfo({latitude:40,serial:'private'}),null);
  const p=photoInfo({device:'iPhone 16 Plus<iPhone17,4>',make:'Apple',model:'iPhone 16 Plus',focal:'6',aperture:'1.6',exposure:'0.00125',iso:'64',latitude:40});
  assert.equal(p.title,'iPhone 16 Plus');assert.deepEqual(p.settings.map(x=>x.value),['6 mm','f/1.6','1/800 s','64']);
  assert.deepEqual(photoInfo({device:'Pura 70 Pro+'}).settings,[]);
  assert.equal(photoInfo({focal:'92.5 mm',exposure:'1/2000',aperture:'f/2.1'}).settings.find(x=>x.key==='exposure').value,'1/2000 s');
});
