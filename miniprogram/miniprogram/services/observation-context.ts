export interface ContextInput {observedDate:string;observedTime:string;placeName:string;}
export interface ObservationContext {
  observedAt:string|null;
  observedDate:string|null;
  timePrecision:'unknown'|'date'|'minute';
  timeSource:'unknown'|'manual';
  placeName:string;
  placeSource:'unknown'|'manual';
}

const BEIJING_OFFSET_MS=8*60*60*1000;
export function beijingDate(instant=new Date().toISOString()):string {
  const ms=Date.parse(instant);if(!Number.isFinite(ms))throw new Error('系统时间无法读取，请稍后重试。');
  return new Date(ms+BEIJING_OFFSET_MS).toISOString().slice(0,10);
}
export function beijingDateTime(instant:string):string {
  const ms=Date.parse(instant);if(!Number.isFinite(ms))return '未知';
  return new Date(ms+BEIJING_OFFSET_MS).toISOString().slice(0,16).replace('T',' ')+'（北京时间）';
}

/** No inferred EXIF/GPS/weather. A date alone never becomes an exact midnight timestamp. */
export function observationContext(input:ContextInput,now?:string):ObservationContext {
  const date=input.observedDate.trim(),time=input.observedTime.trim(),place=input.placeName.trim();
  if(date){
    const ms=Date.parse(date+'T00:00:00Z');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(ms)||new Date(ms).toISOString().slice(0,10)!==date)throw new Error('请选择有效的观察日期。');
  }
  if(time&&(!date||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)))throw new Error('请先选观察日期，再选择有效时刻。');
  if(place.length>80)throw new Error('观察地点最多填写 80 个字符。');
  const observedAt=date&&time?date+'T'+time+':00+08:00':null;
  if(now){
    if((date&&date>beijingDate(now))||(observedAt&&Date.parse(observedAt)>Date.parse(now)))throw new Error('观察时间不能晚于现在；也可以保留未知。');
  }
  return {observedAt,observedDate:date||null,timePrecision:time?'minute':date?'date':'unknown',timeSource:date?'manual':'unknown',placeName:place,placeSource:place?'manual':'unknown'};
}

/** Read legacy records without migration/writes; reject inconsistent new context without overwriting it. */
export function validStoredContext(record:Record<string,unknown>):boolean {
  const keys=['observedDate','timePrecision','timeSource','placeName','placeSource'];
  if(keys.every(key=>record[key]===undefined))return record.observedAt===null;
  if((record.observedDate!==null&&typeof record.observedDate!=='string')||typeof record.placeName!=='string')return false;
  if(record.observedAt!==null&&typeof record.observedAt!=='string')return false;
  const time=typeof record.observedAt==='string'?record.observedAt.slice(11,16):'';
  try{
    const expected=observationContext({observedDate:record.observedDate||'',observedTime:time,placeName:record.placeName});
    return Object.keys(expected).every(key=>record[key]===expected[key as keyof ObservationContext]);
  }catch{return false;}
}
export function observationTimeLabel(record:Partial<ObservationContext>):string {
  if(record.timePrecision==='minute'&&record.observedAt)return record.observedAt.slice(0,16).replace('T',' ')+'（北京时间）';
  if(record.timePrecision==='date'&&record.observedDate)return record.observedDate+'（时刻未知）';
  return '未知';
}
