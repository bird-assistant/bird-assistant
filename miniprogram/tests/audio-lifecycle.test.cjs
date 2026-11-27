const {test}=require('node:test');
const assert=require('node:assert/strict');
const {LocalAudioPlayback}=require('../.test-build/services/audio-playback.js');
function players(){const created=[];global.wx={createInnerAudioContext:()=>{const p={stops:0,destroys:0,onEnded:fn=>p.ended=fn,onError:fn=>p.error=fn,play(){},stop(){p.stops++;p.error?.();},destroy(){p.destroys++;}};created.push(p);return p;}};return created;}
test('repeated audio preview has one owner and interruption callbacks never report failure after stop',()=>{
  const created=players(),errors=[],playback=new LocalAudioPlayback(()=>errors.push('failed'));playback.play('one.mp3');playback.play('two.mp3');assert.equal(created[0].stops,1);assert.equal(created[0].destroys,1);assert.equal(errors.length,0);created[0].error();assert.equal(errors.length,0);playback.stop();created[1].error();assert.equal(errors.length,0);assert.equal(created[1].destroys,1);
});
test('an active playback error reports once and releases the player',()=>{
  const created=players(),errors=[],playback=new LocalAudioPlayback(()=>errors.push('failed'));playback.play('broken.mp3');created[0].error();created[0].error();assert.equal(errors.length,1);assert.equal(created[0].destroys,1);
});
function page(name){let definition;global.Page=value=>definition=value;const file=require.resolve('../.test-build/pages/'+name+'/index.js');delete require.cache[file];require(file);const patches=[],p={data:structuredClone(definition.data),setData(value){patches.push(value);Object.assign(this.data,value);}};for(const[key,value]of Object.entries(definition))if(key!=='data')p[key]=typeof value==='function'?value.bind(p):structuredClone(value);return{p,patches};}
test('identification stops pending microphone work on unload and ignores its late recording',()=>{
  const callbacks={},calls=[];global.wx={canIUse:()=>false,getRecorderManager:()=>({onStart:fn=>callbacks.start=fn,onStop:fn=>callbacks.stop=fn,onError:fn=>callbacks.error=fn,start:options=>calls.push(options),stop:()=>calls.push('stop')})};
  const {p,patches}=page('identify');p.recordAudio();assert.equal(calls[0].format,'mp3');assert.equal(calls[0].sampleRate,48000);p.onUnload();const before=patches.length;callbacks.start();callbacks.stop({tempFilePath:'late.mp3',duration:2000});assert.equal(p.data.assets.length,0);assert.equal(patches.length,before);assert.equal(calls.at(-1),'stop');
});
test('profile audio stops on back and page hiding without late error mutations',()=>{
  const created=players();global.wx.canIUse=()=>false;global.wx.nextTick=fn=>fn();global.wx.pageScrollTo=()=>{};const {p}=page('profile');p.data.detail={id:'record',imagePath:'kept.mp3'};p.playAudio();p.back();assert.equal(created[0].destroys,1);created[0].error();assert.equal(p.data.error,'');p.playAudio();p.onHide();assert.equal(created[1].destroys,1);
});
