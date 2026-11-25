export type Cluster={latitude:number;longitude:number;count:number;minLatitude:number;maxLatitude:number;minLongitude:number;maxLongitude:number};
const clampLatitude=(latitude:number)=>Math.max(-85.051129,Math.min(85.051129,latitude));
export function mapPixel(point:{latitude:number;longitude:number},zoom:number){
  const world=256*2**zoom,sine=Math.sin(clampLatitude(point.latitude)*Math.PI/180);
  return {x:(point.longitude+180)/360*world,y:(.5-Math.log((1+sine)/(1-sine))/(4*Math.PI))*world};
}
function fromPixel(x:number,y:number,zoom:number){const world=256*2**zoom;return {longitude:x/world*360-180,latitude:Math.atan(Math.sinh(Math.PI*(1-2*y/world)))*180/Math.PI};}

/** Recompute from server cells, never from a previously merged display group. */
export function spacedClusters(cells:Cluster[],zoom:number,gap=44):Cluster[]{
  type Group=Cluster & {x:number;y:number};
  const world=256*2**zoom,columns=Math.max(1,Math.ceil(world/gap)),buckets=new Map<string,Set<Group>>();
  const bucket=(row:Group)=>Math.floor(row.x/gap)+','+Math.floor(row.y/gap);
  const remove=(row:Group)=>{const key=bucket(row),items=buckets.get(key);items?.delete(row);if(!items?.size)buckets.delete(key);};
  const sorted=cells.filter(row=>row.count>0&&Number.isFinite(row.latitude)&&Number.isFinite(row.longitude)).map(row=>({...row,...mapPixel(row,zoom)})).sort((a,b)=>a.x-b.x||a.y-b.y);
  for(const cell of sorted){
    let row=cell;
    for(;;){
      let nearest:Group|undefined,distance=gap*gap;const column=Math.floor(row.x/gap),line=Math.floor(row.y/gap);
      for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const other of buckets.get(((column+dx+columns)%columns)+','+(line+dy))||[]){
        const x=Math.abs(row.x-other.x),wrapped=Math.min(x,world-x),y=row.y-other.y,d=wrapped*wrapped+y*y;
        if(d<distance){nearest=other;distance=d;}
      }
      if(!nearest)break;
      remove(nearest);const count=row.count+nearest.count;let bx=nearest.x;
      if(bx-row.x>world/2)bx-=world;else if(row.x-bx>world/2)bx+=world;
      const x=((row.x*row.count+bx*nearest.count)/count+world)%world,y=(row.y*row.count+nearest.y*nearest.count)/count;
      const center=fromPixel(x,y,zoom),around=(value:number)=>center.longitude+((value-center.longitude+540)%360)-180,ends=[row.minLongitude,row.maxLongitude,nearest.minLongitude,nearest.maxLongitude].sort((a,b)=>around(a)-around(b));
      row={...center,x,y,count,minLatitude:Math.min(row.minLatitude,nearest.minLatitude),maxLatitude:Math.max(row.maxLatitude,nearest.maxLatitude),minLongitude:ends[0],maxLongitude:ends[ends.length-1]};
    }
    const key=bucket(row),items=buckets.get(key)||new Set<Group>();items.add(row);buckets.set(key,items);
  }
  const result:Group[]=[];for(const items of buckets.values())for(const row of items)result.push(row);
  return result.map(row=>({latitude:row.latitude,longitude:row.longitude,count:row.count,minLatitude:row.minLatitude,maxLatitude:row.maxLatitude,minLongitude:row.minLongitude,maxLongitude:row.maxLongitude}));
}
