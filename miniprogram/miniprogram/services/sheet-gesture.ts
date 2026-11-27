type Touch=WechatMiniprogram.TouchEvent;
type Host={setData:(values:Record<string,unknown>)=>void};
type Drag={x:number;y:number;dx:number;dy:number;started:number;close:string};
const gestures=new WeakMap<object,Drag>();
/** Drag only the header: scrolling content and date-range gestures keep their own touch ownership. */
export function beginSheetDrag(host:Host,event:Touch){
  resetSheetDrag(host);const touch=event.touches[0],close=String(event.currentTarget.dataset.dismiss||'');
  if(event.touches.length!==1||!touch||typeof (host as unknown as Record<string,unknown>)[close]!=='function')return;
  gestures.set(host,{x:touch.clientX,y:touch.clientY,dx:0,dy:0,started:Date.now(),close});
}
export function moveSheetDrag(host:Host,event:Touch){
  const drag=gestures.get(host),touch=event.touches[0];if(!drag)return;
  if(event.touches.length!==1||!touch){resetSheetDrag(host);return;}
  drag.dx=touch.clientX-drag.x;drag.dy=Math.max(0,touch.clientY-drag.y);
  if(Math.abs(drag.dx)>28&&Math.abs(drag.dx)>drag.dy){resetSheetDrag(host);return;}
  host.setData({sheetDragStyle:'transform:translateY('+Math.min(280,drag.dy)+'px);transition:none;'});
}
export function endSheetDrag(host:Host){
  const drag=gestures.get(host);resetSheetDrag(host);if(!drag)return;
  const speed=drag.dy/Math.max(1,Date.now()-drag.started);
  if(drag.dy>=72||drag.dy>=28&&speed>.65)((host as unknown as Record<string,unknown>)[drag.close] as ()=>void).call(host);
}
export function resetSheetDrag(host:Host){gestures.delete(host);host.setData({sheetDragStyle:''});}
