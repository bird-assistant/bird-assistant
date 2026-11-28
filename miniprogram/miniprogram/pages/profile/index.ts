import {publicGuideCacheInfo,clearPublicGuideCache} from '../../services/public-guide-photos';
import {readSavedPlaces,savePlace,removeSavedPlace,SavedPlace} from '../../services/saved-places';
import {previewCacheInfo,clearPreviewCache,PreviewCacheInfo} from '../../services/preview-cache';
import {connectBusiness} from '../../services/vision-network';
import {writingReadiness} from '../../services/writing-network';
import {diagnosticText} from '../../services/diagnostics';
import {queueObservationReview} from '../../services/draft-navigation';
import {api,community,Draft,hub,openMap,sessionState,sessionRevision,setDraft} from '../../services/community';
import {LocalAudioPlayback} from '../../services/audio-playback';
import { localRepository, Observation, isSampleObservation, observationStats } from '../../services/repository';
import { choosePhoto, errorText, persistImage } from '../../services/media';
import { selectTab } from '../../services/tabs';
import { avatarCrop } from '../../services/crop';
import { round2, numberDraft, parseNumberDraft } from '../../services/numbers';
import { clamp } from '../../services/map-model';
import { getCanvas, loadCanvasImage, exportCanvas } from '../../services/canvas';
import { navigate,resetPageScroll } from '../../services/navigation';
import { observationTimeLabel, beijingDateTime } from '../../services/observation-context';

interface RecordView extends Observation {timeLabel:string;placeLabel:string;savedLabel:string;}

const avatars = [
  { id: 'owl', name: '夜枭' }, { id: 'finch', name: '林雀' }, { id: 'leaf', name: '绿叶' },
  { id: 'mountain', name: '山岚' }, { id: 'water', name: '湖光' }, { id: 'letter', name: '字母 / 姓名' }
];

