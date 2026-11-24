import { RecognitionCandidate, RecognitionResult, trackCandidates, recognitionFailure } from './recognition';
import { connectVision, sendImage, sessionRequest, VisionConnection } from './vision-network';

const sessions='/api/v1/vision/sessions';
type Box = {x1:number;y1:number;x2:number;y2:number};
export interface LiveTrack {
  id:number; box:Box; style:string; appearance:string; label:string; state:string;
  candidates:RecognitionCandidate[]; model:string; scope:string; catalogVersion:string;
}
export interface LiveFrame {width:number;height:number; tracks:LiveTrack[]; id:string; capturedAt:string; image:ArrayBuffer;
  context:RecognitionResult['frameContext'];revision:string;}

export function overlay(box:Box,width:number,height:number,viewWidth:number,viewHeight:number):string {
  const scale=Math.max(viewWidth/width,viewHeight/height);
  const dx=(width*scale-viewWidth)/2,dy=(height*scale-viewHeight)/2;
  const left=Math.max(0,box.x1*width*scale-dx),top=Math.max(0,box.y1*height*scale-dy);
  const right=Math.min(viewWidth,box.x2*width*scale-dx),bottom=Math.min(viewHeight,box.y2*height*scale-dy);
  if(right<=left || bottom<=top) return 'display:none';
  return `left:${left}px;top:${top}px;width:${right-left}px;height:${bottom-top}px`;
}

function readTrack(raw:any):LiveTrack {
  const box:Box=raw.bbox;
  if(!Number.isInteger(raw.track_id)||!box||![box.x1,box.y1,box.x2,box.y2].every(n=>Number.isFinite(n)&&n>=0&&n<=1)||box.x1>=box.x2||box.y1>=box.y2) throw new Error('无效的检测框');
  const species=raw.species,state=species.state;
  if(!['tentative','confirmed'].includes(raw.state)||!['detected','temporarily_lost'].includes(raw.visibility)||!['unknown','candidate','waiting_for_quality','unavailable'].includes(state)) throw new Error('无效的轨迹状态');
  const appearance=raw.visibility==='temporarily_lost'?'lost':raw.state;
  const candidates=appearance==='confirmed' && (state==='candidate'||state==='unknown')?trackCandidates(species.candidates):[];
  if(state==='candidate' && appearance==='confirmed' && !candidates.length) throw new Error('候选缺失');
  let label=raw.recognizable?'已发现鸟，正在等待清晰画面':'鸟体细节不足，可按快门拍照识别';
  if(appearance==='lost') label='暂时丢失 · 预测位置';
  else if(appearance==='tentative') label='正在确认目标';
  else if(state==='unknown') label=species.decision?.reason==='ambiguous_candidates'
    ?'几种鸟外观接近，可展开看候选':'已发现鸟，鸟种待确认';
  else if(state==='unavailable') label='鸟种模型暂不可用';
  else if(state==='candidate') label=(candidates[0].scoreType==='mock'?'示例候选 · ':'候选 · ')+candidates[0].name;
  const scope=species.decision?.candidate_scope;
  return {id:raw.track_id,box,style:'',appearance,label,state,candidates,model:species.model||'',
    scope:scope==='local_seasonal'?'当地时节':scope==='country'?'国家范围':scope==='global'?'全球范围':'',catalogVersion:species.decision?.catalog_version||''};
}

export function frozenResult(frame:LiveFrame):RecognitionResult {
  const subjects=frame.tracks.filter(track=>track.appearance!=='lost').map(track=>({rank:track.id,box:track.box,
    state:track.appearance==='confirmed'&&track.state==='candidate'?'candidate' as const:'unknown' as const,
    reason:track.state,candidates:track.candidates}));
  const first=subjects.find(subject=>subject.state==='candidate');
  const model=frame.tracks.find(track=>track.model);
  return {analysisId:frame.id,kind:'photo',state:first?'candidate':'unknown',reason:'live_frame',subjects,
    candidates:first?.candidates||[],frameContext:frame.context,model:{name:model?.model||'实时检测',backend:'live',revision:frame.revision,catalogVersion:model?.catalogVersion},
    example:subjects.some(subject=>subject.candidates.some(candidate=>candidate.scoreType==='mock'))};
}

