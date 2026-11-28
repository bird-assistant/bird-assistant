import {copy,JournalDocument,readJournals,uid,validJournalCollection} from './journal-model';
import {restoreEditorHistory} from './journal-storage';
import {readSavedPlaces,SavedPlace,validSavedPlaces} from './saved-places';
import {checksum,commitProtectedData,protectedDirectory} from './protected-local-data';

const MAGIC='BIRDBK01',CHUNK=256*1024,MAX_MEDIA=64*1024*1024,MAX_METADATA=2*1024*1024;
type Media={id:string;size:number};
interface Manifest {kind:'bird-assistant-local-backup';version:1;created:string;places:SavedPlace[];journals:JournalDocument[];media:Media[];}
export type BackupInfo={places:number;journals:number;photos:number;bytes:number;created:string;};
type Work={current?:()=>boolean;progress?:(message:string)=>void};
const running=(work:Work)=>{if(work.current&&!work.current())throw new Error('备份操作已暂停，原资料仍保留。');};
const pause=()=>new Promise<void>(resolve=>setTimeout(resolve,0));
const localPath=(path:string)=>path.startsWith(wx.env.USER_DATA_PATH+'/')||/^wxfile:\/\//.test(path);
const packaged=(path:string)=>/^\/assets\/[A-Za-z0-9_./-]+$/.test(path)&&!path.split('/').some(part=>part==='..'||part==='.');
const token=(id:string)=>'bird-backup:'+id;
const u32=(value:number)=>{const buffer=new ArrayBuffer(4);new DataView(buffer).setUint32(0,value,true);return buffer;};
export function utf8Bytes(text:string){let n=0;for(const c of text){const code=c.codePointAt(0)!;n+=code<128?1:code<2048?2:code<65536?3:4;}return n;}
function fsForBackup(){const fs=wx.getFileSystemManager();if(typeof fs.readFileSync!=='function'||typeof fs.appendFileSync!=='function')throw new Error('当前微信不支持完整文件备份，请更新微信后重试。');return fs;}
function exact(fs:WechatMiniprogram.FileSystemManager,path:string,position:number,length:number){
  const result=fs.readFileSync(path,undefined,position,length);if(!(result instanceof ArrayBuffer)||result.byteLength!==length)throw new Error('备份文件不完整，原资料未更改。');return result;
}
function size(fs:WechatMiniprogram.FileSystemManager,path:string){const stat=fs.statSync(path) as WechatMiniprogram.Stats;if(!stat.isFile())throw new Error('请选择完整的羽迹备份文件。');return stat.size;}
function documents(journal:JournalDocument){
  restoreEditorHistory(journal);
  return [journal,...(journal.editHistory?.past||[]).map(s=>s.document),...(journal.editHistory?.future||[]).map(s=>s.document)];
}
function remap(journals:JournalDocument[],replace:(src:string)=>string){for(const j of journals)for(const d of documents(j)){
  // Covers and previews are regenerable. Every original photo, including Undo/Redo-only photos, is retained.
  delete (d as JournalDocument&{cover?:string}).cover;
  for(const element of d.elements)if(element.type==='photo'&&element.src&&!packaged(element.src))element.src=replace(element.src);
}}
function inspect(path:string){
  const fs=fsForBackup(),total=size(fs,path);if(total<16||total>MAX_MEDIA+MAX_METADATA+65536)throw new Error('备份文件大小不符合限制，原资料未更改。');
  const magic=fs.readFileSync(path,'utf8',0,8);if(magic!==MAGIC)throw new Error('这不是可识别的羽迹备份文件。');
  const length=new DataView(exact(fs,path,8,4)).getUint32(0,true);if(!length||length>MAX_METADATA||16+length>total)throw new Error('备份目录不完整。');
  const bytes=exact(fs,path,12,length),stored=new DataView(exact(fs,path,12+length,4)).getUint32(0,true);
  if(checksum(new Uint8Array(bytes))!==stored)throw new Error('备份目录校验失败，原资料未更改。');
  const text=fs.readFileSync(path,'utf8',12,length);if(typeof text!=='string')throw new Error('备份目录无法读取。');
  let m:Manifest;try{m=JSON.parse(text);}catch{throw new Error('备份目录格式不完整。');}
  if(m.kind!=='bird-assistant-local-backup'||m.version!==1||typeof m.created!=='string'||!Number.isFinite(Date.parse(m.created))
    ||!validSavedPlaces({version:1,items:m.places})||!validJournalCollection(m.journals)||!Array.isArray(m.media)||m.media.length>4096
    ||!m.media.every(e=>e&&/^media-[0-9]+$/.test(e.id)&&Number.isSafeInteger(e.size)&&e.size>0&&e.size<=MAX_MEDIA)
    ||new Set(m.media.map(e=>e.id)).size!==m.media.length)throw new Error('备份目录包含无法读取的资料，原资料未更改。');
  const lookup=new Set(m.media.map(e=>token(e.id))),referenced=new Set<string>();
  remap(m.journals,src=>{if(!lookup.has(src))throw new Error('备份照片引用不完整或包含外部路径，原资料未更改。');referenced.add(src);return src;});
  if(referenced.size!==m.media.length)throw new Error('备份包含未关联的文件，未导入。');
  const expected=16+length+m.media.reduce((sum,e)=>sum+e.size+4,0);if(expected!==total||m.media.reduce((sum,e)=>sum+e.size,0)>MAX_MEDIA)throw new Error('备份照片数据不完整。');
  return {fs,m,total,start:16+length};
}
export function inspectLocalBackup(path:string):BackupInfo {const v=inspect(path);return {places:v.m.places.length,journals:v.m.journals.length,photos:v.m.media.length,bytes:v.total,created:v.m.created};}