const menuGroups=[
  {title:'记录与手帐',ids:['notes','journal','history','collection','places','tripHistory']},
  {title:'鸟友社区',ids:['publications','saved','friends','chat','groups','cloud']},
  {title:'账号与偏好',ids:['account','badges','backup','settings']}
];
const menu=[{id:'backup',icon:'image',name:'本机备份与恢复'},{id:'notes',icon:'journal',name:'我的随手记'},{id:'journal',icon:'journal',name:'我的手帐'},{id:'account',icon:'user',name:'社区账号与隐私'},{id:'groups',icon:'chat',name:'观鸟群聊'},{id:'cloud',icon:'pin',name:'云端私人观察'},{id:'publications',icon:'leaf',name:'我的社区发布'},{id:'history',icon:'clock',name:'观察与识别历史'},{id:'tripHistory',icon:'leaf',name:'观鸟咨询记录'},{id:'collection',icon:'collection',name:'收藏的本机观察'},{id:'saved',icon:'collection',name:'社区内容书签'},{id:'places',icon:'pin',name:'收藏地点'},{id:'friends',icon:'user',name:'我的好友'},{id:'chat',icon:'chat',name:'私信与通知'},{id:'badges',icon:'leaf',name:'徽章与成长'},{id:'settings',icon:'settings',name:'设置与缓存'}];
Page({
  data: {identityLoading:false,identityError:'',communityHandle:'',communityMemberId:'',communityActive:false,guideCacheInfo:null as {files:number;kilobytes:number}|null,guideCacheError:'',guideCacheNotice:'',localCloudId:'',localChannels:[] as {channel:string;status:string;reason:string;id:string}[],localStatusError:'',communityName:'',communityAvatar:'',numberEditing:'',numberDrafts:{} as Record<string,string>,cropBusy:false,name:'观鸟者',avatar:'/assets/avatars/owl.png',draftName:'',draftAvatar:'',edit:false,busy:false,avatarPersisted:true,error:'',records:[] as RecordView[],avatars,nativeAvatar:wx.canIUse('button.open-type.chooseAvatar'),view:'profile',observationCount:0,speciesCount:0,favoriteCount:0,favorites:[] as string[],shownRecords:[] as RecordView[],detail:null as RecordView|null,crop:false,cropPath:'',cropWidth:0,cropHeight:0,cropDisplayW:220,cropDisplayH:220,cropZoom:1,cropRotation:0,cropX:0,cropY:0,storageKB:0,menu,menuGroups:menuGroups.map(group=>({title:group.title,items:group.ids.map(id=>menu.find(item=>item.id===id)!)})),pageTitle:'羽迹',savedPlaces:[] as Array<SavedPlace&{dateLabel:string}>,placesBusy:false,cacheInfo:null as PreviewCacheInfo|null,cacheError:'',cacheNotice:'',writingChecking:false,writingStatus:'',writingReady:false,savedPosts:[] as Array<{id:string;title:string}>},
  _pickToken: 0,_visible:false,_profileGeneration:0,_writingCheck:0,
  _player:null as LocalAudioPlayback|null,
  _cropDrag:null as {x:number;y:number;offsetX:number;offsetY:number}|null,
  onShow() {
    this._visible=true;const generation=++this._profileGeneration,revision=sessionRevision();
    selectTab(this, 4);
    this.setData({communityName:'',communityAvatar:'',communityHandle:'',communityMemberId:'',communityActive:sessionState()==='active',identityLoading:sessionState()==='active',identityError:''});
    if(sessionState()==='active')void api(community+'/account').then(account=>{
      if(this._visible&&generation===this._profileGeneration&&revision===sessionRevision()&&sessionState()==='active')this.setData({identityLoading:false,communityMemberId:account.id,communityHandle:account.profile?.handle||'',communityName:account.profile?.nickname||'',communityAvatar:account.profile?'/assets/avatars/'+account.profile.avatar+'.png':''});
    }).catch(()=>{if(this._visible&&generation===this._profileGeneration&&revision===sessionRevision())this.setData({identityLoading:false,identityError:'社区资料暂未读取成功，可打开社区账号重试。'});});
    if (this.data.edit) return;
    try {
      const repository = localRepository(), profile = repository.profile();
      const records=repository.list().map(r=>({...r,sample:isSampleObservation(r),timeLabel:observationTimeLabel(r),placeLabel:r.placeName||'未添加',savedLabel:beijingDateTime(r.createdAt)})),favorites=wx.getStorageSync('bird-assistant.favorites.v1')||[];
      if(!Array.isArray(favorites)||!favorites.every(id=>typeof id==='string'))throw new Error('本机收藏格式无法读取，已有内容未覆盖。');
      this.setData({name:profile.name,avatar:profile.avatar,records,favorites,...observationStats(records,favorites),shownRecords:this.data.view==='collection'?records.filter(r=>favorites.includes(r.id)):records,detail:this.data.detail?records.find(r=>r.id===this.data.detail?.id)||null:null,error:''});
      if(this.data.view==='detail' && this.data.detail)void this.loadLocalStatus(this.data.detail);
    } catch (error) { this.setData({ error: errorText(error) }); }
    if(this.data.view==='places')this.loadPlaces();
    if(this.data.view==='settings')this.refreshSettings();
  },
  onHide(){this._visible=false;this._profileGeneration++;this._writingCheck++;if(this.data.writingChecking)this.setData({writingChecking:false,writingStatus:'检查已暂停，可返回后重新检查。'});this._player?.stop();},
  onUnload() { this._visible=false;this._profileGeneration++;this._writingCheck++;this._player?.stop();this._pickToken++; },
  edit() { this.setData({edit:true,view:'edit',pageTitle:'编辑资料',draftName:this.data.name,draftAvatar:this.data.avatar,avatarPersisted:true,error:''});resetPageScroll(this); },
  changeName(event: WechatMiniprogram.CustomEvent<{ value: string }>) { this.setData({ draftName: event.detail.value }); },
  chooseDefault(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id);
    if (avatars.some(avatar => avatar.id === id)) { this._pickToken++; this.setData({ draftAvatar: '/assets/avatars/' + id + '.png', avatarPersisted: true }); }
  },
  chooseAvatar(event: WechatMiniprogram.CustomEvent<{ avatarUrl?: string }>) {
    if (this.data.edit&&!this.data.busy&&event.detail.avatarUrl) { this._pickToken++; this.setData({ draftAvatar: event.detail.avatarUrl, avatarPersisted: false, error: '' }); }
  },
  avatarError(event:WechatMiniprogram.CustomEvent<{errMsg?:string}>){
    if(!this.data.edit||this.data.busy)return;
    // Native chooser cancellation is expected; preserve the entire draft.
    if(/cancel/i.test(event.detail.errMsg||''))return;
    this.setData({error:'系统头像选择未完成，可重试或上传自己的图片。'});
  },
  chooseFallback() {
    const token = ++this._pickToken;
    choosePhoto(['album']).then(path=>{if(path&&token===this._pickToken&&this.data.edit)wx.getImageInfo({src:path,success:info=>{if(token!==this._pickToken)return;this.setData({crop:true,cropPath:info.path,cropWidth:info.width,cropHeight:info.height,cropZoom:1,cropRotation:0,cropX:0,cropY:0});this.fitCrop();resetPageScroll(this);},fail:()=>this.setData({error:'图片无法读取，原头像仍保留。'})});}).catch(error=>{if(token===this._pickToken)this.setData({error:errorText(error)});});
  },
  cancel() { if (this.data.busy) return; this._pickToken++; this.setData({edit:false,view:'profile',pageTitle:'羽迹',crop:false,error:''});resetPageScroll(this); },
  save() {
    if (this.data.busy) return;
    if (!this.data.draftName.trim()) { this.setData({ error: '请填写显示名称。' }); return; }
    this.setData({ busy: true, error: '' });
    const persist = this.data.avatarPersisted ? Promise.resolve(this.data.draftAvatar) : persistImage(this.data.draftAvatar);
    persist.then(avatar => {
      this.setData({ draftAvatar: avatar, avatarPersisted: true });
      const profile = localRepository().saveProfile({ name: this.data.draftName, avatar });
      this._pickToken++;this.setData({name:profile.name,avatar:profile.avatar,edit:false,busy:false,view:'profile',pageTitle:'羽迹'});resetPageScroll(this);
      wx.showToast({ title: '已保存在本机', icon: 'success' });
    }).catch(error => this.setData({ busy: false, error: errorText(error) }));
  },
  preview(event: WechatMiniprogram.TouchEvent) {
    const record = this.data.records.find(item => item.id === event.currentTarget.dataset.id);
    if (record) wx.previewImage({ urls: [record.imagePath], fail: () => wx.showToast({ title: '照片暂时无法显示，记录仍保留', icon: 'none' }) });
  },
  menu(e:WechatMiniprogram.TouchEvent){
    const view=String(e.currentTarget.dataset.id);
    if(view==='backup'){navigate({url:'/field/backup/index'});return;}
    if(view==='notes'){navigate({url:'/field/notes/index'});return;}
    if(view==='journal'){wx.switchTab({url:'/pages/journal/index'});return;}
    if(view==='tripHistory'){navigate({url:'/field/trip/index?history=1'});return;}
    const item=this.data.menu.find(m=>m.id===view),destinations:Record<string,string>={friends:'friends',account:'account',groups:'groups',chat:'inbox',badges:'growth',saved:'bookmarks',cloud:'observations',publications:'mine'};
    if(destinations[view]){hub(destinations[view]);return;}if(!item)return;
    this.setData({view,pageTitle:item.name,shownRecords:view==='collection'?this.data.records.filter(r=>this.data.favorites.includes(r.id)):this.data.records,error:''});
    if(view==='places')this.loadPlaces();if(view==='settings')this.refreshSettings();resetPageScroll(this);
  },
  loadPlaces(){try{this.setData({savedPlaces:readSavedPlaces().map(place=>({...place,dateLabel:beijingDateTime(place.updatedAt)})),error:''});}catch(error){this.setData({error:errorText(error)});}},
  async addPlace(){
    if(this.data.placesBusy)return;const token=++this._pickToken;this.setData({placesBusy:true,error:''});
    try{const place=await wx.chooseLocation({});if(token!==this._pickToken||this.data.view!=='places')return;
      savePlace({name:place.name,address:place.address||'',latitude:place.latitude,longitude:place.longitude});this.loadPlaces();wx.showToast({title:'地点已收藏',icon:'success'});
    }catch(error){if(token===this._pickToken&&!/cancel/i.test(String((error as {errMsg?:string})?.errMsg||'')))this.setData({error:errorText(error)});}
    finally{if(token===this._pickToken)this.setData({placesBusy:false});}
  },
  openPlace(e:WechatMiniprogram.TouchEvent){
    const place=this.data.savedPlaces.find(item=>item.id===e.currentTarget.dataset.id);if(!place)return;
    openMap(place,'','所有鸟种',0,{scale:15,precisionLabel:'收藏地点 · '+place.name});
  },
  deletePlace(e:WechatMiniprogram.TouchEvent){
    const place=this.data.savedPlaces.find(item=>item.id===e.currentTarget.dataset.id);if(!place)return;
    wx.showModal({title:'移除收藏地点？',content:place.name,confirmText:'移除',success:reply=>{if(!reply.confirm||this.data.view!=='places')return;try{removeSavedPlace(place.id);this.loadPlaces();}catch(error){this.setData({error:errorText(error)});}}});
  },
  refreshSettings(){
    try{this.setData({guideCacheInfo:publicGuideCacheInfo(),guideCacheError:''});}catch(error){this.setData({guideCacheInfo:null,guideCacheError:errorText(error)});}
    try{this.setData({storageKB:wx.getStorageInfoSync().currentSize,cacheInfo:previewCacheInfo(),cacheError:''});}
    catch(error){this.setData({cacheInfo:null,cacheError:errorText(error)});}
  },
  cleanGuideCache(){
    try{const result=clearPublicGuideCache();this.setData({guideCacheNotice:'已清理 '+result.removed+' 张公开图鉴照片'+(result.remaining?'，'+result.remaining+' 张稍后可重试清理':'')+'。',guideCacheError:''});this.refreshSettings();}
    catch(error){this.setData({guideCacheError:errorText(error)});}
  },
  cleanPreviewCache(){
    if(!this.data.cacheInfo)return;
    wx.showModal({title:'清理手帐预览缓存？',content:'只移除可重新生成的缩略图与索引。手帐、撤销历史、帖子草稿、AI建议、观察原图和账号资料保留。',confirmText:'清理预览',success:reply=>{
      if(!reply.confirm||this.data.view!=='settings')return;
      try{const result=clearPreviewCache();this.setData({cacheNotice:result.failed?'已清理部分预览，有些缓存暂未释放，可稍后重试。':'预览缓存已清理，下次打开手帐时重新生成。'});this.refreshSettings();}
      catch(error){this.setData({cacheError:errorText(error)});}
    }});
  },
  async checkWriting(){
    if(this.data.writingChecking)return;
    if(sessionState()!=='active'){this.setData({writingStatus:'请先登录社区账号，再检查手机写作服务。',writingReady:false});return;}
    const generation=++this._writingCheck,revision=sessionRevision();this.setData({writingChecking:true,writingStatus:'正在检查服务配置…',writingReady:false});
    const current=()=>this._visible&&generation===this._writingCheck&&revision===sessionRevision()&&sessionState()==='active';
    try{const connection=await connectBusiness();if(!current())return;await writingReadiness(connection.origin,connection.header.Authorization?.replace(/^Bearer /,'')||'');
      if(current())this.setData({writingReady:true,writingStatus:'手机写作服务已就绪。可在手帐或帖子中生成建议。'});
    }catch(error){if(current())this.setData({writingReady:false,writingStatus:errorText(error)});}
    finally{if(current())this.setData({writingChecking:false});}
  },
  async loadLocalStatus(detail:RecordView){
    this.setData({localCloudId:'',localChannels:[],localStatusError:''});
    if(detail.sample || (detail.mediaKind && detail.mediaKind!=='photo') || sessionState()==='out')return;
    try{
      const reference=detail.communityDraft?.reference || detail.id;
      const state=await api('/api/v2/observations/by-reference/'+encodeURIComponent(reference));
      if(this.data.detail?.id===detail.id)this.setData({localCloudId:state.id||'',localChannels:state.channels});
    }catch{if(this.data.detail?.id===detail.id)this.setData({localStatusError:'暂时无法读取公开进度'});}
  },
  localShare(){
    const detail=this.data.detail;
    if(!detail || detail.sample || (detail.mediaKind && detail.mediaKind!=='photo'))return;
    if(this.data.localCloudId){hub('record',this.data.localCloudId);return;}
    const draft:Draft=detail.communityDraft || {reference:detail.id,path:detail.imagePath,species:null,speciesName:'待鉴定',analysis:detail.analysis?.analysisId||null,target:null,
      date:detail.observedDate||'',time:detail.observedAt?beijingDateTime(detail.observedAt).slice(11,16):'',note:detail.notes,place:detail.placeName||'',point:null,device:''};
    setDraft({...draft,path:detail.imagePath});hub('publish');
  },
  localSpecies(){const species=this.data.detail?.communityDraft?.species;if(species)hub('species',species);},
  copyDiagnostics(){try{wx.setClipboardData({data:diagnosticText()});}catch(error){this.setData({error:errorText(error)});}},
  reviewLocal(){const id=this.data.detail?.id;if(id){queueObservationReview(id);wx.switchTab({url:'/pages/identify/index'});}},
  openRecord(e:WechatMiniprogram.TouchEvent){this._player?.stop();const detail=this.data.records.find(r=>r.id===e.currentTarget.dataset.id);if(detail){this.setData({detail,view:'detail',pageTitle:'观察详情'});void this.loadLocalStatus(detail);resetPageScroll(this);}},
  playAudio(){if(!this.data.detail)return;if(!this._player)this._player=new LocalAudioPlayback(()=>this.setData({error:'声音暂时无法回放，记录仍保留。'}));this._player.play(this.data.detail.imagePath);},
  favorite(){const r=this.data.detail;if(!r)return;const favorites=this.data.favorites.includes(r.id)?this.data.favorites.filter(id=>id!==r.id):[...this.data.favorites,r.id];try{wx.setStorageSync('bird-assistant.favorites.v1',favorites);this.setData({favorites,...observationStats(this.data.records,favorites)});wx.showToast({title:favorites.includes(r.id)?'已加入我的收藏':'已移除收藏',icon:'none'});}catch(error){this.setData({error:errorText(error)});}},
  back(){this._player?.stop();if(this.data.crop){this.setData({crop:false});return;}if(this.data.edit){this.cancel();return;}this.setData({view:'profile',pageTitle:'羽迹',error:''});resetPageScroll(this);},
  fitCrop(){const d=this.data,box=avatarCrop(d.cropWidth,d.cropHeight,d.cropZoom,d.cropRotation,d.cropX,d.cropY);this.setData({cropDisplayW:round2(box.cropDisplayW),cropDisplayH:round2(box.cropDisplayH),cropX:round2(box.cropX),cropY:round2(box.cropY)});},
  setCropValue(key:string,value:number){if(!Number.isFinite(value))return;if(key==='cropZoom')this.setData({cropZoom:round2(clamp(value,1,3))});else if(key==='cropRotation')this.setData({cropRotation:round2(clamp(value,-180,180))});else return;this.fitCrop();},
  cropZoom(e:WechatMiniprogram.CustomEvent<{value:number}>){this.setData({numberEditing:''});this.setCropValue('cropZoom',Number(e.detail.value));},
  numberInput(e:WechatMiniprogram.CustomEvent<{value:string}>){const key=String(e.currentTarget.dataset.key);if(!['cropZoom','cropRotation'].includes(key))return '';const current=String(key==='cropZoom'?this.data.cropZoom:this.data.cropRotation),previous=this.data.numberEditing===key?this.data.numberDrafts[key]??current:current,text=numberDraft(e.detail.value,previous);this.setData({numberEditing:key,numberDrafts:{...this.data.numberDrafts,[key]:text}});const value=parseNumberDraft(text);if(value!==null)this.setCropValue(key,value);return text;},
  numberCommit(e:WechatMiniprogram.CustomEvent<{value:string}>){const key=String(e.currentTarget.dataset.key);if(this.data.numberEditing!==key)return;const value=parseNumberDraft(this.data.numberDrafts[key]||'');if(value!==null)this.setCropValue(key,value);this.setData({numberEditing:''});},
  rotate(e:WechatMiniprogram.TouchEvent){this.setData({cropRotation:round2((this.data.cropRotation+Number(e.currentTarget.dataset.delta)+540)%360-180),cropX:0,cropY:0,numberEditing:''});this.fitCrop();},
  resetCropRotation(){this.setData({cropRotation:0,cropX:0,cropY:0,numberEditing:''});this.fitCrop();},
  cropStart(e:WechatMiniprogram.TouchEvent){const t=e.touches[0];this._cropDrag={x:t.clientX,y:t.clientY,offsetX:this.data.cropX,offsetY:this.data.cropY};},
  cropMove(e:WechatMiniprogram.TouchEvent){const g=this._cropDrag,t=e.touches[0];if(g&&t){this.setData({cropX:g.offsetX+t.clientX-g.x,cropY:g.offsetY+t.clientY-g.y});this.fitCrop();}},
  cropEnd(){this._cropDrag=null;},cancelCrop(){this.setData({crop:false});},
  async useCrop(){
    if(this.data.cropBusy)return;const d={...this.data};this.setData({cropBusy:true,error:''});
    try{
      const canvas=await getCanvas(this,'#avatar-export',512,512),ctx=canvas.getContext('2d'),image=await loadCanvasImage(canvas,d.cropPath),k=512/220;
      ctx.fillStyle='#fffef9';ctx.fillRect(0,0,512,512);ctx.save();ctx.translate(256+d.cropX*k,256+d.cropY*k);ctx.rotate(d.cropRotation*Math.PI/180);ctx.drawImage(image,-d.cropDisplayW*k/2,-d.cropDisplayH*k/2,d.cropDisplayW*k,d.cropDisplayH*k);ctx.restore();
      const path=await exportCanvas(canvas);this.setData({draftAvatar:path,avatarPersisted:false,crop:false});resetPageScroll(this);
    }catch(error){this.setData({error:errorText(error)});}finally{this.setData({cropBusy:false});}
  }
});
