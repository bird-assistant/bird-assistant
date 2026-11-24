import { choosePhoto, errorText, persistImage } from '../../services/media';
import { localRepository } from '../../services/repository';
import { selectTab } from '../../services/tabs';
import { layout } from '../../services/layout';
import { resetPageScroll } from '../../services/navigation';
import { cameraZoom, cameraZoomMax, zoomFromDrag, zoomShortcuts, zoomTicks, DEMO_MAX_ZOOM } from '../../services/camera-zoom';
import { ContextInput, beijingDate, observationContext } from '../../services/observation-context';

import { RecognitionResult, RecognitionError, startRecognition } from '../../services/recognition';
import { connectVision, photoBytes, photoTransport } from '../../services/vision-network';
import { LiveVision, LiveFrame, LiveTrack, frozenResult, overlay } from '../../services/vision-live';
import { readPhotoMetadata, historicalFields } from '../../services/photo-context';
import { hub, setDraft } from '../../services/community';

interface Evidence extends ContextInput {id:string;path:string;kind:'photo'|'video'|'audio';source:'album'|'camera';sample:boolean;persisted:boolean;album:string;birdName:string;notes:string;latitude?:string;longitude?:string;analysis?:RecognitionResult;confirmed?:{rank:number;species:string|null;name:string;analysis:string|null};}

