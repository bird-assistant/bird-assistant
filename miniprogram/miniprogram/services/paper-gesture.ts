export function paperDrag(dx:number,dy:number){
  if(Math.abs(dx)>Math.max(24,Math.abs(dy)*1.2))return {cancel:true,action:'',style:''};
  const distance=Math.min(180,Math.abs(dy)),progress=distance/180;
  return {cancel:false,action:Math.abs(dy)>=90?(dy<0?'share':'delete'):'',
    style:`transform:translateY(${Math.sign(dy)*distance}px) rotate(${Math.sin(progress*Math.PI)*Math.sign(dy)*7}deg) scale(${1-progress*.3});opacity:${1-progress*.55}`};
}