export async function liveLocation():Promise<Record<string,number>> {
  try {
    const settings=await wx.getSetting({});
    if(!settings.authSetting['scope.userLocation']) return {};
    const result=await wx.getLocation({type:'wgs84'});
    if(Number.isFinite(result.accuracy)&&result.accuracy>0&&result.accuracy<=1000) return {latitude:result.latitude,longitude:result.longitude};
  } catch {return {};}
  return {};
}

export class LiveVision {
  private connection?:VisionConnection;
  private path='';
  private socket?:WechatMiniprogram.SocketTask;
  private listener?:WechatMiniprogram.CameraFrameListener;
  private upload?:WechatMiniprogram.RequestTask;
  private pending?:{id:string;capturedAt:string;image:ArrayBuffer};
  private timeout?:ReturnType<typeof setTimeout>;
  private reconnect?:ReturnType<typeof setTimeout>;
  private next=0;
  private sequence=0;
  private interval=500;
  private retries=0;
  private stopped=false;
  private ready=false;
  private revision='';
  constructor(private camera:WechatMiniprogram.CameraContext,private canvas:WechatMiniprogram.Canvas,
    private mode:()=>string,private status:(message:string,keepLastFrame?:boolean)=>void,private result:(frame:LiveFrame)=>void,
    private failed:(message:string)=>void) {}

