const key='bird-assistant.map-view.v1';
export type MapView={latitude:number;longitude:number;scale:number};
function valid(value:unknown):value is MapView{
  if(!value||typeof value!=='object')return false;
  const v=value as MapView;
  return [v.latitude,v.longitude,v.scale].every(n=>typeof n==='number'&&Number.isFinite(n))&&Math.abs(v.latitude)<=90&&Math.abs(v.longitude)<=180&&v.scale>=3&&v.scale<=20;
}
export function readMapView():MapView|null{
  try{const stored=wx.getStorageSync?.(key);return stored?.version===1&&valid(stored)?{latitude:stored.latitude,longitude:stored.longitude,scale:stored.scale}:null;}catch{return null;}
}
/** Only the last settled viewport is local; observations and location permissions are not cached here. */
export function saveMapView(view:MapView){if(!valid(view))return;try{wx.setStorageSync?.(key,{version:1,...view});}catch{/* A full cache must not stop the map. */}}
