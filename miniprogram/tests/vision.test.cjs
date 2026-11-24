const {test}=require('node:test');
const assert=require('node:assert/strict');
const {overlay,frozenResult}=require('../.test-build/services/vision-live.js');
const {historicalFields,jpegMetadata}=require('../.test-build/services/photo-context.js');

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
