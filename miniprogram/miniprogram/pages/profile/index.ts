import {api,community,Draft,hub,sessionState,setDraft} from '../../services/community';
import { localRepository, Observation, isSampleObservation, observationStats } from '../../services/repository';
import { choosePhoto, errorText, persistImage } from '../../services/media';
import { selectTab } from '../../services/tabs';
import { avatarCrop } from '../../services/crop';
import { round2, numberDraft, parseNumberDraft } from '../../services/numbers';
import { clamp } from '../../services/map-model';
import { getCanvas, loadCanvasImage, exportCanvas } from '../../services/canvas';
import { resetPageScroll } from '../../services/navigation';
import { observationTimeLabel, beijingDateTime } from '../../services/observation-context';

interface RecordView extends Observation {timeLabel:string;placeLabel:string;savedLabel:string;}

const avatars = [
  { id: 'owl', name: '夜枭' }, { id: 'finch', name: '林雀' }, { id: 'leaf', name: '绿叶' },
  { id: 'mountain', name: '山岚' }, { id: 'water', name: '湖光' }, { id: 'letter', name: '字母 B' }
];

Page({
  data: {localCloudId:'',localChannels:[] as {channel:string;status:string;reason:string;id:string}[],localStatusError:'',communityName:'',communityAvatar:'',numberEditing:'',numberDrafts:{} as Record<string,string>,cropBusy:false,name:'观鸟者',avatar:'/assets/avatars/owl.png',draftName:'',draftAvatar:'',edit:false,busy:false,avatarPersisted:true,error:'',records:[] as RecordView[],avatars,nativeAvatar:wx.canIUse('button.open-type.chooseAvatar'),view:'profile',observationCount:0,speciesCount:0,favoriteCount:0,favorites:[] as string[],shownRecords:[] as RecordView[],detail:null as RecordView|null,crop:false,cropPath:'',cropWidth:0,cropHeight:0,cropDisplayW:220,cropDisplayH:220,cropZoom:1,cropRotation:0,cropX:0,cropY:0,storageKB:0,menu:[{id:'account',icon:'user',name:'社区账号与隐私'},{id:'groups',icon:'chat',name:'观鸟群聊'},{id:'cloud',icon:'pin',name:'云端私人观察'},{id:'publications',icon:'leaf',name:'我的社区发布'},{id:'history',icon:'clock',name:'观察与识别历史'},{id:'collection',icon:'collection',name:'我的收藏'},{id:'saved',icon:'collection',name:'保存的他人内容'},{id:'places',icon:'pin',name:'地点收藏与打卡'},{id:'friends',icon:'user',name:'我的好友'},{id:'chat',icon:'chat',name:'私信与通知'},{id:'badges',icon:'leaf',name:'徽章与成长'},{id:'settings',icon:'settings',name:'设置与缓存'}],pageTitle:'羽迹',savedPlaces:[] as Array<{name:string;saved:boolean;checked:boolean}>,savedPosts:[] as Array<{id:string;title:string}>},
  _pickToken: 0,
  _cropDrag:null as {x:number;y:number;offsetX:number;offsetY:number}|null,
  onShow() {
    selectTab(this, 4);
    this.setData({communityName:'',communityAvatar:''});
    if(sessionState()==='active')void api(community+'/account').then(account=>{
      if(sessionState()==='active' && account.profile)this.setData({communityName:account.profile.nickname,communityAvatar:'/assets/avatars/'+account.profile.avatar+'.png'});
    }).catch(()=>{});
    if (this.data.edit) return;
    try {
      const repository = localRepository(), profile = repository.profile();
      const records=repository.list().map(r=>({...r,sample:isSampleObservation(r),timeLabel:observationTimeLabel(r),placeLabel:r.placeName||'未添加',savedLabel:beijingDateTime(r.createdAt)})),favorites=wx.getStorageSync('bird-assistant.favorites.v1')||[];
      if(!Array.isArray(favorites)||!favorites.every(id=>typeof id==='string'))throw new Error('本机收藏格式无法读取，已有内容未覆盖。');
      this.setData({name:profile.name,avatar:profile.avatar,records,favorites,...observationStats(records,favorites),shownRecords:this.data.view==='collection'?records.filter(r=>favorites.includes(r.id)):records,detail:this.data.detail?records.find(r=>r.id===this.data.detail?.id)||null:null,error:''});
      if(this.data.view==='detail' && this.data.detail)void this.loadLocalStatus(this.data.detail);
    } catch (error) { this.setData({ error: errorText(error) }); }
  },
  onUnload() { this._pickToken++; },
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
  menu(e:WechatMiniprogram.TouchEvent){const view=String(e.currentTarget.dataset.id),item=this.data.menu.find(m=>m.id===view);const destinations:Record<string,string>={friends:'friends',account:'account',groups:'groups',chat:'inbox',badges:'growth',saved:'bookmarks',cloud:'observations',publications:'mine'};if(destinations[view]){hub(destinations[view]);return;}if(!item)return;try{const shownRecords=view==='collection'?this.data.records.filter(r=>this.data.favorites.includes(r.id)):this.data.records,activity=wx.getStorageSync('bird-assistant.place-demo.v1')||{},names:Record<string,string>={lake:'湖畔公园',wood:'林间小径',reed:'芦苇栈道',lookout:'湖畔观鸟台',grove:'松林休憩点',gate:'林间入口'};this.setData({view,pageTitle:item.name,shownRecords,savedPlaces:Object.keys(activity).filter(k=>activity[k].saved||activity[k].checked).map(k=>({name:names[k]||k,saved:!!activity[k].saved,checked:!!activity[k].checked})),savedPosts:(wx.getStorageSync('bird-assistant.community-demo.v1')||[]).filter((p:{saved:boolean})=>p.saved),storageKB:wx.getStorageInfoSync().currentSize,error:''});resetPageScroll(this);}catch(error){this.setData({error:errorText(error)});}},
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
  openRecord(e:WechatMiniprogram.TouchEvent){const detail=this.data.records.find(r=>r.id===e.currentTarget.dataset.id);if(detail){this.setData({detail,view:'detail',pageTitle:'观察详情'});void this.loadLocalStatus(detail);resetPageScroll(this);}},
  playAudio(){if(!this.data.detail)return;const player=wx.createInnerAudioContext();player.src=this.data.detail.imagePath;player.onEnded(()=>player.destroy());player.onError(()=>{player.destroy();this.setData({error:'声音暂时无法回放，记录仍保留。'});});player.play();},
  favorite(){const r=this.data.detail;if(!r)return;const favorites=this.data.favorites.includes(r.id)?this.data.favorites.filter(id=>id!==r.id):[...this.data.favorites,r.id];try{wx.setStorageSync('bird-assistant.favorites.v1',favorites);this.setData({favorites,...observationStats(this.data.records,favorites)});wx.showToast({title:favorites.includes(r.id)?'已加入我的收藏':'已移除收藏',icon:'none'});}catch(error){this.setData({error:errorText(error)});}},
  back(){if(this.data.crop){this.setData({crop:false});return;}if(this.data.edit){this.cancel();return;}this.setData({view:'profile',pageTitle:'羽迹',error:''});resetPageScroll(this);},
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
