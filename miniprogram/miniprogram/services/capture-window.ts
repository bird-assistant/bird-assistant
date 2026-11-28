export type CaptureMode = 'quick'|'wait';
export interface BufferedFrame {
  id:string;at:number;width:number;height:number;image:ArrayBuffer;score:number;signature:number[];
}
export const CAPTURE_LIMITS={quickMs:60000,replayMs:5000,burstMs:5000,bytes:4*1024*1024,frameBytes:160*1024};

/** A sparse replay, not a video. No files, gallery writes, network or raw RGBA retention. */
export class CaptureWindow {
  private rolling:BufferedFrame[]=[];
  private fallback:BufferedFrame[]=[];
  private chosen:BufferedFrame[]=[];
  private burst:null|{tap:number;until:number;frames:BufferedFrame[]}=null;
  private last=-Infinity;
  private manual=false;
  constructor(readonly mode:CaptureMode,readonly started:number){}
  get bursting(){return !!this.burst;}
  get tapTime(){return this.burst?.tap;}
  get bytes(){return [...this.unique().values()].reduce((sum,f)=>sum+f.image.byteLength,0);}
  get expired(){return this.mode==='quick'&&this.ended;}
  private ended=false;
  due(now:number){return !this.ended&&now-this.last>=(this.burst?200:this.mode==='wait'?500:1000);}
  markSample(now:number){this.last=now;}
  remaining(now:number){return Math.max(0,Math.ceil(((this.burst?.until??(this.mode==='quick'?this.started+CAPTURE_LIMITS.quickMs:now))-now)/1000));}
  add(frame:BufferedFrame){
    if(this.ended||!Number.isFinite(frame.at)||frame.at<this.started||frame.image.byteLength>CAPTURE_LIMITS.frameBytes||!frame.image.byteLength)return;
    this.rolling=this.rolling.filter(f=>f.at>=frame.at-CAPTURE_LIMITS.replayMs&&f.at<=frame.at);
    this.rolling.push(frame);this.rolling=this.rolling.slice(-12);
    if(this.mode==='quick'&&!this.manual)this.fallback=selectFrames([...this.fallback,frame],2);
    if(this.burst&&frame.at<=this.burst.until){this.burst.frames.push(frame);if(this.burst.frames.length>36)this.burst.frames.splice(0,1);}
    this.trim();
  }
  trigger(now:number){
    if(this.ended)return false;
    this.manual=true;this.fallback=[];this.chosen=[];
    if(this.mode==='wait')this.burst={tap:now,until:now+CAPTURE_LIMITS.burstMs,frames:this.rolling.filter(f=>f.at>=now-CAPTURE_LIMITS.replayMs&&f.at<=now)};
    return true;
  }
  tick(now:number):'burst'|'expired'|''{
    if(this.ended)return '';
    if(this.burst&&now>=this.burst.until){
      const before=selectFrames(this.burst.frames.filter(f=>f.at<=this.burst!.tap),1),after=selectFrames(this.burst.frames.filter(f=>f.at>this.burst!.tap),2);
      this.chosen=[...before,...after].sort((a,b)=>a.at-b.at);this.burst=null;this.trim();return 'burst';
    }
    if(this.mode==='quick'&&now>=this.started+CAPTURE_LIMITS.quickMs){
      this.finishQuick();return 'expired';
    }
    return '';
  }
  finishQuick(){if(this.mode==='quick'&&!this.ended){this.chosen=this.manual?[]:selectFrames(this.fallback,2);this.rolling=[];this.fallback=[];this.ended=true;}return this.selected();}
  selected(){return [...this.chosen];}
  discardSelected(){this.chosen=[];this.fallback=[];}
  clear(){this.rolling=[];this.fallback=[];this.chosen=[];this.burst=null;this.ended=true;}
  private unique(){return new Map([...this.rolling,...this.fallback,...this.chosen,...(this.burst?.frames||[])].map(f=>[f.id,f]));}
  private trim(){
    while(this.bytes>CAPTURE_LIMITS.bytes){
      const protectedIds=new Set(this.burst?[selectFrames(this.burst.frames.filter(f=>f.at<=this.burst!.tap),1)[0]?.id,selectFrames(this.burst.frames.filter(f=>f.at>this.burst!.tap),1)[0]?.id]:[]);
      const candidates=[...this.unique().values()].sort((a,b)=>a.score-b.score||a.at-b.at),drop=candidates.find(f=>!protectedIds.has(f.id))||candidates[0];if(!drop)break;
      this.rolling=this.rolling.filter(f=>f.id!==drop.id);this.fallback=this.fallback.filter(f=>f.id!==drop.id);this.chosen=this.chosen.filter(f=>f.id!==drop.id);
      if(this.burst)this.burst.frames=this.burst.frames.filter(f=>f.id!==drop.id);
    }
  }
}
export function selectFrames(frames:BufferedFrame[],limit:number){
  const ranked=[...new Map(frames.map(f=>[f.id,f])).values()].sort((a,b)=>b.score-a.score||b.at-a.at),selected:BufferedFrame[]=[];
  for(const frame of ranked){
    if(!Number.isFinite(frame.score)||frame.score<=0)continue;
    if(selected.some(other=>Math.abs(other.at-frame.at)<350||frame.signature.length&&other.signature.length===frame.signature.length&&frame.signature.reduce((sum,n,i)=>sum+Math.abs(n-other.signature[i]),0)/frame.signature.length<3))continue;
    selected.push(frame);if(selected.length>=limit)break;
  }
  return selected;
}

/** Cheap texture/exposure ranking. It is not bird detection or a species confidence score. */
export function frameQuality(rgba:ArrayBuffer,width:number,height:number){
  const pixels=new Uint8Array(rgba),signature:number[]=[],samples:number[]=[];
  if(!(width>1&&height>1)||pixels.length!==width*height*4)return {score:0,signature};
  const luma=(x:number,y:number)=>{const i=(y*width+x)*4;return (pixels[i]*3+pixels[i+1]*6+pixels[i+2])/10;};
  let detail=0,clipped=0;
  for(let y=1;y<=12;y++)for(let x=1;x<=12;x++){
    const px=Math.min(width-2,Math.floor(x*width/14)),py=Math.min(height-2,Math.floor(y*height/14)),v=luma(px,py);
    samples.push(v);detail+=Math.abs(v-luma(px+1,py))+Math.abs(v-luma(px,py+1));if(v<12||v>244)clipped++;
    if(x%3===0&&y%3===0)signature.push(Math.round(v));
  }
  const mean=samples.reduce((a,b)=>a+b,0)/samples.length,contrast=Math.sqrt(samples.reduce((a,v)=>a+(v-mean)**2,0)/samples.length);
  return {score:Math.max(0,(detail/samples.length+contrast*.25)*(1-clipped/samples.length)),signature};
}
