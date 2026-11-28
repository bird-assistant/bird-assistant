/** Original records live in user files; wx storage is a compatibility mirror, never the only copy. */
export type ProtectedKind='places'|'journals';
type Vault={version:1;revision:number;values:Partial<Record<ProtectedKind,unknown>>;checksum:number};
const keys:Record<ProtectedKind,string>={places:'bird-assistant.saved-places.v1',journals:'bird-assistant.journals.v1'};
export const protectedDirectory=()=>wx.env.USER_DATA_PATH+'/bird-assistant-originals';
export function checksum(bytes:Uint8Array,initial=2166136261){let hash=initial;for(let i=0;i<bytes.length;i++)hash=Math.imul(hash^bytes[i],16777619)>>>0;return hash;}
function utf8Length(value:string){let size=0;for(const c of value){const n=c.codePointAt(0)!;size+=n<128?1:n<2048?2:n<65536?3:4;}return size;}
function stringChecksum(value:string){let hash=2166136261;for(let i=0;i<value.length;i++)hash=Math.imul(hash^value.charCodeAt(i),16777619)>>>0;return hash;}
function fileSystem(){
  if(!wx.env?.USER_DATA_PATH||typeof wx.getFileSystemManager!=='function')return null;
  const fs=wx.getFileSystemManager();return typeof fs.readFileSync==='function'&&typeof fs.writeFileSync==='function'&&typeof fs.statSync==='function'&&typeof fs.accessSync==='function'?fs:null;
}
function latest(fs:WechatMiniprogram.FileSystemManager):Vault|null{
  const valid:Vault[]=[];let unreadable=false;
  for(let i=0;i<2;i++){
    const path=protectedDirectory()+'/records-'+i+'.json';
    try{fs.accessSync(path);}catch{continue;}
    try{
      const stat=fs.statSync(path) as WechatMiniprogram.Stats;if(stat.size>4*1024*1024)throw new Error('size');
      const raw=fs.readFileSync(path,'utf8');if(typeof raw!=='string')throw new Error('format');const v=JSON.parse(raw);
      if(v.version!==1||!Number.isSafeInteger(v.revision)||v.revision<1||!v.values||Array.isArray(v.values)||typeof v.values!=='object'
        ||Object.keys(v.values).some(key=>key!=='places'&&key!=='journals')||v.checksum!==stringChecksum(JSON.stringify(v.values)))throw new Error('integrity');
      valid.push(v);
    }catch{unreadable=true;}
  }
  if(!valid.length&&unreadable)throw new Error('本机保护文件暂不能读取，原内容未覆盖。请保留现有文件以便修复。');
  return valid.sort((a,b)=>b.revision-a.revision)[0]||null;
}
function mirror(values:Vault['values']){for(const kind of Object.keys(values) as ProtectedKind[])try{wx.setStorageSync(keys[kind],values[kind]);}catch{/* The verified user file remains authoritative. */}}
export function commitProtectedData(patch:Vault['values']){
  const fs=fileSystem();if(!fs){for(const kind of Object.keys(patch) as ProtectedKind[])wx.setStorageSync(keys[kind],patch[kind]);return;}
  writeSnapshot(fs,latest(fs),patch);
}
function writeSnapshot(fs:WechatMiniprogram.FileSystemManager,previous:Vault|null,patch:Vault['values']){
  const values={...previous?.values,...patch},revision=(previous?.revision||0)+1;
  const vault:Vault={version:1,revision,values,checksum:stringChecksum(JSON.stringify(values))},raw=JSON.stringify(vault);
  if(utf8Length(raw)>4*1024*1024)throw new Error('本机资料过大，请先导出备份后分批整理，当前内容仍保留。');
  try{fs.mkdirSync(protectedDirectory(),true);}catch{/* The write reports a real filesystem failure. */}
  // Alternate complete snapshots. An interrupted write cannot replace the last valid snapshot.
  try{fs.writeFileSync(protectedDirectory()+'/records-'+(revision%2)+'.json',raw,'utf8');}
  catch{throw new Error('本机资料未能写入保护文件，请检查空间后重试，当前内容仍保留。');}
  mirror(values);
}
/** One scan/commit for launch migration; domain reads remain synchronous and independently safe. */
export function migrateProtectedCollections(validators:Record<ProtectedKind,(value:unknown)=>boolean>){
  const fs=fileSystem();if(!fs)return;const previous=latest(fs),patch:Vault['values']={};
  for(const kind of Object.keys(keys) as ProtectedKind[]){
    if(previous&&Object.prototype.hasOwnProperty.call(previous.values,kind))continue;
    const value=wx.getStorageSync(keys[kind]);if(value!==''&&value!=null&&validators[kind](value))patch[kind]=value;
  }
  if(Object.keys(patch).length)writeSnapshot(fs,previous,patch);
}
export function readProtectedData(kind:ProtectedKind,valid:(value:unknown)=>boolean):unknown{
  const fs=fileSystem(),vault=fs?latest(fs):null;
  if(vault&&Object.prototype.hasOwnProperty.call(vault.values,kind))return vault.values[kind];
  const value=wx.getStorageSync(keys[kind]);
  if(fs&&value!==''&&value!=null&&valid(value))commitProtectedData({[kind]:value});
  return value;
}
