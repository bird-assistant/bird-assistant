import {businessOrigin,connectBusiness,forgetConnection} from './vision-network';

export const SPEECH_MAX_BYTES=3*1024*1024;
export class TranscriptionError extends Error {constructor(readonly code:string,message:string){super(message);this.name='TranscriptionError';}}
const copy:Record<string,string>={NOT_CONFIGURED:'语音转写服务尚未启用，录音和文字仍保留。',AUDIO_DURATION:'请使用1–30秒的语音，原有文字仍保留。',INVALID_AUDIO:'录音格式无法读取，请重新录制或直接输入文字。',NO_SPEECH:'没有读到清楚的人声，请重录或直接输入。',RATE_LIMITED:'转写或写作额度已用完，或服务正忙，请稍后重试。'};
export function startTranscription(filePath:string,requestId:string):{result:Promise<string>;cancel():void}{
  let cancelled=false,task:WechatMiniprogram.RequestTask|undefined,rejectCancel:(error:Error)=>void=()=>{};
  const cancellation=new Promise<never>((_resolve,reject)=>rejectCancel=reject);
  const check=()=>{if(cancelled)throw new TranscriptionError('CANCELLED','已取消转写，原有文字和录音仍保留。');};
  const work=(async()=>{
    if(!filePath||!/^[a-zA-Z0-9_-]{1,128}$/.test(requestId))throw new TranscriptionError('INVALID_INPUT','请先录制一段语音。');
    const fs=wx.getFileSystemManager(),info=await new Promise<WechatMiniprogram.GetFileInfoSuccessCallbackResult>((resolve,reject)=>fs.getFileInfo({filePath,success:resolve,fail:()=>reject(new TranscriptionError('FILE_UNAVAILABLE','录音无法读取，请重新录制，文字仍保留。'))}));
    check();if(!Number.isSafeInteger(info.size)||info.size<=0||info.size>SPEECH_MAX_BYTES)throw new TranscriptionError('AUDIO_TOO_LARGE','录音为空或超过3 MB，请录制更短的一段。');
    const bytes=await new Promise<ArrayBuffer>((resolve,reject)=>fs.readFile({filePath,success:value=>typeof value.data==='string'?reject(new TranscriptionError('INVALID_AUDIO',copy.INVALID_AUDIO)):resolve(value.data),fail:()=>reject(new TranscriptionError('FILE_UNAVAILABLE','录音无法读取，请重新录制。'))}));
    check();if(bytes.byteLength>SPEECH_MAX_BYTES)throw new TranscriptionError('AUDIO_TOO_LARGE','录音超过3 MB，请录制更短的一段。');
    const origin=businessOrigin(),connection=await connectBusiness();check();if(connection.origin!==origin)throw new TranscriptionError('CONFIGURATION_CHANGED','服务地址已变更，请重新转写。');
    return await new Promise<string>((resolve,reject)=>{task=wx.request({url:origin+'/api/v1/journal/transcriptions',method:'POST',header:connection.header,timeout:30000,data:{version:1,requestId,wav:wx.arrayBufferToBase64(bytes)},
      success:response=>{
        if(cancelled)return;
        if(response.statusCode!==200){if(response.statusCode===401)forgetConnection();const rawCode=(response.data as any)?.error?.code,code=typeof rawCode==='string'&&/^[A-Z_]{1,80}$/.test(rawCode)?rawCode:'HTTP_ERROR';reject(new TranscriptionError(code,response.statusCode===404?'语音转写服务尚未部署，原有文字与录音仍保留。':response.statusCode===401||response.statusCode===403?'转写授权暂不可用，请重新进入后重试。':(Object.prototype.hasOwnProperty.call(copy,code)?copy[code]:'语音转写未完成，原有文字与录音仍保留，请稍后重试。')));return;}
        const value=response.data as {version?:number;requestId?:string;text?:string};
        if(value?.version!==1||value.requestId!==requestId||typeof value.text!=='string'||!value.text.trim()||value.text.length>2000){reject(new TranscriptionError('INVALID_OUTPUT','转写结果无法读取，原有文字仍保留。'));return;}
        resolve(value.text.trim());
      },fail:()=>{if(!cancelled)reject(new TranscriptionError('CONNECTION_FAILED','转写连接失败，请检查网络；原有文字与录音仍保留。'));}});});
  })();
  return{result:Promise.race([work,cancellation]),cancel(){if(cancelled)return;cancelled=true;rejectCancel(new TranscriptionError('CANCELLED','已取消转写，原有文字与录音仍保留。'));try{task?.abort();}catch{}}};
}
