const DAY=86400000;
export function calendarDate(value:string){const stamp=Date.parse(value+'T00:00:00Z');return /^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(stamp)&&new Date(stamp).toISOString().slice(0,10)===value;}
export function calendarMonth(value:string,delta=0){
  const date=new Date(value.slice(0,7)+'-01T00:00:00Z');date.setUTCMonth(date.getUTCMonth()+delta);return date.toISOString().slice(0,7)+'-01';
}
export function orderedDates(first:string,last:string){return first<=last?{from:first,to:last}:{from:last,to:first};}
export function calendarCells(month:string,from='',to='',min='',max=''){
  const date=new Date(month.slice(0,7)+'-01T00:00:00Z'),first=date.getTime(),offset=(date.getUTCDay()+6)%7;
  return Array.from({length:42},(_,index)=>{
    const stamp=new Date(first+(index-offset)*DAY),value=stamp.toISOString().slice(0,10),current=value.slice(0,7)===month.slice(0,7);
    return {value,day:stamp.getUTCDate(),current,disabled:!current||!!min&&value<min||!!max&&value>max,start:value===from,end:value===to,within:!!from&&!!to&&value>from&&value<to};
  });
}
