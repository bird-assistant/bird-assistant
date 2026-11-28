import {callPrivateVault,cloudVaultReady,mergeCloudPlaces,VaultCopy} from '../../services/cloud-vault';
import {readSavedPlaces} from '../../services/saved-places';
import {uid} from '../../services/journal-model';
import {beijingDateTime} from '../../services/observation-context';
const explain=(error:unknown)=>error instanceof Error?error.message:'云端操作未完成，本机收藏仍保留。';
Page({
 data:{ready:false,known:false,working:false,localCount:0,cloudCount:0,present:false,when:'',names:[] as string[],error:'',status:''},
 _copy:null as VaultCopy|null,_generation:0,_alive:false,
 onLoad(){this.setData({ready:cloudVaultReady()});this.localCount();},onShow(){this._alive=true;},
 onHide(){this._alive=false;this._generation++;this._copy=null;this.setData({working:false,known:false,status:'返回后请重新读取云端副本。未自动修改本机收藏。'});},onUnload(){this._alive=false;this._generation++;this._copy=null;},
 localCount(){try{this.setData({localCount:readSavedPlaces().length});}catch(e){this.setData({error:explain(e)});}},
 async read(){if(this.data.working||!this.data.ready)return;const generation=++this._generation;this.setData({working:true,error:'',status:''});
  try{const copy=await callPrivateVault('read');if(!this._alive||generation!==this._generation)return;this.show(copy);this.localCount();}
  catch(e){if(this._alive&&generation===this._generation){this._copy=null;this.setData({known:false,error:explain(e)});}}
  finally{if(this._alive&&generation===this._generation)this.setData({working:false});}
 },
 show(copy:VaultCopy){this._copy=copy;this.setData({known:true,present:copy.present,cloudCount:copy.places.length,when:copy.updatedAt?beijingDateTime(copy.updatedAt):'',names:copy.places.slice(0,5).map(p=>p.name),status:copy.present?'已读取云端副本，可选择合并到本机。':'当前微信账号尚无云端收藏副本。'});},
 async upload(){if(this.data.working||!this._copy||!this.data.known)return;
  try{const places=readSavedPlaces(),reply=await wx.showModal({title:'更新云端收藏副本？',content:'将用当前 '+places.length+' 个收藏地点更新云端副本。本机内容保留；日后恢复会合并，不替换本机地点。',confirmText:'更新副本'});if(!reply.confirm||!this._alive||!this._copy)return;
   await this.mutate('write',places);
  }catch(e){if(this._alive)this.setData({error:explain(e)});}
 },
 async remove(){if(this.data.working||!this._copy?.present||!this.data.known)return;
  try{const reply=await wx.showModal({title:'删除云端收藏副本？',content:'只删除当前微信账号的云端收藏副本，本机收藏和完整文件备份保留。',confirmText:'删除副本'});if(reply.confirm&&this._alive&&this._copy)await this.mutate('remove');}
  catch(e){if(this._alive)this.setData({error:explain(e)});}
 },
 async mutate(action:'write'|'remove',places?:VaultCopy['places']){if(!this._copy||this.data.working)return;const generation=++this._generation;this.setData({working:true,error:''});
  try{const copy=await callPrivateVault(action,{expectedRevision:this._copy.revision,mutationId:uid(),...(action==='write'?{places}: {})});if(!this._alive||generation!==this._generation)return;this.show(copy);this.setData({status:action==='write'?'云端收藏副本已更新。手帐原照片请继续使用完整文件备份。':'云端副本已删除，本机收藏保留。'});}
  catch(e){if(this._alive&&generation===this._generation){this._copy=null;this.setData({known:false,error:explain(e)});}}
  finally{if(this._alive&&generation===this._generation)this.setData({working:false});}
 },
 async merge(){if(this.data.working||!this._copy?.present)return;const copy=this._copy;
  try{const reply=await wx.showModal({title:'合并到本机收藏？',content:'保留现有地点，相同坐标沿用本机记录；只添加本机没有的收藏。',confirmText:'合并收藏'});if(!reply.confirm||!this._alive)return;
   const added=mergeCloudPlaces(copy);this.localCount();this.setData({error:'',status:'已添加 '+added+' 个收藏地点，现有地点保留。'});
  }catch(e){if(this._alive)this.setData({error:explain(e)});}
 },
 back(){wx.navigateBack({fail:()=>wx.switchTab({url:'/pages/profile/index'})});}
});
