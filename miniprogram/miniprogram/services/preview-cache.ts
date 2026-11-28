import {JOURNAL_SHELF_KEY} from './journal-shelf';
import {readJournals} from './journal-model';
import {readPostDrafts} from './post-draft';
import {localRepository} from './repository';
import {getDraft} from './community';

const ownKey=(key:string)=>key===JOURNAL_SHELF_KEY||key.startsWith('bird-assistant.journal.preview.v1.');
export interface PreviewCacheInfo {files:number;kilobytes:number;entries:number;protectedFiles:number;}
function snapshot(){
  // Validate the authoritative collections before removing any disposable cache.
  // Raw manifests below also protect older complete drafts hidden by a recovery.
  const journals=readJournals();readPostDrafts();localRepository().list();localRepository().profile();
  const keys=wx.getStorageInfoSync().keys,cacheKeys=keys.filter(ownKey),references:string[]=[];
  const folder=wx.env.USER_DATA_PATH+'/journal-previews',prefix=folder+'/';
  const visit=(value:unknown)=>{if(typeof value==='string'){if(value.includes(prefix))references.push(value);}else if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==='object')Object.values(value).forEach(visit);};
  for(const key of keys)if(!ownKey(key))visit(wx.getStorageSync(key));
  visit(journals);visit(getDraft());
  const fs=wx.getFileSystemManager();let names:string[]=[];
  try{names=fs.readdirSync(folder);}catch(error){if(!/no such file|not exist|ENOENT/i.test(String((error as {errMsg?:string})?.errMsg||error)))throw new Error('预览缓存目录暂不能读取，请稍后重试。');}
  const files:Array<{path:string;size:number}>=[];let protectedFiles=0;
  for(const name of names){
    if(!/^[^/\\\0]+\.png$/i.test(name)||name==='.'||name==='..')continue;
    const path=prefix+name,stat=fs.statSync(path) as WechatMiniprogram.Stats;if(!stat.isFile())continue;
    if(references.some(value=>value.includes(path))){protectedFiles++;continue;}
    files.push({path,size:stat.size});
  }
  return {fs,files,cacheKeys,protectedFiles};
}
export function previewCacheInfo():PreviewCacheInfo{
  const {files,cacheKeys,protectedFiles}=snapshot();return {files:files.length,kilobytes:Math.ceil(files.reduce((total,file)=>total+file.size,0)/1024),entries:cacheKeys.length,protectedFiles};
}
/** Only journal-previews PNG derivatives and their rebuildable index are owned here. */
export function clearPreviewCache(){
  const {fs,files,cacheKeys,protectedFiles}=snapshot();let removed=0,failed=0;
  // Drop the index first so a failed unlink can only leave an orphan, never a broken row.
  for(const key of cacheKeys)try{wx.removeStorageSync(key);}catch{failed++;}
  if(!failed)for(const file of files)try{fs.unlinkSync(file.path);removed++;}catch{failed++;}
  return {removed,failed,protectedFiles};
}
