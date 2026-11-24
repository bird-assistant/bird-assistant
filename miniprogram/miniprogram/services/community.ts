import {businessOrigin,connectBusiness,forgetConnection,sendImage,VisionConnection} from './vision-network';

export const community='/api/v1/community';
export type Method='GET'|'POST'|'PUT'|'DELETE';
export interface Point {latitude:number;longitude:number;system:'GCJ-02'|'WGS84'}
export interface Draft {reference:string;path:string;storedMedia?:string;species:string|null;speciesName:string;analysis:string|null;target:number|null;
  date:string;time:string;note:string;place:string;point:Point|null;device:string;}
type Compose={title:string;body:string;photo:string;sourceId?:string};
let compose:Compose|null=null;
export function setCompose(value:Compose){compose=value;}
export function takeCompose(){const result=compose;compose=null;return result;}
type MapFocus={latitude:number;longitude:number;species:string;speciesLabel:string;scope:number};
let focus:MapFocus|null=null;
export function openMap(point:{latitude:number;longitude:number},species='',speciesLabel='所有鸟种',scope=0){focus={latitude:point.latitude,longitude:point.longitude,species,speciesLabel,scope};wx.switchTab({url:'/pages/home/index'});}
export function takeMapFocus(){const result=focus;focus=null;return result;}
let draft:Draft|null=null;
export function setDraft(value:Draft){draft=value;}
export function getDraft(){return draft;}
export function key(){return Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);}
const socialScreens = ['account','friends','member','inbox','chat','groups','group','blocked'];
export function hub(screen:string,id=''){
  const page=socialScreens.includes(screen)?'social':'hub';
  wx.navigateTo({url:'/field/'+page+'/index?screen='+encodeURIComponent(screen)+'&id='+encodeURIComponent(id)});
}
const sessionKey='bird-assistant.community.session.v1';
export function sessionState(){return wx.getStorageSync?.(sessionKey) || '';}
export function setSession(active:boolean){
  wx.setStorageSync(sessionKey,active?'active':'out');
  if(!active){forgetConnection();compose=null;draft=null;focus=null;}
}
function ensureSession(){if(sessionState()==='out')throw new Error('已退出本机社区，请到「我的 → 社区账号」重新登录。');}

function failure(status:number,body:any){
  const code=body?.error?.code;
  const reasons:Record<string,string>={TRIP_TIME:'请选择未来七天内尚未结束的出发时段。',
    TRIP_NOT_CONFIGURED:'云端出行顾问尚待管理员配置 API 密钥。',TRIP_PROVIDER_AUTH:'管理员需要检查云端模型密钥与权限。',
    TRIP_PROVIDER_BUSY:'云端模型额度或并发已满，请稍后重试。',TRIP_OUTPUT:'本次建议未通过证据校验，请重试。',
    TRIP_PROVIDER:'云端模型暂时无法回答，请稍后重试。',TRIP_TIMEOUT:'云端响应超时，可以重新提交。',
    TRIP_EXPIRED:'对话已过期，点击「新咨询」重新提问。',TRIP_IN_PROGRESS:'上次提问仍在处理，请稍后重试。',
    TRIP_QUOTA:'本小时出行咨询额度已用完，请稍后再试。',MAP_LOCATION_RESTRICTED:'地图发布需要有位置、已确认且允许公开位置的鸟种。可单独发布讨论。',
    HANDLE_TAKEN:'鸟友号已被使用，请换一个。',FRIENDS_ONLY:'请先成为好友。',REGISTRATION_REQUIRED:'请先完善社区账号资料。',
    INVALID_IMAGE:'请选择 JPEG、PNG 或 WebP 照片。',MESSAGE_UNAVAILABLE:'当前无法向该用户发送消息。'};
  return new Error(reasons[code]||({401:'微信登录已失效。',403:'当前账号没有此权限。',404:'内容已撤回或不可见。',409:'内容已变化，请刷新后重试。',413:'照片超过上传大小限制。',422:'请检查必填项和坐标。',429:'操作频繁，请稍后重试。'} as Record<number,string>)[status]||'业务服务连接失败，请重试。');
}
export async function api(path:string,method:Method='GET',data?:object):Promise<any>{
  const guest=method==='GET' && (path.startsWith('/api/v1/species') || (path===community+'/posts' && data && 'species' in data) || (sessionState()==='out' && (path===community+'/posts'||path===community+'/external'||path.startsWith(community+'/publications/'))));
  if(!guest)ensureSession();
  for(const refresh of [false,true]){
    const connection=guest?{origin:businessOrigin(),header:{}}:await connectBusiness(refresh);
    const reply=await new Promise<{statusCode:number;data:any}>((resolve,reject)=>wx.request({url:connection.origin+path,
      method,data,header:connection.header,timeout:path==='/api/v1/map/trip-plan'?60000:15000,success:resolve,fail:()=>reject(new Error('网络连接失败，请重试。'))}));
    if(reply.statusCode>=200&&reply.statusCode<300)return reply.data;
    if(reply.statusCode!==401||refresh)throw failure(reply.statusCode,reply.data);
  }
}
const mediaPath = community + '/media';
const photoLimit = 24 * 1024 * 1024;
type UploadReply = { statusCode: number; data: string };

