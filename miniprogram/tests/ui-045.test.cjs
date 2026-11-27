const {test}=require('node:test');
const assert=require('node:assert/strict');
const {MapTargets}=require('../.test-build/services/map-targets.js');
const {chinesePlace}=require('../.test-build/services/place-names.js');
const {profileInitials}=require('../.test-build/services/profile-initials.js');
const {adviceParagraphs,adviceSections}=require('../.test-build/services/trip-advice.js');
const cell=n=>({latitude:39.9,longitude:116.4+n*.001,count:n+1,minLatitude:39.9,maxLatitude:39.9,minLongitude:116.4+n*.001,maxLongitude:116.4+n*.001});

test('cold marker IDs survive repeated zoom renders and delayed native string callbacks with their original filters',()=>{
  const targets=new MapTargets(),query={scope:'all',speciesId:'tit',minLongitude:116};
  const first=targets.assign([cell(0)],query,4)[0];
  assert.equal(targets.assign([cell(0)],{...query,minLongitude:115},5)[0],first);
  for(let i=1;i<100;i++)targets.assign([cell(i)],{scope:'mine',speciesId:'sparrow'},i%16+4);
  query.speciesId='changed';
  assert.equal(targets.get(String(first)).query.speciesId,'tit');
  assert.equal(targets.get(first).zoom,5);
  assert.equal(targets.get('not-a-marker'),undefined);
  for(let i=100;i<800;i++)targets.assign([cell(i)],{scope:'all'},10);
  assert.equal(targets.get(first),undefined,'stale callbacks are bounded');
});
test('Chinese source region names are translated without guessing unfamiliar localities',()=>{
  assert.equal(chinesePlace('Beijing'),'北京');assert.equal(chinesePlace('Sichuan Province'),'四川');
  assert.equal(chinesePlace('Zhejiang / Shanghai'),'浙江 / 上海');assert.equal(chinesePlace('Hubei'),'湖北');
  assert.equal(chinesePlace('Unknown Wetland'),'Unknown Wetland');assert.equal(chinesePlace('北京 · 圆明园'),'北京 · 圆明园');
});
test('name avatars use one English initial or up to two leading Chinese characters',()=>{
  for(const [name,want] of [['Baguette','B'],['alice Chen','A'],['  王小明 ','王小'],['王','王'],['李 A','李'],['','鸟']])assert.equal(profileInitials(name),want);
});
test('old dense trip responses are divided at sentence boundaries without dropping or inventing text',()=>{
  const text='先去湖边观察。'.repeat(30)+'\n注意岸边安全。',paragraphs=adviceParagraphs(text);
  assert.ok(paragraphs.length>2);assert.equal(paragraphs.join(''),text.replace(/\n/g,''));
  assert.equal(adviceSections({headline:'先去公园',reasons:['较近'],watchFor:[],preparation:[],uncertainty:['暂无预报']}).length,2);
});
test('a photo flips both ways, shows missing metadata feedback and resets when its source changes',()=>{
  let definition;global.Component=d=>definition=d;
  require('../.test-build/components/photo-card/index.js');
  const messages=[];global.wx={showToast:o=>messages.push(o.title)};
  const card={data:{flipped:false,fileInfo:null,manualInfo:null},setData(v){Object.assign(this.data,v);}};
  definition.methods.flip.call(card);assert.equal(card.data.flipped,false);assert.match(messages[0],/暂无/);
  card.data.fileInfo={title:'Sony',settings:[]};definition.methods.flip.call(card);assert.equal(card.data.flipped,true);
  definition.methods.flip.call(card);assert.equal(card.data.flipped,false);
  card.data.flipped=true;definition.observers.src.call(card);assert.equal(card.data.flipped,false);
});
test('import dispatch keeps photo and audio attempts separate, independent of the last previewed asset',async()=>{
  let definition;global.Page=d=>definition=d;global.wx={canIUse:()=>false,pageScrollTo:()=>{}};
  require('../.test-build/pages/identify/index.js');
  const page={data:structuredClone(definition.data),setData(v){Object.assign(this.data,v);}};
  for(const [key,value] of Object.entries(definition))if(key!=='data')page[key]=typeof value==='function'?value.bind(page):structuredClone(value);
  page.data.view='review';const photo=page.addEvidence('photo.jpg','photo','album'),audio=page.addEvidence('audio.mp3','audio','album');
  assert.equal(page.data.currentId,audio.id);assert.equal(photo.selected,true);
  const sent=[];page.analyse=async()=>{sent.push(page.data.currentId);return true;};page.review=()=>page.setData({view:'review'});
  page.data.importMode='both';await page.analyseSelected();assert.deepEqual(sent,[photo.id,audio.id]);assert.equal(page.data.assets.length,2);assert.equal(page.data.view,'review');
  sent.length=0;page.data.importMode='media';page.setData({error:''});await page.analyseSelected();assert.deepEqual(sent,[photo.id]);assert.equal(page.data.view,'review');assert.match(page.data.batchProgress,/已完成 1/);
});
