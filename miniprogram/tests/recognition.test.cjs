const {test}=require('node:test');
const assert=require('node:assert/strict');
const {parseRecognitionResult,recognitionFailure,startRecognition}=require('../.test-build/services/recognition.js');
const fixtures=require('./fixtures/recognition.json');
const copy=value=>structuredClone(value);
const response=value=>({statusCode:200,data:JSON.stringify(value)});
const input={kind:'audio',filePath:'wxfile://local/bird.mp3',reference:'wx-demo-1'};

test('pinned recognition fixtures preserve score semantics, mock labels and separate photo subjects',()=>{
  const audio=parseRecognitionResult(JSON.stringify(fixtures.audio),'audio','wx-demo-1');
  assert.equal(audio.candidates[0].name,'欧亚大山雀');assert.equal(audio.candidates[0].scoreType,'birdnet_confidence');
  assert.equal(audio.candidates[0].score,0.974545);assert.equal(audio.candidates[0].scoreText,'0.97');assert.equal(audio.example,false);
  const value=copy(fixtures.photo);value.subjects.push({...copy(value.subjects[0]),rank:2,state:'unknown',reason:'below_threshold'});
  const photo=parseRecognitionResult(JSON.stringify(value),'photo');
  assert.equal(photo.example,true);assert.equal(photo.subjects.length,2);assert.equal(photo.subjects[1].state,'unknown');
  assert.equal(photo.candidates.length,1);assert.equal(photo.subjects[0].candidates[0].scoreType,'mock');
  value.candidates[0].score_type='relative_similarity';value.subjects.forEach(s=>s.candidates[0].score_type='relative_similarity');
  value.model.backend='open-clip';value.policy.score_type='relative_similarity';
  assert.equal(parseRecognitionResult(JSON.stringify(value),'photo').example,false);
});

test('unknown recognition is a valid result and unmapped audio names do not fabricate species identifiers',()=>{
  const value=copy(fixtures.audio);value.state='unknown';value.candidates=[];value.policy.reason='below_threshold';
  const unknown=parseRecognitionResult(JSON.stringify(value),'audio');assert.equal(unknown.state,'unknown');assert.deepEqual(unknown.candidates,[]);
  value.state='candidate';value.candidates=copy(fixtures.audio.candidates);value.candidates[0].species_id=null;value.candidates[0].mapped=false;
  const c=parseRecognitionResult(JSON.stringify(value),'audio').candidates[0];assert.equal(c.speciesId,null);assert.equal(c.mapped,false);
});

test('Dongniao photo confidence retains its source and unmapped names have no catalog ID',()=>{
  const raw=copy(fixtures.photo);
  raw.model.backend='dongniao';raw.policy.score_type='dongniao_confidence';
  for(const candidate of [...raw.candidates,...raw.subjects[0].candidates]){
    Object.assign(candidate,{score_type:'dongniao_confidence',score:0.8667,species_id:null,mapped:false});
  }
  const result=parseRecognitionResult(JSON.stringify(raw),'photo');
  assert.equal(result.example,false);assert.equal(result.candidates[0].mapped,false);
  assert.equal(result.subjects[0].candidates[0].scoreText,'懂鸟 86.7%');
});

test('wrong references, malformed scores, score types, duplicate targets and invalid boxes are rejected',()=>{
  const reject=(value,kind='audio',reference)=>assert.throws(()=>parseRecognitionResult(JSON.stringify(value),kind,reference),e=>e.code==='INVALID_RESPONSE');
  reject(fixtures.audio,'audio','other-material');
  for(const score of [null,'0.9',-0.1,1.1]){const x=copy(fixtures.audio);x.candidates[0].score=score;reject(x);}
  const type=copy(fixtures.audio);type.candidates[0].score_type='relative_similarity';reject(type);
  const box=copy(fixtures.photo);box.subjects[0].bbox.x1=0.99;reject(box,'photo');
  const duplicate=copy(fixtures.photo);duplicate.subjects.push(copy(duplicate.subjects[0]));reject(duplicate,'photo');
  assert.throws(()=>parseRecognitionResult('<html>gateway down</html>','photo'));
  assert.throws(()=>parseRecognitionResult('x'.repeat(1024*1024+1),'audio'));
});

test('explicit uploads use exact multipart contracts; cancellation settles once and discards late responses',async()=>{
  const pending=[];let aborted=0;
  const transport={upload(request,success,fail){pending.push({request,success,fail});return{abort(){aborted++;}};}};
  const job=startRecognition(transport,input);const cancelled=assert.rejects(job.result,e=>e.code==='CANCELLED');
  assert.deepEqual(pending[0].request,{path:'/api/v1/audio/analyses',name:'audio',filePath:input.filePath,formData:{client_reference:'wx-demo-1'}});
  job.cancel();job.cancel();pending[0].success(response(fixtures.audio));pending[0].fail();await cancelled;assert.equal(aborted,1);
  const photo=startRecognition(transport,{kind:'photo',filePath:'wxfile://local/bird.jpg',reference:'photo-1'});
  assert.equal(pending[1].request.name,'image');assert.deepEqual(pending[1].request.formData,{});
  assert.equal(pending[1].request.path,'/api/v1/vision/analyses');pending[1].success(response(fixtures.photo));assert.equal((await photo.result).example,true);
  photo.cancel();assert.equal(aborted,1);
});

test('recognition failures retain safe codes/retry hints without surfacing server debug messages or retrying',async()=>{
  const error=recognitionFailure({statusCode:429,data:JSON.stringify({error:{code:'AUDIO_CAPACITY_EXCEEDED',request_id:'req-123',message:'private debug text',details:{trace:'not for display'}}}),header:{'Retry-After':'3'}});
  assert.equal(error.code,'AUDIO_CAPACITY_EXCEEDED');assert.equal(error.requestId,'req-123');assert.equal(error.retryAfterSeconds,3);
  assert.equal(error.message.includes('private debug text'),false);
  assert.equal(recognitionFailure({statusCode:502,data:'<html>error</html>'}).code,'HTTP_ERROR');
  let calls=0;
  const transport={upload(_r,_ok,fail){calls++;fail();return{abort(){}};}};
  await assert.rejects(startRecognition(transport,input).result,e=>e.code==='UPLOAD_FAILED');assert.equal(calls,1);
  const malformed={upload(_r,ok){ok({statusCode:200,data:'{}'});return{abort(){}};}};
  await assert.rejects(startRecognition(malformed,input).result,e=>e.code==='INVALID_RESPONSE');
  await assert.rejects(startRecognition(transport,{...input,sample:true}).result,e=>e.code==='EXAMPLE_MEDIA');
  await assert.rejects(startRecognition(transport,{...input,kind:'video'}).result,e=>e.code==='UNSUPPORTED_KIND');assert.equal(calls,1);
});
