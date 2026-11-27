export const PAPER_HOLD_MS=1000;
export const PAPER_HOLD_SLOP=10;
export type PaperAction=''|'share'|'delete';

/** Intent follows finger travel; the visual paper follows with resistance. */
export function paperDrag(dx:number,dy:number,viewport=900){
  if(![dx,dy,viewport].every(Number.isFinite))return {cancel:true,action:'' as PaperAction,progress:0,down:false,up:false,style:''};
  if(Math.abs(dx)>=36&&Math.abs(dx)>Math.abs(dy)*.7)return {cancel:true,action:'' as PaperAction,progress:0,down:false,up:false,style:''};
  const threshold=Math.max(130,Math.min(210,viewport*.22));
  const progress=Math.min(1,Math.abs(dy)/threshold),travel=116*(1-Math.exp(-Math.abs(dy)/220));
  const action:PaperAction=Math.abs(dy)>=threshold&&Math.abs(dy)>Math.abs(dx)*1.8?(dy<0?'share':'delete'):'';
  return {cancel:false,action,progress,down:dy>12,up:dy < -12,
    style:`transform:translateY(${Math.sign(dy)*travel}px) rotate(${Math.sign(dy)*progress*2.8}deg) scale(${1-progress*.46});opacity:${1-progress*.58}`};
}
