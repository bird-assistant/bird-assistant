const {test}=require('node:test');
const assert=require('node:assert/strict');
const cache=require('../.test-build/services/public-guide-photos.js');
function environment(){const store=new Map(),files=new Map([['/user/original.jpg',100]]),removed=[],requests=[];let bytes=100,fail=false,quota=false,deny=false;
 global.wx={env:{USER_DATA_PATH:'/user'},getStorageSync:k=>structuredClone(store.get(k)??''),setStorageSync:(k,v)=>{if(quota)throw Error('quota');store.set(k,structuredClone(v));},getFileSystemManager:()=>({accessSync:p=>{if(!files.has(p))throw Error('missing');},mkdirSync(){},copyFileSync:(from,to)=>files.set(to,files.get(from)),unlinkSync:p=>{if(deny)throw Error('busy');removed.push(p);files.delete(p);},getFileInfo:o=>o.success({size:files.get(o.filePath)})}),getImageInfo:o=>o.success({width:200,height:200,path:o.src}),downloadFile(o){requests.push(o);if(fail){o.fail({errMsg:'offline'});return {abort(){}};}const path='/tmp/photo-'+requests.length;files.set(path,bytes);o.success({statusCode:200,tempFilePath:path});return {abort(){}};}};
 return {store,files,removed,requests,size:v=>bytes=v,offline:()=>fail=true,quota:()=>quota=true,deny:()=>deny=true};
}
test('public guide images are downloaded without credentials, reused locally and cleared without original files',async()=>{
 const e=environment(),path=await cache.publicGuidePhoto('bird_1');assert.match(path,/^\/user\/guide-photo-cache-v1\//);assert.equal(e.requests[0].header,undefined);assert.match(e.requests[0].url,/\/api\/v1\/species\/bird_1\/photo$/);
 assert.equal(await cache.publicGuidePhoto('bird_1'),path);assert.equal(e.requests.length,1);assert.equal(cache.publicGuideCacheInfo().files,1);
 assert.equal(cache.clearPublicGuideCache().removed,1);assert.equal(e.files.has('/user/original.jpg'),true);assert.equal(e.removed.every(p=>p.startsWith('/user/guide-photo-cache-v1/')),true);
});
test('concurrent cache downloads merge their manifest and duplicate requests share one job',async()=>{
 const e=environment();const result=await Promise.all([cache.publicGuidePhoto('a'),cache.publicGuidePhoto('b'),cache.publicGuidePhoto('a')]);assert.equal(result[0],result[2]);assert.equal(e.requests.length,2);assert.equal(cache.publicGuideCacheInfo().files,2);
});
test('the image cache enforces both file and byte budgets with least recently used derived files',async()=>{
 const e=environment();for(let i=0;i<34;i++)await cache.publicGuidePhoto('small_'+i);assert.equal(cache.publicGuideCacheInfo().files,32);assert.equal(e.removed.length,2);
 cache.clearPublicGuideCache();e.size(3*1024*1024);for(let i=0;i<7;i++)await cache.publicGuidePhoto('big_'+i);const info=cache.publicGuideCacheInfo();assert.ok(info.kilobytes<=16*1024);assert.equal(info.files,5);assert.equal(e.files.has('/user/original.jpg'),true);
});
test('offline public-photo fallback is bounded by age; large files and storage quota leave no new persistent cache',async()=>{
 const e=environment(),path=await cache.publicGuidePhoto('offline');const index=e.store.get(cache.PUBLIC_GUIDE_CACHE_KEY);index.items[0].saved=Date.now()-10*86400000;e.offline();assert.equal(await cache.publicGuidePhoto('offline'),path);
 index.items[0].saved=Date.now()-31*86400000;assert.match(await cache.publicGuidePhoto('offline'),/^https?:/);
 const fresh=environment();fresh.size(4*1024*1024);assert.match(await cache.publicGuidePhoto('large'),/^\/tmp\//);assert.equal(cache.publicGuideCacheInfo().files,0);
 fresh.size(100);fresh.quota();assert.match(await cache.publicGuidePhoto('quota'),/^\/tmp\//);assert.equal([...fresh.files.keys()].filter(p=>p.startsWith('/user/guide-photo')).length,0);
});
test('a corrupt cache manifest cannot trick cleanup into deleting an original photo',async()=>{
 const e=environment();e.store.set(cache.PUBLIC_GUIDE_CACHE_KEY,{version:1,items:[{url:'https://example/photo',path:'/user/original.jpg',bytes:100,saved:Date.now(),used:Date.now()}]});
 assert.throws(()=>cache.clearPublicGuideCache(),/未清理/);assert.match(await cache.publicGuidePhoto('safe'),/^https?:/);assert.equal(e.requests.length,0);assert.deepEqual(e.removed,[]);assert.equal(e.files.has('/user/original.jpg'),true);
});
test('failed eviction stops cache growth instead of silently orphaning more derived files',async()=>{
 const e=environment();for(let i=0;i<32;i++)await cache.publicGuidePhoto('fill_'+i);e.deny();assert.match(await cache.publicGuidePhoto('over-budget'),/^\/tmp\//);assert.equal(cache.publicGuideCacheInfo().files,32);assert.equal([...e.files.keys()].filter(p=>p.startsWith('/user/guide-photo')).length,32);
});
test('a changed photo credit or source invalidates the image so old artwork cannot inherit new attribution',async()=>{
 const e=environment(),one={sourceUrl:'https://source.example/one',credit:'Author one',license:'CC BY 4.0'},two={sourceUrl:'https://source.example/two',credit:'Author two',license:'CC BY-SA 4.0'};
 const a=await cache.publicGuidePhoto('changed',one),b=await cache.publicGuidePhoto('changed',two);assert.notEqual(a,b);assert.equal(e.requests.length,2);assert.equal(e.files.has(a),false);assert.equal(cache.publicGuideCacheInfo().files,1);
});
