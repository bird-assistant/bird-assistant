'use strict';
// Optional transport only. Existing business bearer validation, permissions and quotas remain authoritative.
const ORIGIN = 'https://api.auroraliu.cn:8080';
const ACTIONS = Object.freeze({
  writingCapabilities: {path:'/api/v1/journal/capabilities', method:'GET'},
  writingSuggestions: {path:'/api/v1/journal/suggestions', method:'POST', writing:true},
  socialInbox: {path:'/api/v1/community/inbox', method:'GET'},
  socialFriends: {path:'/api/v1/community/friends', method:'GET'},
  socialGroups: {path:'/api/v1/community/groups', method:'GET'}
});
function failed(code,status=400){return {ok:false,status,error:{code}};}
async function handleGateway(event,options){
  if(!event || typeof event!=='object' || Array.isArray(event))return failed('GATEWAY_INPUT');
  if(typeof event.action!=='string' || !Object.prototype.hasOwnProperty.call(ACTIONS,event.action))return failed('GATEWAY_ACTION');
  const action=ACTIONS[event.action];
  if(!options.appId)return failed('GATEWAY_NOT_CONFIGURED',503);
  if(!options.context?.OPENID || options.context.APPID!==options.appId)return failed('GATEWAY_CONTEXT',401);
  // Never mint business identity from event.OPENID or cached CloudBase instance context.
  if(typeof event.token!=='string' || !/^[A-Za-z0-9._~-]{16,4096}$/.test(event.token))return failed('BUSINESS_SESSION_REQUIRED',401);
  if(action.writing && !options.writingEnabled)return failed('WRITING_DISABLED',503);
  let body;
  if(action.method==='POST'){
    if(!event.payload || typeof event.payload!=='object' || Array.isArray(event.payload))return failed('GATEWAY_INPUT');
    try{body=JSON.stringify(event.payload);}catch{return failed('GATEWAY_INPUT');}
    if(Buffer.byteLength(body)>2*1024*1024)return failed('GATEWAY_PAYLOAD_TOO_LARGE',413);
  }
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),action.writing?60000:12000);
  try{
    const response=await options.fetch(ORIGIN+action.path,{method:action.method,headers:{Authorization:'Bearer '+event.token,'Content-Type':'application/json'},body,signal:controller.signal,redirect:'error'});
    const text=await response.text();if(Buffer.byteLength(text)>2*1024*1024)return failed('GATEWAY_RESPONSE_TOO_LARGE',502);
    let data;try{data=JSON.parse(text);}catch{return failed('GATEWAY_RESPONSE',502);}
    if(!response.ok)return failed(typeof data?.error?.code==='string'&&/^[A-Z0-9_]{1,80}$/.test(data.error.code)?data.error.code:'BUSINESS_HTTP_'+response.status,response.status);
    return {ok:true,status:response.status,data};
  }catch(error){return failed(controller.signal.aborted?'GATEWAY_TIMEOUT':'GATEWAY_NETWORK',controller.signal.aborted?504:502);}
  finally{clearTimeout(timer);}
}
module.exports={handleGateway};
