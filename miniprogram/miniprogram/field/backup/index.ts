import {readJournals} from '../../services/journal-model';
import {readSavedPlaces} from '../../services/saved-places';
import {BackupInfo,exportLocalBackup,inspectLocalBackup,restoreLocalBackup} from '../../services/local-backup';
import {beijingDateTime} from '../../services/observation-context';
type Tap=WechatMiniprogram.TouchEvent;
const explain=(e:unknown)=>e instanceof Error?e.message:'备份操作未完成，现有资料仍保留。';
Page({
  data:{rows:[] as Array<{id:string;title:string;chosen:boolean}>,placeCount:0,selected:0,working:false,picking:false,status:'',error:'',
    readyPath:'',readySize:'',readyPhotos:0,importInfo:null as (BackupInfo&{date:string;size:string})|null},
  _visible:false,_disposed:false,_generation:0,_importPath:'',
  onLoad(){this.refresh();},onShow(){this._visible=true;},
  onHide(){this._visible=false;if(this.data.working)this.cancel();},onUnload(){this._disposed=true;this.cancel();},
  refresh(){try{const journals=readJournals(),places=readSavedPlaces();this.setData({rows:journals.map(j=>({id:j.id,title:j.title,chosen:true})),selected:journals.length,placeCount:places.length,error:''});}catch(e){this.setData({error:explain(e)});}},
  choose(event:Tap){if(this.data.working)return;const rows=this.data.rows.map(r=>r.id===event.currentTarget.dataset.id?{...r,chosen:!r.chosen}:r);this.setData({rows,selected:rows.filter(r=>r.chosen).length});},
  all(){if(this.data.working)return;const chosen=this.data.selected!==this.data.rows.length;this.setData({rows:this.data.rows.map(r=>({...r,chosen})),selected:chosen?this.data.rows.length:0});},
  cancel(){this._generation++;if(!this._disposed)this.setData({working:false,status:'操作已暂停，现有资料仍保留。'});},
  async generate(){if(this.data.working||this.data.picking)return;const generation=++this._generation;this.setData({working:true,error:'',status:'正在读取收藏与手帐…',readyPath:''});
    try{const result=await exportLocalBackup(this.data.rows.filter(r=>r.chosen).map(r=>r.id),{current:()=>!this._disposed&&generation===this._generation,progress:status=>{if(generation===this._generation)this.setData({status});}});
      if(this._disposed||generation!==this._generation)return;this.setData({readyPath:result.path,readySize:(result.info.bytes/1024/1024).toFixed(2)+' MiB',readyPhotos:result.info.photos,status:'备份文件已生成。请继续发送或另存到微信之外。'});
    }catch(e){if(generation===this._generation)this.setData({error:explain(e),status:''});}finally{if(generation===this._generation)this.setData({working:false});}
  },
  share(){const path=this.data.readyPath;if(!path)return;
    if(typeof wx.shareFileMessage!=='function'){this.setData({error:'当前微信不支持发送备份文件，请更新微信后再导出。'});return;}
    // Native file sharing is user-controlled and can stay open indefinitely. Never lock the page on a timer.
    const fail=(e:unknown)=>{if(this._disposed||/cancel/i.test(String((e as {errMsg?:string})?.errMsg||'')))return;this.setData({error:'备份文件尚未发送，可再次操作。'});};
    try{const result=wx.shareFileMessage({filePath:path,fileName:'羽迹收藏与手帐备份.birdbackup',success:()=>{if(!this._disposed)this.setData({status:'已从文件发送界面返回。请确认文件已在电脑或手机「文件」中保存，再清除小程序全部数据。'});},fail}) as unknown as {catch?:(fn:(e:unknown)=>void)=>void}|undefined;result?.catch?.(fail);}catch(e){fail(e);}
  },
  async chooseBackup(){if(this.data.working||this.data.picking)return;this.setData({picking:true,error:''});
    try{const result=await wx.chooseMessageFile({count:1,type:'file',extension:['birdbackup']});if(this._disposed||!result.tempFiles[0])return;
      const path=result.tempFiles[0].path,info=inspectLocalBackup(path);this._importPath=path;this.setData({importInfo:{...info,date:beijingDateTime(info.created),size:(info.bytes/1024/1024).toFixed(2)+' MiB'},status:'已读取备份目录；确认恢复时会逐张校验照片。'});
    }catch(e){if(!this._disposed&&!/cancel/i.test(String((e as {errMsg?:string})?.errMsg||'')))this.setData({error:explain(e),importInfo:null});}finally{if(!this._disposed)this.setData({picking:false});}
  },
  async restore(){if(this.data.working||!this._importPath||!this.data.importInfo)return;
    try{const reply=await wx.showModal({title:'合并恢复这份备份？',content:'保留现有收藏和手帐。手帐ID冲突时新增恢复副本，不覆盖原件；全部照片校验成功后再保存。',confirmText:'合并恢复'});
      if(reply.confirm&&!this._disposed)await this.performRestore();
    }catch(e){if(!this._disposed)this.setData({error:explain(e)});}
  },
  async performRestore(){if(this.data.working||!this._importPath)return;const generation=++this._generation,path=this._importPath;this.setData({working:true,error:'',status:'正在校验备份…'});
    try{const result=await restoreLocalBackup(path,{current:()=>!this._disposed&&generation===this._generation,progress:status=>{if(generation===this._generation)this.setData({status});}});
      if(this._disposed||generation!==this._generation)return;this._importPath='';this.refresh();this.setData({importInfo:null,status:'已恢复 '+result.places+' 个收藏地点、'+result.journals+' 份手帐'+(result.copies?'（其中 '+result.copies+' 份为恢复副本）':'')+'。现有原件保留。'});
    }catch(e){if(generation===this._generation)this.setData({error:explain(e),status:''});}finally{if(generation===this._generation)this.setData({working:false});}
  },
  cloud(){wx.navigateTo({url:'/field/cloud-vault/index'});},
  back(){if(this.data.working){this.cancel();return;}wx.navigateBack({fail:()=>wx.switchTab({url:'/pages/profile/index'})});}
});
