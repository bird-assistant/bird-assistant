const {test}=require('node:test');
const assert=require('node:assert/strict');

test('setup preserves existing local identity, library choice and settings across code updates',async()=>{
  const {prepareConfig}=await import('../scripts/setup.mjs');
  const template={appid:'touristappid',libVersion:'3.17.1',setting:{es6:true}};
  const existing={appid:'wx0123456789abcdef',libVersion:'3.17.2',setting:{localChoice:true}};
  assert.deepEqual(prepareConfig(template,existing),existing);assert.equal(prepareConfig(template,null).appid,'touristappid');assert.deepEqual(existing.setting,{localChoice:true});
  const changed=prepareConfig(template,existing,'wxfedcba9876543210');assert.equal(changed.appid,'wxfedcba9876543210');assert.deepEqual(changed.setting,existing.setting);
  assert.throws(()=>prepareConfig(template,existing,'not-an-appid'));
});
