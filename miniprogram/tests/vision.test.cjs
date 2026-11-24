const {test}=require('node:test');
const assert=require('node:assert/strict');
const {LiveVision,overlay,frozenResult}=require('../.test-build/services/vision-live.js');
const {historicalFields,jpegMetadata}=require('../.test-build/services/photo-context.js');
const {photoBytes}=require('../.test-build/services/vision-network.js');

test('next live upload waits from acknowledgment and a limited frame preserves the overlay',t=>{
  let now=10000,request;
  t.mock.method(Date,'now',()=>now);
  global.wx={request:options=>{request=options;return {abort(){}};},base64ToArrayBuffer:()=>new ArrayBuffer(2)};
  const canvas={width:1,height:1,getContext:()=>({createImageData:()=>({data:new Uint8Array(4)}),putImageData(){}}),toDataURL:()=>'data:image/jpeg;base64,AA=='};
  const notices=[];
  const live=new LiveVision({},canvas,()=>'fast',(...args)=>notices.push(args),()=>{},()=>{});
  live.ready=true;live.connection={origin:'https://test.invalid',header:{}};
  const frame={width:1,height:1,data:new ArrayBuffer(4)};
  try{
    live.frame(frame);now+=180;
    request.success({statusCode:202,data:'',header:{}});
    assert.ok(live.next>=now+500);
    live.clearFrame();now=live.next;live.frame(frame);
    request.success({statusCode:429,data:'{}',header:{'Retry-After':'2'}});
    assert.ok(live.next>=now+2000);
    assert.equal(notices.at(-1)[1],true);
  }finally{live.stop();}
});

test('photo uploads preserve distant detail within both server limits',async()=>{
  const attempts=[];
  global.wx={getImageInfo:async()=>({width:3000,height:4000}),
    compressImage:async options=>{attempts.push(options);return {tempFilePath:'encoded'};},
    getFileSystemManager:()=>({readFile:options=>options.success({data:new ArrayBuffer(attempts.length===1?6*1024*1024+1:10)})})};
  assert.equal((await photoBytes('original')).byteLength,10);
  assert.deepEqual(attempts.map(item=>item.quality),[92,75]);
  for(const item of attempts){
    assert.equal(item.src,'original');
    assert.ok(item.compressedHeight>3000);
    assert.ok(item.compressedHeight*item.compressedWidth<=3840*2160);
  }
});

test('center-cropped preview clips boxes and hides out-of-frame tracks',()=>{
  assert.equal(overlay({x1:.25,y1:0,x2:.75,y2:1},200,100,100,100),'left:0px;top:0px;width:100px;height:100px');
  assert.equal(overlay({x1:0,y1:0,x2:.1,y2:1},200,100,100,100),'display:none');
});

test('freezing a frame never promotes a lost track or an unknown candidate',()=>{
  const track={id:1,appearance:'confirmed',state:'unknown',candidates:[{scoreType:'relative_similarity'}]};
  const result=frozenResult({id:'frame-1',tracks:[track,{...track,id:2,appearance:'lost',state:'candidate'}]});
  assert.equal(result.state,'unknown');assert.equal(result.subjects.length,1);assert.equal(result.candidates.length,0);
  assert.equal(result.subjects[0].candidates.length,1);
});

test('historical photo never borrows current time or location and accepts zero-valued coordinates',()=>{
  const unknown=historicalFields('','','','');assert.equal(unknown.capture_time_precision,'unknown');assert.equal(unknown.latitude,undefined);
  const date=historicalFields('2026-04-01','','0','0');assert.equal(date.capture_time_precision,'date');assert.equal(date.longitude,'0');
  assert.throws(()=>historicalFields('','','','12'));assert.throws(()=>historicalFields('','','unknown','12'));
  assert.deepEqual(jpegMetadata(Uint8Array.from([255,216,255,225,0,1]).buffer),{});
});