/** Streaming frames avoid building a base64 archive in the mini-program's JS heap. */
export async function exportLocalBackup(ids:string[],work:Work={}):Promise<{path:string;info:BackupInfo}>{
  running(work);const fs=fsForBackup(),all=readJournals(),selected=new Set(ids);
  if(selected.size!==ids.length||ids.some(id=>!all.some(j=>j.id===id)))throw new Error('手帐列表已变化，请重新打开备份页。');
  const journals=copy(all.filter(j=>selected.has(j.id))),places=readSavedPlaces(),sources=new Map<string,Media>();
  remap(journals,src=>{if(!localPath(src))throw new Error('手帐含未保存的照片，请先打开并保存这份手帐，再重试备份。');
    if(!sources.has(src)){let bytes=0;try{bytes=size(fs,src);}catch{throw new Error('一张手帐原照片暂不能读取，未生成不完整备份。请检查原手帐。');}
      if(!bytes)throw new Error('手帐原照片为空，未生成不完整备份。');sources.set(src,{id:'media-'+sources.size,size:bytes});}return token(sources.get(src)!.id);});
  if(Array.from(sources.values()).reduce((sum,e)=>sum+e.size,0)>MAX_MEDIA)throw new Error('照片总量超过64 MiB，请减少勾选手帐、分批导出。原资料仍保留。');
  const manifest:Manifest={kind:'bird-assistant-local-backup',version:1,created:new Date().toISOString(),places,journals,media:Array.from(sources.values())},text=JSON.stringify(manifest),length=utf8Bytes(text);
  if(length>MAX_METADATA)throw new Error('所选手帐目录过大，请分批导出。');
  const folder=protectedDirectory()+'/exports',path=folder+'/bird-assistant-'+uid()+'.birdbackup';try{fs.mkdirSync(folder,true);}catch{}
  try{
    fs.writeFileSync(path,MAGIC,'utf8');fs.appendFileSync(path,u32(length));fs.appendFileSync(path,text,'utf8');
    const metadata=exact(fs,path,12,length);fs.appendFileSync(path,u32(checksum(new Uint8Array(metadata))));
    let index=0;for(const src of sources.keys()){
      const entry=sources.get(src)!;let hash=2166136261;work.progress?.('正在备份原照片 '+(++index)+' / '+sources.size);
      for(let position=0;position<entry.size;position+=CHUNK){running(work);const bytes=exact(fs,src,position,Math.min(CHUNK,entry.size-position));hash=checksum(new Uint8Array(bytes),hash);fs.appendFileSync(path,bytes);await pause();}
      if(size(fs,src)!==entry.size)throw new Error('原照片在备份期间发生变化，请重新生成。');fs.appendFileSync(path,u32(hash));
    }
    running(work);return {path,info:inspectLocalBackup(path)};
  }catch(error){try{fs.unlinkSync(path);}catch{}throw error;}
}

/** Validate and stage all photos first, then commit both collections in one protected snapshot. */
export async function restoreLocalBackup(path:string,work:Work={}):Promise<{places:number;journals:number;copies:number}>{
  running(work);const {fs,m,start}=inspect(path),folder=protectedDirectory()+'/restored-'+uid(),staged:string[]=[],mapping=new Map<string,string>();let position=start,committed=false;
  try{
    if(m.media.length)fs.mkdirSync(folder,true);let index=0;
    for(const entry of m.media){
      const target=folder+'/'+entry.id+'.jpg';staged.push(target);fs.writeFileSync(target,new ArrayBuffer(0));let hash=2166136261;work.progress?.('正在校验并恢复照片 '+(++index)+' / '+m.media.length);
      for(let offset=0;offset<entry.size;offset+=CHUNK){running(work);const bytes=exact(fs,path,position,Math.min(CHUNK,entry.size-offset));position+=bytes.byteLength;hash=checksum(new Uint8Array(bytes),hash);fs.appendFileSync(target,bytes);await pause();}
      const expected=new DataView(exact(fs,path,position,4)).getUint32(0,true);position+=4;if(hash!==expected)throw new Error('备份照片校验失败，未修改现有收藏或手帐。');mapping.set(token(entry.id),target);
    }
    running(work);remap(m.journals,src=>{const target=mapping.get(src);if(!target)throw new Error('备份照片缺失。');return target;});
    const places=readSavedPlaces(),journals=readJournals(),ids=new Set(journals.map(j=>j.id));let addedPlaces=0,copies=0;
    for(const p of m.places){if(places.some(old=>Math.abs(old.latitude-p.latitude)<.00001&&Math.abs(old.longitude-p.longitude)<.00001))continue;
      const restored={...p,id:places.some(old=>old.id===p.id)?uid():p.id};places.push(restored);addedPlaces++;}
    for(const j of m.journals){if(ids.has(j.id)){const id=uid();for(const doc of documents(j))doc.id=id;j.title+='（恢复副本）';copies++;}ids.add(j.id);journals.push(j);}
    commitProtectedData({places:{version:1,items:places},journals});committed=true;
    return {places:addedPlaces,journals:m.journals.length,copies};
  }finally{if(!committed){for(const file of staged)try{fs.unlinkSync(file);}catch{}if(staged.length)try{fs.rmdirSync(folder);}catch{}}}
}
