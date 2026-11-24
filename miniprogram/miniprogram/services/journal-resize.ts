import { JournalDocument, JournalElement } from './journal-model';
import { round2 } from './numbers';

export type RatioLock = 'current'|'original'|'free';
export const ratioLocks = [{id:'current',name:'锁定当前比例'},{id:'original',name:'锁定原图比例'},{id:'free',name:'自由变形'}];
export function ratioLock(photo:JournalElement):RatioLock {return photo.ratioLock||'current';}
export function photoRatio(photo:JournalElement):number {
  if(ratioLock(photo)==='original')return photo.iw>0&&photo.ih>0?photo.iw/photo.ih:photo.w/photo.h;
  return photo.lockedRatio||photo.w/photo.h;
}
/** Capture a ratio when selected; resizing must never gradually drift the lock. */
export function setRatioLock(photo:JournalElement,mode:RatioLock,d:JournalDocument) {
  photo.ratioLock=mode;photo.lockedRatio=photo.w/photo.h;
  if(mode==='free')photo.photoFit='stretch';
  if(mode==='original'){photo.photoFit='cover';resizePhoto(photo,'w',photo.w,d);}
}
export function resizePhoto(photo:JournalElement,key:'w'|'h',value:number,d:JournalDocument) {
  const maxW=Math.max(1,d.width-photo.x),maxH=Math.max(1,d.height-photo.y);
  if(ratioLock(photo)==='free'){
    photo[key]=round2(Math.max(1,Math.min(value,key==='w'?maxW:maxH)));return;
  }
  const ratio=photoRatio(photo);if(!photo.lockedRatio)photo.lockedRatio=ratio;
  const requestedW=key==='w'?value:value*ratio;
  const w=Math.max(1,Math.min(requestedW,maxW,maxH*ratio));
  photo.w=round2(w);photo.h=round2(w/ratio);
}
export const pixelValues=(e:JournalElement|null)=>e?{w:Math.round(e.w),h:Math.round(e.h),fontSize:Math.round(e.fontSize)}:{w:0,h:0,fontSize:0};
