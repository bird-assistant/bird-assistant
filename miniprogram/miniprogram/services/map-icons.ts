import {exportCanvas} from './canvas';

/** Text travels inside the PNG, so native marker-label anchors cannot drift by platform. */
export function drawClusterIcon(canvas:WechatMiniprogram.Canvas,count:number){
  canvas.width=96;canvas.height=96;const ctx=canvas.getContext('2d');
  ctx.clearRect(0,0,96,96);ctx.beginPath();ctx.arc(48,48,44,0,Math.PI*2);
  ctx.fillStyle='#285b49';ctx.fill();ctx.lineWidth=5;ctx.strokeStyle='#fffef9';ctx.stroke();
  const text=String(count);let size=32;ctx.font='600 '+size+'px sans-serif';
  while(size>8&&ctx.measureText(text).width>72){size--;ctx.font='600 '+size+'px sans-serif';}
  ctx.fillStyle='#ffffff';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,48,49,72);
}

export class MapIconCache {
  private files=new Map<number,string>();
  private chain:Promise<unknown>=Promise.resolve();
  private closed=false;
  constructor(private canvas:()=>Promise<WechatMiniprogram.Canvas>,private remove:(path:string)=>void){}
  get(count:number){return this.files.get(count);}
  prepare(counts:number[]){
    const wanted=new Set(counts.filter(n=>Number.isSafeInteger(n)&&n>0).slice(0,256));
    const result=this.chain.then(async()=>{
      for(const count of wanted){
        if(this.closed)return;if(this.files.has(count))continue;
        const canvas=await this.canvas();if(this.closed)return;
        drawClusterIcon(canvas,count);const path=await exportCanvas(canvas);
        if(this.closed){this.remove(path);return;}this.files.set(count,path);
      }
      for(const entry of this.files){const count=entry[0],path=entry[1];if(this.files.size<=128)break;if(!wanted.has(count)){this.files.delete(count);this.remove(path);}}
    });
    this.chain=result.catch(()=>{});return result;
  }
  close(){this.closed=true;for(const path of this.files.values())this.remove(path);this.files.clear();}
}