  async start(){
    try {
      this.connection=await connectVision();
      if(this.stopped)return;
      const location=await liveLocation();
      if(this.stopped)return;
      const session=await sessionRequest(this.connection,sessions,'POST',{observation_mode:'live',...location});
      if(typeof session?.session_id!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(session.session_id)) throw new Error('视觉会话响应无效。');
      this.path=sessions+'/'+session.session_id;
      if(this.stopped){this.release();return;}
      if(session.websocket_path!==this.path+'/events')throw new Error('视觉事件地址无效。');
      this.interval=Math.max(200,Number(session.recommended_frame_interval_ms)||500);
      this.listen();
    }catch(err){this.fail(err instanceof Error?err.message:'实时识别启动失败。');}
  }
  private fail(message:string){if(!this.stopped){this.stop();this.failed(message);}}
  private listen(){
    if(this.stopped||!this.connection)return;
    const socket=wx.connectSocket({url:this.connection.origin.replace(/^http/,'ws')+this.path+'/events',header:this.connection.header,success:()=>{}});
    this.socket=socket;
    const disconnected=()=>{
      if(this.stopped||this.socket!==socket)return;
      this.socket=undefined;this.ready=false;this.clearFrame();socket.close({});
      if(++this.retries>3){this.fail('实时连接已断开，可重新开启。');return;}
      this.status('连接中断，正在恢复取景识别');
      this.reconnect=setTimeout(()=>this.listen(),500*this.retries);
    };
    this.timeout=setTimeout(disconnected,12000);
    socket.onError(disconnected);socket.onClose(disconnected);
    socket.onMessage(event=>{
      if(this.stopped||this.socket!==socket)return;
      try {
        if(typeof event.data!=='string'||event.data.length>1024*1024)throw new Error();
        const msg=JSON.parse(event.data);
        if(sessions+'/'+msg.session_id!==this.path)return;
        if(msg.type==='vision.session.started'){
          this.clearFrame();this.ready=true;this.revision=msg.details?.model_revision||'';
          this.status(msg.details?.latitude==null?'正在寻找鸟类 · 未提供定位，候选范围较广':'正在寻找鸟类');
          this.timeout=setTimeout(()=>this.fail('未收到相机画面，可拍照后分析。'),12000);
          if(!this.listener){this.listener=this.camera.onCameraFrame(frame=>this.frame(frame));this.listener.start({fail:()=>this.fail('无法读取相机帧，可拍照后分析。')});}
        }else if(msg.type==='vision.session.closed') this.fail('视觉会话已结束，可重新开启。');
        else if(this.pending && msg.frame_id===this.pending.id){
          const pending=this.pending;this.clearFrame();
          if(msg.type==='vision.frame.dropped'){this.status('已跳过过期帧，等待新画面',true);return;}
          if(msg.type==='vision.frame.error'){this.fail('云端处理此帧失败，可重新开启。');return;}
          if(msg.type!=='vision.frame.result'||!Array.isArray(msg.tracks)||msg.tracks.length>1000||!(msg.image_width>0&&msg.image_height>0))throw new Error();
          this.retries=0;
          const context=msg.observation_context;
          this.result({...pending,width:msg.image_width,height:msg.image_height,tracks:msg.tracks.map(readTrack),revision:this.revision,
            context:{sessionId:msg.session_id,capturedAt:pending.capturedAt,latitude:context?.latitude??null,longitude:context?.longitude??null,regionCode:context?.region_code??null}});
        }
      }catch{this.fail('实时结果无法读取，可重新开启或拍照复核。');}
    });
  }
  private frame(frame:WechatMiniprogram.OnCameraFrameCallbackResult){
    if(this.stopped||!this.ready||this.pending||this.upload||Date.now()<this.next||!this.connection)return;
    this.next=Date.now()+Math.max(this.interval,this.mode()==='wait'?1800:250);
    if(this.timeout)clearTimeout(this.timeout);
    try{
      if(this.canvas.width!==frame.width)this.canvas.width=frame.width;
      if(this.canvas.height!==frame.height)this.canvas.height=frame.height;
      const context=this.canvas.getContext('2d'),pixels=context.createImageData(frame.width,frame.height);
      pixels.data.set(new Uint8ClampedArray(frame.data));context.putImageData(pixels,0,0);
      const data=this.canvas.toDataURL('image/jpeg',0.90);
      if(!/^data:image\/(jpeg|png);base64,/.test(data))throw new Error();
      const image=wx.base64ToArrayBuffer(data.slice(data.indexOf(',')+1));
      const id='frame-'+(++this.sequence),capturedAt=new Date().toISOString();
      this.pending={id,capturedAt,image};
      this.timeout=setTimeout(()=>this.fail('等待识别结果超时，请重新开启。'),45000);
      this.upload=sendImage(this.connection,this.path+'/frames','frame',image,{frame_id:id,captured_at:capturedAt,capture_time_precision:'exact'},res=>{
        this.upload=undefined;
        if(this.stopped)return;
        if(res.statusCode===202){
          this.next=Math.max(this.next,Date.now()+this.interval+80);
        }else if(res.statusCode===429){
          const error=recognitionFailure(res);
          this.clearFrame();
          this.next=Date.now()+Math.max(this.interval+80,(error.retryAfterSeconds??1)*1000);
          this.status('正在调整取帧间隔',true);
        }else this.fail(recognitionFailure(res).message);
      },()=>{this.upload=undefined;if(this.ready)this.fail('画面上传失败，请检查网络后重新开启。');});
    }catch{this.fail('此设备无法编码取景画面，可拍照后分析。');}
  }
  private clearFrame(){this.pending=undefined;if(this.timeout)clearTimeout(this.timeout);}
  private release(){if(this.connection&&this.path){void sessionRequest(this.connection,this.path,'DELETE').catch(()=>{});this.path='';}}
  stop(){
    this.stopped=true;this.ready=false;this.clearFrame();if(this.reconnect)clearTimeout(this.reconnect);
    this.listener?.stop({});this.upload?.abort();this.socket?.close({});this.release();
  }
}
