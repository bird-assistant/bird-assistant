import { clamp } from './map-model';

export interface CropPhoto { w:number;h:number;iw:number;ih:number;zoom:number;cropX:number;cropY:number; }

/** One cover calculation for the canvas, crop preview and exported pixels. */
export function photoCrop(photo:CropPhoto,scale=1) {
  const iw=Math.max(1,photo.iw),ih=Math.max(1,photo.ih);
  const k=Math.max(photo.w/iw,photo.h/ih)*clamp(photo.zoom,1,3);
  const sourceW=photo.w/k,sourceH=photo.h/k;
  const sourceX=(iw-sourceW)*clamp(photo.cropX,0,100)/100;
  const sourceY=(ih-sourceH)*clamp(photo.cropY,0,100)/100;
  return {imageW:iw*k*scale,imageH:ih*k*scale,imageX:-sourceX*k*scale||0,imageY:-sourceY*k*scale||0,sourceX,sourceY,sourceW,sourceH,canPanX:iw-sourceW>.01,canPanY:ih-sourceH>.01};
}

/** Keep every corner of the crop frame inside an arbitrarily rotated image. */
export function avatarCrop(width:number,height:number,zoom:number,rotation:number,x:number,y:number,size=220) {
  const angle=rotation*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),extent=size*(Math.abs(c)+Math.abs(s));
  const k=Math.max(extent/Math.max(1,width),extent/Math.max(1,height))*clamp(zoom,1,3);
  const maxU=Math.max(0,(width*k-extent)/2),maxV=Math.max(0,(height*k-extent)/2);
  const u=clamp(c*x+s*y,-maxU,maxU),v=clamp(-s*x+c*y,-maxV,maxV);
  return {cropDisplayW:width*k,cropDisplayH:height*k,cropX:c*u-s*v,cropY:s*u+c*v};
}
