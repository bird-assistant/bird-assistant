export const MAP_RIPPLE_MS=9000;
export type MapRipple={latitude:number;longitude:number;started:number;color:string};
/** Native geographic circles stay attached while the map pans or zooms. */
export function mapRippleCircles(point:MapRipple,now:number,zoom:number){
  const elapsed=now-point.started;if(elapsed<0||elapsed>=MAP_RIPPLE_MS)return [];
  const metres=40075016.686*Math.cos(point.latitude*Math.PI/180)/(256*2**Math.max(3,Math.min(20,zoom)));
  const green=/^#[0-9a-f]{6}$/i.test(point.color)?point.color:'#285b49';
  const fade=(phase:number)=>{const wash=phase*phase*.94;return '#'+[0,1,2].map(i=>Math.round(parseInt(green.slice(1+i*2,3+i*2),16)*(1-wash)+[250,251,245][i]*wash).toString(16).padStart(2,'0')).join('');};
  const rings=[0,850].map(delay=>{const phase=((elapsed+delay)%1700)/1700;return {latitude:point.latitude,longitude:point.longitude,radius:(5+phase*37)*metres,color:fade(phase),fillColor:green+'00',strokeWidth:Math.max(.2,3*(1-phase))};});
  return [{latitude:point.latitude,longitude:point.longitude,radius:4*metres,color:green,fillColor:green,strokeWidth:1},...rings];
}
export function mapDateRange(period:number,today:string){
  const days=[0,7,30,90,365][period]||0;
  return {startDate:days?new Date(Date.parse(today+'T00:00:00Z')-(days-1)*86400000).toISOString().slice(0,10):'',endDate:days?today:''};
}
