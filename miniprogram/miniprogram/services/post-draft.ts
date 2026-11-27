import {PostImage,checkPostImages,cleanPostImage,postImage} from './post-media';

// Keep old keys readable and mirror the latest draft for legacy readers.
export const POST_DRAFT_KEY='bird-assistant.post-draft.v2';
export const POST_RECOVERY_KEY='bird-assistant.post-draft-recovery.v2';
export const POST_DRAFTS_KEY='bird-assistant.post-drafts.v3';
export const POST_RECOVERIES_KEY='bird-assistant.post-draft-recoveries.v3';
const LEGACY='bird-assistant.post-draft.v1';
export interface PostDraft {
  version:2;id?:string;createdAt?:string;updatedAt?:string;saveId?:string;
  title:string;body:string;images:PostImage[];activeAttachment?:string;
  writing:{purpose:number;instructions:string;includeImage:boolean;imageIds?:string[]};
  missingMedia?:number;
}
interface Shelf {version:3;items:PostDraft[];lastId:string;}
const copy=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
const uid=()=> 'post-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10);
function checked(value:any):PostDraft {
  if(!value||value.version!==2||typeof value.title!=='string'||typeof value.body!=='string'||!Array.isArray(value.images))throw new Error('帖子草稿无法读取，原有资料未覆盖。');
  const images=value.images.map(cleanPostImage);checkPostImages(images);
  const writing=value.writing||{};
  return {...copy(value),images,writing:{purpose:Number.isInteger(writing.purpose)?writing.purpose:1,instructions:typeof writing.instructions==='string'?writing.instructions:'',includeImage:writing.includeImage===true,
    ...(Array.isArray(writing.imageIds)?{imageIds:writing.imageIds.filter((id:unknown)=>typeof id==='string'&&images.some((image:PostImage)=>image.id===id))}:{})}};
}
export function newPostDraft():PostDraft {
  const now=new Date().toISOString();
  return {version:2,id:uid(),createdAt:now,updatedAt:now,title:'',body:'',images:[],writing:{purpose:1,instructions:'',includeImage:false,imageIds:[]}};
}
function legacy():PostDraft|null {
  const current=wx.getStorageSync(POST_DRAFT_KEY);
  if(current)return {...checked(current),id:current.id||'legacy-post-draft'};
  const old=wx.getStorageSync(LEGACY);if(!old)return null;
  if(typeof old.title!=='string'||typeof old.body!=='string'||typeof old.image!=='string')throw new Error('旧帖子草稿无法读取，原有资料未覆盖。');
  const image=old.image?postImage(old.image):null;if(image)image.manualCamera=old.manualCamera||{};
  return checked({version:2,id:'legacy-post-draft',title:old.title,body:old.body,images:image?[image]:[],writing:old.writing||{purpose:1,instructions:'',includeImage:false}});
}
function shelf():Shelf {
  const value=wx.getStorageSync(POST_DRAFTS_KEY);
  if(value!==''&&value!=null){
    if(value.version!==3||!Array.isArray(value.items)||typeof value.lastId!=='string')throw new Error('草稿箱无法读取，已有资料未覆盖。');
    const items=value.items.map(checked);
    if(items.some((item:PostDraft)=>!item.id)||new Set(items.map((item:PostDraft)=>item.id)).size!==items.length)throw new Error('草稿箱编号无效，已有资料未覆盖。');
    return {version:3,items,lastId:value.lastId};
  }
  const old=legacy();return {version:3,items:old?[old]:[],lastId:old?.id||''};
}
function recoveries():PostDraft[] {
  const value=wx.getStorageSync(POST_RECOVERIES_KEY);
  if(value!==''&&value!=null){
    if(value.version!==3||!Array.isArray(value.items))throw new Error('草稿恢复记录无法读取，已有资料未覆盖。');
    const items=value.items.map(checked);
    if(items.some((item:PostDraft)=>!item.id)||new Set(items.map((item:PostDraft)=>item.id)).size!==items.length)throw new Error('草稿恢复编号无效，已有资料未覆盖。');
    return items;
  }
  // A matching complete save is preferable if clearing the recovery key failed.
  const old=wx.getStorageSync(POST_RECOVERY_KEY);
  return old?[{...checked(old),id:old.id||'legacy-post-draft'}]:[];
}
export function readPostDrafts():PostDraft[] {
  const base=shelf(),items=base.items;
  for(const recovery of recoveries()){
    const index=items.findIndex(item=>item.id===recovery.id);
    if(index>=0&&items[index].saveId&&items[index].saveId===recovery.saveId)continue;
    if(index>=0){
      // An earlier media copy can finish after a newer text recovery was cached.
      // Stable attachment IDs let that recovery reuse its now-durable originals.
      const dir=prefix(),images=recovery.images.map(image=>{
        const saved=items[index].images.find(previous=>previous.id===image.id);
        return !image.path&&saved&&(saved.path.startsWith('/assets/')||(dir&&saved.path.startsWith(dir)))?{...image,path:saved.path}:image;
      });
      items[index]={...recovery,images,missingMedia:images.filter(image=>!image.path).length};
    }else items.push(recovery);
  }
  const epoch=(value?:string)=>{const time=Date.parse(value||'');return Number.isFinite(time)?time:-Infinity;};
  return items.sort((a,b)=>{
    const changed=(draft:PostDraft)=>epoch(draft.updatedAt)!==-Infinity?epoch(draft.updatedAt):epoch(draft.createdAt);
    const modifiedA=changed(a),modifiedB=changed(b);
    if(modifiedA!==modifiedB)return modifiedB>modifiedA?1:-1;
    const createdA=epoch(a.createdAt),createdB=epoch(b.createdAt);return createdA!==createdB?(createdB>createdA?1:-1):(a.id||'').localeCompare(b.id||'');
  });
}
export function readPostDraft(id?:string):PostDraft|null {
  const base=shelf(),items=readPostDrafts();
  return items.find(item=>item.id===(id||base.lastId))||(!id?items[0]:null)||null;
}
function prefix(){return wx.env?.USER_DATA_PATH?wx.env.USER_DATA_PATH+'/bird-post-draft/':'';}
function removeOwned(paths:string[]) {
  const dir=prefix();if(!dir)return;
  const owned=[...new Set(paths)].filter(path=>path.startsWith(dir)&&/^[a-z0-9-]+\.(?:jpe?g|png|webp)$/i.test(path.slice(dir.length)));
  if(!owned.length)return;const fs=wx.getFileSystemManager();
  for(const path of owned)try{fs.unlinkSync(path);}catch{/* A locked file may be reclaimed on a later save. */}
}
function pathsIn(items:PostDraft[]){const paths:string[]=[];for(const item of items)for(const image of item.images)paths.push(image.path);return paths;}
function identity(input:PostDraft,base:Shelf):PostDraft {
  const checkedInput=checked(input),id=input.id||base.lastId||uid(),previous=base.items.find(item=>item.id===id),now=new Date().toISOString();
  return {...checkedInput,id,createdAt:previous?.createdAt||input.createdAt||(previous?undefined:now),updatedAt:now,saveId:uid()};
}
function recoveryFor(value:PostDraft):PostDraft {
  const dir=prefix();
  const images=value.images.map(item=>({...item,path:item.path.startsWith('/assets/')||(dir&&item.path.startsWith(dir))?item.path:''}));
  return {...copy(value),images,missingMedia:images.filter(item=>!item.path).length};
}
function putRecovery(value:PostDraft){
  const recovery=recoveryFor(value),items=recoveries().filter(item=>item.id!==value.id);
  wx.setStorageSync(POST_RECOVERY_KEY,recovery);
  wx.setStorageSync(POST_RECOVERIES_KEY,{version:3,items:[recovery,...items]});
}
/** Synchronous text recovery also survives unloading before a media copy finishes. */
export function cachePostDraft(input:PostDraft):PostDraft {
  const value=identity(input,shelf());putRecovery(value);return value;
}
let writes:Promise<unknown>=Promise.resolve();
/** Serialize manifests; distinct drafts never overwrite another save's collection. */
export function savePostDraft(input:PostDraft):Promise<PostDraft> {
  // Capture recovery before queueing. A queued older save must never replace
  // edits cached synchronously while another draft's media is still copying.
  let snapshot:PostDraft;
  try{snapshot=identity(input,shelf());putRecovery(snapshot);}catch(error){return Promise.reject(error);}
  const task=writes.then(()=>saveNow(snapshot));writes=task.then(()=>undefined,()=>undefined);return task;
}
async function saveNow(input:PostDraft):Promise<PostDraft> {
  const base=shelf(),value=checked(input),previousRaw=wx.getStorageSync(POST_DRAFT_KEY);
  const created:string[]=[];
  try{
    if(value.images.some(image=>!image.path.startsWith('/assets/'))){
      const fs=wx.getFileSystemManager(),dir=prefix();if(!dir)throw new Error('本机素材目录尚未就绪。');
      try{fs.mkdirSync(dir,true);}catch(error){try{fs.accessSync(dir);}catch{throw error;}}
      for(const image of value.images){
        if(!image.path)throw new Error('有照片尚未保留，请重新添加后保存；文字已保存在本机。');
        if(image.path.startsWith('/assets/'))continue;
        fs.accessSync(image.path);if(image.path.startsWith(dir))continue;
        const suffix=/\.(jpe?g|png|webp)$/i.exec(image.path)?.[1]?.toLowerCase()||'jpg';
        const target=dir+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10)+'.'+suffix;created.push(target);
        await new Promise<void>((resolve,reject)=>fs.copyFile({srcPath:image.path,destPath:target,success:()=>resolve(),fail:reject}));image.path=target;
      }
    }
    delete value.missingMedia;
    const items=[value,...base.items.filter(item=>item.id!==value.id)];
    // Commit the collection last. Roll back the compatibility mirror if it fails.
    wx.setStorageSync(POST_DRAFT_KEY,value);
    try{wx.setStorageSync(POST_DRAFTS_KEY,{version:3,items,lastId:value.id});}
    catch(error){try{if(previousRaw)wx.setStorageSync(POST_DRAFT_KEY,previousRaw);else wx.removeStorageSync(POST_DRAFT_KEY);}catch{}throw error;}
  }catch{
    removeOwned(created);throw new Error('照片草稿未保存，文字与参数已保存在本机。请检查小程序可用空间后重试；已有完整草稿未覆盖。');
  }
  try{wx.setStorageSync(POST_RECOVERIES_KEY,{version:3,items:recoveries().filter(item=>item.id!==value.id||item.saveId!==value.saveId)});}catch{}
  try{if(wx.getStorageSync(POST_RECOVERY_KEY)?.saveId===value.saveId)wx.removeStorageSync(POST_RECOVERY_KEY);}catch{}
  const retained=new Set(pathsIn([value,...base.items.filter(item=>item.id!==value.id),...recoveries()]));
  removeOwned(pathsIn(base.items).filter(path=>!retained.has(path)));
  return value;
}
export function deletePostDraft(id:string):Promise<void>{
  const task=writes.then(()=>deleteNow(id));writes=task.then(()=>undefined,()=>undefined);return task;
}
function deleteNow(id:string){
  const base=shelf(),items=base.items.filter(item=>item.id!==id),pending=recoveries().filter(item=>item.id!==id);
  wx.setStorageSync(POST_DRAFTS_KEY,{version:3,items,lastId:base.lastId===id?(items[0]?.id||''):base.lastId});
  wx.setStorageSync(POST_RECOVERIES_KEY,{version:3,items:pending});
  const latest=items[0];try{if(latest)wx.setStorageSync(POST_DRAFT_KEY,latest);else wx.removeStorageSync(POST_DRAFT_KEY);if(wx.getStorageSync(POST_RECOVERY_KEY)?.id===id)wx.removeStorageSync(POST_RECOVERY_KEY);}catch{}
  const retained=new Set(pathsIn([...items,...pending]));
  removeOwned(pathsIn(base.items.filter(item=>item.id===id)).filter(path=>!retained.has(path)));
}
