const {test}=require('node:test');
const assert=require('node:assert/strict');
const metadata=require('../.test-build/services/photo-metadata.js');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function page(){let definition;global.Page=value=>definition=value;const path=require.resolve('../.test-build/pages/identify/index.js');delete require.cache[path];require(path);const p={data:structuredClone(definition.data),setData(value){Object.assign(this.data,value);}};for(const [key,value]of Object.entries(definition))if(key!=='data')p[key]=typeof value==='function'?value.bind(p):structuredClone(value);return p;}
const meta={state:'ready',format:'jpeg',hasExif:true,camera:{make:'Nikon',iso:'800'}};
test('photo metadata does not alter recognition identity, selection, observation time or location',async t=>{
  global.wx={canIUse:()=>false};const pending=[];t.mock.method(metadata,'readLocalPhotoMetadata',()=>new Promise(resolve=>pending.push(resolve)));
  const p=page(),a=p.addEvidence('a.jpg','photo','album'),b=p.addEvidence('b.jpg','photo','album');a.selected=false;a.status='A result already exists';
  pending[0](meta);await settle();assert.equal(p.data.assets[0],a);assert.equal(a.status,'A result already exists');assert.equal(a.selected,false);assert.equal(p.data.fileMetadata,null);
  assert.equal(p.data.observedDate,'');assert.equal(p.data.observedTime,'');assert.equal(p.data.latitude,'');assert.equal(p.data.longitude,'');p.activateEvidence(a.id);assert.deepEqual(p.data.fileMetadata,meta);
  p.onUnload();pending[1](meta);await settle();assert.equal(b.fileMetadata,undefined);
});
test('readonly camera parameters never emit edits and local file values remain separate from author entries',()=>{
  let definition;global.Component=value=>definition=value;const path=require.resolve('../.test-build/components/photo-editor/index.js');delete require.cache[path];require(path);
  const events=[],p={data:{...structuredClone(definition.data),value:{iso:'1600'},readonly:true,disabled:false},setData(value){Object.assign(this.data,value);},triggerEvent:(...args)=>events.push(args)};
  definition.observers.fileInfo.call(p,meta);assert.equal(p.data.value.iso,'1600');assert.equal(p.data.embedded.settings.find(item=>item.key==='iso').value,'800');
  definition.methods.change.call(p,{currentTarget:{dataset:{key:'iso'}},detail:{value:'3200'}});assert.equal(events.length,0);
  p.data.readonly=false;definition.methods.change.call(p,{currentTarget:{dataset:{key:'iso'}},detail:{value:'3200'}});assert.equal(events[0][1].iso,'3200');
});
