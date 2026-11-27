/** Bounded, local-only camera metadata. Never follow GPS, serial or MakerNote IFDs. */
export interface LocalPhotoMetadata {
  state:'ready'|'missing'|'unsupported'|'unavailable';
  format:'jpeg'|'png'|'webp'|'tiff'|'unknown';
  camera:Record<string,string>;
  hasExif:boolean;
}
export const PHOTO_HEADER_LIMIT=256*1024;
const text=(bytes:Uint8Array,start:number,count:number)=>{
  let value='';for(let i=0;i<Math.min(count,128);i++){const c=bytes[start+i];if(!c)break;value+=String.fromCharCode(c);}
  return value.replace(/[\x00-\x1f\x7f]/g,' ').trim().slice(0,100);
};
const signature=(bytes:Uint8Array,start:number,value:string)=>start>=0&&start+value.length<=bytes.length&&Array.from(value).every((c,i)=>bytes[start+i]===c.charCodeAt(0));
const dimensions=(camera:Record<string,string>,width:number,height:number)=>{
  if(Number.isInteger(width)&&Number.isInteger(height)&&width>0&&height>0&&width*height<=52_000_000)camera.resolution=width+' × '+height+' px';
};
function tiff(bytes:Uint8Array,base:number,end:number):Record<string,string>{
  const camera:Record<string,string>={},view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const inside=(offset:number,size:number)=>Number.isSafeInteger(offset)&&Number.isSafeInteger(size)&&offset>=base&&size>=0&&offset+size<=end;
  if(!inside(base,8))return camera;
  const little=signature(bytes,base,'II');if(!little&&!signature(bytes,base,'MM'))return camera;
  const u16=(offset:number)=>view.getUint16(offset,little),u32=(offset:number)=>view.getUint32(offset,little);
  if(u16(base+2)!==42)return camera;
  const values=new Map<number,string|number>();
  const sizes:Record<number,number>={1:1,2:1,3:2,4:4,5:8,7:1,9:4,10:8};
  const allowed=new Set([256,257,271,272,34665,33434,33437,34855,34867,37380,37383,37385,37386,40962,40963,41987,42036]);
  function ifd(relative:number){
    const offset=base+relative;if(relative<8||!inside(offset,2))return;
    const entries=u16(offset);if(entries>256||!inside(offset+2,entries*12+4))return;
    for(let i=0;i<entries;i++){
      const p=offset+2+i*12,tag=u16(p);if(!allowed.has(tag))continue;
      const type=u16(p+2),count=u32(p+4),size=sizes[type];
      if(!size||!count||count>256)continue;
      const length=size*count,start=length<=4?p+8:base+u32(p+8);if(!inside(start,length))continue;
      let value:string|number|undefined;
      if(type===2)value=text(bytes,start,count);
      else if(type===3)value=u16(start);
      else if(type===4)value=u32(start);
      else if(type===9)value=view.getInt32(start,little);
      else if(type===5||type===10){const denominator=type===10?view.getInt32(start+4,little):u32(start+4);if(denominator)value=(type===10?view.getInt32(start,little):u32(start))/denominator;}
      if(typeof value==='string'||typeof value==='number'&&Number.isFinite(value))values.set(tag,value);
    }
  }
  ifd(u32(base+4));const nested=values.get(34665);if(typeof nested==='number')ifd(nested);
  for(const field of [[271,'make'],[272,'model'],[42036,'lens']] as const){const value=values.get(field[0]);if(typeof value==='string'&&value)camera[field[1]]=value;}
  for(const field of [[33434,'exposure'],[33437,'aperture'],[37386,'focal']] as const){const value=values.get(field[0]);if(typeof value==='number'&&value>0)camera[field[1]]=String(value);}
  const sensitivity=values.get(34855),iso=sensitivity===65535||sensitivity===undefined?values.get(34867):sensitivity;
  if(typeof iso==='number'&&Number.isInteger(iso)&&iso>0)camera.iso=String(iso);
  const bias=values.get(37380);if(typeof bias==='number')camera.exposureBias=(bias>=0?'+':'')+Number(bias.toFixed(2))+' EV';
  const balance=values.get(41987);if(balance===0||balance===1)camera.whiteBalance=balance===0?'AWB':'手动';
  const metering=values.get(37383),meters:Record<number,string>={1:'平均测光',2:'中央重点',3:'点测光',4:'多点',5:'评价测光',6:'局部测光'};
  if(typeof metering==='number'&&meters[metering])camera.metering=meters[metering];
  const flash=values.get(37385);if(typeof flash==='number'&&Number.isInteger(flash)&&flash>=0&&flash<=65535)camera.flash=flash&1?'已闪光':'未闪光';
  const width=values.get(40962)||values.get(256),height=values.get(40963)||values.get(257);
  if(typeof width==='number'&&typeof height==='number')dimensions(camera,width,height);
  return camera;
}

