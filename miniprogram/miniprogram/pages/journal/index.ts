import { selectTab } from '../../services/tabs';
import { layout, editorPanes, EDITOR_CHROME_HEIGHT } from '../../services/layout';
import { localRepository, isSampleObservation } from '../../services/repository';
import { errorText, persistImage } from '../../services/media';
import { photoCrop } from '../../services/crop';
import { previewQueue } from '../../services/journal-preview';
import { JournalAiSuggestion, JournalAiInput, startJournalAi, journalAiAvailable } from '../../services/journal-ai';
import { teamWritingTransport } from '../../services/writing-network';
import { ratioLocks, ratioLock, setRatioLock, resizePhoto, resizeOrnament, isOrnament, pixelValues, RatioLock } from '../../services/journal-resize';
import { papers, paperColors, paperSource } from '../../services/journal-paper';
import { round2, floor2, numberDraft, parseNumberDraft } from '../../services/numbers';
import { clamp } from '../../services/map-model';
import { getCanvas, loadCanvasImage, exportCanvas } from '../../services/canvas';
import { resetPageScroll } from '../../services/navigation';
import { JournalAsset, JournalDocument, JournalElement, Snapshot, JOURNAL_KEY, copy, element, elementLabel, fit, focusOffset, makeJournal, compositionName, changeJournalRatio, reflowJournalPhotos, journalFingerprint, readJournals, recordHistory, snapshot, textLayout } from '../../services/journal-model';
type Touch=WechatMiniprogram.TouchEvent;
type Input=WechatMiniprogram.CustomEvent<{value:string}>;
const samples=Array.from({length:4},(_,i)=>({id:'sample-'+i,src:'/assets/samples/field-'+i+'.png',label:['湖边停留','枝头一瞥','待鉴定','林间相遇'][i],notes:'示例插画',sample:true,selected:true,date:'2026-10-21'}));
function projectElement(e:JournalElement,d:JournalDocument,scale:number) {
  const text=e.type==='text'?textLayout(e,d):null;
  return {...e,...photoCrop(e,scale),label:elementLabel(e,d),left:e.x/d.width*100,top:e.y/d.height*100,width:e.w/d.width*100,height:e.h/d.height*100,fontPx:e.fontSize*scale,rows:text?text.rows.map(r=>({...r,size:r.size*scale,y:r.y*scale})):[],overflow:!!text?.overflow};
}
Page({
  data:{templateWidth:150,saveStatus:'',ratioLocks,ratioMode:'current',pixels:{w:0,h:0,fontSize:0},papers,paperColors,paperSource:'',templateOpen:false,templateOptions:[] as Array<{id:number;name:string;photos:Array<{src:string;style:string;imageStyle:string}>}>,composition:'',aiBusy:false,aiSuggestion:null as JournalAiSuggestion|null,backgroundSelected:false,layersOpen:false,selectedName:'',numberEditing:'',numberDrafts:{} as Record<string,string>,cropOpen:false,cropDraft:null as JournalElement|null,cropPreview:null as (ReturnType<typeof photoCrop>&{width:number;height:number})|null,editorChromeHeight:EDITOR_CHROME_HEIGHT,maxWidth:900,maxHeight:1200,assetImageHeight:114,from:'',to:'',unknown:true,picked:[] as JournalAsset[],period:0,periods:['自选素材','每日','每周','每月','每年'],includeNotes:false,aiPhotos:[] as Array<{id:string;src:string;label:string;selected:boolean}>,exporting:false,editorHeight:650,controlsHeight:200,overview:false,paperScale:1,paperLeft:0,shownHeight:400,view:'home',headerTitle:'羽迹',drafts:[] as Array<JournalDocument&{cover:string}>,assets:[] as JournalAsset[],source:'observations',chosen:0,title:'沿着鸟鸣，慢慢走',ratio:'3:4',style:'nature',styles:[{id:'nature',name:'自然留白'},{id:'magazine',name:'纸上故事'},{id:'minimal',name:'极简图鉴'}],ratios:['3:4','1:1','4:3'],doc:null as JournalDocument|null,renderElements:[] as Array<Record<string,unknown>>,selected:null as JournalElement|null,labels:[] as Array<{id:string;label:string}>,selectedId:'',canUndo:false,canRedo:false,dirty:false,stageWidth:320,stageHeight:390,docHeight:427,focusY:0,headerHeight:88,scale:1,error:'',busy:false,ai:false,inputMode:'text',prompt:'',purpose:0,purposes:['观察感想','鸟类介绍','分享文案','照片手帐'],placement:1,placements:['图片上方','图片下方','独立文字'],voiceRecording:false,voiceCancelled:false,voicePath:'',bundleSummary:'',decorations:[{id:'leaf',name:'叶子'},{id:'flower',name:'小花'},{id:'star',name:'星星'},{id:'feather',name:'羽毛'},{id:'stamp',name:'邮戳'},{id:'tape',name:'纸胶带'},{id:'sprig',name:'枝叶'},{id:'grass',name:'芦苇'},{id:'sun',name:'日光'},{id:'moon',name:'月相'},{id:'waves',name:'水纹'},{id:'compass',name:'方位'}],exportPath:''},
  _past:[] as Snapshot[],_future:[] as Snapshot[],_drag:null as {before:Snapshot;x:number;y:number;element:JournalElement;resize:boolean}|null,_editBefore:null as Snapshot|null,_voiceStartX:0,_voiceCancel:false,_recorder:null as WechatMiniprogram.RecorderManager|null,
  _adjustment:null as {before:Snapshot;key:string;id:string}|null,
  _previews:null as ReturnType<typeof previewQueue>|null,
  _aiJob:null as ReturnType<typeof startJournalAi>|null,
  _aiContext:null as {docId:string;before:string;target:string;placement:number}|null,
  queuePreview(){if(!this._previews)this._previews=previewQueue(()=>this.renderPreview());this._previews.request();},
  flushPendingPreview(){this._previews?.flush();},
  renderPreview(){
    const d=this.data.doc;if(!d)return;const id=this.data.cropDraft?.id||this.data.selectedId,index=d.elements.findIndex(e=>e.id===id);if(index<0)return;
    const original=d.elements[index],e=this.data.cropDraft?.id===id?this.data.cropDraft:original;
    fit({...d,elements:[e]});const rendered=projectElement(e,d,this.data.scale);
    this.data.renderElements[index]=rendered;
    const patch:Record<string,unknown>={['renderElements['+index+']']:rendered};
    if(this.data.cropDraft){const scale=Math.min(Math.max(100,this.data.stageWidth-44)/e.w,180/e.h);patch.cropDraft=e;patch.cropPreview={...photoCrop(e,scale),width:round2(e.w*scale),height:round2(e.h*scale)};}
    else {patch.selected=original;patch.pixels=pixelValues(original);patch.dirty=true;patch.exportPath='';}
    this.setData(patch);
  },
  onUnload(){this._active=false;clearTimeout(this._autosave);this.finishAdjustment();this.endTextEdit();void this.persistDraft();this._previews?.cancel();this._aiJob?.cancel();this._aiJob=null;},
  _autosave:0 as unknown as ReturnType<typeof setTimeout>,
  _saveJob:null as Promise<boolean>|null,
  _revision:0,
  _active:true,
  scheduleSave(){
    this._revision++;clearTimeout(this._autosave);
    this.setData({saveStatus:'更改待保存'});
    this._autosave=setTimeout(()=>{void this.persistDraft();},700);
  },
  async persistDraft():Promise<boolean>{
    clearTimeout(this._autosave);
    if(this._saveJob){const ok=await this._saveJob;return ok&&this.data.dirty?this.persistDraft():ok;}
    if(!this.data.doc||!this.data.dirty)return true;
    const document=copy(this.data.doc),revision=this._revision;
    this.setData({saveStatus:'正在保存'});
    this._saveJob=(async()=>{
      try{
        for(const photo of document.elements.filter(e=>e.type==='photo')){
          if(photo.persisted||photo.src.startsWith('/assets/'))continue;
          const previous=photo.src,durable=await persistImage(previous);
          photo.src=durable;photo.persisted=true;this.rememberMedia(previous,durable);
        }
        const existing=readJournals();document.updatedAt=new Date().toISOString();
        wx.setStorageSync(JOURNAL_KEY,[document,...existing.filter(d=>d.id!==document.id)]);
        wx.setStorageSync('bird-assistant.journal.last.v1',document.id);
        if(this.data.doc?.id===document.id&&this._revision===revision){
          this.data.doc.updatedAt=document.updatedAt;
          this.setData({dirty:false,saveStatus:'已自动保存',error:this.data.error.startsWith('自动保存未完成')?'':this.data.error});
        }
        this.loadDrafts();return true;
      }catch(error){this.setData({saveStatus:'保存未完成',error:'自动保存未完成，当前编辑仍保留。'+errorText(error)});return false;}
    })();
    const ok=await this._saveJob;this._saveJob=null;
    if(ok&&this.data.dirty&&this._active)this._autosave=setTimeout(()=>{void this.persistDraft();},700);
    return ok;
  },
  _scrollTop:0,
  _catalog:[] as JournalAsset[],
  openLayers(){this.finishAdjustment();this.endTextEdit();this.setData({layersOpen:true});},
  closeLayers(){this.setData({layersOpen:false});},
  onEditorScroll(e:WechatMiniprogram.CustomEvent<{scrollTop:number}>){this._scrollTop=round2(e.detail.scrollTop);},
  onLoad(){this.resizeEditor();},
  onResize(){this.resizeEditor();},
  resizeEditor(){const box=layout();this.setData({templateWidth:Math.min(150,Math.floor((box.width-48)/2-22)),headerHeight:box.headerHeight,assetImageHeight:round2((box.width-86)*.375),editorHeight:layout(true).height,stageWidth:box.width-52,scale:(box.width-52)/900});this.refresh();},
  onShow(){this._active=true;selectTab(this,1);this.loadDrafts();if(!this.data.doc){const id=wx.getStorageSync('bird-assistant.journal.last.v1'),doc=this.data.drafts.find(d=>d.id===id);if(doc)this.setData({doc:copy(doc),saveStatus:'已自动保存'});}if(this.data.doc&&this.data.view==='editor')this.refresh();},
  onHide(){this._active=false;clearTimeout(this._autosave);this._aiJob?.cancel();this._aiJob=null;this.setData({aiBusy:false});this.finishAdjustment();this.endTextEdit();void this.persistDraft();if(this.data.voiceRecording){this._voiceCancel=true;this._recorder?.stop();}},
  loadDrafts(){try{this.setData({drafts:readJournals().map(d=>({...d,cover:d.elements.find(e=>e.type==='photo')?.src||'/assets/samples/field-1.png'})),error:''});}catch(e){this.setData({error:errorText(e)});}},
  canOpenAnother(then?:()=>void){
    if(this.data.busy||this.data.exporting)return false;
    if(this.data.doc&&this.data.dirty){void this.persistDraft().then(ok=>{if(ok)then?.();});return false;}
    return true;
  },
  newJournal(){if(!this.canOpenAnother(()=>this.newJournal()))return;this._catalog=[];this.setData({view:'picker',headerTitle:'选择素材',assets:[],chosen:0,source:'observations',error:''});this.loadAssets();resetPageScroll(this);},
  sample(e?:Touch){if(!this.canOpenAnother(()=>this.sample(e)))return;const count=Number(e?.currentTarget.dataset.count)||4;this._catalog=copy(samples).map((a,i)=>({...a,source:'sample',selected:i<count}));this.setData({view:'picker',headerTitle:'选择素材',source:'sample',error:''});this.syncAssets();resetPageScroll(this);},
  syncAssets(){const favorites=this.data.source==='collection'?(wx.getStorageSync('bird-assistant.favorites.v1')||[]):[],d=this.data;this.setData({assets:this._catalog.filter(a=>(d.source==='collection'?favorites.includes(a.id):a.source===d.source)&&(!a.date?d.unknown:(!d.from||a.date>=d.from)&&(!d.to||a.date<=d.to))),chosen:this._catalog.filter(a=>a.selected).length,picked:this._catalog.filter(a=>a.selected)});},
  date(e:Input){const key=String(e.currentTarget.dataset.key);if(key==='from'||key==='to'){this.setData({[key]:e.detail.value});this.syncAssets();}},
  clearDates(){this.setData({from:'',to:''});this.syncAssets();},
  unknown(){this.setData({unknown:!this.data.unknown});this.syncAssets();},
  clearSelection(){for(const a of this._catalog)a.selected=false;this.syncAssets();},
  reorder(e:Touch){const picked=this._catalog.filter(a=>a.selected),i=picked.findIndex(a=>a.id===e.currentTarget.dataset.id),j=clamp(i+Number(e.currentTarget.dataset.delta),0,picked.length-1);if(i<0||i===j)return;const a=this._catalog.indexOf(picked[i]),b=this._catalog.indexOf(picked[j]),first=this._catalog[a];this._catalog[a]=this._catalog[b];this._catalog[b]=first;this.syncAssets();},
  period(e:Input){this.setData({period:Number(e.detail.value)});},notes(){this.setData({includeNotes:!this.data.includeNotes});},
  loadAssets(){try{const records=localRepository().list().filter(r=>!r.mediaKind||r.mediaKind==='photo');for(const r of records)if(!this._catalog.some(a=>a.id===r.id))this._catalog.push({id:r.id,src:r.imagePath,label:r.birdName,notes:r.notes,sample:isSampleObservation(r),selected:false,persisted:true,source:'observations',date:r.observedDate||undefined});this.syncAssets();}catch(e){this.setData({error:errorText(e)});}},
  source(e:Touch){const source=String(e.currentTarget.dataset.id);this.setData({source});if(source==='sample'&&!this._catalog.some(a=>a.source==='sample'))this._catalog.push(...copy(samples).map(a=>({...a,source:'sample',selected:false})));if(source==='observations'||source==='collection')this.loadAssets();else this.syncAssets();},
  importPhotos(){const count=6-this.data.chosen;if(count<1){wx.showToast({title:'每页先选最多 6 张，可先取消一张',icon:'none'});return;}wx.chooseImage({count,sizeType:['original'],sourceType:['album'],success:r=>{this._catalog.push(...r.tempFilePaths.map((src,i)=>({id:'album-'+Date.now()+'-'+i,src,label:'片段 '+(i+1),notes:'',sample:false,selected:true,source:'album'})));this.setData({source:'album',error:''});this.syncAssets();},fail:e=>{if(!/cancel/i.test(e.errMsg))this.setData({error:'照片选择未完成，已有素材保留。'});}});},
  chooseAsset(e:Touch){const a=this._catalog.find(a=>a.id===e.currentTarget.dataset.id);if(a){if(!a.selected&&this.data.chosen>=6){wx.showToast({title:'每页先选最多 6 张，可先取消一张',icon:'none'});return;}a.selected=!a.selected;}this.syncAssets();},
  next(){if(this.data.from&&this.data.to&&this.data.from>this.data.to)return;if(this.data.chosen)this.setData({view:'setup',headerTitle:'风格与比例',assets:this._catalog.filter(a=>a.selected)});resetPageScroll(this);},
  setting(e:Touch){const key=String(e.currentTarget.dataset.key);if(['ratio','style'].includes(key))this.setData({[key]:String(e.currentTarget.dataset.id)});},
  title(e:Input){this.setData({title:e.detail.value});},
  generate(){const doc=makeJournal(this._catalog.filter(a=>a.selected),this.data.title,this.data.ratio,this.data.style,1,this.data.includeNotes);doc.period=this.data.periods[this.data.period];this.openDocument(doc,true);},
  async generateFromPhotos(){
    const photos=this._catalog.filter(a=>a.selected);
    if(!photos.length||photos.length>4){this.setData({error:'根据照片生成手帐，请先选 1–4 张照片。'});return;}
    if(photos.some(a=>a.sample)){this.setData({error:'请使用自己的照片生成手帐；示例插画仍可本地排版。'});return;}
    this.generate();this.openAi();
    this.setData({purpose:3,placement:2,prompt:'根据已勾选照片生成一页简短中文观鸟手帐：标题简洁，正文描述照片中可见的颜色、姿态或画面关系，结合我主动提供的备注。选择适合这些照片的构图。没有提供的鸟名、日期、地点、天气和经历均保持未知，不把视觉猜测写成确认事实。'});
    await this.prepareAi();
  },
  openDraft(e:Touch){if(!this.canOpenAnother(()=>this.openDraft(e)))return;const doc=this.data.drafts.find(d=>d.id===e.currentTarget.dataset.id);if(doc)this.openDocument(copy(doc),false);},
  assetLoaded(e:WechatMiniprogram.CustomEvent<{width:number;height:number}>){const a=this._catalog.find(a=>a.id===e.currentTarget.dataset.id);if(a&&e.detail.width>0&&e.detail.height>0){a.width=e.detail.width;a.height=e.detail.height;}},
  openDocument(doc:JournalDocument,dirty:boolean){clearTimeout(this._autosave);if(!dirty&&wx.setStorageSync){try{wx.setStorageSync('bird-assistant.journal.last.v1',doc.id);}catch{/* draft data remains independently readable */}}this._aiJob?.cancel();this._aiJob=null;this._aiContext=null;this._past=[];this._future=[];this._editBefore=null;this._adjustment=null;this._scrollTop=0;this.setData({doc,view:'editor',headerTitle:'编辑手帐',selectedId:'',backgroundSelected:false,dirty,ai:false,aiBusy:false,aiSuggestion:null,layersOpen:false,overview:false,cropOpen:false,cropDraft:null,numberEditing:'',numberDrafts:{},exportPath:'',error:'',saveStatus:dirty?'更改待保存':'已自动保存'});resetPageScroll(this);this.refresh();if(dirty)this.scheduleSave();},
  refresh(){this._previews?.cancel();const d=this.data.doc;if(!d)return;fit(d);const selected=d.elements.find(e=>e.id===this.data.selectedId)||null,scale=this.data.scale;
    const renderElements=d.elements.map(original=>{
      const e=this.data.cropDraft?.id===original.id?{...original,...this.data.cropDraft}:original;
      return projectElement(e,d,scale);
    });
    const crop=this.data.cropDraft,cropScale=crop?Math.min(Math.max(100,this.data.stageWidth-44)/crop.w,180/crop.h):1;
    const cropPreview=crop?{...photoCrop(crop,cropScale),width:round2(crop.w*cropScale),height:round2(crop.h*cropScale)}:null;
    const editorHeight=this.data.editorHeight||layout(true).height,{stageHeight,controlsHeight}=editorPanes(editorHeight,d.height*scale),showAll=this.data.overview||!selected;
    const viewportScale=showAll?Math.min(scale,stageHeight/d.height):scale;
    const shownHeight=d.height*viewportScale;
    this.setData({pixels:pixelValues(selected),ratioMode:selected?ratioLock(selected):'current',paperSource:paperSource(d.paper),doc:d,composition:compositionName(d),renderElements,selected,selectedName:selected?elementLabel(selected,d):this.data.backgroundSelected?'背景':'',cropPreview,labels:d.elements.map(e=>({id:e.id,label:elementLabel(e,d)})),canUndo:!!this._past.length,canRedo:!!this._future.length,docHeight:d.height*scale,stageHeight,controlsHeight,maxWidth:floor2(d.width-(selected?.x||0)),maxHeight:floor2(d.height-(selected?.y||0)),paperScale:viewportScale/scale,paperLeft:(this.data.stageWidth-d.width*viewportScale)/2,focusY:showAll?0:((this._drag||this._adjustment)?this.data.focusY:focusOffset(selected||undefined,scale,d.height,stageHeight)),shownHeight});
  },
  before(){this.finishAdjustment();this.endTextEdit();return snapshot(this.data.doc!,this.data.selectedId);},
  commit(before:Snapshot){if(recordHistory(this._past,this._future,before,this.data.doc!)){this.setData({dirty:true,exportPath:''});this.scheduleSave();}this.refresh();},
  select(e:Touch){this.finishAdjustment();this.endTextEdit();this.setData({selectedId:String(e.currentTarget.dataset.id),backgroundSelected:false,layersOpen:false,numberEditing:'',numberDrafts:{}});this.refresh();},
  beginTextEdit(){if(!this._editBefore)this._editBefore=snapshot(this.data.doc!,this.data.selectedId);},
  endTextEdit(){if(this._editBefore){const before=this._editBefore;this._editBefore=null;this.commit(before);}},
  text(e:Input){const d=this.data.doc,selected=this.data.selected;if(!d||!selected)return;this.beginTextEdit();const key=String(e.currentTarget.dataset.key);if(key==='title'||key==='text'){const a=d.elements.find(a=>a.id===selected.id)!;a[key]=e.detail.value;if(key==='title'&&a===d.elements.filter(e=>e.type==='text'&&!e.photoId)[1])d.title=e.detail.value.trim()||'未命名手帐';this.setData({doc:d,dirty:true,exportPath:''});this.scheduleSave();this.refresh();}},
  previewAdjust(e:WechatMiniprogram.CustomEvent<{value:number|string}>){
    if(e.currentTarget.dataset.control==='slider'&&this.data.numberEditing)this.setData({numberEditing:''});
    const d=this.data.doc,id=this.data.selectedId,key=String(e.currentTarget.dataset.key),raw=Number(e.detail.value);
    if(!d||!id||!Number.isFinite(raw)||!['w','h','fontSize','rotation','zoom','cropX','cropY'].includes(key))return;
    const a=d.elements.find(item=>item.id===id);if(!a)return;
    if(this._adjustment?.key!==key||this._adjustment.id!==id){
      this.finishAdjustment();this.endTextEdit();this._adjustment={before:snapshot(d,id),key,id};
    }
    const bounds:Record<string,[number,number]>={w:[Math.min(60,this.data.maxWidth),this.data.maxWidth],h:[Math.min(60,this.data.maxHeight),this.data.maxHeight],fontSize:[12,64],rotation:[-180,180],zoom:[1,3],cropX:[0,100],cropY:[0,100]};
    // Avoid DevTools' missing SWC array-destructuring runtime helper.
    const range=bounds[key],bounded=clamp(raw,range[0],range[1]),value=key==='fontSize'?Math.round(bounded):round2(bounded);
    if(key==='fontSize'&&a.titleSize)a.titleSize=Math.round(a.titleSize*value/a.fontSize);
    if(a.type==='photo'&&(key==='w'||key==='h'))resizePhoto(a,key,value,d);else if(isOrnament(a)&&(key==='w'||key==='h'))resizeOrnament(a,key,value,d);else (a as unknown as Record<string,unknown>)[key]=value;
    this.data.dirty=true;this.data.exportPath='';this.queuePreview();
  },
  adjust(e:WechatMiniprogram.CustomEvent<{value:number|string}>){this.previewAdjust(e);this.finishAdjustment();},
  finishAdjustment(){const pending=this._adjustment;if(!pending)return;this._adjustment=null;this.commit(pending.before);},
  cancelAdjustment(){const pending=this._adjustment;if(!pending)return;this._adjustment=null;this.setData({doc:copy(pending.before.document),selectedId:pending.before.selected});this.refresh();},
  resetRotation(){if(!this.data.selectedId||!this.data.doc)return;const before=this.before(),a=this.data.doc.elements.find(e=>e.id===this.data.selectedId);if(a){a.rotation=0;this.commit(before);}},
  numberInput(e:Input){
    const key=String(e.currentTarget.dataset.key),crop=e.currentTarget.dataset.scope==='crop';
    const target=crop?this.data.cropDraft:this.data.selected;if(!target)return '';
    const current=String(['w','h','fontSize'].includes(key)?Math.round(Number((target as unknown as Record<string,unknown>)[key])):(target as unknown as Record<string,unknown>)[key]??''),previous=this.data.numberEditing===key?this.data.numberDrafts[key]??current:current;
    const text=['fontSize','w','h'].includes(key)?(/^\d*$/.test(e.detail.value)?e.detail.value:previous):numberDraft(e.detail.value,previous);this.setData({numberEditing:key,numberDrafts:{...this.data.numberDrafts,[key]:text}});
    const value=parseNumberDraft(text);if(value!==null){const event={...e,detail:{value}};if(crop)this.previewCrop(event);else this.previewAdjust(event);}return text;
  },
  numberCommit(e:Input){
    const key=String(e.currentTarget.dataset.key);if(this.data.numberEditing!==key)return;
    const value=parseNumberDraft(this.data.numberDrafts[key]||''),crop=e.currentTarget.dataset.scope==='crop';
    if(value!==null){const event={...e,detail:{value}};if(crop)this.previewCrop(event);else this.adjust(event);}else if(!crop)this.cancelAdjustment();
    this.setData({numberEditing:''});
  },
  photoFit(e:Touch){
    const d=this.data.doc,a=this.data.selected,mode=String(e.currentTarget.dataset.id);
    if(!d||a?.type!=='photo'||!['cover','stretch'].includes(mode))return;
    const before=this.before();a.photoFit=mode as 'cover'|'stretch';
    if(mode==='stretch')setRatioLock(a,'free',d);
    this.commit(before);
  },
  openCrop(){this.finishAdjustment();const a=this.data.selected;if(a?.type!=='photo')return;this.setData({cropOpen:true,cropDraft:{...copy(a),photoFit:'cover'},numberEditing:'',numberDrafts:{}});this.refresh();},
  previewCrop(e:WechatMiniprogram.CustomEvent<{value:number|string}>){
    if(e.currentTarget.dataset.control==='slider'&&this.data.numberEditing)this.setData({numberEditing:''});
    const draft=this.data.cropDraft,key=String(e.currentTarget.dataset.key),value=Number(e.detail.value);if(!draft||!Number.isFinite(value))return;
    if(key==='zoom')draft.zoom=round2(clamp(value,1,3));else if(key==='cropX'||key==='cropY')draft[key]=round2(clamp(value,0,100));else return;
    this.queuePreview();
  },
  finishCropPreview(e:WechatMiniprogram.CustomEvent<{value:number|string}>){this.previewCrop(e);this.flushPendingPreview();},
  resetCrop(){const draft=this.data.cropDraft;if(draft){this.setData({cropDraft:{...draft,zoom:1,cropX:50,cropY:50},numberEditing:'',numberDrafts:{}});this.refresh();}},
  cancelCrop(){this.setData({cropOpen:false,cropDraft:null,numberEditing:'',numberDrafts:{}});this.refresh();},
  applyCrop(){const draft=this.data.cropDraft,d=this.data.doc;if(!draft||!d)return;const before=this.before(),a=d.elements.find(e=>e.id===draft.id);if(a)Object.assign(a,{zoom:draft.zoom,cropX:draft.cropX,cropY:draft.cropY,photoFit:'cover'});this.setData({cropOpen:false,cropDraft:null,numberEditing:'',numberDrafts:{}});this.commit(before);},
  dragStart(e:Touch){const d=this.data.doc,t=e.touches[0];if(!d||!t)return;const id=String(e.currentTarget.dataset.id);this.setData({selectedId:id,backgroundSelected:false});const a=d.elements.find(a=>a.id===id)!;this._drag={before:this.before(),x:t.clientX,y:t.clientY,element:copy(a),resize:e.currentTarget.dataset.resize==='yes'};this.refresh();},
  dragMove(e:Touch){const g=this._drag,t=e.touches[0],d=this.data.doc;if(!g||!t||!d)return;const a=d.elements.find(a=>a.id===g.element.id)!;if(g.resize){if(a.type==='photo'||isOrnament(a)){const resize=a.type==='photo'?resizePhoto:resizeOrnament;const dx=(t.clientX-g.x)/(this.data.scale*this.data.paperScale),dy=(t.clientY-g.y)/(this.data.scale*this.data.paperScale);if(a.type==='photo'?ratioLock(a)==='free':!a.ornamentRatioLocked){resize(a,'w',Math.max(60,g.element.w+dx),d);resize(a,'h',Math.max(60,g.element.h+dy),d);}else{const key=Math.abs(dx/g.element.w)>=Math.abs(dy/g.element.h)?'w':'h';resize(a,key,Math.max(60,(key==='w'?g.element.w+dx:g.element.h+dy)),d);}}else{a.w=clamp(g.element.w+(t.clientX-g.x)/(this.data.scale*this.data.paperScale),60,d.width-a.x);if(a.type!=='text')a.h=clamp(g.element.h+(t.clientY-g.y)/(this.data.scale*this.data.paperScale),60,d.height-a.y);}}else{a.x=clamp(g.element.x+(t.clientX-g.x)/(this.data.scale*this.data.paperScale),0,d.width-a.w);a.y=clamp(g.element.y+(t.clientY-g.y)/(this.data.scale*this.data.paperScale),0,d.height-Math.min(a.h,45));}this.queuePreview();},
  dragEnd(){if(this._drag){const before=this._drag.before;this._drag=null;this.commit(before);}},
  undo(){this.finishAdjustment();this.endTextEdit();const entry=this._past.pop();if(!entry)return;this._future.push(snapshot(this.data.doc!,this.data.selectedId));this.setData({doc:copy(entry.document),selectedId:entry.selected,dirty:true,exportPath:''});this.scheduleSave();this.refresh();},
  redo(){this.finishAdjustment();this.endTextEdit();const entry=this._future.pop();if(!entry)return;this._past.push(snapshot(this.data.doc!,this.data.selectedId));this.setData({doc:copy(entry.document),selectedId:entry.selected,dirty:true,exportPath:''});this.scheduleSave();this.refresh();},
  background(){this.finishAdjustment();this.endTextEdit();this.setData({selectedId:'',backgroundSelected:true,layersOpen:false,numberEditing:'',numberDrafts:{}});this.refresh();},
  backgroundColor(e:Touch){const color=String(e.currentTarget.dataset.color);if(!this.data.doc||!paperColors.includes(color))return;const before=this.before();this.data.doc.background=color;this.commit(before);},
  toggleOrnamentRatio(){const a=this.data.selected,d=this.data.doc;if(!a||!isOrnament(a)||!d)return;const before=this.before();a.ornamentRatioLocked=!a.ornamentRatioLocked;a.ornamentOriginalRatio=a.ornamentOriginalRatio||1;if(a.ornamentRatioLocked)resizeOrnament(a,'w',a.w,d);this.commit(before);},
  lockRatio(e:Touch){const a=this.data.selected,d=this.data.doc,mode=String(e.currentTarget.dataset.id) as RatioLock;if(!a||a.type!=='photo'||!d||!['current','original','free'].includes(mode))return;const before=this.before();setRatioLock(a,mode,d);this.commit(before);},
  paper(e:Touch){const id=String(e.currentTarget.dataset.id);if(!this.data.doc||!papers.some(p=>p.id===id))return;const before=this.before();this.data.doc.paper=id;this.commit(before);},
  chooseTemplate(){
    if(!this.data.doc)return;this.finishAdjustment();this.endTextEdit();
    const doc=this.data.doc;
    const variants=doc.elements.filter(e=>e.type==='photo').length<=2?[1,2,3]:[1,2];
    const options=variants.map(id=>{const d=copy(doc);d.variant=id;reflowJournalPhotos(d);return {id,name:compositionName(d),photos:d.elements.filter(e=>e.type==='photo').map(p=>{const c=photoCrop(p);return {src:p.src,style:`left:${p.x/d.width*100}%;top:${p.y/d.height*100}%;width:${p.w/d.width*100}%;height:${p.h/d.height*100}%`,imageStyle:`left:${c.imageX/p.w*100}%;top:${c.imageY/p.h*100}%;width:${c.imageW/p.w*100}%;height:${c.imageH/p.h*100}%`};})};});
    this.setData({templateOpen:true,templateOptions:options});
  },
  closeTemplates(){this.setData({templateOpen:false});},
  applyTemplate(e:Touch){const variant=Number(e.currentTarget.dataset.id);if(!this.data.doc||![1,2,3].includes(variant))return;const before=this.before();this.data.doc.variant=variant;reflowJournalPhotos(this.data.doc);this.setData({templateOpen:false,selectedId:'',overview:true});this.commit(before);},
  layoutRatio(){
    if(this.data.busy||this.data.exporting)return;
    this.finishAdjustment();this.endTextEdit();
    const docId=this.data.doc?.id;if(!docId)return;
    wx.showActionSheet({itemList:['竖版 3:4','方形 1:1','横版 4:3'],success:r=>{if(this.data.doc?.id!==docId||!Number.isInteger(r.tapIndex)||r.tapIndex<0||r.tapIndex>2)return;this.applyRatio(['3:4','1:1','4:3'][r.tapIndex]);}});
  },
  applyRatio(ratio:string){if(!this.data.doc||this.data.doc.ratio===ratio)return;const before=this.before();if(!changeJournalRatio(this.data.doc,ratio))return;this.setData({selectedId:'',backgroundSelected:false,overview:true,error:''});this.commit(before);},
  changeStyle(){
    if(this.data.busy||this.data.exporting||!this.data.doc)return;const id=this.data.doc.id;
    wx.showActionSheet({itemList:this.data.styles.map(s=>s.name),success:r=>{if(this.data.doc?.id!==id||!this.data.styles[r.tapIndex])return;const before=this.before(),d=this.data.doc;d.style=this.data.styles[r.tapIndex].id;d.background=d.style==='minimal'?'#ffffff':d.style==='magazine'?'#eee8da':'#f5efdf';reflowJournalPhotos(d);this.setData({selectedId:'',overview:true});this.commit(before);}});
  },
  addText(){const before=this.before(),d=this.data.doc!,a=element('text',{x:90,y:d.height*.45,w:600,h:60,title:'',text:'写下这一刻的感想',fontSize:28});d.elements.push(a);this.setData({selectedId:a.id});this.commit(before);},
  addDecoration(e:Touch){const before=this.before(),d=this.data.doc!,a=element(String(e.currentTarget.dataset.id),{x:700,y:d.height*.48,w:80,h:80,color:'#839771',ornamentOriginalRatio:1,ornamentRatioLocked:false});d.elements.push(a);this.setData({selectedId:a.id});this.commit(before);},
  addPhoto(){wx.chooseImage({count:1,sourceType:['album'],sizeType:['original'],success:r=>{const before=this.before(),d=this.data.doc!,number=Math.max(0,...d.elements.map(e=>e.photoNumber))+1,a=element('photo',{x:100,y:d.height*.3,w:360,h:270,src:r.tempFilePaths[0],photoNumber:number});d.elements.push(a);this.setData({selectedId:a.id});this.commit(before);}});},
  imageLoaded(e:WechatMiniprogram.CustomEvent<{width:number;height:number}>){
    const id=e.currentTarget.dataset.id,a=this.data.doc?.elements.find(a=>a.id===id);let changed=false;
    for(const image of [a,this.data.cropDraft?.id===id?this.data.cropDraft:null])if(image&&(image.iw!==e.detail.width||image.ih!==e.detail.height)){image.iw=e.detail.width;image.ih=e.detail.height;changed=true;}
    if(changed)this.refresh();
  },
  rememberMedia(oldPath:string,newPath:string){
    const replace=(d:JournalDocument)=>{for(const e of d.elements)if(e.type==='photo'&&e.src===oldPath){e.src=newPath;e.persisted=true;}};
    if(this.data.doc)replace(this.data.doc);
    const patch:Record<string,unknown>={};
    this.data.renderElements.forEach((e,i)=>{if(e.src===oldPath){const value={...e,src:newPath,persisted:true};this.data.renderElements[i]=value;patch['renderElements['+i+']']=value;}});
    if(this.data.cropDraft?.src===oldPath){this.data.cropDraft.src=newPath;patch.cropDraft=this.data.cropDraft;}
    if(this._active&&Object.keys(patch).length)this.setData(patch);
    if(this._aiContext){const d=JSON.parse(this._aiContext.before);replace(d);this._aiContext.before=journalFingerprint(d);}
    for(const history of [...this._past,...this._future])replace(history.document);if(this._editBefore)replace(this._editBefore.document);
  },
  remove(){if(!this.data.selectedId)return;const before=this.before(),d=this.data.doc!;d.elements=d.elements.filter(e=>e.id!==this.data.selectedId);this.setData({selectedId:''});this.commit(before);},
  layer(e:Touch){const before=this.before(),d=this.data.doc!,i=d.elements.findIndex(e=>e.id===this.data.selectedId),to=clamp(i+Number(e.currentTarget.dataset.delta),0,d.elements.length-1);if(i>=0){const a=d.elements.splice(i,1)[0];d.elements.splice(to,0,a);}this.commit(before);},
  rearrange(){if(!this.data.doc||this.data.busy||this.data.exporting)return;const before=this.before(),d=this.data.doc;d.variant=d.variant%(d.elements.filter(e=>e.type==='photo').length<=2?3:2)+1;reflowJournalPhotos(d);this.setData({selectedId:'',backgroundSelected:false,overview:true,error:''});this.commit(before);},
  async save(){this.finishAdjustment();this.endTextEdit();if(this.data.busy||!this.data.doc)return;this.setData({busy:true});const ok=await this.persistDraft();this.setData({busy:false});if(ok)wx.showToast({title:'手帐已保存到本机',icon:'success'});},
  openAi(){if(this.data.busy||this.data.exporting)return;this.finishAdjustment();this.endTextEdit();const d=this.data.doc!;this._aiJob?.cancel();this._aiJob=null;this.setData({ai:true,aiBusy:false,aiSuggestion:null,bundleSummary:'',error:'',aiPhotos:d.elements.filter(e=>e.type==='photo').map(e=>({id:e.id,src:e.src,label:elementLabel(e,d),selected:this.data.selected?.type==='photo'?e.id===this.data.selectedId:true}))});},closeAi(){this._aiJob?.cancel();this._aiJob=null;this._aiContext=null;this.setData({aiBusy:false});if(this.data.voiceRecording){this._voiceCancel=true;this._recorder?.stop();}this.setData({ai:false});},
  prompt(e:Input){this._aiJob?.cancel();this._aiJob=null;this.setData({prompt:e.detail.value,aiBusy:false,aiSuggestion:null});},toggleInput(){this.setData({inputMode:this.data.inputMode==='text'?'voice':'text'});},
  aiChoice(e:Input){const key=String(e.currentTarget.dataset.key);if(!['purpose','placement'].includes(key))return;this._aiJob?.cancel();this._aiJob=null;this.setData({[key]:Number(e.detail.value),aiBusy:false,aiSuggestion:null});},
  aiPhoto(e:Touch){this._aiJob?.cancel();this._aiJob=null;this.setData({aiBusy:false,aiSuggestion:null,aiPhotos:this.data.aiPhotos.map(p=>p.id===e.currentTarget.dataset.id?{...p,selected:!p.selected}:p),bundleSummary:''});},
  async prepareAi(){
    const d=this.data.doc;if(!d||this.data.aiBusy)return;
    if(d.elements.some(e=>e.type==='photo'&&!e.persisted&&!e.src.startsWith('/assets/'))&&!await this.persistDraft())return;
    if(this.data.voicePath){this.setData({error:'语音转写尚未接入，请先输入文字要求；录音仍保留。'});return;}
    const a=this.data.selected,photos=d.elements.filter(e=>e.type==='photo'&&this.data.aiPhotos.some(p=>p.id===e.id&&p.selected));
    const area=a?.type==='text'?a.w*Math.max(a.h,d.height-a.y):d.width*d.height*.15,maxChars=this.data.purpose===3?60:Math.max(20,Math.min(600,Math.floor(area/(28*28*1.4))));
    const request:JournalAiInput={version:1,requestId:'journal-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8),prompt:this.data.prompt,purpose:this.data.purposes[this.data.purpose],maxChars,images:photos.map(p=>({id:p.id,label:(d.elements.find(c=>c.photoId===p.id)?.text||elementLabel(p,d)).slice(0,100),path:p.src}))};
    this.setData({bundleSummary:'请求已整理：'+request.images.length+' 张关联图片，最多约 '+maxChars+' 字。',aiSuggestion:null,error:''});
    let job:ReturnType<typeof startJournalAi>;
    try{job=startJournalAi(request,journalAiAvailable()?undefined:teamWritingTransport(this));}catch(error){this.setData({error:errorText(error)});return;}
    this._aiJob=job;this._aiContext={docId:d.id,before:journalFingerprint(d),target:a?.type==='text'?a.id:'',placement:this.data.placement};this.setData({aiBusy:true});
    try{const suggestion=await job.result;if(this._aiJob===job&&this.data.ai&&this.data.doc?.id===d.id)this.setData({aiSuggestion:suggestion});}
    catch(error){if(this._aiJob===job)this.setData({error:errorText(error)});}
    finally{if(this._aiJob===job){this._aiJob=null;this.setData({aiBusy:false});}}
  },
  applyAi(e:Touch){
    const suggestion=this.data.aiSuggestion,context=this._aiContext,d=this.data.doc;if(!suggestion||!context||!d)return;
    if(context.docId!==d.id||context.before!==journalFingerprint(d)){this.setData({aiSuggestion:null,error:'手帐已修改，请重新生成建议，当前内容未覆盖。'});return;}
    const before=this.before();let target=d.elements.find(a=>a.id===context.target);
    if(!target)target=d.elements.find(a=>a.type==='text'&&!a.photoId&&a.title);
    if(!target){target=element('text',{x:72,y:d.height*.11,w:756,fontSize:26});d.elements.push(target);}
    target.title=suggestion.title;target.text=suggestion.body;
    if(this.data.purpose===3)target.maxLines=5;
    if(target===d.elements.find(a=>a.type==='text'&&!a.photoId&&a.title))d.title=suggestion.title||d.title;
    if(e.currentTarget.dataset.design==='yes'){d.style=suggestion.design.style;d.variant=suggestion.design.variant;d.background=d.style==='minimal'?'#ffffff':d.style==='magazine'?'#eee8da':'#f5efdf';reflowJournalPhotos(d);}
    else if(this.data.purpose===3)reflowJournalPhotos(d);
    this.setData({selectedId:target.id,overview:true,ai:false,aiSuggestion:null,error:''});this._aiContext=null;this.commit(before);
  },
  voiceStart(e:Touch){if(this.data.voiceRecording)return;this._voiceStartX=e.touches[0]?.clientX||0;this._voiceCancel=false;if(!this._recorder){this._recorder=wx.getRecorderManager();this._recorder.onStop(r=>{if(!this.data.voiceRecording)return;this.setData({voiceRecording:false,voicePath:this._voiceCancel?'':r.tempFilePath,bundleSummary:this._voiceCancel?'已取消这段语音':'已保留语音 · ASR 尚未接入，可切回文字输入',voiceCancelled:false});});this._recorder.onError(()=>this.setData({voiceRecording:false,error:'录音未完成，请检查麦克风权限或切回文字输入。'}));}this.setData({voiceRecording:true,voiceCancelled:false,error:''});this._recorder.start({format:'mp3',duration:60000});},
  voiceMove(e:Touch){this._voiceCancel=(e.touches[0]?.clientX||0)<this._voiceStartX-65;this.setData({voiceCancelled:this._voiceCancel});},voiceEnd(){if(this.data.voiceRecording)this._recorder?.stop();},voiceCancel(){this._voiceCancel=true;this.voiceEnd();},
  async export(){
    this.finishAdjustment();this.endTextEdit();if(!this.data.doc||this.data.busy||this.data.exporting)return;
    const d=copy(this.data.doc);this.setData({exporting:true,error:'',exportPath:''});
    try{
      const canvas=await getCanvas(this,'#journal-export',d.width,d.height),ctx=canvas.getContext('2d');
      ctx.fillStyle=d.background;ctx.fillRect(0,0,d.width,d.height);
      const texture=paperSource(d.paper);if(texture){const image=await loadCanvasImage(canvas,texture);ctx.drawImage(image,0,0,d.width,d.height,0,0,d.width,d.height);}
      for(const e of d.elements){
        ctx.save();ctx.translate(e.x+e.w/2,e.y+e.h/2);ctx.rotate(e.rotation*Math.PI/180);
        if(e.type==='photo'){
          const image=await loadCanvasImage(canvas,e.src),crop=photoCrop({...e,iw:image.width,ih:image.height});
          ctx.fillStyle='#fffef9';ctx.fillRect(-e.w/2-6,-e.h/2-6,e.w+12,e.h+12);
          ctx.drawImage(image,crop.sourceX,crop.sourceY,crop.sourceW,crop.sourceH,-e.w/2,-e.h/2,e.w,e.h);
        }else if(e.type==='text'){
          ctx.fillStyle=e.color;ctx.textBaseline='top';
          for(const row of textLayout(e,d).rows){ctx.font=(row.bold?'600 ':'400 ')+row.size+'px '+(e.font==='sans'?'sans-serif':e.font==='hand'?'KaiTi,serif':'serif');ctx.fillText(row.text,-e.w/2,-e.h/2+row.y);}
        }else if(e.type==='tape'){ctx.fillStyle=e.color;ctx.globalAlpha=.65;ctx.fillRect(-e.w/2,-e.h/2,e.w,e.h);}
        else {const image=await loadCanvasImage(canvas,'/assets/decorations/'+e.type+'.png');ctx.drawImage(image,-e.w/2,-e.h/2,e.w,e.h);}
        ctx.restore();
      }
      const path=await exportCanvas(canvas);if(this.data.doc&&journalFingerprint(this.data.doc)===journalFingerprint(d))this.setData({exportPath:path});else this.setData({error:'已导出开始时的版本；画布已修改，请重新导出当前版本。'});
      wx.previewImage({urls:[path],fail:()=>this.setData({error:'成品图已生成，预览暂未打开；可点击保存到手机相册。'})});
    }catch(error){this.setData({error:errorText(error)});}
    finally {this.setData({exporting:false});}
  },
  saveExport(){if(this.data.exportPath)wx.saveImageToPhotosAlbum({filePath:this.data.exportPath,success:()=>wx.showToast({title:'已保存成品图',icon:'success'}),fail:()=>this.setData({error:'相册保存未完成，成品图仍可预览。'})});},
  toggleOverview(){this.setData({overview:!this.data.overview});this.refresh();},
  back(){if(this.data.busy||this.data.exporting)return;this.finishAdjustment();this.endTextEdit();if(this.data.layersOpen){this.closeLayers();return;}if(this.data.cropOpen){this.cancelCrop();return;}if(this.data.ai){this.closeAi();return;}if(this.data.templateOpen){this.closeTemplates();return;}if(this.data.view==='editor'&&this.data.dirty){void this.persistDraft().then(ok=>{if(ok){this.setData({view:'home',headerTitle:'羽迹'});resetPageScroll(this);}});return;}const setup=this.data.view==='setup';this.setData({view:setup?'picker':'home',headerTitle:setup?'选择素材':'羽迹'});if(setup)this.syncAssets();resetPageScroll(this);},
  resume(){if(this.data.doc){this.setData({view:'editor',headerTitle:'编辑手帐'});resetPageScroll(this);this.refresh();}},noop(){}
});
