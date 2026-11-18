const {test}=require('node:test');
const assert=require('node:assert/strict');
const {observationContext,observationTimeLabel,beijingDate,beijingDateTime}=require('../.test-build/services/observation-context.js');
const {createRepository,observationStats,isSampleObservation,RECORDS_KEY}=require('../.test-build/services/repository.js');
const now='2026-10-30T00:10:00.000Z';
const blank={observedDate:'',observedTime:'',placeName:''};
const draft={birdName:'乌鸫',notes:'本人填写，尚未核验',imagePath:'wxfile://saved/bird.jpg',source:'album',mediaKind:'photo'};
const legacy={...draft,id:'legacy',birdName:'待鉴定',createdAt:now,observedAt:null,visibility:'private',sync:'local-only'};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const event=(key,value)=>({currentTarget:{dataset:{key}},detail:{value}});
const tap=id=>({currentTarget:{dataset:{id}}});
function makePage(name,port){
  let definition;global.wx=port;global.Page=value=>{definition=value;};
  const path=require.resolve('../.test-build/pages/'+name+'/index.js');delete require.cache[path];require(path);
  const p={data:structuredClone(definition.data),setData(value){Object.assign(this.data,value);}};
  for(const key of Object.keys(definition))if(key!=='data')p[key]=typeof definition[key]==='function'?definition[key].bind(p):structuredClone(definition[key]);
  return p;
}
function environment(){
  const data=new Map();let failure=false,copies=0;
  const port={canIUse:()=>false,getStorageSync:key=>data.get(key)||'',setStorageSync(key,value){if(failure)throw new Error('test storage rejection');data.set(key,structuredClone(value));},getStorageInfoSync:()=>({currentSize:1}),getFileSystemManager:()=>({saveFile:o=>{copies++;o.success({savedFilePath:'wxfile://saved/bird.jpg'});}}),showToast(){},nextTick:fn=>fn(),pageScrollTo(){}};
  return {data,port,fail:()=>{failure=true;},allow:()=>{failure=false;},copies:()=>copies};
}

test('observation date precision stays unknown, date-only or manual Beijing minute without borrowing save time',()=>{
  const unknown=observationContext(blank,now);assert.equal(unknown.observedAt,null);assert.equal(unknown.observedDate,null);assert.equal(unknown.timeSource,'unknown');assert.equal(unknown.placeSource,'unknown');
  const date=observationContext({...blank,observedDate:'2026-10-29'},now);
  assert.equal(date.observedAt,null);assert.equal(date.observedDate,'2026-10-29');assert.equal(date.timePrecision,'date');assert.equal(date.timeSource,'manual');assert.match(observationTimeLabel(date),/时刻未知/);
  const minute=observationContext({observedDate:'2026-10-29',observedTime:'07:15',placeName:'  校园荷塘  '},now);
  assert.equal(minute.observedAt,'2026-10-29T07:15:00+08:00');assert.equal(minute.placeName,'校园荷塘');assert.equal(minute.placeSource,'manual');assert.match(observationTimeLabel(minute),/07:15（北京时间）/);
  assert.equal(beijingDate('2026-10-29T16:01:00Z'),'2026-10-30');assert.match(beijingDateTime('2026-10-29T16:01:00Z'),/2026-10-30 00:01/);
});

test('invalid calendars, future observation times, missing dates and overlong places fail before a storage write',()=>{
  let writes=0;const repo=createRepository({read:()=>'',write(){writes++;}},()=>now);
  for(const input of [
    {...blank,observedDate:'2026-02-29'}, {...blank,observedDate:'2026-04-31'},
    {...blank,observedDate:'2026-10-31'}, {...blank,observedDate:'2026-10-30',observedTime:'08:11'},
    {...blank,observedTime:'07:00'}, {...blank,observedDate:'2026-10-29',observedTime:'24:00'},
    {...blank,placeName:'字'.repeat(81)}
  ])assert.throws(()=>repo.save({...draft,...input}));
  assert.equal(writes,0);
  assert.equal(observationContext({...blank,observedDate:'2024-02-29'},now).observedDate,'2024-02-29');
  assert.equal(observationContext({...blank,observedDate:'2026-10-30',observedTime:'08:10'},now).timePrecision,'minute');
});

test('legacy records read without migration and later saves retain them; inconsistent stored context is never overwritten',()=>{
  const data=new Map([[RECORDS_KEY,{version:1,records:[{...legacy,unknownOldField:'retain'}]}]]);let writes=0;
  const repo=createRepository({read:key=>data.get(key),write(key,value){writes++;data.set(key,structuredClone(value));}},()=>now,()=> 'new-context');
  const before=structuredClone(data.get(RECORDS_KEY));assert.equal(repo.list().length,1);assert.equal(writes,0);assert.deepEqual(data.get(RECORDS_KEY),before);
  const saved=repo.save({...draft,observedDate:'2026-10-29',observedTime:'18:20',placeName:'公园步道'});
  assert.equal(saved.createdAt,now);assert.equal(saved.observedAt,'2026-10-29T18:20:00+08:00');assert.equal(repo.list()[1].unknownOldField,'retain');
  const withContext=structuredClone(data.get(RECORDS_KEY));withContext.records[0].timeSource='unknown';data.set(RECORDS_KEY,withContext);const preserved=structuredClone(withContext);
  assert.throws(()=>repo.save(draft),/无法读取/);assert.deepEqual(data.get(RECORDS_KEY),preserved);assert.equal(writes,1);
});

