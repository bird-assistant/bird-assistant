import { JournalAiInput, JournalAiTransport, JournalAiError } from './journal-ai';
import { deadline, getCanvas, loadCanvasImage } from './canvas';

/** Bounded JPEG redraw drops original metadata; local paths never enter the wire payload. */
export async function prepareJournalPhotos(page:WechatMiniprogram.Page.TrivialInstance,input:JournalAiInput) {
  const output:Array<{id:string;label:string;dataUrl:string}>=[];
  if(!input.images.length)return output;
  const canvas=await getCanvas(page,'#journal-ai-canvas',1,1),ctx=canvas.getContext('2d');
  try{for(const photo of input.images){
    const image=await loadCanvasImage(canvas,photo.path),scale=Math.min(1,1024/Math.max(image.width,image.height));
    canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));
    ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
    const path=await deadline(new Promise<string>((resolve,reject)=>wx.canvasToTempFilePath({canvas,width:canvas.width,height:canvas.height,destWidth:canvas.width,destHeight:canvas.height,fileType:'jpg',quality:.75,success:r=>resolve(r.tempFilePath),fail:reject})),'照片副本准备超时。');
    try{
      const base64=await deadline(new Promise<string>((resolve,reject)=>wx.getFileSystemManager().readFile({filePath:path,encoding:'base64',success:r=>resolve(String(r.data)),fail:reject})),'照片副本读取超时。');
      if(base64.length>1398104)throw new Error('照片副本超过 1 MB，请减少图片后重试。');
      output.push({id:photo.id,label:photo.label.slice(0,100),dataUrl:'data:image/jpeg;base64,'+base64});
    }finally{wx.getFileSystemManager().unlink({filePath:path,fail:()=>{}});}
  }return output;}finally{canvas.width=1;canvas.height=1;}
}

/** Installation is explicit in the gateway bootstrap; never put a DashScope key in the app. */
export function journalGatewayTransport(options:{endpoint:string;localDev?:boolean;session:()=>Promise<string>;invalidate?:()=>void;prepare:(input:JournalAiInput)=>Promise<Array<{id:string;label:string;dataUrl:string}>>}):JournalAiTransport {
  const local=options.localDev===true&&wx.getDeviceInfo?.().platform==='devtools'&&options.endpoint==='http://127.0.0.1:18200/api/v1/journal/suggestions';
  if((!local&&!/^https:\/\/[^\s@?#]+\//.test(options.endpoint))||/aliyuncs\.com|api\.openai\.com/i.test(options.endpoint))throw new Error('A team HTTPS gateway is required');
  return {generate(input){
    let cancelled=false,task:WechatMiniprogram.RequestTask|undefined;
    const result=(async()=>{
      const token=await options.session();if(!token||token.length>4096||/[\r\n]/.test(token))throw new Error('用户会话不可用。');
      if(cancelled)throw new Error('Cancelled');
      let images:Array<{id:string;label:string;dataUrl:string}>;try{images=await options.prepare(input);}catch(error){throw new JournalAiError('IMAGE_PREPARATION',error instanceof Error?error.message.slice(0,180):'所选照片副本准备失败，原稿仍保留。');}if(cancelled)throw new Error('Cancelled');
      if(images.length!==input.images.length||images.some((p,i)=>p.id!==input.images[i].id))throw new Error('所选照片不一致，请重新准备。');
      return new Promise<unknown>((resolve,reject)=>{task=wx.request({url:options.endpoint,method:'POST',timeout:25000,header:{Authorization:'Bearer '+token},data:{version:1,requestId:input.requestId,prompt:input.prompt,purpose:input.purpose,maxChars:input.maxChars,images},success:r=>{if(r.statusCode===200){resolve(r.data);return;}if(r.statusCode===401)options.invalidate?.();const rawCode=(r.data as {error?:{code?:string}})?.error?.code,code=typeof rawCode==='string'&&/^[A-Z_]{1,80}$/.test(rawCode)?rawCode:'HTTP_ERROR';console.warn('[Bird Assistant] journal request',{status:r.statusCode,code,requestId:input.requestId});const messages:Record<string,string>={AUTH_REQUIRED:'用户会话已过期，请重试。',AUTH_INVALID:'用户会话已过期，请重试。',NOT_CONFIGURED:'团队 Qwen 网关尚未完成配置，原文仍保留。',RATE_LIMITED:'AI 服务繁忙或额度已用完，请稍后重试。',TIMEOUT:'AI 请求超时，原文仍保留。',INVALID_OUTPUT:'AI 建议未通过检查，原文未修改。',PROVIDER_AUTH:'Qwen模型授权不可用，请维护者检查共享账号与模型权限。',MODEL_UNAVAILABLE:'当前图片或文字模型未启用，请维护者检查模型配置。',PROVIDER_INPUT:'Qwen未接受这份写作请求，原文与照片仍保留。'};reject(new JournalAiError(r.statusCode===404?'NOT_DEPLOYED':code,r.statusCode===404?'手帐AI接口尚未部署，原文与照片仍保留。':Object.prototype.hasOwnProperty.call(messages,code)?messages[code]:'手帐服务请求未完成，原文仍保留。'));},fail:()=>reject(new Error('手帐服务请求未完成。'))});});
    })();
    return {result,cancel(){cancelled=true;task?.abort();}};
  }};
}
