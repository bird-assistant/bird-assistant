const {test}=require('node:test');
const assert=require('node:assert/strict');
const save=require('../.test-build/services/media-save.js');
const origin='https://api.auroraliu.cn:8080',path='/api/v1/community/publications/post_example/photos/1';
function environment(){const calls=[];global.wx={getExtConfigSync:()=>({}),downloadFile:o=>{calls.push(['download',o]);o.success({statusCode:200,tempFilePath:'wxfile://download-owned'});},saveImageToPhotosAlbum:o=>{calls.push(['album',o]);o.success();},getFileSystemManager:()=>({unlink:o=>calls.push(['unlink',o.filePath])})};return calls;}
test('saving a public image uses its redacted route and cleans only the downloaded temporary copy',async()=>{
  const calls=environment();await save.savePublishedPhoto(origin+path);assert.equal(calls[0][1].url,origin+path);assert.equal(calls[1][1].filePath,'wxfile://download-owned');assert.deepEqual(calls[2],['unlink','wxfile://download-owned']);
});
test('arbitrary URLs, private observation paths, query credentials and invalid indices never download',()=>{
  const calls=environment();for(const url of ['https://untrusted.invalid'+path,origin+'.evil'+path,'/api/v2/observations/private/photo',origin+path+'?token=secret',path.replace('/1','/9'),path.replace('post_example','../private')])assert.throws(()=>save.publishedPhotoUrl(url));assert.equal(calls.length,0);
});
test('withdrawn or failed downloads never prompt for album access',async()=>{
  for(const statusCode of [404,403,502]){const calls=environment();global.wx.downloadFile=o=>o.success({statusCode,tempFilePath:'not-an-image'});await assert.rejects(save.savePublishedPhoto(path));assert.equal(calls.length,0);}
});
test('album permission failure is actionable and does not remove originals or drafts',async()=>{
  const calls=environment();global.wx.saveImageToPhotosAlbum=o=>o.fail({errMsg:'saveImageToPhotosAlbum:fail auth deny'});await assert.rejects(save.savePublishedPhoto(path),/相册权限/);assert.deepEqual(calls.at(-1),['unlink','wxfile://download-owned']);
});
