export const MAP_RIPPLE_MS=9000;
export type MapRipple={latitude:number;longitude:number;started:number;color:string};
/** Native geographic circles stay attached while the map pans or zooms. */
export function mapRippleCircles(point:MapRipple,now:number,zoom:number){
  const elapsed=now-point.started;if(elapsed<0||elapsed>=MAP_RIPPLE_MS)return [];
  const metres=40075016.686*Math.cos(point.latitude*Math.PI/180)/(256*2**Math.max(3,Math.min(20,zoom)));
  const rings=[0,850].map(delay=>{const phase=((elapsed+delay)%1700)/1700,alpha=Math.round((1-phase)*140).toString(16).padStart(2,'0');return {latitude:point.latitude,longitude:point.longitude,radius:(5+phase*37)*metres,color:point.color+alpha,fillColor:point.color+'00',strokeWidth:2};});
  return [{latitude:point.latitude,longitude:point.longitude,radius:4*metres,color:'#fffef9e6',fillColor:point.color+'e6',strokeWidth:2},...rings];
}
export function mapDateRange(period:number,today:string){
  const days=[0,7,30,90,365][period]||0;
  return {startDate:days?new Date(Date.parse(today+'T00:00:00Z')-(days-1)*86400000).toISOString().slice(0,10):'',endDate:days?today:''};
}
