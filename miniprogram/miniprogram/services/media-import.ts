export type PickedMedia={path:string;kind:'photo'|'video'|'audio';name?:string;size?:number;duration?:number};
type Rejection={name:string;reason:string};
const audioTypes=['mp3','wav','aac','m4a','mp4','ogg'];
const label=(file:PickedMedia)=>(file.name||String(file.path||'').split('/').pop()||'所选文件').replace(/[\x00-\x1f]/g,'').slice(0,90);

/** Picker extension filters are hints. Check the returned file before adding it to a draft. */
export function audioContainer(bytes:Uint8Array):string {
  const text=(start:number,end:number)=>String.fromCharCode(...bytes.slice(start,end));
  if(bytes.length>=12&&text(0,4)==='RIFF'&&text(8,12)==='WAVE')return 'wav';
  if(bytes.length>=12&&text(4,8)==='ftyp')return 'mp4';
  if(bytes.length>=4&&text(0,4)==='OggS')return 'ogg';
  if(bytes.length>=10&&text(0,3)==='ID3')return 'mp3';
  if(bytes.length>=7&&bytes[0]===255&&(bytes[1]&246)===240)return 'aac';
  if(bytes.length>=4&&bytes[0]===255&&(bytes[1]&224)===224&&(bytes[1]&6)!==0&&(bytes[2]&240)!==240&&(bytes[2]&240)!==0)return 'mp3';
  return '';
}

export async function validatePickedMedia(file:PickedMedia):Promise<void>{
  if(!file.path)throw new Error('没有读取到文件。');
  if(file.kind==='photo'){
    if(typeof wx.getImageInfo!=='function')throw new Error('当前版本无法验证图片，请升级微信后重试。');
    await new Promise<void>((resolve,reject)=>wx.getImageInfo({src:file.path,success:info=>Number.isFinite(info.width)&&Number.isFinite(info.height)&&info.width>0&&info.height>0?resolve():reject(new Error('图片内容无效。')),fail:()=>reject(new Error('不是可读取的照片，请选择受支持的图片。'))}));
    return;
  }
  if(file.kind==='video'){
    if(typeof wx.getVideoInfo!=='function')throw new Error('当前版本无法验证视频，请升级微信后重试。');
    await new Promise<void>((resolve,reject)=>wx.getVideoInfo({src:file.path,success:info=>Number.isFinite(info.width)&&Number.isFinite(info.height)&&Number.isFinite(info.duration)&&info.width>0&&info.height>0&&info.duration>0?resolve():reject(new Error('视频内容无效。')),fail:()=>reject(new Error('不是可读取的视频。'))}));
    return;
  }
  const extension=(file.name||file.path).split('.').pop()?.toLowerCase()||'';
  if(!audioTypes.includes(extension))throw new Error('请选择MP3、WAV、AAC、M4A/MP4或OGG音频。');
  const fs=wx.getFileSystemManager();
  const size=await new Promise<number>((resolve,reject)=>fs.getFileInfo({filePath:file.path,success:info=>resolve(info.size),fail:()=>reject(new Error('文件无法读取，请重新选择。'))}));
  if(!Number.isFinite(size)||size<4)throw new Error('文件为空或内容不完整。');
  const header=await new Promise<Uint8Array>((resolve,reject)=>fs.readFile({filePath:file.path,position:0,length:Math.min(64,size),success:r=>typeof r.data==='string'?reject(new Error('文件内容无法验证。')):resolve(new Uint8Array(r.data)),fail:()=>reject(new Error('文件无法读取。'))}));
  const container=audioContainer(header),expected=extension==='m4a'?'mp4':extension;
  if(!container||container!==expected)throw new Error('实际内容与音频格式不符，请选择有效音频文件。');
}

export function showImportRejections(rejected:Rejection[]){
  if(!rejected.length)return;
  wx.showModal({title:'文件未添加',content:rejected.slice(0,6).map(item=>item.name+'：'+item.reason).join('\n')+(rejected.length>6?'\n其余'+(rejected.length-6)+'个文件也未添加。':''),showCancel:false,confirmText:'知道了',success:()=>{},fail:()=>{}});
}

export async function acceptPickedMedia<T extends PickedMedia>(files:T[],active:()=>boolean=()=>true):Promise<T[]>{
  const accepted:T[]=[],rejected:Rejection[]=[];
  for(const file of files){
    if(!active())return [];
    try{await validatePickedMedia(file);if(!active())return [];accepted.push(file);}
    catch(error){if(!active())return [];rejected.push({name:label(file),reason:error instanceof Error?error.message:'文件格式不支持。'});}
  }
  if(active())showImportRejections(rejected);
  return accepted;
}
