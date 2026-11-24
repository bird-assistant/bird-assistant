const {test}=require('node:test');
const assert=require('node:assert/strict');
const ai=require('../.test-build/services/journal-ai.js');
function page(name){
  let definition;global.wx={getWindowInfo:()=>({windowWidth:390,windowHeight:844,statusBarHeight:24}),getMenuButtonBoundingClientRect:()=>({top:30,bottom:62,left:290}),getStorageSync:()=>'',nextTick:f=>f(),pageScrollTo:()=>{}};
  global.Page=d=>definition=d;const file=require.resolve('../.test-build/pages/'+name+'/index.js');delete require.cache[file];require(file);
  const p={data:structuredClone(definition.data),setData:v=>Object.assign(p.data,v),getTabBar:()=>({setData(){}})};
  for(const[k,v]of Object.entries(definition))if(k!=='data')p[k]=typeof v==='function'?v.bind(p):structuredClone(v);
  return p;
}
test('forum suggestions use explicit media selection, ignore late output and require apply before publishing',async()=>{
  const jobs=[];ai.installJournalAiTransport({generate:input=>{let done;const result=new Promise(r=>done=r);const job={input,done:()=>done({version:1,requestId:input.requestId,title:'Proposed title',body:'A polished user observation.',design:{style:'nature',variant:1}})};jobs.push(job);return {result,cancel(){}};}});
  try{
    const p=page('community');p.compose();p.setData({title:'Original title',body:'My own observation',image:'wxfile://private-photo'});p.openWriting();const pending=p.prepareWriting();assert.equal(jobs[0].input.images.length,0);
    p.change({currentTarget:{dataset:{key:'body'}},detail:{value:'A later user edit'}});jobs[0].done();await pending;assert.equal(p.data.writingSuggestion,null);assert.equal(p.data.body,'A later user edit');
    p.writingImage();const second=p.prepareWriting();assert.deepEqual(jobs[1].input.images.map(p=>p.path),['wxfile://private-photo']);jobs[1].done();await second;
    assert.equal(p.data.title,'Original title');assert.ok(p.data.writingSuggestion);p.applyWriting();assert.equal(p.data.title,'Proposed title');assert.equal(p.data.body,'A polished user observation.');assert.equal(p.data.image,'wxfile://private-photo');assert.equal(p.data.view,'compose');assert.equal(p.data.writingOpen,false);p.onUnload();
  }finally{ai.installJournalAiTransport(null);}
});
test('species navigation uses the selected target candidate ID and does not confirm or publish it',()=>{
  const p=page('identify'),routes=[],notices=[];global.wx.navigateTo=o=>routes.push(o.url);global.wx.showToast=o=>notices.push(o.title);
  p.data.currentId='photo-2';p.data.analysis={subjects:[{rank:1,candidates:[{rank:1,name:'First',speciesId:'taxon-first'}]},{rank:2,candidates:[{rank:3,name:'Second',speciesId:'avibase-second'}]}]};
  const before=structuredClone(p.data.analysis);p.candidateInfo({currentTarget:{dataset:{subject:2,rank:3}}});assert.equal(routes[0],'/field/hub/index?screen=species&id=avibase-second');assert.deepEqual(p.data.analysis,before);assert.equal(p.data.currentId,'photo-2');assert.equal(p.data.birdName,'');
  p.data.analysis.subjects[1].candidates[0].speciesId=null;p.candidateInfo({currentTarget:{dataset:{subject:2,rank:3}}});assert.equal(routes.length,1);assert.match(notices[0],/待补充/);
});
