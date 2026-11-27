export type SpeechState='idle'|'starting'|'recording'|'stopping';
export type SpeechClip={path:string;durationMs:number};
type Port={owner:SpeechCapture|null};
const ports=new WeakMap<WechatMiniprogram.RecorderManager,Port>();

/** One owner per native recorder. A release before onStart never leaves a recording running. */
export class SpeechCapture {
  private state:SpeechState='idle';private closed=false;private cancelled=false;private holding=false;
  private manager:WechatMiniprogram.RecorderManager;private port:Port;
  constructor(private changed:(state:SpeechState)=>void,private clip:(value:SpeechClip)=>void,private error:(message:string)=>void,private profile:'speech'|'bird'='speech'){
    this.manager=wx.getRecorderManager();let port=ports.get(this.manager);
    if(!port){port={owner:null};ports.set(this.manager,port);const shared=port;
      this.manager.onStart(()=>shared.owner?.started());
      this.manager.onStop(value=>shared.owner?.finished(value));
      this.manager.onError(()=>shared.owner?.failed());
    }this.port=port;
  }
  private update(state:SpeechState){this.state=state;if(!this.closed)this.changed(state);}
  start(){
    if(this.closed||this.state!=='idle')return;
    if(this.port.owner){this.error('上一段录音还未结束，请稍后重试。');return;}
    this.port.owner=this;this.holding=true;this.cancelled=false;this.update('starting');
    try{this.manager.start(this.profile==='bird'?{format:'mp3',sampleRate:48000,numberOfChannels:1,encodeBitRate:128000,duration:60000}:{format:'wav',sampleRate:16000,numberOfChannels:1,duration:30000});}catch{this.failed();}
  }
  private stop(){try{this.manager.stop();}catch{this.failed();}}
  private started(){if(!this.holding||this.closed){this.cancelled=true;this.update('stopping');this.stop();}else this.update('recording');}
  setCancelled(value:boolean){this.cancelled=value;}
  release(cancel=false){
    this.holding=false;this.cancelled=cancel||this.state==='starting';
    if(this.state==='recording'){this.update('stopping');this.stop();}
  }
  private finished(value:{tempFilePath:string;duration:number}){
    const accept=!this.cancelled&&!this.closed;this.port.owner=null;this.holding=false;this.update('idle');
    if(!accept)return;
    if(!value.tempFilePath||!Number.isFinite(value.duration)||value.duration<1000||value.duration>(this.profile==='bird'?60500:30500)){this.error('请录制1–'+(this.profile==='bird'?'60':'30')+'秒的声音；原有文字与录音仍保留。');return;}
    this.clip({path:value.tempFilePath,durationMs:value.duration});
  }
  private failed(){this.port.owner=null;this.holding=false;this.update('idle');if(!this.closed)this.error('录音未完成，请检查麦克风权限；也可直接输入文字。');}
  dispose(){if(this.closed)return;this.closed=true;this.release(true);}
}
