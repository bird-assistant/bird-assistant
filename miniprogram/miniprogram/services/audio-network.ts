import {businessOrigin,connectBusiness,forgetConnection} from './vision-network';
import {RecognitionError,RecognitionInput,RecognitionResult,recognitionFailure,recognitionUpload,startRecognition} from './recognition';

export const AUDIO_MAX_BYTES=10*1024*1024;
/** One explicit upload through the public origin. Readiness failure sends no recording or login. */
export function startAudioRecognition(input:RecognitionInput):{result:Promise<RecognitionResult>;cancel():void} {
  let stopped=false,request:WechatMiniprogram.RequestTask|undefined,job:ReturnType<typeof startRecognition>|undefined;
  let rejectCancelled:(error:Error)=>void=()=>{};
  const cancelled=new Promise<never>((_resolve,reject)=>{rejectCancelled=reject;});
  const check=()=>{if(stopped)throw new RecognitionError('CANCELLED','已取消识别，原录音仍保留。');};
  const work=(async()=>{
    if(input.kind!=='audio')throw new RecognitionError('UNSUPPORTED_KIND','请选择需要分析的录音。');
    recognitionUpload(input);const origin=businessOrigin();
    const info=await new Promise<WechatMiniprogram.GetFileInfoSuccessCallbackResult>((resolve,reject)=>wx.getFileSystemManager().getFileInfo({filePath:input.filePath,success:resolve,fail:()=>reject(new RecognitionError('AUDIO_FILE_UNAVAILABLE','录音无法读取，请重新选择文件。'))}));
    check();if(!Number.isFinite(info.size)||info.size<=0)throw new RecognitionError('EMPTY_AUDIO','录音文件为空，请重新选择。');
    if(info.size>AUDIO_MAX_BYTES)throw new RecognitionError('AUDIO_TOO_LARGE','录音超过10 MB，请选择不超过60秒的较小片段，原件仍保留。');
    const header=await new Promise<ArrayBuffer>((resolve,reject)=>wx.getFileSystemManager().readFile({filePath:input.filePath,position:0,length:Math.min(4,info.size),success:value=>typeof value.data==='string'?reject(new RecognitionError('AUDIO_FILE_UNAVAILABLE','录音无法读取，请重新选择文件。')):resolve(value.data),fail:()=>reject(new RecognitionError('AUDIO_FILE_UNAVAILABLE','录音无法读取，请重新选择文件。'))}));
    check();const bytes=new Uint8Array(header);if(bytes[0]===79&&bytes[1]===103&&bytes[2]===103&&bytes[3]===83)throw new RecognitionError('UNSUPPORTED_AUDIO_FORMAT','OGG暂不支持识别，原录音仍可在本机回听和保留。');
    await new Promise<void>((resolve,reject)=>{request=wx.request({url:origin+'/api/v1/audio/readyz',method:'GET',timeout:15000,
      success:response=>{
        if(stopped)return;
        if(response.statusCode===404){reject(new RecognitionError('AUDIO_NOT_DEPLOYED','声音识别服务尚未部署，录音仍可回听和保留。'));return;}
        if(response.statusCode!==200){reject(recognitionFailure({statusCode:response.statusCode,data:typeof response.data==='string'?response.data:JSON.stringify(response.data),header:response.header}));return;}
        const value=response.data as {status?:string;models?:Array<{ready?:boolean}>};
        if(value?.status!=='ready'||!Array.isArray(value.models)||!value.models.length||value.models.some(model=>model.ready!==true)){reject(new RecognitionError('AUDIO_NOT_READY','声音模型尚未就绪，原录音仍保留，请稍后重试。'));return;}
        resolve();
      },fail:()=>{if(!stopped)reject(new RecognitionError('AUDIO_CONNECTION_FAILED','声音服务连接失败，请检查网络后重试，原录音仍保留。'));}});});
    request=undefined;check();const connection=await connectBusiness();check();if(connection.origin!==origin)throw new RecognitionError('AUDIO_CONFIGURATION_CHANGED','服务地址已更改，请重新开始识别，原录音仍保留。');
    job=startRecognition({upload:(upload,success,fail)=>wx.uploadFile({url:connection.origin+upload.path,filePath:upload.filePath,name:'audio',formData:upload.formData,header:connection.header,timeout:60000,
      success:response=>{if(response.statusCode===401)forgetConnection();success(response);},fail})},input);
    return await job.result;
  })();
  return {result:Promise.race([work,cancelled]),cancel(){if(stopped)return;stopped=true;rejectCancelled(new RecognitionError('CANCELLED','已取消识别，原录音仍保留。'));try{request?.abort();}catch{}job?.cancel();}};
}
