import { JournalAiInput } from './journal-ai';
import { journalGatewayTransport, prepareJournalPhotos } from './journal-gateway';
import { businessOrigin, connectBusiness, forgetConnection } from './vision-network';

/** Reuse the business service's user session; no provider secret or second login system. */
export function teamWritingTransport(page:WechatMiniprogram.Page.TrivialInstance) {
  return journalGatewayTransport({invalidate:forgetConnection,endpoint:businessOrigin()+'/api/v1/journal/suggestions',
    session:async()=>{
      const connection=await connectBusiness();
      if(connection.origin!==businessOrigin())throw new Error('写作服务与登录地址不一致。');
      return connection.header.Authorization?.replace(/^Bearer /,'')||'';
    },prepare:(input:JournalAiInput)=>prepareJournalPhotos(page,input)});
}
