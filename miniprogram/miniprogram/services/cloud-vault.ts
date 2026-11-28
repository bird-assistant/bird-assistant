import {cloudVaultConfig} from './cloud-vault-config';
import {nativeDeadline} from './native-deadline';
import {readSavedPlaces,SavedPlace,validSavedPlaces} from './saved-places';
import {uid} from './journal-model';
import {commitProtectedData} from './protected-local-data';
export type VaultCopy={revision:number;present:boolean;updatedAt:string;places:SavedPlace[]};
const messages:Record<string,string>={VAULT_NOT_CONFIGURED:'云端备份尚未开通，完整文件备份仍可使用。',VAULT_IDENTITY:'云端身份未通过校验，请确认当前微信账号和小程序环境。',VAULT_CONFLICT:'云端副本已在另一台设备更新，请重新读取后决定。',VAULT_RETRY_CHANGED:'上次操作内容已变化，请先重新读取云端副本。',VAULT_INPUT:'收藏数量或资料格式超出云端副本范围；请使用完整文件备份。',VAULT_STORED_DATA:'云端副本暂不能读取，原资料未覆盖。',VAULT_STORAGE:'云端暂不能保存，请稍后重新读取，本机收藏仍保留。'};
export const cloudVaultReady=()=>cloudVaultConfig.enabled&&!!cloudVaultConfig.environment;
function valid(value:any):value is VaultCopy{return !!value&&Number.isSafeInteger(value.revision)&&value.revision>=0&&typeof value.present==='boolean'
 &&typeof value.updatedAt==='string'&&(value.updatedAt===''||Number.isFinite(Date.parse(value.updatedAt)))&&validSavedPlaces({version:1,items:value.places})&&value.places.length<=250&&(!value.present?value.places.length===0:true);}
export async function callPrivateVault(action:'read'|'write'|'remove',options:{expectedRevision?:number;mutationId?:string;places?:SavedPlace[]}={}):Promise<VaultCopy>{
 if(!cloudVaultReady())throw new Error(messages.VAULT_NOT_CONFIGURED);
 if(typeof wx.cloud?.init!=='function'||typeof wx.cloud?.callFunction!=='function')throw new Error('当前微信不支持云端备份，请更新微信或使用完整文件备份。');
 wx.cloud.init({env:cloudVaultConfig.environment,traceUser:false});
 const result=await nativeDeadline<{result?:unknown}>((resolve,reject)=>{const task=wx.cloud.callFunction({name:'birdPrivateVault',config:{env:cloudVaultConfig.environment},data:{action,...options},success:value=>resolve({result:value.result}),fail:()=>reject(new Error('云端请求未完成，请重新读取确认结果，本机收藏仍保留。'))});(task as unknown as {catch?:(fn:()=>void)=>void})?.catch?.(()=>reject(new Error('云端请求未完成，请重新读取确认结果，本机收藏仍保留。')));},8000,'云端结果暂未确认，请重新读取后再操作，本机收藏仍保留。');
 const response=result.result as {ok?:boolean;error?:{code?:string};data?:unknown}|undefined;if(!response||response.ok!==true)throw new Error(messages[String(response?.error?.code||'')]||'云端备份未完成，请重新读取，本机收藏仍保留。');
 if(!valid(response.data))throw new Error('云端返回的资料不完整，本机收藏未更改。');return response.data;
}
export function mergeCloudPlaces(copy:VaultCopy){
 if(!valid(copy))throw new Error('云端副本格式不完整，本机收藏未更改。');
 const places=readSavedPlaces();let added=0;
 for(const p of copy.places){if(places.some(old=>Math.abs(old.latitude-p.latitude)<.00001&&Math.abs(old.longitude-p.longitude)<.00001))continue;
  places.push({...p,id:places.some(old=>old.id===p.id)?uid():p.id});added++;}
 if(added)commitProtectedData({places:{version:1,items:places}});return added;
}