async function readOriginal(path: string): Promise<ArrayBuffer> {
  const files = wx.getFileSystemManager();
  const unreadable = () => new Error('微信无法读取这张照片。请从相册重新选择原图。');
  const size = await new Promise<number>((resolve, reject) => files.getFileInfo({
    filePath: path, success: info => resolve(info.size), fail: () => reject(unreadable())
  }));
  if (size > photoLimit) throw new Error('照片超过 24 MiB，请选择较小的照片。');
  if (!size) throw unreadable();
  return new Promise((resolve, reject) => files.readFile({
    filePath: path,
    success: result => {
      if (typeof result.data === 'string' || result.data.byteLength !== size) reject(unreadable());
      else resolve(result.data);
    },
    fail: () => reject(unreadable())
  }));
}

function requestPhoto(connection: VisionConnection, original: ArrayBuffer): Promise<UploadReply> {
  return new Promise((resolve, reject) => sendImage(connection, mediaPath, 'file', original, {}, resolve, error => {
    const detail = error.errMsg || '';
    if (/domain list|合法域名/i.test(detail)) reject(new Error('微信拦截了照片请求，请检查业务地址的 request 合法域名。'));
    else if (/timeout|timed out/i.test(detail)) reject(new Error('照片上传超时，请切换网络后重试。'));
    else if (/ssl|tls|certificate/i.test(detail)) reject(new Error('照片上传时 HTTPS 证书校验失败。'));
    else reject(new Error('照片上传时网络连接失败，请检查网络后重试。'));
  }));
}

export async function uploadPhoto(path: string): Promise<{id: string; camera: Record<string, string>}> {
  ensureSession();
  let original: ArrayBuffer | undefined;
  for (const refresh of [false, true]) {
    const connection = await connectBusiness(refresh);
    let reply: UploadReply;
    if (original) reply = await requestPhoto(connection, original);
    else {
      try {
        reply = await new Promise<UploadReply>((resolve, reject) => wx.uploadFile({
          url: connection.origin + mediaPath, name: 'file', filePath: path,
          header: connection.header, timeout: 60000, success: resolve, fail: reject
        }));
      } catch (error) {
        const detail = String((error as {errMsg?: string})?.errMsg || '');
        if (/cancel/i.test(detail)) throw new Error('照片上传已取消。');
        if (/auth deny|permission denied|privacy/i.test(detail)) throw new Error('微信未授权上传，请检查小程序的隐私授权后重试。');
        original = await readOriginal(path);
        reply = await requestPhoto(connection, original);
      }
    }
    if (reply.statusCode === 401 && !refresh) continue;
    let data;
    try { data = JSON.parse(reply.data); } catch { data = null; }
    if (reply.statusCode !== 201) throw failure(reply.statusCode, data);
    if (typeof data?.id !== 'string' || !data.id) throw new Error('照片服务返回了无效的上传凭据，请重试。');
    return data;
  }
  throw new Error('请重新登录');
}
export async function privatePhoto(id:string){
  ensureSession();
  const connection=await connectBusiness();
  const response=await new Promise<WechatMiniprogram.DownloadFileSuccessCallbackResult>((resolve,reject)=>wx.downloadFile({
    url:connection.origin+'/api/v2/observations/'+encodeURIComponent(id)+'/photo',header:connection.header,success:resolve,fail:reject}));
  if(response.statusCode!==200)throw failure(response.statusCode,null);
  return response.tempFilePath;
}
export function imageUrl(path?:string){return path?.startsWith(community+'/publications/')?businessOrigin()+path:'';}