test('examples and stale/duplicate bookmarks do not inflate actual observation, name or favorite totals',()=>{
  const records=[{...legacy,id:'unknown'}, {...legacy,id:'a',birdName:'乌鸫'}, {...legacy,id:'b',birdName:' 乌鸫 '},
    {...legacy,id:'example',birdName:'示例鸟',sample:true}, {...legacy,id:'old-example',birdName:'旧示例',imagePath:'/assets/samples/field-0.png'}];
  assert.deepEqual(observationStats(records,['a','a','example','old-example','no-such-record']),{observationCount:3,speciesCount:1,favoriteCount:1});
  assert.equal(isSampleObservation(records[4]),true);assert.equal(records.length,5);
});

test('review context follows each material, explicit clearing restores uncertainty, and storage retry retains durable context',async(t)=>{
  t.mock.method(console,'warn',()=>{});const env=environment(),p=makePage('identify',env.port);
  const first=p.addEvidence('wxfile://temp/photo.jpg','photo','album');p.toggleContext();assert.equal(p.data.observedDate,'');
  p.changeContext(event('observedDate','2026-10-29'));p.changeContext(event('observedTime','07:15'));p.changeContext(event('placeName','校园荷塘'));
  const second=p.addEvidence('wxfile://song.mp3','audio','album');assert.equal(p.data.placeName,'');assert.equal(p.data.observedDate,'');
  p.changeContext(event('placeName','另一处树下'));p.selectEvidence(tap(first.id));assert.equal(p.data.observedTime,'07:15');assert.equal(p.data.placeName,'校园荷塘');
  p.clearObservedTime();assert.equal(p.data.observedDate,'2026-10-29');p.changeContext(event('observedTime','06:10'));
  p.changeContext(event('observedDate','2026-10-28'));assert.equal(p.data.observedTime,'');
  env.fail();p.save();await flush();assert.equal(p.data.persisted,true);assert.equal(p.data.observedDate,'2026-10-28');assert.equal(p.data.placeName,'校园荷塘');assert.equal(env.copies(),1);
  env.allow();p.save();await flush();assert.equal(env.copies(),1);const saved=env.data.get(RECORDS_KEY).records[0];assert.equal(saved.timePrecision,'date');assert.equal(saved.observedAt,null);assert.equal(saved.placeName,'校园荷塘');
  p.selectEvidence(tap(second.id));assert.equal(p.data.placeName,'另一处树下');p.clearObservedDate();assert.equal(p.data.observedTime,'');assert.equal(p.data.observedDate,'');
});

test('invalid review context blocks file persistence and retains the original material and input',()=>{
  const env=environment(),p=makePage('identify',env.port);p.addEvidence('wxfile://temp/photo.jpg','photo','album');
  p.setData({observedDate:'9999-12-31',placeName:'保留地点'});p.save();assert.equal(env.copies(),0);assert.equal(p.data.busy,false);assert.equal(p.data.contextOpen,true);assert.equal(p.data.placeName,'保留地点');assert.equal(p.data.assets.length,1);assert.match(p.data.error,/不能晚于/);
});

test('saved observation context survives fresh page instances and drives profile details, counts and journal date filters',async()=>{
  const env=environment(),p=makePage('identify',env.port);p.addEvidence('wxfile://temp/photo.jpg','photo','album');
  p.changeName({detail:{value:'乌鸫'}});p.changeContext(event('observedDate','2026-10-29'));p.changeContext(event('observedTime','07:15'));p.changeContext(event('placeName','校园荷塘'));p.save();await flush();
  const stored=env.data.get(RECORDS_KEY).records[0];env.data.get(RECORDS_KEY).records.push({...legacy,id:'example',sample:true,birdName:'示例鸟'});
  const profile=makePage('profile',env.port);profile.onShow();assert.equal(profile.data.observationCount,1);assert.equal(profile.data.speciesCount,1);assert.equal(profile.data.records.length,2);
  profile.openRecord(tap(stored.id));assert.match(profile.data.detail.timeLabel,/2026-10-29 07:15/);assert.equal(profile.data.detail.placeLabel,'校园荷塘');assert.notEqual(profile.data.detail.savedLabel,profile.data.detail.timeLabel);
  profile.favorite();assert.equal(profile.data.favoriteCount,1);profile.openRecord(tap('example'));profile.favorite();assert.equal(profile.data.favoriteCount,1);
  profile.menu(tap('history'));assert.equal(profile.data.shownRecords.length,2);
  env.data.get(RECORDS_KEY).records.push({...legacy,id:'later'});profile.onShow();assert.equal(profile.data.shownRecords.length,3);
  const journal=makePage('journal',env.port);journal.newJournal();
  assert.equal(journal.data.assets.find(a=>a.id===stored.id).date,'2026-10-29');
  journal.date(event('from','2026-10-30'));journal.unknown();assert.equal(journal.data.assets.length,0);
  journal.date(event('from','2026-10-29'));assert.equal(journal.data.assets.length,1);assert.equal(journal.data.assets[0].id,stored.id);
  assert.equal(journal.data.assets[0].date,'2026-10-29');
});
