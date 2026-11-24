type CameraInfo={title:string;subtitle:string;settings:Array<{key:string;label:string;value:string}>};
const clean=(value:unknown)=>typeof value==='string'?value.trim():'';
const number=(value:string)=>/^\d+(?:\.\d+)?(?:e[-+]?\d+)?$/i.test(value)&&Number(value)>0?Number(value):null;
const decimal=(value:number)=>String(Math.round(value*100)/100);

/** Presentation of the server's already-redacted camera fields; never infer EXIF. */
export function photoInfo(raw:unknown):CameraInfo|null{
  if(!raw||typeof raw!=='object')return null;
  const camera=raw as Record<string,unknown>,device=clean(camera.device).replace(/\s*<[^>]*>\s*$/,'').trim();
  const make=clean(camera.make),model=clean(camera.model),modelName=model.toLowerCase().startsWith(make.toLowerCase())?model:[make,model].filter(Boolean).join(' ');
  const settings:CameraInfo['settings']=[];
  for(const field of [['focal','焦距'],['aperture','光圈'],['exposure','快门'],['iso','ISO']]){
    const key=field[0],label=field[1];
    const text=clean(camera[key]);if(!text)continue;
    const numeric=number(text);let value=text;
    if(numeric!==null){
      if(key==='focal')value=decimal(numeric)+' mm';
      else if(key==='aperture')value='f/'+decimal(numeric);
      else if(key==='exposure'){
        const reciprocal=Math.round(1/numeric);
        value=numeric<1&&Math.abs(reciprocal*numeric-1)<.02?'1/'+reciprocal+' s':decimal(numeric)+' s';
      }else value=decimal(numeric);
    }else if(key==='exposure'&&/^\d+\s*\/\s*\d+$/.test(text))value=text+' s';
    settings.push({key,label,value});
  }
  if(!device&&!modelName&&!settings.length)return null;
  return {title:device||modelName||'拍摄参数',subtitle:device&&modelName&&device.toLowerCase()!==modelName.toLowerCase()?modelName:'',settings};
}
