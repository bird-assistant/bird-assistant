const {test}=require('node:test');
const assert=require('node:assert/strict');
const audio=require('../.test-build/services/audio-network.js');
const {parseRecognitionResult}=require('../.test-build/services/recognition.js');
const fixtures=require('./fixtures/recognition.json');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function page(){let definition;global.Page=value=>definition=value;const file=require.resolve('../.test-build/pages/identify/index.js');delete require.cache[file];require(file);const p={data:structuredClone(definition.data),setData(value){Object.assign(this.data,value);}};for(const [key,value]of Object.entries(definition))if(key!=='data')p[key]=typeof value==='function'?value.bind(p):structuredClone(value);return p;}
test('an audio attempt keeps its own candidates and notes without changing an existing photo result',async t=>{
  global.wx={canIUse:()=>false};const p=page(),photo=p.addEvidence('photo.jpg','photo','album');photo.analysis={kind:'photo',analysisId:'photo-1'};p.data.notes='Photo note';
  const recording=p.addEvidence('bird.mp3','audio','album');p.data.notes='Audio note';let input;
  t.mock.method(audio,'startAudioRecognition',value=>{input=value;return{result:Promise.resolve(parseRecognitionResult(JSON.stringify({...fixtures.audio,client_reference:value.reference}),'audio',value.reference)),cancel(){}};});
  assert.equal(await p.analyse(),true);assert.equal(input.reference,recording.id);assert.equal(recording.analysis.kind,'audio');assert.equal(recording.analysis.photoContext,undefined);assert.equal(photo.analysis.analysisId,'photo-1');
  p.confirmAudioCandidate({currentTarget:{dataset:{rank:1}}});assert.equal(p.data.birdName,'欧亚大山雀');assert.equal(recording.notes,'Audio note');assert.equal(p.draftObservation(),null);assert.equal(photo.notes,'Photo note');
});
test('audio examples cannot be selected as a real identification, and cancelled late responses change no asset',async t=>{
  global.wx={canIUse:()=>false};const p=page(),recording=p.addEvidence('bird.mp3','audio','album');let finish,cancelled=0;
  t.mock.method(audio,'startAudioRecognition',()=>({result:new Promise(resolve=>finish=resolve),cancel(){cancelled++;}}));
  const work=p.analyse();await settle();p.cancelAnalysis();finish(parseRecognitionResult(JSON.stringify(fixtures.audio),'audio','wx-demo-1'));await work;assert.equal(cancelled,1);assert.equal(recording.analysis,undefined);assert.equal(p.data.analysis,null);
  p.data.analysis={...parseRecognitionResult(JSON.stringify(fixtures.audio),'audio'),example:true};p.confirmAudioCandidate({currentTarget:{dataset:{rank:1}}});assert.equal(p.data.birdName,'');
});