/** Recognize JPEG APP1, PNG eXIf, WebP EXIF and classic TIFF; corrupt inputs stay unknown. */
export function parsePhotoMetadata(data:ArrayBuffer):LocalPhotoMetadata {
  const bytes=new Uint8Array(data),view=new DataView(data),camera:Record<string,string>={};let format:LocalPhotoMetadata['format']='unknown',hasExif=false;
  const exif=(start:number,end:number)=>{const offset=signature(bytes,start,'Exif\0\0')?start+6:start;const fields=tiff(bytes,offset,end);if(Object.keys(fields).length){hasExif=true;Object.assign(camera,fields);}};
  try{
    if(bytes[0]===0xff&&bytes[1]===0xd8){
      format='jpeg';let p=2;
      for(let step=0;step<512&&p+4<=bytes.length;step++){
        if(bytes[p++]!==0xff)break;while(bytes[p]===0xff)p++;
        const marker=bytes[p++];if(marker===0xda||marker===0xd9)break;
        if(marker===0x01||marker>=0xd0&&marker<=0xd8)continue;
        if(p+2>bytes.length)break;const length=view.getUint16(p);if(length<2||p+length>bytes.length)break;
        if(marker===0xe1&&signature(bytes,p+2,'Exif\0\0'))exif(p+2,p+length);
        if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)&&length>=8)dimensions(camera,view.getUint16(p+5),view.getUint16(p+3));
        p+=length;
      }
    }else if(signature(bytes,0,'\x89PNG\r\n\x1a\n')){
      format='png';let p=8;
      for(let step=0;step<128&&p+12<=bytes.length;step++){
        const length=view.getUint32(p),end=p+8+length;if(end+4>bytes.length)break;
        if(signature(bytes,p+4,'IHDR')&&length===13)dimensions(camera,view.getUint32(p+8),view.getUint32(p+12));
        if(signature(bytes,p+4,'eXIf'))exif(p+8,end);
        if(signature(bytes,p+4,'IEND'))break;p=end+4;
      }
    }else if(signature(bytes,0,'RIFF')&&signature(bytes,8,'WEBP')){
      format='webp';let p=12;
      for(let step=0;step<128&&p+8<=bytes.length;step++){
        const length=view.getUint32(p+4,true),end=p+8+length;if(end>bytes.length)break;
        if(signature(bytes,p,'EXIF'))exif(p+8,end);
        if(signature(bytes,p,'VP8X')&&length>=10){const n=(o:number)=>1+bytes[o]+bytes[o+1]*256+bytes[o+2]*65536;dimensions(camera,n(p+12),n(p+15));}
        if(signature(bytes,p,'VP8 ')&&length>=10&&signature(bytes,p+11,'\x9d\x01\x2a'))dimensions(camera,view.getUint16(p+14,true)&0x3fff,view.getUint16(p+16,true)&0x3fff);
        if(signature(bytes,p,'VP8L')&&length>=5&&bytes[p+8]===0x2f){const bits=view.getUint32(p+9,true);dimensions(camera,1+(bits&0x3fff),1+(bits>>>14&0x3fff));}
        p=end+(length&1);
      }
    }else if(signature(bytes,0,'II')||signature(bytes,0,'MM')){format='tiff';exif(0,bytes.length);}
  }catch{/* Metadata must never prevent importing or preserving the photo. */}
  return {state:Object.keys(camera).length?'ready':format==='unknown'?'unsupported':'missing',format,camera,hasExif};
}

export function cleanLocalMetadata(value:any):LocalPhotoMetadata|undefined {
  if(!value||!['ready','missing','unsupported','unavailable'].includes(value.state))return;
  const camera:Record<string,string>={};
  for(const key of ['make','model','lens','iso','exposure','aperture','focal','resolution','whiteBalance','exposureBias','metering','flash'])if(typeof value.camera?.[key]==='string')camera[key]=value.camera[key].slice(0,100);
  return {state:value.state,format:['jpeg','png','webp','tiff'].includes(value.format)?value.format:'unknown',camera,hasExif:value.hasExif===true};
}

export async function readLocalPhotoMetadata(path:string):Promise<LocalPhotoMetadata> {
  const unavailable:LocalPhotoMetadata={state:'unavailable',format:'unknown',camera:{},hasExif:false};
  try{
    const fs=wx.getFileSystemManager();
    const size=await new Promise<number>((resolve,reject)=>fs.getFileInfo({filePath:path,success:result=>resolve(result.size),fail:reject}));
    if(!Number.isSafeInteger(size)||size<=0)return unavailable;
    const data=await new Promise<ArrayBuffer>((resolve,reject)=>fs.readFile({filePath:path,position:0,length:Math.min(size,PHOTO_HEADER_LIMIT),
      success:result=>typeof result.data==='string'?reject(new Error('binary metadata required')):resolve(result.data),fail:reject}));
    return parsePhotoMetadata(data);
  }catch{return unavailable;}
}
