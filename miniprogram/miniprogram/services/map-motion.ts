import { clamp } from './map-model';

export const MAP_FLIGHT_MS=500;
// x(t)=t, y(t)=1-(1-t)^3; matches the CSS curve for smooth interruption.
export interface MapView { x:number;y:number;zoom:number; }
export function flightFrame(from:MapView,to:MapView,elapsed:number):MapView {
  const t=clamp(elapsed/MAP_FLIGHT_MS,0,1),p=1-Math.pow(1-t,3);
  return {x:from.x+(to.x-from.x)*p,y:from.y+(to.y-from.y)*p,zoom:from.zoom+(to.zoom-from.zoom)*p};
}

/** Place the selected point between the search/filter controls and open sheet. */
export function placeAnchor(pageHeight:number,sheetHeight:number) {
  const bottom=Math.max(0,pageHeight-sheetHeight),top=Math.min(120,bottom*.4);
  return (top+bottom)/2;
}
