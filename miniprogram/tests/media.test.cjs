const {test}=require('node:test');
const assert=require('node:assert/strict');
const {choosePhoto,persistImage}=require('../.test-build/services/media.js');

test('cancelled native selection is not reported as an upload or permission failure',async()=>{
  global.wx={chooseImage:options=>options.fail({errMsg:'chooseImage:fail cancel'})};assert.equal(await choosePhoto(['album']),null);
});
test('actual picker diagnostics survive without being relabelled as permission denial',async()=>{
  global.wx={chooseImage:options=>options.fail({errMsg:'chooseImage:fail native picker unavailable',errno:1200})};
  await assert.rejects(choosePhoto(['album']),error=>error.detail.errno===1200&&error.detail.errMsg.includes('native picker')&&!error.message.includes('权限'));
});
test('durable media paths are accepted only after filesystem acknowledgement; failures retain an error',async()=>{
  let options;global.wx={getFileSystemManager:()=>({saveFile:value=>{options=value;}})};
  let finished=false;const pending=persistImage('wxfile://temp.jpg').then(path=>{finished=true;return path;});await Promise.resolve();assert.equal(finished,false);options.success({savedFilePath:'wxfile://saved/permanent.jpg'});assert.equal(await pending,'wxfile://saved/permanent.jpg');
  global.wx={getFileSystemManager:()=>({saveFile:value=>value.fail({errMsg:'saveFile:fail quota'})})};await assert.rejects(persistImage('temp'),/当前输入仍保留/);
});
