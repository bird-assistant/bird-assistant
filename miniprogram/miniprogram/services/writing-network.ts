import { JournalAiInput } from './journal-ai';
import { journalGatewayTransport, prepareJournalPhotos } from './journal-gateway';
import { businessOrigin, connectBusiness, forgetConnection } from './vision-network';

export const LOCAL_WRITING_SETTING='bird-assistant.writing.devtools-local.v1';
const LOCAL_WRITING='http://127.0.0.1:18200';

function localSession():Promise<string>{
  return new Promise((resolve,reject)=>wx.request({url:LOCAL_WRITING+'/dev/writing/session',method:'POST',
    header:{'X-Bird-DevTools':'writing'},timeout:5000,
    success:reply=>{const data=reply.data as {access_token?:string;expires_in?:number};
      if(reply.statusCode===200&&typeof data?.access_token==='string'&&Number.isFinite(data.expires_in)&&Number(data.expires_in)>0)resolve(data.access_token);
      else reject(new Error('本机写作联调尚未就绪，请检查写作终端，原稿仍保留。'));},
    fail:()=>reject(new Error('本机写作联调未连接，请先启动 writing_dev.py，原稿仍保留。'))}));
}

/** Reuse the business service's user session; no provider secret or second login system. */
export function teamWritingTransport(page:WechatMiniprogram.Page.TrivialInstance) {
  if(wx.getDeviceInfo?.().platform==='devtools'&&wx.getStorageSync?.(LOCAL_WRITING_SETTING)===true){
    return journalGatewayTransport({endpoint:LOCAL_WRITING+'/api/v1/journal/suggestions',localDev:true,
      session:localSession,prepare:(input:JournalAiInput)=>prepareJournalPhotos(page,input)});
  }
  return journalGatewayTransport({invalidate:forgetConnection,endpoint:businessOrigin()+'/api/v1/journal/suggestions',
    session:async()=>{
      const connection=await connectBusiness();
      if(connection.origin!==businessOrigin())throw new Error('写作服务与登录地址不一致。');
      return connection.header.Authorization?.replace(/^Bearer /,'')||'';
    },prepare:(input:JournalAiInput)=>prepareJournalPhotos(page,input)});
}
