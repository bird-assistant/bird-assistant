const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {setTimeout: delay} = require('node:timers/promises');

async function main() {
  const path = process.argv[2];
  if (!path) throw Error('请传入一张测试用的 JPEG 鸟类照片');
  const jpeg = fs.readFileSync(path);
  const compiledPage=process.argv[3];
  let render;
  if(compiledPage){
    const runtime={window:{},console};
    vm.runInNewContext(fs.readFileSync(compiledPage,'utf8'),runtime);
    render=runtime.$gwx('pages/identify/index.wxml');
  }
  function bytes(buffer) {return Uint8Array.from(buffer).buffer;}
  global.wx = {
    getDeviceInfo: () => ({platform:'devtools'}), getSetting: async () => ({authSetting:{}}),
    getImageInfo: async () => ({width:1000,height:750}), compressImage: async () => ({tempFilePath:path}),
    getFileSystemManager: () => ({readFile:options => options.success({data:bytes(jpeg)})}),
    base64ToArrayBuffer: value => bytes(Buffer.from(value,'base64')),
    request(options) {
      const controller = new AbortController();
      const form = options.data instanceof ArrayBuffer;
      fetch(options.url,{method:options.method,headers:{'Content-Type':'application/json',...options.header},
        body:form?options.data:JSON.stringify(options.data),signal:controller.signal}).then(async res => {
        const text = await res.text();
        options.success({statusCode:res.status,data:options.dataType==='text'||!text?text:JSON.parse(text),header:Object.fromEntries(res.headers)});
      }).catch(options.fail);
      return {abort:()=>controller.abort()};
    },
    connectSocket(options) {
      const socket = new WebSocket(options.url,{headers:options.header});
      return {onClose:fn=>socket.addEventListener('close',fn),onMessage:fn=>socket.addEventListener('message',fn),
        onError:fn=>socket.addEventListener('error',fn),close:()=>socket.close()};
    }
  };
  global.Page = definition => {global.identify=definition;};
  require('../.test-build/pages/identify/index.js');
  const page=global.identify;
  page.setData=value=>Object.assign(page.data,value);
  page.addEvidence(path,'photo','album');
  await page.analyse();
  assert.ok(page.data.analysis,page.data.error);
  assert.equal(page.data.analysis.example,false);
  assert.equal(page.data.birdName,'');
  page.setData({view:'review'});
  const candidate=page.data.analysis.subjects[0]?.candidates[0];
  if(candidate){
    if(render)assert.ok(JSON.stringify(render(page.data)).includes(candidate.name));
    page.confirmCandidate({currentTarget:{dataset:{subject:page.data.analysis.subjects[0].rank,rank:candidate.rank}}});
    assert.equal(page.data.birdName,candidate.name);
  }
  console.log('照片',page.data.analysis.model.name,page.data.analysis.state,page.data.analysis.subjects.map(value=>value.candidates[0]?.name));
  let sample;
  page._camera={onCameraFrame:callback=>({start:()=>{sample=callback;},stop:()=>{sample=null;}})};
  const pixels=new Uint8ClampedArray(4);
  const canvas={getContext:()=>({createImageData:()=>({data:pixels}),putImageData(){}}),toDataURL:()=> 'data:image/jpeg;base64,'+jpeg.toString('base64')};
  wx.createSelectorQuery=()=>({in(){return this;},select(){return this;},node(){},boundingClientRect(){},exec:fn=>fn([{node:canvas},{width:360,height:640}])});
  page.setData({view:'live',cameraReady:true,expanded:true});
  page.toggleVision();
  try {
    const deadline=Date.now()+35000;
    while(Date.now()<deadline && page.data.liveActive){
      sample?.({width:1,height:1,data:pixels.buffer});
      if(page.data.liveTracks.some(track=>track.appearance==='confirmed'))break;
      await delay(250);
    }
    const track=page.data.liveTracks.find(track=>track.appearance==='confirmed');
    assert.ok(track,page.data.liveText);
    assert.match(track.style,/width:/);
    if(render)assert.ok(JSON.stringify(render(page.data)).includes(track.label));
    console.log('实时',track.label,track.scope,track.candidates[0]?.scoreText);
  } finally {page.stopVision();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
