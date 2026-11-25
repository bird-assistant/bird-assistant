export const PHOTO_FIELDS=[
  {key:'device',label:'相机 / 机身',placeholder:'Sony α7 IV / Nikon Z8'},
  {key:'lens',label:'镜头',placeholder:'FE 200–600mm'},
  {key:'resolution',label:'原图尺寸',placeholder:'6000 × 4000 px'},
  {key:'iso',label:'ISO',placeholder:'800'},
  {key:'exposure',label:'快门',placeholder:'1/2000 s'},
  {key:'aperture',label:'光圈',placeholder:'f/6.3'},
  {key:'focal',label:'焦距',placeholder:'600 mm'},
  {key:'focusMode',label:'对焦模式',placeholder:'AF-C / AF-A'},
  {key:'whiteBalance',label:'白平衡',placeholder:'AWB / 5500 K'},
  {key:'exposureBias',label:'曝光补偿',placeholder:'+0.3 EV'},
  {key:'metering',label:'测光',placeholder:'点测光 / 评价测光'},
  {key:'lighting',label:'光线',placeholder:'阴天 / 逆光'},
  {key:'flash',label:'闪光',placeholder:'未闪光'}
];
export type PhotoDetails=Record<string,string>;
const marker='\n\n── 摄影参数（作者填写） ──\n';
const embeddedMarker='\n\n── 摄影参数（照片文件） ──\n';
export function cleanPhotoDetails(raw:unknown):PhotoDetails{
  const value=raw&&typeof raw==='object'?raw as Record<string,unknown>:{},result:PhotoDetails={};
  for(const field of PHOTO_FIELDS){const text=value[field.key];if(typeof text==='string'&&text.trim())result[field.key]=text.replace(/[\r\n]/g,' ').trim().slice(0,80);}
  return result;
}
/** Human-readable caption keeps author-entered settings compatible with existing servers. */
function append(body:string,raw:unknown,heading:string){
  const camera=cleanPhotoDetails(raw),lines=PHOTO_FIELDS.filter(field=>camera[field.key]).map(field=>field.label+'：'+camera[field.key]);
  const result=body+(lines.length?heading+lines.join('\n'):'');
  if(result.length>2000)throw new Error('正文与摄影参数合计超过 2000 字，请精简后重试；草稿仍保留。');
  return result;
}
export function withPhotoDetails(body:string,raw:unknown){return append(body,raw,marker);}
export function withEmbeddedPhotoDetails(body:string,raw:Record<string,string>){const device=raw.device||[raw.make,raw.model].filter(Boolean).join(' ');return append(body,{...raw,device},embeddedMarker);}
function read(raw:unknown,heading:string):{body:string;camera:PhotoDetails}{
  const body=typeof raw==='string'?raw:'',at=body.lastIndexOf(heading);if(at<0)return {body,camera:{}};
  const camera:PhotoDetails={};
  for(const line of body.slice(at+heading.length).split('\n')){
    const field=PHOTO_FIELDS.find(item=>line.startsWith(item.label+'：'));if(!field||camera[field.key])return {body,camera:{}};
    const value=line.slice(field.label.length+1);if(!value||value.length>80)return {body,camera:{}};camera[field.key]=value;
  }
  return {body:body.slice(0,at),camera};
}
export function readPhotoDetails(raw:unknown){return read(raw,marker);}
export function readEmbeddedPhotoDetails(raw:unknown){return read(raw,embeddedMarker);}
