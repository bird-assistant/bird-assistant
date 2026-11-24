export interface PhotoMetadata { date?:string; time?:string; latitude?:number; longitude?:number; }

export function jpegMetadata(buffer:ArrayBuffer):PhotoMetadata {
  const data=new DataView(buffer);
  try {
    if(data.getUint16(0)!==0xffd8) return {};
    for(let offset=2;offset+10<data.byteLength;){
      const tag=data.getUint16(offset),length=data.getUint16(offset+2);
      if(length<2||tag===0xffda||offset+length+2>data.byteLength)break;
      if(tag===0xffe1 && data.getUint32(offset+4)===0x45786966 && data.getUint16(offset+8)===0){
        const base=offset+10;
        const tiff=new DataView(buffer,base,offset+length+2-base),little=tiff.getUint16(0)===0x4949;
        const short=(address:number)=>tiff.getUint16(address,little);
        const integer=(address:number)=>tiff.getUint32(address,little);
        if(short(2)!==42)return {};
        function field(directory:number,tagId:number,type:number,count:number){
          if(!directory)return 0;
          const entries=Math.min(short(directory),512);
          for(let index=0;index<entries;index++){
            const entry=directory+2+12*index;
            if(short(entry)===tagId && short(entry+2)===type && integer(entry+4)===count){
              return type===2 && count<=4 || type===4 && count===1?entry+8:integer(entry+8);
            }
          }
          return 0;
        }
        const result:PhotoMetadata={},root=integer(4);
        const exif=field(root,0x8769,4,1),gps=field(root,0x8825,4,1);
        const date=exif?field(integer(exif),0x9003,2,20):0;
        if(date){
          const stamp=String.fromCharCode(...new Uint8Array(buffer,base+date,19));
          const parts=/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):\d{2}$/.exec(stamp);
          if(parts){result.date=parts[1]+'-'+parts[2]+'-'+parts[3];result.time=parts[4]+':'+parts[5];}
        }
        if(gps){
          const coordinate=(tagId:number,refs:string)=>{
            const directory=integer(gps),reference=field(directory,tagId,2,2),value=field(directory,tagId+1,5,3);
            if(!reference||!value)return NaN;
            const sign=refs.indexOf(String.fromCharCode(tiff.getUint8(reference)));
            if(sign<0)return NaN;
            const rational=(address:number)=>integer(address)/integer(address+4);
            return (sign===0?1:-1)*(rational(value)+rational(value+8)/60+rational(value+16)/3600);
          };
          const latitude=coordinate(1,'NS'),longitude=coordinate(3,'EW');
          if(Math.abs(latitude)<=90 && Math.abs(longitude)<=180){result.latitude=latitude;result.longitude=longitude;}
        }
        return result;
      }
      offset+=length+2;
    }
  }catch{return {};}
  return {};
}

export async function readPhotoMetadata(path:string):Promise<PhotoMetadata> {
  const files=wx.getFileSystemManager();
  const length=await new Promise<number>((resolve,reject)=>files.getFileInfo({filePath:path,success:res=>resolve(Math.min(res.size,256*1024)),fail:reject}));
  return new Promise((resolve,reject)=>files.readFile({filePath:path,position:0,length,success:res=>resolve(typeof res.data==='string'?{}:jpegMetadata(res.data)),fail:reject}));
}

export function historicalFields(date:string,time:string,latitude:string,longitude:string):Record<string,string> {
  const fields:Record<string,string>={observation_mode:'historical',capture_time_precision:time&&date?'exact':date?'date':'unknown',
    captured_at:date?date+'T'+(time||'12:00')+':00+08:00':'1970-01-01T00:00:00Z'};
  if(latitude.trim()||longitude.trim()){
    const valid=(value:string,limit:number)=>/^[+-]?(\d+(\.\d+)?|\.\d+)$/.test(value.trim())&&Math.abs(Number(value))<=limit;
    if(!valid(latitude,90)||!valid(longitude,180))throw new Error('请同时填写有效的纬度和经度，或清空两项。');
    fields.latitude=String(Number(latitude));fields.longitude=String(Number(longitude));
  }
  return fields;
}
