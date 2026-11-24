import { clamp } from './map-model';

export interface CropPhoto { w:number;h:number;iw:number;ih:number;zoom:number;cropX:number;cropY:number;photoFit?:'cover'|'stretch'; }

/** One source rectangle for preview/export; stretch maps its axes independently. */
export function photoCrop(photo:CropPhoto,scale=1) {
  const iw=Math.max(1,photo.iw),ih=Math.max(1,photo.ih);
  const zoom=clamp(photo.zoom,1,3),stretch=photo.photoFit==='stretch';
  const k=Math.max(photo.w/iw,photo.h/ih)*zoom;
  const sourceW=stretch?iw/zoom:photo.w/k,sourceH=stretch?ih/zoom:photo.h/k;
  const sourceX=(iw-sourceW)*clamp(photo.cropX,0,100)/100;
  const sourceY=(ih-sourceH)*clamp(photo.cropY,0,100)/100;
  const kx=photo.w/sourceW,ky=photo.h/sourceH;
  return {imageW:iw*kx*scale,imageH:ih*ky*scale,imageX:-sourceX*kx*scale||0,imageY:-sourceY*ky*scale||0,sourceX,sourceY,sourceW,sourceH,canPanX:iw-sourceW>.01,canPanY:ih-sourceH>.01};
}

/** Keep every corner of the crop frame inside an arbitrarily rotated image. */
export function avatarCrop(width:number,height:number,zoom:number,rotation:number,x:number,y:number,size=220) {
  const angle=rotation*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),extent=size*(Math.abs(c)+Math.abs(s));
  const k=Math.max(extent/Math.max(1,width),extent/Math.max(1,height))*clamp(zoom,1,3);
  const maxU=Math.max(0,(width*k-extent)/2),maxV=Math.max(0,(height*k-extent)/2);
  const u=clamp(c*x+s*y,-maxU,maxU),v=clamp(-s*x+c*y,-maxV,maxV);
  return {cropDisplayW:width*k,cropDisplayH:height*k,cropX:c*u-s*v,cropY:s*u+c*v};
}
