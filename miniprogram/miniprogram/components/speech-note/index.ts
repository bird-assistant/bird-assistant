import {SpeechCapture,SpeechState} from '../../services/speech-capture';
import {startTranscription} from '../../services/transcription-network';
const id=()=> 'speech-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8);
type Runtime={closed:boolean;hidden:boolean;generation:number;startX:number;capture:SpeechCapture|null;job:ReturnType<typeof startTranscription>|null};
const instances=new WeakMap<object,Runtime>();
function runtime(instance:object){let state=instances.get(instance);if(!state){state={closed:false,hidden:false,generation:0,startX:0,capture:null,job:null};instances.set(instance,state);}return state;}
Component({
  properties:{acceptedId:{type:String,value:''}},
  data:{state:'idle' as SpeechState,cancelled:false,clipPath:'',duration:0,busy:false,transcript:'',proposalId:'',error:''},
  lifetimes:{created(){runtime(this);},detached(){runtime(this).closed=true;this.stopWork();}},
  pageLifetimes:{hide(){runtime(this).hidden=true;this.stopWork();},show(){runtime(this).hidden=false;}},
  methods:{
    start(event:WechatMiniprogram.TouchEvent){const control=runtime(this);if(control.closed||control.hidden||this.data.busy||this.data.state!=='idle')return;control.startX=event.touches[0]?.clientX||0;this.setData({cancelled:false,error:''});
      if(!control.capture)control.capture=new SpeechCapture(state=>{if(!control.closed&&!control.hidden)this.setData({state});},clip=>{if(!control.closed&&!control.hidden)this.setData({clipPath:clip.path,duration:Math.round(clip.durationMs/1000),transcript:'',proposalId:'',error:''});},error=>{if(!control.closed&&!control.hidden)this.setData({error});});control.capture.start();
    },
    move(event:WechatMiniprogram.TouchEvent){const control=runtime(this),cancelled=(event.touches[0]?.clientX||0)<control.startX-65;control.capture?.setCancelled(cancelled);this.setData({cancelled});},
    end(){runtime(this).capture?.release(this.data.cancelled);},
    cancelRecording(){this.setData({cancelled:true});runtime(this).capture?.release(true);},
    stopWork(){const control=runtime(this);control.generation++;control.job?.cancel();control.job=null;control.capture?.dispose();control.capture=null;if(!control.closed)this.setData({busy:false,state:'idle',cancelled:false});},
    async transcribe(){const control=runtime(this);if(control.closed||control.hidden||this.data.busy||this.data.state!=='idle'||!this.data.clipPath)return;const token=++control.generation;const job=startTranscription(this.data.clipPath,id());control.job=job;this.setData({busy:true,error:''});
      try{const transcript=await job.result;if(!control.closed&&!control.hidden&&token===control.generation)this.setData({transcript,proposalId:id()});}
      catch(error){if(!control.closed&&!control.hidden&&token===control.generation)this.setData({error:error instanceof Error?error.message:'转写未完成，录音仍保留。'});}
      finally{if(!control.closed&&token===control.generation){control.job=null;this.setData({busy:false});}}
    },
    cancelTranscription(){const control=runtime(this);control.generation++;control.job?.cancel();control.job=null;this.setData({busy:false,error:'已取消转写，录音仍保留。'});},
    edit(event:WechatMiniprogram.CustomEvent<{value:string}>){this.setData({transcript:event.detail.value,proposalId:id()});},
    confirm(){if(this.data.busy||!this.data.transcript.trim()||this.data.acceptedId===this.data.proposalId)return;this.triggerEvent('confirm',{text:this.data.transcript.trim(),id:this.data.proposalId});},
    discard(){if(this.data.busy||this.data.state!=='idle')return;this.setData({clipPath:'',duration:0,transcript:'',proposalId:'',error:''});}
  }
});