Page({
  data: {latitude:'',longitude:'',liveActive:false,liveText:'实时识别未开启',liveTracks:[] as LiveTrack[],analysis:null as RecognitionResult|null,analyzing:false,isSample:false,contextOpen:false,observedDate:'',observedTime:'',placeName:'',today:beijingDate(),zoomText:'1.0',zoomEnabled:false,zoomWidth:320,zoomTicks:zoomTicks(1,1,320),zoomShortcuts:zoomShortcuts(1),zoomRange:'相机准备中',imagePath:'',source:'album' as 'album'|'camera',birdName:'',notes:'',error:'',busy:false,picking:false,persisted:false,view:'live',height:600,mode:'quick',help:false,paused:false,demo:false,cameraReady:false,cameraError:'',zoom:1,maxZoom:1,focus:'visual',expanded:false,audio:true,recording:false,recordSeconds:0,assets:[] as Evidence[],importKind:'gallery',currentId:'',mediaKind:'photo' as 'photo'|'video'|'audio',albumStatus:'',audioRecording:false },
  _zoomSession:0,
  _live:null as LiveVision|null,
  _liveGeneration:0,
  _frame:null as LiveFrame|null,
  _staleTimer:0 as ReturnType<typeof setTimeout>,
  _viewport:null as {width:number;height:number}|null,
  _analysisGeneration:0,
  _photoJob:null as ReturnType<typeof startRecognition>|null,
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
  onResize(){this.clearTracks();if(this.data.liveActive)wx.createSelectorQuery().in(this).select('.viewfinder').boundingClientRect(result=>{if(result&& !Array.isArray(result))this._viewport=result;}).exec();const box=layout();this.setData({height:box.height,zoomWidth:Math.max(180,box.width-24)});this.updateZoomView(this.data.zoom);},
  onShow() { this.setData({today:beijingDate()});selectTab(this, 2);if(this.data.view==='live'){this.setData({paused:false});this.updateZoomView(this.data.zoom);} },
  onHide(){this.stopVision();this.cancelAnalysis();this.resetZoomRequests();this.setData({cameraReady:false});this._holding=false;clearTimeout(this._holdTimer);if(this.data.recording)this.stopVideo();if(this.data.audioRecording)this._recorder?.stop();this.setData({paused:true});this.updateZoomView(this.data.zoom);},
  onUnload() { this.stopVision();this.cancelAnalysis();this.resetZoomRequests();this._pickToken++;this._holding=false;clearTimeout(this._holdTimer);clearInterval(this._recordTimer); },
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
  retainReviewDraft(){const a=this.data.assets.find(item=>item.id===this.data.currentId);if(a){a.birdName=this.data.birdName;a.notes=this.data.notes;a.observedDate=this.data.observedDate;a.observedTime=this.data.observedTime;a.placeName=this.data.placeName;a.latitude=this.data.latitude;a.longitude=this.data.longitude;}},
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
    if (this.data.busy || this.data.picking || this.data.analyzing || !this.data.imagePath) return;
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
      localRepository().save({imagePath,source:draft.source,birdName:draft.birdName,notes:draft.notes,mediaKind:draft.mediaKind,sample:!!selected?.sample,analysis:selected?.analysis,observedDate:draft.observedDate,observedTime:draft.observedTime,placeName:draft.placeName});
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
  pause(){this.stopVision();if(this.data.recording)this.stopVideo();this.resetZoomRequests();this.setData({paused:!this.data.paused,cameraReady:false});this.updateZoomView(this.data.zoom);},
  demo(){if(this.data.busy||this.data.recording)return;this.stopVision();this.resetZoomRequests();this._zoomConfirmed=1;this.setData({demo:!this.data.demo,cameraError:'',paused:false,cameraReady:false,maxZoom:1});this.updateZoomView(1);},
  cameraReady(e:WechatMiniprogram.CustomEvent<{maxZoom:number|string}>){
    this.resetZoomRequests();this._zoomConfirmed=1;this.setData({cameraReady:true,cameraError:'',maxZoom:cameraZoomMax(e.detail.maxZoom)});
    const desired=cameraZoom(this.data.zoom,this.data.maxZoom);this.updateZoomView(desired);if(desired>1&&this.data.zoomEnabled){this._zoomPending=desired;this.flushZoom();}
  },
  cameraError(e:WechatMiniprogram.CustomEvent<{errMsg:string}>){this.stopVision();console.warn('[Bird Assistant] camera',e.detail);this.resetZoomRequests();this._zoomConfirmed=1;this.setData({cameraReady:false,maxZoom:1,cameraError:'相机暂不可用；可导入素材，或查看明确标注的取景示例。'});this.updateZoomView(1);},
  cameraStopped(){this.stopVision();this.resetZoomRequests();this.setData({cameraReady:false,paused:true});this.updateZoomView(this.data.zoom);},
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
  import(){this.stopVision();this.cancelAnalysis();this.resetZoomRequests();this.setData({view:'import',paused:true,cameraReady:false,error:''});this.updateZoomView(this.data.zoom);resetPageScroll(this);},importKind(e:WechatMiniprogram.TouchEvent){this.setData({importKind:String(e.currentTarget.dataset.id)});},
  chooseFiles(){if(this.data.picking||this.data.busy)return;this.setData({picking:true,error:''});if(this.data.importKind==='audio'){wx.chooseMessageFile({count:6,type:'file',extension:['mp3','wav','m4a','aac','mp4','ogg'],success:r=>{for(const f of r.tempFiles)this.addEvidence(f.path,'audio','album');this.setData({picking:false});},fail:e=>{this.setData({picking:false});if(!/cancel/i.test(e.errMsg))this.setData({error:'音频文件选择未完成，已有素材保留。'});}});return;}
    wx.chooseMedia({count:6,mediaType:['image','video'],sizeType:['original'],sourceType:['album'],success:r=>{for(const f of r.tempFiles)this.addEvidence(f.tempFilePath,f.fileType==='video'?'video':'photo','album');this.setData({picking:false});},fail:e=>{this.setData({picking:false});if(!/cancel/i.test(e.errMsg))this.setData({error:'素材选择未完成，可使用下方单张照片入口重试。'});}});
  },
  addEvidence(path:string,kind:Evidence['kind'],source:Evidence['source'],sample=false){this.cancelAnalysis();this.retainReviewDraft();const a:Evidence={id:'e-'+Date.now()+'-'+Math.random().toString(36).slice(2,5),path,kind,source,sample,persisted:sample,album:source==='camera'?'尚未保存到相册':'保留设备原件',birdName:'',notes:'',observedDate:'',observedTime:'',placeName:''};this.setData({latitude:'',longitude:'',analysis:null,isSample:sample,assets:[...this.data.assets,a],currentId:a.id,imagePath:path,mediaKind:kind,source,persisted:sample,albumStatus:a.album,birdName:'',notes:'',observedDate:'',observedTime:'',placeName:'',contextOpen:false,error:''});return a;},
  addSample(){this.addEvidence('/assets/samples/field-0.png','photo','album',true);},
  review(){this.stopVision();this.resetZoomRequests();this.setData({view:'review',paused:true,cameraReady:false,error:''});this.updateZoomView(this.data.zoom);resetPageScroll(this);},
  selectEvidence(e:WechatMiniprogram.TouchEvent){if(this.data.busy)return;const a=this.data.assets.find(a=>a.id===e.currentTarget.dataset.id);if(a){this.cancelAnalysis();this.retainReviewDraft();this.setData({analysis:a.analysis||null,isSample:a.sample,latitude:a.latitude||'',longitude:a.longitude||'',currentId:a.id,imagePath:a.path,mediaKind:a.kind,source:a.source,persisted:a.persisted,albumStatus:a.album,birdName:a.birdName||'',notes:a.notes||'',observedDate:a.observedDate||'',observedTime:a.observedTime||'',placeName:a.placeName||'',error:''});}},
  removeEvidence(e:WechatMiniprogram.TouchEvent){if(this.data.busy)return;const id=String(e.currentTarget.dataset.id);if(this.data.currentId===id)this.cancelAnalysis();this.setData({assets:this.data.assets.filter(a=>a.id!==id),...(this.data.currentId===id?{currentId:'',imagePath:'',birdName:'',notes:'',observedDate:'',observedTime:'',placeName:'',contextOpen:false,albumStatus:'',persisted:false,error:''}:{})});},
  cancelAnalysis(){
    this._analysisGeneration++;
    this._photoJob?.cancel();this._photoJob=null;
    if(this.data.analyzing)this.setData({analyzing:false});
  },
  async usePhotoMetadata(){
    const asset=this.data.assets.find(item=>item.id===this.data.currentId);
    if(!asset||asset.sample||asset.kind!=='photo'||this.data.analyzing)return;
    try{
      const metadata=await readPhotoMetadata(asset.path);
      if(asset.id!==this.data.currentId)return;
      if(!metadata.date&&metadata.latitude===undefined){this.setData({error:'未读到拍摄时间或 GPS，可手动填写。'});return;}
      const location=metadata.latitude===undefined?'地点未知':`${metadata.latitude.toFixed(5)}, ${metadata.longitude?.toFixed(5)}`;
      const reply=await wx.showModal({title:'使用照片的拍摄信息？',content:[metadata.date||'日期未知',metadata.time||'',location].join(' '),confirmText:'采用'});
      if(!reply.confirm||asset.id!==this.data.currentId)return;
      this.setData({observedDate:metadata.date||this.data.observedDate,observedTime:metadata.date?metadata.time||'':this.data.observedTime,
        latitude:metadata.latitude?.toFixed(6)??this.data.latitude,longitude:metadata.longitude?.toFixed(6)??this.data.longitude,error:''});
      this.retainReviewDraft();
    }catch{if(asset.id===this.data.currentId)this.setData({error:'照片信息读取失败，可手动填写。'});}
  },
  changeCoordinate(event:WechatMiniprogram.CustomEvent<{value:string}>){
    const key=event.currentTarget.dataset.key;
    if(this.data.busy||this.data.analyzing)return;
    if(key==='latitude')this.setData({latitude:event.detail.value});
    if(key==='longitude')this.setData({longitude:event.detail.value});
    this.retainReviewDraft();
  },
  async analyse(){
    const asset=this.data.assets.find(item=>item.id===this.data.currentId);
    if(!asset||this.data.busy||this.data.analyzing)return;
    if(asset.sample||asset.kind!=='photo'){
      this.setData({error:asset.sample?'示例图片仅供体验。':'视觉识别支持单张照片。'});return;
    }
    const generation=++this._analysisGeneration;
    this.setData({analyzing:true,error:''});
    try{
      observationContext(this.data,new Date().toISOString());
      const fields=historicalFields(this.data.observedDate,this.data.observedTime,this.data.latitude,this.data.longitude);
      const connection=await connectVision();
      if(generation!==this._analysisGeneration)return;
      const image=await photoBytes(asset.path);
      if(generation!==this._analysisGeneration)return;
      this._photoJob=startRecognition(photoTransport(connection,image,fields),{kind:'photo',filePath:asset.path,reference:asset.id});
      const result=await this._photoJob.result;
      if(generation!==this._analysisGeneration)return;
      result.photoContext=fields;asset.analysis=result;this.setData({analysis:result});
    }catch(error){
      if(generation!==this._analysisGeneration)return;
      const message=error instanceof Error?error.message:'照片处理失败，请重新选择照片。';
      const reference=error instanceof RecognitionError && error.requestId?' · 请求号 '+error.requestId:'';
      this.setData({error:message+reference});
    }finally{
      if(generation===this._analysisGeneration){this._photoJob=null;this.setData({analyzing:false});}
    }
  },
  candidateInfo(event:WechatMiniprogram.TouchEvent){
    const subject=this.data.analysis?.subjects.find(item=>item.rank===Number(event.currentTarget.dataset.subject));
    const candidate=subject?.candidates.find(item=>item.rank===Number(event.currentTarget.dataset.rank));
    if(candidate?.speciesId)hub('species',candidate.speciesId);
    else wx.showToast({title:'该候选的鸟种资料待补充，识别结果仍保留',icon:'none'});
  },
  confirmCandidate(event:WechatMiniprogram.TouchEvent){
    if(this.data.busy||this.data.analysis?.example)return;
    const selection=event.currentTarget.dataset;
    const subject=this.data.analysis?.subjects.find(item=>item.rank===Number(selection.subject));
    const candidate=subject?.candidates.find(item=>item.rank===Number(selection.rank));
    const asset=this.data.assets.find(item=>item.id===this.data.currentId);
    if(asset&&candidate){asset.confirmed={rank:subject!.rank,species:candidate.speciesId,name:candidate.name,analysis:this.data.analysis?.analysisId||null};this.setData({birdName:candidate.name});this.retainReviewDraft();}
  },
  clearCandidate(){if(!this.data.busy){this.setData({birdName:''});this.retainReviewDraft();}},
  speciesInfo(event:WechatMiniprogram.TouchEvent){const id=event.currentTarget.dataset.id;if(id)hub('species',id);},
  shareObservation(){
    const data=this.data,asset=data.assets.find(item=>item.id===data.currentId);
    if(!asset||asset.sample||asset.kind!=='photo')return;
    const confirmed=asset.confirmed?.analysis===(data.analysis?.analysisId||null) && asset.confirmed?.name===data.birdName?asset.confirmed:null;
    const point=data.latitude!==''&&data.longitude!==''?{latitude:Number(data.latitude),longitude:Number(data.longitude),system:'WGS84' as const}:null;
    const device=asset.source==='camera'?wx.getDeviceInfo().model:'';
    setDraft({reference:asset.id,path:asset.path,species:confirmed?.species||null,speciesName:confirmed?.name||'待鉴定',
      analysis:data.analysis?.analysisId||null,target:confirmed?.rank||null,date:data.observedDate,time:data.observedTime,
      note:data.notes,place:data.placeName,point,device});
    hub('publish');
  },
  clearTracks(){clearTimeout(this._staleTimer);this._frame=null;this.setData({liveTracks:[]});},
  stopVision(){
    this._liveGeneration++;this._live?.stop();this._live=null;this.clearTracks();
    this.setData({liveActive:false,liveText:'实时识别未开启'});
  },
  toggleVision(){
    if(this.data.liveActive){this.stopVision();return;}
    if(!this.data.cameraReady||this.data.paused||this.data.demo||!this._camera)return;
    const generation=++this._liveGeneration;
    this.setData({liveActive:true,liveText:'正在连接视觉模型',error:''});
    const query=wx.createSelectorQuery().in(this);
    query.select('#vision-encoder').node();query.select('.viewfinder').boundingClientRect();
    query.exec(parts=>{
      if(generation!==this._liveGeneration||!this._camera)return;
      const canvas=parts[0]?.node,bounds=parts[1];
      if(!canvas||!bounds?.width){this.stopVision();this.setData({liveText:'画面未就绪，请重试或拍照分析'});return;}
      this._viewport={width:bounds.width,height:bounds.height};
      this._live=new LiveVision(this._camera,canvas,()=>this.data.mode,(message,keepLastFrame)=>{
        if(keepLastFrame && this._frame?.tracks.length)return;
        this.clearTracks();this.setData({liveText:message});
      },frame=>{
        this._frame=frame;
        const viewport=this._viewport||bounds;
        const tracks=frame.tracks.map(track=>({...track,style:overlay(track.box,frame.width,frame.height,viewport.width,viewport.height)}));
        this.setData({liveTracks:tracks,liveText:tracks[0]?.label||'当前画面未发现鸟类'});
        clearTimeout(this._staleTimer);
        this._staleTimer=setTimeout(()=>{this.clearTracks();this.setData({liveText:'等待新画面'});},this.data.mode==='wait'?4500:2800);
      },message=>{this.stopVision();this.setData({liveText:message});});
      void this._live.start();
    });
  },
  attachFrameLocation(asset:Evidence,frame:LiveFrame|null){
    const context=frame?.context;
    if(context?.latitude==null||context.longitude==null)return;
    asset.latitude=String(context.latitude);asset.longitude=String(context.longitude);
    this.setData({latitude:asset.latitude,longitude:asset.longitude});
  },
  keepFrame(){
    const frame=this._frame;
    if(!frame||!this.data.liveActive)return;
    const suffix=new Uint8Array(frame.image)[0]===137?'png':'jpg';
    const path=wx.env.USER_DATA_PATH+'/vision-'+Date.now()+'.'+suffix;
    try {
      wx.getFileSystemManager().writeFileSync(path,frame.image);
      const result=frozenResult(frame);
      const asset=this.addEvidence(path,'photo','camera',result.example);
      this.attachFrameLocation(asset,frame);asset.persisted=true;asset.analysis=result;asset.album='已保留识别帧';
      asset.observedDate=beijingDate(frame.capturedAt);
      asset.observedTime=new Date(Date.parse(frame.capturedAt)+8*3600000).toISOString().slice(11,16);
      this.setData({analysis:result,persisted:true,albumStatus:asset.album,observedDate:asset.observedDate,observedTime:asset.observedTime});
      this.review();
    } catch {this.setData({error:'识别帧保存失败，请检查本机空间。'});}
  },
  shutterStart(){if(this.data.paused||this.data.busy)return;this._holding=true;this._suppressTap=false;this._holdTimer=setTimeout(()=>{this._suppressTap=true;this.startVideo();},380);},
  shutterEnd(){this._holding=false;clearTimeout(this._holdTimer);if(this.data.recording){this._suppressTap=true;this.stopVideo();}},
  shutterCancel(){this._holding=false;clearTimeout(this._holdTimer);this._suppressTap=true;if(this.data.recording)this.stopVideo();},
  shutterPhoto(){
    if(this._suppressTap){this._suppressTap=false;return;}
    if(this.data.paused||this.data.busy)return;
    if(this.data.demo){this.addSample();wx.showToast({title:'已保留示例，点击复核素材',icon:'none'});return;}
    if(!this.data.cameraReady)return;
    const analyzeOnCapture=this.data.liveActive;
    const generation=this._liveGeneration;
    this.setData({busy:true,error:''});
    this._camera?.takePhoto({quality:'high',success:result=>{
      const asset=this.addEvidence(result.tempImagePath,'photo','camera');
      const captured=new Date();
      if(this._frame&&Math.abs(captured.getTime()-Date.parse(this._frame.capturedAt))<5000)this.attachFrameLocation(asset,this._frame);
      asset.observedDate=beijingDate(captured.toISOString());asset.observedTime=new Date(captured.getTime()+8*3600000).toISOString().slice(11,16);
      this.setData({observedDate:asset.observedDate,observedTime:asset.observedTime});
      this.saveAlbum(asset);
      this.setData({busy:false});
      if(analyzeOnCapture && this.data.liveActive && generation===this._liveGeneration){
        this.review();void this.analyse();
      }
    },fail:error=>this.setData({busy:false,error:errorText(error)})});
  },
  startVideo(){if(!this.data.cameraReady||this.data.demo||this.data.recording||this.data.busy)return;this._camera?.startRecord({timeoutCallback:r=>{clearInterval(this._recordTimer);this.setData({recording:false,busy:false});if(r.tempVideoPath){const a=this.addEvidence(r.tempVideoPath,'video','camera');this.saveAlbum(a);}},success:()=>{this.setData({recording:true,recordSeconds:0});if(!this._holding){this.stopVideo();return;}this._recordTimer=setInterval(()=>this.setData({recordSeconds:this.data.recordSeconds+1}),1000);},fail:e=>this.setData({error:errorText(e)})});},
  stopVideo(){if(!this.data.recording)return;clearInterval(this._recordTimer);this.setData({recording:false,busy:true});this._camera?.stopRecord({success:r=>{const a=this.addEvidence(r.tempVideoPath,'video','camera');this.saveAlbum(a);this.setData({busy:false});},fail:e=>this.setData({busy:false,error:errorText(e)})});},
  saveAlbum(a:Evidence){const update=(album:string)=>{a.album=album;this.setData({assets:this.data.assets,...(this.data.currentId===a.id?{albumStatus:album}:{})});};const done=()=>update('已保存到手机相册'),fail=()=>update('相册保存未完成 · 素材仍保留');if(a.kind==='video')wx.saveVideoToPhotosAlbum({filePath:a.path,success:done,fail});else wx.saveImageToPhotosAlbum({filePath:a.path,success:done,fail});},
  retryAlbum(){const a=this.data.assets.find(a=>a.id===this.data.currentId);if(a&&!a.sample&&a.source==='camera')this.saveAlbum(a);},
  recordAudio(){if(this.data.audioRecording){this._recorder?.stop();return;}if(this.data.recording||this.data.busy)return;if(!this._recorder){this._recorder=wx.getRecorderManager();this._recorder.onStop(r=>{if(!this.data.audioRecording)return;this.addEvidence(r.tempFilePath,'audio','album');this.setData({audioRecording:false});});this._recorder.onError(e=>{if(this.data.audioRecording)this.setData({audioRecording:false,error:errorText(e)});});}this.setData({audioRecording:true,error:''});this._recorder.start({format:'mp3',duration:60000});},
  resumeOrDemo(){if(this.data.paused)this.pause();else this.demo();},
  back(){this.cancelAnalysis();this.resetZoomRequests();this.setData({view:'live',paused:false,cameraReady:false,error:''});this.updateZoomView(this.data.zoom);resetPageScroll(this);}
});
