import { RecognitionResponse, RecognitionTransport, recognitionFailure } from './recognition';
import {nativeDeadline} from './native-deadline';

export const VISION_ORIGIN = 'https://api.auroraliu.cn:8080';
export const LOCAL_VISION_SETTING = 'bird-assistant.vision.devtools-local.v1';
const LOOPBACK = 'http://127.0.0.1:18000';
export interface VisionConnection {origin:string; header:Record<string,string>;}
let cached: {connection:VisionConnection; expires:number}|undefined;
let authenticating:Promise<VisionConnection>|undefined;

function endpoint():string {
  const override = wx.getExtConfigSync?.()?.visionOrigin;
  // Public HTTPS is the normal path on every client. Local SSH is an explicit developer opt-in.
  if (!override && wx.getDeviceInfo?.().platform === 'devtools' && wx.getStorageSync?.(LOCAL_VISION_SETTING) === true) return LOOPBACK;
  const origin = override || VISION_ORIGIN;
  if (typeof origin === 'string' && /^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(origin)) return origin;
  throw new Error('请配置小程序的 HTTPS 视觉服务地址。');
}

function requestJson(url:string, method:'POST'|'DELETE', header:Record<string,string>, data?:object):Promise<any> {
  return nativeDeadline((resolve,reject)=>wx.request({url,method,header,data,timeout:15000,
    success:res=>{
      if(res.statusCode>=200 && res.statusCode<300) return resolve(res.data);
      if(res.statusCode===401) cached=undefined;
      reject(recognitionFailure({statusCode:res.statusCode,data:JSON.stringify(res.data),header:res.header}));
    }, fail:error=>reject(new Error(/domain list|不在.*合法域名/i.test(error.errMsg)
      ? '微信阻止了服务请求，请检查小程序的服务器域名配置。'
      : url.startsWith('http://127.0.0.1:') ? '本机视觉联调未连接，请检查开发隧道是否已启动。'
      : '视觉服务连接失败，原素材仍保留，请检查网络后重试。'))}),17000,'服务授权响应超时，请重试。');
}

async function login(origin:string):Promise<VisionConnection> {
  let reply;
  if(origin===LOOPBACK){
    reply=await requestJson('http://127.0.0.1:18001/login','POST',{'X-Bird-DevTools':'vision'});
  }else{
    const code=await nativeDeadline<string>((resolve,reject)=>{wx.login({timeout:10000,
      success:value=>resolve(value.code),fail:()=>reject(new Error('微信登录失败，请重试。'))});},12000,'微信登录响应超时，请重试。');
    reply=await requestJson(origin+'/api/v1/vision/auth/wechat','POST',{}, {code});
  }
  if(typeof reply?.access_token!=='string'||!Number.isFinite(reply.expires_in)||reply.expires_in<=0) throw new Error('视觉服务授权失败。');
  const connection={origin,header:{Authorization:'Bearer '+reply.access_token}};
  cached={connection,expires:Date.now()+(reply.expires_in-30)*1000};
  return connection;
}

export async function connectVision():Promise<VisionConnection> {
  const origin=endpoint();
  if(cached && cached.connection.origin===origin && Date.now()<cached.expires) return cached.connection;
  if(!authenticating) authenticating=login(origin).finally(()=>{authenticating=undefined;});
  return authenticating;
}

let businessLogin:Promise<VisionConnection>|undefined;
export function forgetConnection(){cached=undefined;}
export async function connectBusiness(refresh=false):Promise<VisionConnection>{
  const origin=businessOrigin();
  if(!refresh && cached?.connection.origin===origin && Date.now()<cached.expires)return cached.connection;
  if(!businessLogin)businessLogin=login(origin).finally(()=>{businessLogin=undefined;});
  return businessLogin;
}

export function businessOrigin():string{
  const origin=wx.getExtConfigSync?.()?.visionOrigin || VISION_ORIGIN;
  if(typeof origin!=='string'||!/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(origin))throw new Error('业务服务地址无效');
  return origin;
}

export function sessionRequest(connection:VisionConnection,path:string,method:'POST'|'DELETE',data?:object){
  return requestJson(connection.origin+path,method,connection.header,data);
}

function ascii(value:string):Uint8Array {return Uint8Array.from(value,letter=>letter.charCodeAt(0));}

export function sendImage(connection:VisionConnection,path:string,field:'frame'|'image'|'file',image:ArrayBuffer,fields:Record<string,string>,success:(response:RecognitionResponse)=>void,fail:(error:WechatMiniprogram.GeneralCallbackResult)=>void){
  const bytes=new Uint8Array(image);
  const boundary='BirdForm'+Math.random().toString(36).slice(2)+Date.now();
  const format=bytes[0]===137?'png':bytes[0]===82?'webp':'jpeg';
  let prefix='';
  for(const key of Object.keys(fields)) prefix+='--'+boundary+'\r\nContent-Disposition: form-data; name="'+key+'"\r\n\r\n'+fields[key]+'\r\n';
  prefix+='--'+boundary+'\r\nContent-Disposition: form-data; name="'+field+'"; filename="bird.'+format+'"\r\nContent-Type: image/'+format+'\r\n\r\n';
  const head=ascii(prefix),tail=ascii('\r\n--'+boundary+'--\r\n');
  const body=new Uint8Array(head.length+bytes.length+tail.length);
  body.set(head);body.set(bytes,head.length);body.set(tail,head.length+bytes.length);
  const header={...connection.header,'Content-Type':'multipart/form-data; boundary='+boundary};
  if(field==='image')Object.assign(header,{'X-Bird-Photo-Review':'1'});
  return wx.request({url:connection.origin+path,method:'POST',header,
    data:body.buffer,timeout:field==='file'?60000:45000,dataType:'text',success:res=>{
      if(res.statusCode===401) cached=undefined;
      success({statusCode:res.statusCode,data:String(res.data),header:res.header});
    },fail});
}

export async function photoBytes(path:string):Promise<ArrayBuffer> {
  const info=await wx.getImageInfo({src:path});
  const scale=Math.min(1,Math.sqrt(3840*2160/(info.width*info.height)));
  for(const quality of [92,75]){
    const compressed=await wx.compressImage({src:path,quality,
      compressedWidth:Math.max(1,Math.floor(info.width*scale)),
      compressedHeight:Math.max(1,Math.floor(info.height*scale))});
    const files=wx.getFileSystemManager();
    try {
      const image=await new Promise<ArrayBuffer>((resolve,reject)=>files.readFile({
        filePath:compressed.tempFilePath,
        success:res=>typeof res.data==='string'?reject(new Error('图片读取失败，请重新选择。')):resolve(res.data),
        fail:()=>reject(new Error('图片读取失败，请重新选择。'))}));
      if(image.byteLength<=6*1024*1024)return image;
    } finally {
      if(compressed.tempFilePath && compressed.tempFilePath!==path){
        try { files.unlinkSync(compressed.tempFilePath); } catch {}
      }
    }
  }
  throw new Error('图片过大，请裁剪后重试。');
}

export function photoTransport(connection:VisionConnection,image:ArrayBuffer,fields:Record<string,string>):RecognitionTransport {
  return {upload:(request,success,fail)=>sendImage(connection,request.path,'image',image,fields,success,fail)};
}
