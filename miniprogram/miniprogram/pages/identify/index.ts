import { choosePhoto, errorText, persistImage } from '../../services/media';
import { localRepository } from '../../services/repository';
import { selectTab } from '../../services/tabs';
import { layout } from '../../services/layout';
import { resetPageScroll } from '../../services/navigation';
import { cameraZoom, cameraZoomMax, zoomFromDrag, zoomShortcuts, zoomTicks, DEMO_MAX_ZOOM } from '../../services/camera-zoom';
import { ContextInput, beijingDate, observationContext } from '../../services/observation-context';

interface Evidence extends ContextInput {id:string;path:string;kind:'photo'|'video'|'audio';source:'album'|'camera';sample:boolean;persisted:boolean;album:string;birdName:string;notes:string;}

Page({
  data: {contextOpen:false,observedDate:'',observedTime:'',placeName:'',today:beijingDate(),zoomText:'1.0',zoomEnabled:false,zoomWidth:320,zoomTicks:zoomTicks(1,1,320),zoomShortcuts:zoomShortcuts(1),zoomRange:'相机准备中',imagePath:'',source:'album' as 'album'|'camera',birdName:'',notes:'',error:'',busy:false,picking:false,persisted:false,view:'live',height:600,mode:'quick',help:false,paused:false,demo:false,cameraReady:false,cameraError:'',zoom:1,maxZoom:1,focus:'visual',expanded:false,audio:true,recording:false,recordSeconds:0,assets:[] as Evidence[],importKind:'gallery',currentId:'',mediaKind:'photo' as 'photo'|'video'|'audio',albumStatus:'',audioRecording:false },
  _zoomSession:0,
  _zoomPending:null as number|null,
  _zoomInFlight:false,
  _zoomConfirmed:1,
  _zoomDrag:null as {x:number;zoom:number}|null,
  _pickToken: 0,
  _camera:null as WechatMiniprogram.CameraContext|null,
  _holdTimer:0 as ReturnType<typeof setTimeout>,
  _recordTimer:0 as ReturnType<typeof setInterval>,
  _suppressTap:false,
  _holding:false,
  _recorder:null as WechatMiniprogram.RecorderManager|null,
  onLoad(){const box=layout();this.setData({height:box.height,zoomWidth:Math.max(180,box.width-24)});this._camera=wx.createCameraContext();this.updateZoomView(1);},
  onResize(){const box=layout();this.setData({height:box.height,zoomWidth:Math.max(180,box.width-24)});this.updateZoomView(this.data.zoom);},
  onShow() { this.setData({today:beijingDate()});selectTab(this, 2);if(this.data.view==='live'){this.setData({paused:false});this.updateZoomView(this.data.zoom);} },
  onHide(){this.resetZoomRequests();this.setData({cameraReady:false});this._holding=false;clearTimeout(this._holdTimer);if(this.data.recording)this.stopVideo();if(this.data.audioRecording)this._recorder?.stop();this.setData({paused:true});this.updateZoomView(this.data.zoom);},
  onUnload() { this.resetZoomRequests();this._pickToken++;this._holding=false;clearTimeout(this._holdTimer);clearInterval(this._recordTimer); },
  choose(event: WechatMiniprogram.TouchEvent) {
    if (this.data.busy || this.data.picking) return;
    const source = event.currentTarget.dataset.source === 'camera' ? 'camera' : 'album';
    const token = ++this._pickToken;
    this.setData({ picking: true });
    choosePhoto([source]).then(path => {
      if (token !== this._pickToken) return;
      if(path){this.addEvidence(path,'photo',source);this.setData({imagePath:path,source,persisted:false,picking:false,error:'',view:'review',mediaKind:'photo'});resetPageScroll(this);}else this.setData({picking:false});
    }).catch(error => { if (token === this._pickToken) this.setData({ picking: false, error: errorText(error) }); });
  },
  retainReviewDraft(){const a=this.data.assets.find(item=>item.id===this.data.currentId);if(a){a.birdName=this.data.birdName;a.notes=this.data.notes;a.observedDate=this.data.observedDate;a.observedTime=this.data.observedTime;a.placeName=this.data.placeName;}},
  changeName(event: WechatMiniprogram.CustomEvent<{ value: string }>) { if(this.data.busy)return;this.setData({ birdName: event.detail.value });this.retainReviewDraft(); },
  changeNotes(event: WechatMiniprogram.CustomEvent<{ value: string }>) { if(this.data.busy)return;this.setData({ notes: event.detail.value });this.retainReviewDraft(); },
  toggleContext(){if(!this.data.busy)this.setData({contextOpen:!this.data.contextOpen,today:beijingDate()});},
  changeContext(event:WechatMiniprogram.CustomEvent<{value:string}>){
    if(this.data.busy)return;const key=String(event.currentTarget.dataset.key);
    if(!['observedDate','observedTime','placeName'].includes(key))return;
    const input:ContextInput={observedDate:this.data.observedDate,observedTime:this.data.observedTime,placeName:this.data.placeName};
    input[key as keyof ContextInput]=event.detail.value;
    // A new day needs its own optional time, rather than inheriting a previous day's clock reading.
    if(key==='observedDate')input.observedTime='';
    try{observationContext(input,new Date().toISOString());this.setData({...input,error:''});this.retainReviewDraft();}
    catch(error){this.setData({error:error instanceof Error?error.message:'观察信息未更新，请重试。'});}
  },
  clearObservedDate(){if(this.data.busy)return;this.setData({observedDate:'',observedTime:'',error:''});this.retainReviewDraft();},
  clearObservedTime(){if(this.data.busy)return;this.setData({observedTime:'',error:''});this.retainReviewDraft();},
  preview() {
    if(this.data.mediaKind==='audio'){const player=wx.createInnerAudioContext();player.src=this.data.imagePath;player.onEnded(()=>player.destroy());player.onError(()=>{player.destroy();this.setData({error:'音频回放未完成，素材仍保留。'});});player.play();return;}
    if (this.data.imagePath&&this.data.mediaKind==='photo') wx.previewImage({ urls: [this.data.imagePath], fail: () => wx.showToast({ title: '预览未完成，当前素材仍保留', icon: 'none' }) });
  },
  save() {
    if (this.data.busy || this.data.picking || !this.data.imagePath) return;
    try{observationContext(this.data,new Date().toISOString());}
    catch(error){this.setData({contextOpen:true,error:error instanceof Error?error.message:'请检查观察信息。'});return;}
    this.retainReviewDraft();
    // Freeze the selected draft while the filesystem acknowledges persistence.
    const draft={id:this.data.currentId,source:this.data.source,birdName:this.data.birdName,notes:this.data.notes,mediaKind:this.data.mediaKind,observedDate:this.data.observedDate,observedTime:this.data.observedTime,placeName:this.data.placeName};
    const selected=this.data.assets.find(a=>a.id===draft.id);
    this.setData({ busy: true, error: '' });
    const persist = this.data.persisted ? Promise.resolve(this.data.imagePath) : persistImage(this.data.imagePath);
    persist.then(imagePath => {
      // Retain the durable path even if the following storage write fails, so retry remains possible.
      if(this.data.currentId===draft.id)this.setData({ imagePath, persisted: true });
      if(selected){selected.path=imagePath;selected.persisted=true;this.setData({assets:this.data.assets});}
      localRepository().save({imagePath,source:draft.source,birdName:draft.birdName,notes:draft.notes,mediaKind:draft.mediaKind,sample:!!selected?.sample,observedDate:draft.observedDate,observedTime:draft.observedTime,placeName:draft.placeName});
      this._pickToken++;
      this.setData({busy:false,assets:this.data.assets.filter(a=>a.id!==draft.id),...(this.data.currentId===draft.id?{imagePath:'',birdName:'',notes:'',observedDate:'',observedTime:'',placeName:'',contextOpen:false,persisted:false,currentId:'',albumStatus:''}:{}),view:'review'});
      wx.showToast({ title: '已保存在本机', icon: 'success' });
    }).catch(error => this.setData({ busy: false, error: errorText(error) }));
  },
  mode(e:WechatMiniprogram.TouchEvent){this.setData({mode:String(e.currentTarget.dataset.id),help:false});},
  help(){this.setData({help:!this.data.help});},
  resetZoomRequests(){this._zoomSession++;this._zoomPending=null;this._zoomInFlight=false;this._zoomDrag=null;},
  zoomLimit(){return this.data.demo?DEMO_MAX_ZOOM:this.data.maxZoom;},
  updateZoomView(raw:number){
    const limit=this.zoomLimit(),value=cameraZoom(raw,limit),available=this.data.demo||(this.data.cameraReady&&typeof this._camera?.setZoom==='function');
    const enabled=available&&!this.data.paused&&limit>1;
    const range=this.data.demo?'示例变焦 1.0–5.0×':this.data.cameraError?'相机不可用':this.data.paused?'取景已暂停':!this.data.cameraReady?'相机准备中':!available?'当前环境不提供变焦':limit<=1?'当前相机仅支持 1.0×':'当前相机 1.0–'+limit.toFixed(1)+'×';
    this.setData({zoom:value,zoomText:value.toFixed(1),zoomEnabled:enabled,zoomRange:range,zoomTicks:zoomTicks(value,limit,this.data.zoomWidth),zoomShortcuts:zoomShortcuts(limit)});
  },
  pause(){if(this.data.recording)this.stopVideo();this.resetZoomRequests();this.setData({paused:!this.data.paused,cameraReady:false});this.updateZoomView(this.data.zoom);},
  demo(){if(this.data.busy||this.data.recording)return;this.resetZoomRequests();this._zoomConfirmed=1;this.setData({demo:!this.data.demo,cameraError:'',paused:false,cameraReady:false,maxZoom:1});this.updateZoomView(1);},
  cameraReady(e:WechatMiniprogram.CustomEvent<{maxZoom:number|string}>){
    this.resetZoomRequests();this._zoomConfirmed=1;this.setData({cameraReady:true,cameraError:'',maxZoom:cameraZoomMax(e.detail.maxZoom)});
    const desired=cameraZoom(this.data.zoom,this.data.maxZoom);this.updateZoomView(desired);if(desired>1&&this.data.zoomEnabled){this._zoomPending=desired;this.flushZoom();}
  },
  cameraError(e:WechatMiniprogram.CustomEvent<{errMsg:string}>){console.warn('[Bird Assistant] camera',e.detail);this.resetZoomRequests();this._zoomConfirmed=1;this.setData({cameraReady:false,maxZoom:1,cameraError:'相机暂不可用；可导入素材，或查看明确标注的取景示例。'});this.updateZoomView(1);},
  cameraStopped(){this.resetZoomRequests();this.setData({cameraReady:false,paused:true});this.updateZoomView(this.data.zoom);},
  zoom(e:WechatMiniprogram.TouchEvent){this.setZoom(Number(e.currentTarget.dataset.zoom));},
  zoomNudge(e:WechatMiniprogram.TouchEvent){this.setZoom(this.data.zoom+Number(e.currentTarget.dataset.delta));},
  zoomStart(e:WechatMiniprogram.TouchEvent){const touch=e.touches[0];if(this.data.zoomEnabled&&touch)this._zoomDrag={x:touch.clientX,zoom:this.data.zoom};},
  zoomMove(e:WechatMiniprogram.TouchEvent){const drag=this._zoomDrag,touch=e.touches[0];if(drag&&touch)this.setZoom(zoomFromDrag(drag.zoom,touch.clientX-drag.x,this.zoomLimit()));},
  zoomEnd(){this._zoomDrag=null;},
  setZoom(raw:number){
    if(!Number.isFinite(raw)||!this.data.zoomEnabled)return;
    const value=cameraZoom(raw,this.zoomLimit());if(value===this.data.zoom)return;
    if(this.data.error.startsWith('变焦未完成'))this.setData({error:''});this.updateZoomView(value);if(this.data.demo)return;
    this._zoomPending=value;this.flushZoom();
  },
  flushZoom(){
    if(this._zoomInFlight||this._zoomPending===null||!this._camera||!this.data.cameraReady)return;
    const value=this._zoomPending,session=this._zoomSession;this._zoomPending=null;this._zoomInFlight=true;
    this._camera.setZoom({zoom:value,success:r=>{
      if(session!==this._zoomSession)return;this._zoomInFlight=false;this._zoomConfirmed=cameraZoom(r.zoom,this.data.maxZoom);
      if(this._zoomPending===this._zoomConfirmed)this._zoomPending=null;
      if(this._zoomPending===null)this.updateZoomView(this._zoomConfirmed);else this.flushZoom();
    },fail:()=>{
      if(session!==this._zoomSession)return;this._zoomInFlight=false;
      if(this._zoomPending!==null)this.flushZoom();else{this.updateZoomView(this._zoomConfirmed);this.setData({error:'变焦未完成，已恢复上次成功的倍率。可重试或使用系统相机拍摄后导入。'});}
    }});
  },
  focus(e:WechatMiniprogram.TouchEvent){this.setData({focus:String(e.currentTarget.dataset.id)});},expand(){this.setData({expanded:!this.data.expanded});},toggleAudio(){this.setData({audio:!this.data.audio});},
  import(){this.resetZoomRequests();this.setData({view:'import',paused:true,cameraReady:false,error:''});this.updateZoomView(this.data.zoom);resetPageScroll(this);},importKind(e:WechatMiniprogram.TouchEvent){this.setData({importKind:String(e.currentTarget.dataset.id)});},
  chooseFiles(){if(this.data.picking||this.data.busy)return;this.setData({picking:true,error:''});if(this.data.importKind==='audio'){wx.chooseMessageFile({count:6,type:'file',extension:['mp3','wav','m4a','aac','mp4','ogg'],success:r=>{for(const f of r.tempFiles)this.addEvidence(f.path,'audio','album');this.setData({picking:false});},fail:e=>{this.setData({picking:false});if(!/cancel/i.test(e.errMsg))this.setData({error:'音频文件选择未完成，已有素材保留。'});}});return;}
    wx.chooseMedia({count:6,mediaType:['image','video'],sourceType:['album'],success:r=>{for(const f of r.tempFiles)this.addEvidence(f.tempFilePath,f.fileType==='video'?'video':'photo','album');this.setData({picking:false});},fail:e=>{this.setData({picking:false});if(!/cancel/i.test(e.errMsg))this.setData({error:'素材选择未完成，可使用下方单张照片入口重试。'});}});
  },
  addEvidence(path:string,kind:Evidence['kind'],source:Evidence['source'],sample=false){this.retainReviewDraft();const a:Evidence={id:'e-'+Date.now()+'-'+Math.random().toString(36).slice(2,5),path,kind,source,sample,persisted:sample,album:source==='camera'?'尚未保存到相册':'保留设备原件',birdName:'',notes:'',observedDate:'',observedTime:'',placeName:''};this.setData({assets:[...this.data.assets,a],currentId:a.id,imagePath:path,mediaKind:kind,source,persisted:sample,albumStatus:a.album,birdName:'',notes:'',observedDate:'',observedTime:'',placeName:'',contextOpen:false,error:''});return a;},
  addSample(){this.addEvidence('/assets/samples/field-0.png','photo','album',true);},
  review(){this.resetZoomRequests();this.setData({view:'review',paused:true,cameraReady:false,error:''});this.updateZoomView(this.data.zoom);resetPageScroll(this);},
  selectEvidence(e:WechatMiniprogram.TouchEvent){if(this.data.busy)return;const a=this.data.assets.find(a=>a.id===e.currentTarget.dataset.id);if(a){this.retainReviewDraft();this.setData({currentId:a.id,imagePath:a.path,mediaKind:a.kind,source:a.source,persisted:a.persisted,albumStatus:a.album,birdName:a.birdName||'',notes:a.notes||'',observedDate:a.observedDate||'',observedTime:a.observedTime||'',placeName:a.placeName||'',error:''});}},
  removeEvidence(e:WechatMiniprogram.TouchEvent){if(this.data.busy)return;const id=String(e.currentTarget.dataset.id);this.setData({assets:this.data.assets.filter(a=>a.id!==id),...(this.data.currentId===id?{currentId:'',imagePath:'',birdName:'',notes:'',observedDate:'',observedTime:'',placeName:'',contextOpen:false,albumStatus:'',persisted:false,error:''}:{})});},
  analyse(){this.setData({error:'识别后端尚未接入。你的素材仍保留，可以手动补充鸟名或先存为待鉴定。'});},
  shutterStart(){if(this.data.paused||this.data.busy)return;this._holding=true;this._suppressTap=false;this._holdTimer=setTimeout(()=>{this._suppressTap=true;this.startVideo();},380);},
  shutterEnd(){this._holding=false;clearTimeout(this._holdTimer);if(this.data.recording){this._suppressTap=true;this.stopVideo();}},
  shutterCancel(){this._holding=false;clearTimeout(this._holdTimer);this._suppressTap=true;if(this.data.recording)this.stopVideo();},
  shutterPhoto(){if(this._suppressTap){this._suppressTap=false;return;}if(this.data.paused||this.data.busy)return;if(this.data.demo){this.addSample();wx.showToast({title:'已保留示例，点击复核素材',icon:'none'});return;}if(!this.data.cameraReady)return;this.setData({busy:true,error:''});this._camera?.takePhoto({quality:'high',success:r=>{const a=this.addEvidence(r.tempImagePath,'photo','camera');this.saveAlbum(a);this.setData({busy:false});},fail:e=>this.setData({busy:false,error:errorText(e)})});},
  startVideo(){if(!this.data.cameraReady||this.data.demo||this.data.recording||this.data.busy)return;this._camera?.startRecord({timeoutCallback:r=>{clearInterval(this._recordTimer);this.setData({recording:false,busy:false});if(r.tempVideoPath){const a=this.addEvidence(r.tempVideoPath,'video','camera');this.saveAlbum(a);}},success:()=>{this.setData({recording:true,recordSeconds:0});if(!this._holding){this.stopVideo();return;}this._recordTimer=setInterval(()=>this.setData({recordSeconds:this.data.recordSeconds+1}),1000);},fail:e=>this.setData({error:errorText(e)})});},
  stopVideo(){if(!this.data.recording)return;clearInterval(this._recordTimer);this.setData({recording:false,busy:true});this._camera?.stopRecord({success:r=>{const a=this.addEvidence(r.tempVideoPath,'video','camera');this.saveAlbum(a);this.setData({busy:false});},fail:e=>this.setData({busy:false,error:errorText(e)})});},
  saveAlbum(a:Evidence){const update=(album:string)=>{a.album=album;this.setData({assets:this.data.assets,...(this.data.currentId===a.id?{albumStatus:album}:{})});};const done=()=>update('已保存到手机相册'),fail=()=>update('相册保存未完成 · 素材仍保留');if(a.kind==='video')wx.saveVideoToPhotosAlbum({filePath:a.path,success:done,fail});else wx.saveImageToPhotosAlbum({filePath:a.path,success:done,fail});},
  retryAlbum(){const a=this.data.assets.find(a=>a.id===this.data.currentId);if(a&&!a.sample&&a.source==='camera')this.saveAlbum(a);},
  recordAudio(){if(this.data.audioRecording){this._recorder?.stop();return;}if(this.data.recording||this.data.busy)return;if(!this._recorder){this._recorder=wx.getRecorderManager();this._recorder.onStop(r=>{if(!this.data.audioRecording)return;this.addEvidence(r.tempFilePath,'audio','album');this.setData({audioRecording:false});});this._recorder.onError(e=>{if(this.data.audioRecording)this.setData({audioRecording:false,error:errorText(e)});});}this.setData({audioRecording:true,error:''});this._recorder.start({format:'mp3',duration:60000});},
  resumeOrDemo(){if(this.data.paused)this.pause();else this.demo();},
  back(){this.resetZoomRequests();this.setData({view:'live',paused:false,cameraReady:false,error:''});this.updateZoomView(this.data.zoom);resetPageScroll(this);}
});
