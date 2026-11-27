const {test}=require('node:test');
const assert=require('node:assert/strict');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const tap=id=>({currentTarget:{dataset:{id}}});

function network({platform='devtools',local=false,origin,reply}={}){
  const calls=[];
  global.wx={getDeviceInfo:()=>({platform}),getStorageSync:()=>local,getExtConfigSync:()=>({visionOrigin:origin}),
    login:options=>options.success({code:'test-wechat-code'}),
    request:options=>{calls.push(options);if(reply)reply(options);else options.success({statusCode:200,data:{access_token:'test-session',expires_in:3600}});return{abort(){}};}};
  const path=require.resolve('../.test-build/services/vision-network.js');delete require.cache[path];
  return{service:require(path),calls};
}
function page(){
  let definition;global.Page=value=>definition=value;
  const path=require.resolve('../.test-build/pages/identify/index.js');delete require.cache[path];require(path);
  const p={data:structuredClone(definition.data),setData(value,done){Object.assign(this.data,value);done?.();}};
  for(const[key,value]of Object.entries(definition))if(key!=='data')p[key]=typeof value==='function'?value.bind(p):structuredClone(value);
  return p;
}

test('normal simulator and phone vision authenticate through the public service without a local tunnel',async()=>{
  for(const platform of ['devtools','android','ios']){
    const {service,calls}=network({platform});
    const connection=await service.connectVision();
    assert.equal(connection.origin,service.VISION_ORIGIN);
    assert.equal(calls.length,1);assert.equal(calls[0].url,service.VISION_ORIGIN+'/api/v1/vision/auth/wechat');
    assert.deepEqual(calls[0].data,{code:'test-wechat-code'});
  }
});

test('local SSH is an explicit simulator-only choice and cannot redirect the phone or an HTTPS override',async()=>{
  const local=network({local:true});assert.equal((await local.service.connectVision()).origin,'http://127.0.0.1:18000');
  assert.equal(local.calls[0].url,'http://127.0.0.1:18001/login');assert.equal(local.calls[0].header['X-Bird-DevTools'],'vision');
  const phone=network({platform:'android',local:true});assert.equal((await phone.service.connectVision()).origin,phone.service.VISION_ORIGIN);
  const override=network({local:true,origin:'https://alternate.invalid:8080'});assert.equal((await override.service.connectVision()).origin,'https://alternate.invalid:8080');
  const invalid=network({origin:'http://untrusted.invalid'});await assert.rejects(invalid.service.connectVision(),/HTTPS/);assert.equal(invalid.calls.length,0);
});

test('an empty gateway 502 stops before photo upload and preserves the imported photo and draft',async()=>{
  const {calls}=network({reply:options=>options.success({statusCode:502,data:'',header:{}})});
  global.wx.getFileSystemManager=()=>assert.fail('a failed connection must not read or upload the photo');
  const p=page(),asset=p.addEvidence('original.jpg','photo','album');p.data.notes='Keep this observation draft.';
  await p.analyse();
  assert.equal(calls.length,1);assert.equal(p.data.imagePath,'original.jpg');assert.equal(p.data.assets[0].id,asset.id);
  assert.equal(p.data.notes,'Keep this observation draft.');assert.match(p.data.error,/HTTP 502/);assert.equal(p.data.analysis,null);assert.equal(p.data.analyzing,false);
});

test('domain rejection and missing local bridge have distinct actionable errors',async()=>{
  const domain=network({reply:options=>options.fail({errMsg:'request:fail url not in domain list'})});
  await assert.rejects(domain.service.connectVision(),/服务器域名/);
  const local=network({local:true,reply:options=>options.fail({errMsg:'request:fail connection refused'})});
  await assert.rejects(local.service.connectVision(),/本机视觉联调/);
});

test('the photo fallback appears only after picker failure and disappears after a later successful multi-select',async()=>{
  let picker;global.wx={chooseMedia:options=>picker=options,getImageInfo:o=>o.success({width:640,height:480,type:'jpeg'})};const p=page();
  const existing=p.addEvidence('existing.jpg','photo','album');p.data.notes='Existing note.';
  assert.equal(p.data.photoFallback,false);p.chooseFiles();picker.fail({errMsg:'chooseMedia:fail cancel'});
  assert.equal(p.data.photoFallback,false);assert.equal(p.data.notes,'Existing note.');assert.equal(p.data.assets[0].id,existing.id);
  p.chooseFiles();picker.fail({errMsg:'chooseMedia:fail unavailable'});assert.equal(p.data.photoFallback,true);
  p.chooseFiles();picker.success({tempFiles:[{tempFilePath:'a.jpg',fileType:'image'},{tempFilePath:'b.jpg',fileType:'image'}]});await settle();
  assert.equal(p.data.photoFallback,false);assert.equal(p.data.assets.length,3);assert.ok(p.data.assets.every(a=>a.selected));
});

test('an unavailable media API exposes the fallback and late picker failures cannot alter an unloaded page',()=>{
  global.wx={};const p=page();p.chooseFiles();assert.equal(p.data.photoFallback,true);assert.equal(p.data.picking,false);
  let picker;global.wx.chooseMedia=options=>picker=options;const next=page();next.chooseFiles();next.onUnload();
  picker.fail({errMsg:'chooseMedia:fail unavailable'});assert.equal(next.data.photoFallback,false);assert.equal(next.data.error,'');
});

test('fallback photo cancellation preserves the selected material and its notes',async()=>{
  let picker;global.wx={chooseImage:options=>picker=options};const p=page();p.addEvidence('existing.jpg','photo','album');p.data.photoFallback=true;p.data.notes='Keep this note.';
  p.choose({currentTarget:{dataset:{source:'album'}}});picker.fail({errMsg:'chooseImage:fail cancel'});await settle();
  assert.equal(p.data.photoFallback,true);assert.equal(p.data.imagePath,'existing.jpg');assert.equal(p.data.notes,'Keep this note.');assert.equal(p.data.picking,false);
});

test('late visual measurements cannot stretch the current audio explanation or update an unloaded page',()=>{
  const measured=[];
  global.wx={nextTick:fn=>fn(),createSelectorQuery:()=>({in(){return this;},select(){return this;},boundingClientRect(fn){measured.push(fn);return this;},exec(){}})};
  const p=page();p.data.expanded=true;p.data.clueCollapsed=false;p.measureClues();
  p.focus(tap('audio'));measured[1]({height:52});measured[0]({height:200});assert.equal(p.data.clueHeight,52);
  p.measureClues();measured[2]({height:200});assert.equal(p.data.clueHeight,130);
  p.data.cameraShort=true;p.measureClues();measured[3]({height:200});assert.equal(p.data.clueHeight,80);
  p.onUnload();measured[4]({height:10});assert.equal(p.data.clueHeight,80);
});
