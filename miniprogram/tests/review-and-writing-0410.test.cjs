const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const writing=require('../.test-build/services/writing-network.js');
const {journalGatewayTransport}=require('../.test-build/services/journal-gateway.js');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function page(){let definition;global.Page=d=>definition=d;const file=require.resolve('../.test-build/pages/identify/index.js');delete require.cache[file];require(file);const p={data:structuredClone(definition.data),setData(v,done){Object.assign(this.data,v);done?.();}};for(const[key,v]of Object.entries(definition))if(key!=='data')p[key]=typeof v==='function'?v.bind(p):structuredClone(v);return p;}
function environment(){global.wx={canIUse:()=>false,nextTick:fn=>fn(),pageScrollTo(){},getImageInfo:o=>o.success({width:100,height:80}),getStorageSync:()=>false,getDeviceInfo:()=>({platform:'devtools'})};}
const input={requestId:'test-writing',prompt:'整理这次观察',purpose:'手帐',maxChars:100,images:[]};

test('collecting files cannot dispatch recognition; continue opens the same review assets and keeps existing results',async()=>{
  environment();const p=page();p.import();const captured=p.addEvidence('captured.jpg','photo','camera');captured.analysis={analysisId:'original-live',subjects:[]};p.data.analysis=captured.analysis;p.data.notes='Already observed';
  let picker,calls=0;global.wx.chooseMedia=o=>picker=o;p.chooseFiles();picker.success({tempFiles:[{tempFilePath:'external.jpg',fileType:'image'}]});await settle();
  p.analyse=async()=>{calls++;return true;};await p.analyseSelected();assert.equal(calls,0);assert.equal(p.data.view,'import');assert.equal(captured.notes,'Already observed');
  const imported=p.data.assets[1];p.continueReview();assert.equal(p.data.view,'review');assert.equal(p.data.currentId,imported.id);assert.equal(p.data.assets[0],captured);assert.equal(captured.analysis.analysisId,'original-live');assert.equal(imported.analysis,undefined);
  p.selectEvidence({currentTarget:{dataset:{id:captured.id}}});assert.equal(p.data.notes,'Already observed');assert.equal(p.data.analysis.analysisId,'original-live');assert.equal(imported.selected,true);
});

test('fallback photo selection remains in collection until the explicit continue action',async()=>{
  environment();const p=page();p.import();let picker;global.wx.chooseImage=o=>picker=o;p.choose({currentTarget:{dataset:{source:'album'}}});picker.success({tempFilePaths:['fallback.jpg']});await settle();assert.equal(p.data.view,'import');assert.equal(p.data.assets.length,1);p.continueReview();assert.equal(p.data.view,'review');
});

test('shared review analyzes only selected new files, preserving a captured result and confirmed notes',async()=>{
  environment();const p=page(),captured=p.addEvidence('captured.jpg','photo','camera');captured.analysis={analysisId:'keep-result'};p.data.analysis=captured.analysis;p.data.notes='My original note';const external=p.addEvidence('external.jpg','photo','album');p.continueReview();const sent=[];p.analyse=async()=>{sent.push(p.data.currentId);return true;};await p.analyseSelected();assert.deepEqual(sent,[external.id]);assert.equal(captured.analysis.analysisId,'keep-result');assert.equal(captured.notes,'My original note');assert.equal(p.data.view,'review');
});

test('the import template has no second identification form; review owns scope and dispatch',()=>{
  const markup=fs.readFileSync('miniprogram/pages/identify/index.wxml','utf8');const start=markup.indexOf('<view wx:elif="{{view === \'import\'}}"'),end=markup.indexOf('<view wx:else class="page review-page',start);const collect=markup.slice(start,end),review=markup.slice(end);
  assert.match(collect,/bindtap="continueReview"/);assert.doesNotMatch(collect,/bindtap="analyse|bindtap="importMode"|bindtap="sendImported"/);assert.match(review,/bindtap="analyseSelected"/);assert.match(review,/catchtap="toggleImportEvidence"/);assert.match(review,/bindtap="selectEvidence"/);
});

test('local writing requires a strict DevTools-only opt-in and never changes phone transport',()=>{
  for(const platform of ['android','ios']){global.wx={getDeviceInfo:()=>({platform}),getStorageSync:()=>true};assert.doesNotThrow(()=>writing.teamWritingTransport({}));assert.throws(()=>journalGatewayTransport({endpoint:'http://127.0.0.1:18200/api/v1/journal/suggestions',localDev:true,session:async()=>'',prepare:async()=>[]}),/HTTPS/);}
  global.wx={getDeviceInfo:()=>({platform:'devtools'}),getStorageSync:()=>false};assert.doesNotThrow(()=>writing.teamWritingTransport({}));
});

test('an unavailable explicit local writing gateway fails locally without a public or provider fallback',async()=>{
  const urls=[];global.wx={getDeviceInfo:()=>({platform:'devtools'}),getStorageSync:()=>true,request:o=>{urls.push(o.url);o.fail({errMsg:'refused'});return{abort(){}};}};
  await assert.rejects(writing.teamWritingTransport({}).generate(input).result,/本机写作联调未连接/);assert.deepEqual(urls,['http://127.0.0.1:18200/dev/writing/session']);
});

test('local writing uses the production payload and a short session, with no WeChat secret or model key in client requests',async()=>{
  const calls=[];global.wx={getDeviceInfo:()=>({platform:'devtools'}),getStorageSync:()=>true,request:o=>{calls.push(o);if(o.url.endsWith('/session'))o.success({statusCode:200,data:{access_token:'local-short-session',expires_in:3600}});else o.success({statusCode:200,data:{requestId:input.requestId}});return{abort(){}};}};
  await writing.teamWritingTransport({}).generate(input).result;assert.equal(calls.length,2);assert.equal(calls[1].url,'http://127.0.0.1:18200/api/v1/journal/suggestions');assert.equal(calls[1].header.Authorization,'Bearer local-short-session');assert.deepEqual(calls[1].data,{version:1,...input});assert.doesNotMatch(JSON.stringify(calls),/aliyuncs|api_key|appsecret/i);
});
