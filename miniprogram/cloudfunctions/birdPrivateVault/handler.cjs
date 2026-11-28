'use strict';
const {createHash}=require('node:crypto');
const MAX_BYTES=128*1024,MAX_PLACES=250;
const fail=(code,status=400)=>({ok:false,status,error:{code}});
const hash=text=>createHash('sha256').update(text).digest('hex');
const stamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
function cleanPlaces(value){
 if(!Array.isArray(value)||value.length>MAX_PLACES)throw Error('VAULT_INPUT');
 const result=value.map(p=>{
  if(!p||typeof p.id!=='string'||!p.id||p.id.length>160||typeof p.name!=='string'||!p.name.trim()||p.name.length>100
   ||typeof p.address!=='string'||p.address.length>240||!stamp(p.createdAt)||!stamp(p.updatedAt)
   ||!Number.isFinite(p.latitude)||Math.abs(p.latitude)>90||!Number.isFinite(p.longitude)||Math.abs(p.longitude)>180)throw Error('VAULT_INPUT');
  return {id:p.id,name:p.name,address:p.address,latitude:p.latitude,longitude:p.longitude,createdAt:p.createdAt,updatedAt:p.updatedAt};
 });
 if(new Set(result.map(p=>p.id)).size!==result.length||Buffer.byteLength(JSON.stringify(result))>MAX_BYTES)throw Error('VAULT_INPUT');return result;
}
function validRecord(value,owner){
 return value&&value.version===1&&value.owner===owner&&Number.isSafeInteger(value.revision)&&value.revision>0
  &&typeof value.present==='boolean'&&stamp(value.updatedAt)&&value.mutation&&typeof value.mutation.id==='string'&&typeof value.mutation.digest==='string';
}
const project=value=>({revision:value?.revision||0,present:value?.present||false,updatedAt:value?.updatedAt||'',places:value?.places||[]});
/** Trusted SDK identity only. This is private storage, independent of the existing business server. */
async function handleVault(event,options){
 if(!options.enabled||!options.appId)return fail('VAULT_NOT_CONFIGURED',503);
 const context=options.context;if(!context?.OPENID||typeof context.OPENID!=='string'||context.APPID!==options.appId)return fail('VAULT_IDENTITY',401);
 if(!event||!['read','write','remove'].includes(event.action))return fail('VAULT_ACTION');
 const owner=hash(context.APPID+'\0'+context.OPENID).slice(0,32);
 try{
  const prior=await options.store.read(owner);
  if(prior){if(!validRecord(prior,owner))return fail('VAULT_STORED_DATA',409);prior.places=cleanPlaces(prior.places);if(!prior.present&&prior.places.length)return fail('VAULT_STORED_DATA',409);}
  if(event.action==='read')return {ok:true,data:project(prior)};
  if(!Number.isSafeInteger(event.expectedRevision)||event.expectedRevision<0||typeof event.mutationId!=='string'||!/^[a-zA-Z0-9_-]{10,100}$/.test(event.mutationId))return fail('VAULT_INPUT');
  const places=event.action==='remove'?[]:cleanPlaces(event.places),digest=hash(JSON.stringify({action:event.action,places}));
  if(prior?.mutation.id===event.mutationId){if(prior.mutation.digest!==digest)return fail('VAULT_RETRY_CHANGED',409);return {ok:true,data:project(prior)};}
  if((prior?.revision||0)!==event.expectedRevision)return fail('VAULT_CONFLICT',409);
  const next={version:1,owner,revision:event.expectedRevision+1,updatedAt:options.now(),present:event.action==='write',places,mutation:{id:event.mutationId,digest}};
  if(!await options.store.compareAndSwap(owner,event.expectedRevision,next))return fail('VAULT_CONFLICT',409);
  return {ok:true,data:project(next)};
 }catch(error){return fail(error?.message==='VAULT_INPUT'?'VAULT_INPUT':'VAULT_STORAGE',error?.message==='VAULT_INPUT'?400:503);}
}
module.exports={handleVault,cleanPlaces,MAX_BYTES,MAX_PLACES};
