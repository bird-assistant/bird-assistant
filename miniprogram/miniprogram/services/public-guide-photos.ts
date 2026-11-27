import {businessOrigin} from './vision-network';
import {speciesPath} from './field-guide';
import {nativeDeadline} from './native-deadline';

export const PUBLIC_GUIDE_CACHE_KEY='bird-assistant.public-guide-photos.v1';
export const PUBLIC_GUIDE_CACHE_LIMIT={files:32,bytes:16*1024*1024,item:3*1024*1024,ttl:7*86400000,stale:30*86400000};
type Entry={url:string;identity:string;path:string;bytes:number;saved:number;used:number};
type Index={version:1;items:Entry[]};
const jobs=new Map<string,Promise<string>>();
const directory=()=>wx.env.USER_DATA_PATH+'/guide-photo-cache-v1/';
const owns=(path:unknown):path is string=>typeof path==='string'&&path.startsWith(directory())&&/^[a-z0-9-]+\.jpg$/.test(path.slice(directory().length));
function read():Index {
  const v=wx.getStorageSync(PUBLIC_GUIDE_CACHE_KEY);if(v===''||v==null)return {version:1,items:[]};
  if(v.version!==1||!Array.isArray(v.items)||v.items.length>32||!v.items.every((e:any)=>e&&owns(e.path)&&typeof e.url==='string'
    &&/^https?:\/\//.test(e.url)&&typeof e.identity==='string'&&e.identity.length<=4096&&Number.isSafeInteger(e.bytes)&&e.bytes>0&&e.bytes<=PUBLIC_GUIDE_CACHE_LIMIT.item
    &&Number.isFinite(e.saved)&&e.saved>0&&Number.isFinite(e.used)&&e.used>0)||new Set(v.items.map((e:Entry)=>e.url)).size!==v.items.length
    ||new Set(v.items.map((e:Entry)=>e.path)).size!==v.items.length||v.items.reduce((sum:number,e:Entry)=>sum+e.bytes,0)>PUBLIC_GUIDE_CACHE_LIMIT.bytes)throw new Error('公开图鉴缓存索引无法读取，原件和缓存均未清理。');
  return {version:1,items:v.items.map((e:Entry)=>({...e}))};
}
const exists=(path:string)=>{try{wx.getFileSystemManager().accessSync(path);return true;}catch{return false;}};
function remove(path:string){if(owns(path)){try{wx.getFileSystemManager().unlinkSync(path);return true;}catch{return !exists(path);}}return false;}
export function publicGuideCacheInfo(){const index=read();return {files:index.items.length,kilobytes:Math.round(index.items.reduce((sum,e)=>sum+e.bytes,0)/1024)};}
export function clearPublicGuideCache(){const index=read(),kept=index.items.filter(e=>!remove(e.path));wx.setStorageSync(PUBLIC_GUIDE_CACHE_KEY,{version:1,items:kept});return {removed:index.items.length-kept.length,remaining:kept.length};}

/** Only the anonymous species-photo route is eligible; never private observations or message media. */
export function publicGuidePhoto(id:string,photo?:{credit?:string;license?:string;sourceUrl?:string}):Promise<string>{
  if(!id||id.length>160)return Promise.resolve('');
  const url=businessOrigin()+speciesPath(id)+'/photo';
  const identity=JSON.stringify([photo?.sourceUrl||'',photo?.license||'',photo?.credit||'']).slice(0,4096),jobKey=url+'\n'+identity;
  if(jobs.has(jobKey))return jobs.get(jobKey)!;
  const job=load(url,identity).finally(()=>{if(jobs.get(jobKey)===job)jobs.delete(jobKey);});jobs.set(jobKey,job);return job;
}
async function load(url:string,identity:string):Promise<string>{
  let index:Index;try{index=read();}catch{return url;}
  const cached=index.items.find(e=>e.url===url&&e.identity===identity),time=Date.now();
  if(cached&&exists(cached.path)&&time-cached.saved<PUBLIC_GUIDE_CACHE_LIMIT.ttl){
    // Touch at most hourly, so a visible grid does not churn storage on every render.
    if(time-cached.used>3600000){cached.used=time;try{wx.setStorageSync(PUBLIC_GUIDE_CACHE_KEY,index);}catch{/* Reading the existing derived image still works. */}}
    return cached.path;
  }
  const fallback=()=>cached&&exists(cached.path)&&time-cached.saved<PUBLIC_GUIDE_CACHE_LIMIT.stale?cached.path:url;
  if(typeof wx.downloadFile!=='function')return fallback();
  try{
    const result=await nativeDeadline<WechatMiniprogram.DownloadFileSuccessCallbackResult>((resolve,reject)=>wx.downloadFile({url,timeout:12000,success:resolve,fail:reject}),14000,'图鉴照片加载超时。');
    if(result.statusCode!==200||!result.tempFilePath)return fallback();
    const path=result.tempFilePath,files=wx.getFileSystemManager();
    const size=await new Promise<number>((resolve,reject)=>files.getFileInfo({filePath:path,success:info=>resolve(info.size),fail:reject}));
    await nativeDeadline<unknown>((resolve,reject)=>{wx.getImageInfo({src:path,success:resolve,fail:reject});},5000,'照片格式检查超时。');
    if(!size||size>PUBLIC_GUIDE_CACHE_LIMIT.item)return path;
    // All mutations below are synchronous: concurrent downloads merge into a freshly read manifest.
    index=read();const items=index.items.filter(e=>e.url!==url).sort((a,b)=>b.used-a.used);
    let bytes=items.reduce((sum,e)=>sum+e.bytes,0);while(items.length>=PUBLIC_GUIDE_CACHE_LIMIT.files||bytes+size>PUBLIC_GUIDE_CACHE_LIMIT.bytes){const oldest=items.pop();if(!oldest)break;bytes-=oldest.bytes;if(!remove(oldest.path))return path;}
    const previous=index.items.find(e=>e.url===url);if(previous&&!remove(previous.path))return path;
    const target=directory()+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)+'.jpg';
    try{files.mkdirSync(directory(),true);}catch{/* Already created, or copy will report the storage error. */}
    files.copyFileSync(path,target);
    try{wx.setStorageSync(PUBLIC_GUIDE_CACHE_KEY,{version:1,items:[{url,identity,path:target,bytes:size,saved:time,used:time},...items]});}
    catch{remove(target);return path;}
    if(cached)remove(cached.path);return target;
  }catch{return fallback();}
}
