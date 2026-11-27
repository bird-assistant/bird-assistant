import { clamp } from './map-model';

export const ZOOM_OCTAVE_PX=144;
export const DEMO_MAX_ZOOM=5;

/** CameraContext accepts tenths; never round the reported ceiling upwards. */
export function cameraZoomMax(raw:unknown) {
  const value=Number(raw);
  return Number.isFinite(value)&&value<=Number.MAX_SAFE_INTEGER/10?Math.max(1,Math.floor((value+1e-8)*10)/10):1;
}
export function cameraZoom(value:number,max:number) {
  return Number.isFinite(value)?clamp(Math.round(value*10)/10,1,cameraZoomMax(max)):1;
}
export function zoomFromDrag(start:number,deltaX:number,max:number) {
  const limit=cameraZoomMax(max),power=clamp(Math.log2(cameraZoom(start,limit))-deltaX/ZOOM_OCTAVE_PX,0,Math.log2(limit));
  return cameraZoom(Math.pow(2,power),limit);
}
export function cameraZoomProfile(device:{brand?:string;model?:string}|undefined){
  // A shortcut preference, never a claim that CameraContext selects a lens.
  const name=((device?.brand||'')+' '+(device?.model||'')).replace(/[\s_-]/g,'').toLowerCase();
  return /pura70pro(?:\+|plus)/.test(name)?'pura70proplus':'default';
}
export function zoomShortcuts(max:number,profile='default') {
  // Unknown device names still offer 3.5×, without guessing their lens layout.
  const presets=profile==='pura70proplus'?[1,2,3.5,5,10]:[1,2,3,3.5,5,10];
  const limit=cameraZoomMax(max),values=presets.filter(value=>value<=limit);
  // Give small ranges (for example 1–1.8) a reachable upper endpoint too.
  if(values.length===1&&limit>1)values.push(limit);
  return values.map(value=>({value,label:String(value)+'×'}));
}
export function zoomTicks(value:number,max:number,width:number) {
  const limit=cameraZoomMax(max),ticks:Array<{id:string;offset:number;major:boolean;label:string}>=[];
  const seen=new Set<string>(),half=Math.max(0,width)/2+12;
  const add=(raw:number,major:boolean)=>{
    const z=cameraZoom(raw,limit),id=z.toFixed(1);
    if(raw<1||raw>limit)return;
    if(seen.has(id)){const existing=ticks.find(t=>t.id===id);if(existing&&major){existing.major=true;existing.label=String(z);}return;}seen.add(id);
    const offset=Math.log2(z/value)*ZOOM_OCTAVE_PX;
    if(Math.abs(offset)<=half)ticks.push({id,offset:Math.round(offset*100)/100,major,label:major?String(z):''});
  };
  // Equal ratios have equal travel: detailed at 1×, practical even at 100×.
  for(let base=1;base<=limit;base*=10){
    for(let tenth=10;tenth<100;tenth+=tenth<20?1:tenth<50?2:5){
      const mantissa=tenth/10;add(mantissa*base,[1,2,3,5].includes(mantissa));
    }
  }
  add(3.5,true);add(limit,true);return ticks.sort((a,b)=>a.offset-b.offset);
}
