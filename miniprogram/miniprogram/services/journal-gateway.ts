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
export function journalGatewayTransport(options:{endpoint:string;session:()=>Promise<string>;prepare:(input:JournalAiInput)=>Promise<Array<{id:string;label:string;dataUrl:string}>>}):JournalAiTransport {
  if(!/^https:\/\/[^\s@?#]+\//.test(options.endpoint)||/aliyuncs\.com|api\.openai\.com/i.test(options.endpoint))throw new Error('A team HTTPS gateway is required');
  return {generate(input){
    let cancelled=false,task:WechatMiniprogram.RequestTask|undefined;
    const result=(async()=>{
      const token=await options.session();if(!token||token.length>4096||/[\r\n]/.test(token))throw new Error('用户会话不可用。');
      if(cancelled)throw new Error('Cancelled');
      const images=await options.prepare(input);if(cancelled)throw new Error('Cancelled');
      if(images.length!==input.images.length||images.some((p,i)=>p.id!==input.images[i].id))throw new Error('所选照片不一致，请重新准备。');
      return new Promise<unknown>((resolve,reject)=>{task=wx.request({url:options.endpoint,method:'POST',timeout:25000,header:{Authorization:'Bearer '+token},data:{version:1,requestId:input.requestId,prompt:input.prompt,purpose:input.purpose,maxChars:input.maxChars,images},success:r=>{if(r.statusCode===200){resolve(r.data);return;}const code=(r.data as {error?:{code?:string}})?.error?.code||'';const messages:Record<string,string>={AUTH_REQUIRED:'用户会话已过期，请重新进入。',NOT_CONFIGURED:'团队 Qwen 网关尚未完成配置，原文仍保留。',RATE_LIMITED:'AI 服务繁忙或额度已用完，请稍后重试。',TIMEOUT:'AI 请求超时，原文仍保留。',INVALID_OUTPUT:'AI 建议未通过检查，原文未修改。'};reject(new JournalAiError(code,messages[code]||'手帐服务请求未完成，原文仍保留。'));},fail:()=>reject(new Error('手帐服务请求未完成。'))});});
    })();
    return {result,cancel(){cancelled=true;task?.abort();}};
  }};
}
