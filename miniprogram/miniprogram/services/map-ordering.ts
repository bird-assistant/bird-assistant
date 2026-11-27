type Point={latitude:number;longitude:number};
/** Distance to the displayed public region, never an inferred private capture point. */
export function displayedDistance(point:Point|null,location:Point|undefined){
  if(!point||!location||![point.latitude,point.longitude,location.latitude,location.longitude].every(Number.isFinite))return undefined;
  const rad=Math.PI/180,a=point.latitude*rad,b=location.latitude*rad,dlat=b-a,dlon=(location.longitude-point.longitude)*rad;
  return Math.round(6371*2*Math.asin(Math.min(1,Math.sqrt(Math.sin(dlat/2)**2+Math.cos(a)*Math.cos(b)*Math.sin(dlon/2)**2)))*10)/10;
}
