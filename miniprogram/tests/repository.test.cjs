const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createRepository,RECORDS_KEY,PROFILE_KEY}=require('../.test-build/services/repository.js');

function setup(){const data=new Map();let reject=false;const port={read:key=>data.get(key),write(key,value){if(reject)throw new Error('quota exceeded');data.set(key,structuredClone(value));}};return {data,fail:()=>{reject=true;},allow:()=>{reject=false;},repo:createRepository(port,()=> '2026-10-30T10:00:00.000Z',()=> 'test-record')};}
const draft={birdName:'',notes:'A timid bird beside the reeds.',imagePath:'wxfile://saved/local.jpg',source:'album'};

test('private local saving preserves unknown observation context and a durable image reference',()=>{
  const {repo}=setup(),saved=repo.save(draft);
  assert.equal(saved.birdName,'待鉴定');assert.equal(saved.observedAt,null);assert.equal(saved.visibility,'private');assert.equal(saved.sync,'local-only');assert.equal(saved.imagePath,draft.imagePath);assert.equal(repo.list().length,1);
  saved.notes='changed outside';assert.equal(repo.list()[0].notes,draft.notes);
});
test('a failed write throws instead of reporting success or changing the previous records',()=>{
  const s=setup();s.repo.save(draft);const before=structuredClone(s.data.get(RECORDS_KEY));s.fail();
  assert.throws(()=>s.repo.save({...draft,notes:'new note'}),/quota/);assert.deepEqual(s.data.get(RECORDS_KEY),before);
});
test('unknown or corrupt stored data is retained rather than silently reset and overwritten',()=>{
  for(const value of [{version:99,records:[]},{version:1,records:[{id:'broken'}]},'invalid']){
    const s=setup();s.data.set(RECORDS_KEY,value);assert.throws(()=>s.repo.save(draft),/无法读取/);assert.deepEqual(s.data.get(RECORDS_KEY),value);
  }
});
test('profile writes are explicit, trim the name and retain the previous profile on failure',()=>{
  const s=setup();assert.equal(s.data.has(PROFILE_KEY),false);assert.equal(s.repo.profile().name,'观鸟者');assert.equal(s.data.has(PROFILE_KEY),false);
  s.repo.saveProfile({name:'  Baguette  ',avatar:'/assets/avatars/leaf.png'});s.fail();assert.throws(()=>s.repo.saveProfile({name:'new',avatar:'new.jpg'}),/quota/);assert.equal(s.repo.profile().name,'Baguette');
});
test('corrupt profile data is not overwritten by a seemingly successful edit',()=>{
  const s=setup();s.data.set(PROFILE_KEY,{version:2,profile:{name:'old'}});assert.throws(()=>s.repo.saveProfile({name:'new',avatar:'new'}),/无法读取/);assert.equal(s.data.get(PROFILE_KEY).version,2);
});
