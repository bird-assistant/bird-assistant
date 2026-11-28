import {BufferedFrame,CAPTURE_LIMITS,CaptureMode,CaptureWindow,frameQuality} from './capture-window';

/** One native listener shared by sparse local replay and optional online detection. */
export class CameraBuffer {
  readonly policy:CaptureWindow;
  private listener?:WechatMiniprogram.CameraFrameListener;
  private timer?:ReturnType<typeof setInterval>;
  private stopped=false;
  private sequence=0;
  private slowUntil=0;
  private lastEncoded=-Infinity;
  constructor(private camera:WechatMiniprogram.CameraContext,private canvas:WechatMiniprogram.Canvas,mode:CaptureMode,
    private update:(kind:'tick'|'burst'|'expired',frames:BufferedFrame[],remaining:number)=>void,
    private raw:(frame:WechatMiniprogram.OnCameraFrameCallbackResult)=>void,private failed:(message:string)=>void,private blocked:()=>boolean=()=>false){this.policy=new CaptureWindow(mode,Date.now());}
  start(){
    try{
      this.listener=this.camera.onCameraFrame(frame=>this.frame(frame));
      const started=this.listener.start({fail:()=>this.fail('此设备暂不支持片段取样；原图快门和相册导入仍可使用。')}) as unknown as {catch?:(failed:()=>void)=>unknown}|undefined;
      started?.catch?.(()=>this.fail('此设备暂不支持片段取样；原图快门和相册导入仍可使用。'));
      if(this.stopped)return;
      this.timer=setInterval(()=>{const now=Date.now(),event=this.policy.tick(now);this.update(event||'tick',this.policy.selected(),this.policy.remaining(now));if(event==='expired')this.stop(false);},250);
    }catch{this.fail('此设备暂不支持片段取样；原图快门和相册导入仍可使用。');}
  }
  trigger(){return !this.stopped&&this.policy.trigger(Date.now());}
  private frame(frame:WechatMiniprogram.OnCameraFrameCallbackResult){
    if(this.stopped||this.blocked())return;
    // Online transport applies its own backpressure, independent of local replay retention.
    this.raw(frame);
    const now=Date.now();if(!this.policy.due(now)||now<this.slowUntil&&now-this.lastEncoded<1000)return;
    this.policy.markSample(now);this.lastEncoded=now;
    const width=Math.floor(frame.width),height=Math.floor(frame.height);
    if(!(width>1&&height>1)||width*height>2*1024*1024||frame.data.byteLength!==width*height*4)return;
    try{
      const quality=frameQuality(frame.data,width,height);if(quality.score<=0)return;
      const scale=Math.min(1,640/Math.max(width,height)),w=Math.max(1,Math.round(width*scale)),h=Math.max(1,Math.round(height*scale));
      this.canvas.width=w;this.canvas.height=h;const ctx=this.canvas.getContext('2d'),out=ctx.createImageData(w,h),source=new Uint8Array(frame.data);
      if(w===width&&h===height)out.data.set(source);
      else for(let y=0;y<h;y++)for(let x=0;x<w;x++){const src=(Math.floor(y*height/h)*width+Math.floor(x*width/w))*4,dest=(y*w+x)*4;out.data[dest]=source[src];out.data[dest+1]=source[src+1];out.data[dest+2]=source[src+2];out.data[dest+3]=255;}
      ctx.putImageData(out,0,0);const uri=this.canvas.toDataURL('image/jpeg',.72);
      if(!/^data:image\/(jpeg|png);base64,/.test(uri))throw new Error('encoding');
      const image=wx.base64ToArrayBuffer(uri.slice(uri.indexOf(',')+1));
      if(image.byteLength<=CAPTURE_LIMITS.frameBytes)this.policy.add({id:'buffer-'+now+'-'+(++this.sequence),at:now,width:w,height:h,image,...quality});
      if(Date.now()-now>100)this.slowUntil=Date.now()+2000;
    }catch{this.fail('片段取样暂不可用，原图快门和已有照片仍保留。');}
  }
  private fail(message:string){if(this.stopped)return;this.stop();this.failed(message);}
  stop(clear=true){this.stopped=true;if(this.timer)clearInterval(this.timer);this.timer=undefined;try{const stopped=this.listener?.stop({fail:()=>{}}) as unknown as {catch?:(failed:()=>void)=>unknown}|undefined;stopped?.catch?.(()=>{});}catch{}this.listener=undefined;if(clear)this.policy.clear();}
}
