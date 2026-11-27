/** Approximate names from the existing curated trip-park regions, never administrative containment. */
const regions=[{label:'北京一带',lat:40.0,lon:116.3,radius:70},{label:'上海一带',lat:31.2,lon:121.5,radius:60},{label:'浙江 · 杭州一带',lat:30.27,lon:120.06,radius:50},{label:'广东深圳 / 香港北部一带',lat:22.5,lon:114.0,radius:45},{label:'湖北 · 武汉一带',lat:30.56,lon:114.4,radius:55}];
export function approximateRegion(point:{latitude:number;longitude:number}|null){
  if(!point)return '';let nearest='',distance=Infinity;
  for(const row of regions){const y=(point.latitude-row.lat)*111,x=(point.longitude-row.lon)*111*Math.cos(point.latitude*Math.PI/180),km=Math.hypot(x,y);if(km<row.radius&&km<distance){distance=km;nearest=row.label;}}
  return nearest;
}
