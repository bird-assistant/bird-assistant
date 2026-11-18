import { selectTab } from '../../services/tabs';
import { layout, editorPanes, EDITOR_CHROME_HEIGHT } from '../../services/layout';
import { localRepository, isSampleObservation } from '../../services/repository';
import { errorText, persistImage } from '../../services/media';
import { photoCrop } from '../../services/crop';
import { round2, floor2, numberDraft, parseNumberDraft } from '../../services/numbers';
import { clamp } from '../../services/map-model';
import { getCanvas, loadCanvasImage, exportCanvas } from '../../services/canvas';
import { resetPageScroll } from '../../services/navigation';
import { JournalAsset, JournalDocument, JournalElement, Snapshot, JOURNAL_KEY, copy, element, elementLabel, fit, focusOffset, makeJournal, reflowJournalPhotos, readJournals, recordHistory, snapshot, textLayout } from '../../services/journal-model';
type Touch=WechatMiniprogram.TouchEvent;
type Input=WechatMiniprogram.CustomEvent<{value:string}>;
const samples=Array.from({length:4},(_,i)=>({id:'sample-'+i,src:'/assets/samples/field-'+i+'.png',label:['湖边停留','枝头一瞥','待鉴定','林间相遇'][i],notes:'示例插画',sample:true,selected:true,date:'2026-10-21'}));
Page({
  data:{backgroundSelected:false,layersOpen:false,selectedName:'',numberEditing:'',numberDrafts:{} as Record<string,string>,cropOpen:false,cropDraft:null as JournalElement|null,cropPreview:null as (ReturnType<typeof photoCrop>&{width:number;height:number})|null,editorChromeHeight:EDITOR_CHROME_HEIGHT,maxWidth:900,maxHeight:1200,assetImageHeight:114,from:'',to:'',unknown:true,picked:[] as JournalAsset[],period:0,periods:['自选素材','每日','每周','每月','每年'],includeNotes:false,aiPhotos:[] as Array<{id:string;src:string;label:string;selected:boolean}>,exporting:false,editorHeight:650,controlsHeight:200,overview:false,paperScale:1,paperLeft:0,shownHeight:400,view:'home',headerTitle:'羽迹',drafts:[] as Array<JournalDocument&{cover:string}>,assets:[] as JournalAsset[],source:'observations',chosen:0,title:'沿着鸟鸣，慢慢走',ratio:'3:4',style:'nature',styles:[{id:'nature',name:'自然手帐'},{id:'magazine',name:'杂志拼贴'},{id:'minimal',name:'极简记录'}],ratios:['3:4','1:1','4:3'],doc:null as JournalDocument|null,renderElements:[] as Array<Record<string,unknown>>,selected:null as JournalElement|null,labels:[] as Array<{id:string;label:string}>,selectedId:'',canUndo:false,canRedo:false,dirty:false,stageWidth:320,stageHeight:390,docHeight:427,focusY:0,headerHeight:88,scale:1,error:'',busy:false,ai:false,inputMode:'text',prompt:'',purpose:0,purposes:['观察感想','鸟类介绍','分享文案'],placement:1,placements:['图片上方','图片下方','独立文字'],voiceRecording:false,voiceCancelled:false,voicePath:'',bundleSummary:'',decorations:[{id:'leaf',name:'叶子'},{id:'flower',name:'小花'},{id:'star',name:'星星'},{id:'feather',name:'羽毛'},{id:'stamp',name:'邮戳'},{id:'tape',name:'纸胶带'}],exportPath:''},
  _past:[] as Snapshot[],_future:[] as Snapshot[],_drag:null as {before:Snapshot;x:number;y:number;element:JournalElement;resize:boolean}|null,_editBefore:null as Snapshot|null,_voiceStartX:0,_voiceCancel:false,_recorder:null as WechatMiniprogram.RecorderManager|null,
  _adjustment:null as {before:Snapshot;key:string;id:string}|null,
  _scrollTop:0,
  _catalog:[] as JournalAsset[],
  openLayers(){this.finishAdjustment();this.endTextEdit();this.setData({layersOpen:true});},
  closeLayers(){this.setData({layersOpen:false});},
  onEditorScroll(e:WechatMiniprogram.CustomEvent<{scrollTop:number}>){this._scrollTop=round2(e.detail.scrollTop);},
  onLoad(){this.resizeEditor();},
  onResize(){this.resizeEditor();},
  resizeEditor(){const box=layout();this.setData({headerHeight:box.headerHeight,assetImageHeight:round2((box.width-86)*.375),editorHeight:layout(true).height,stageWidth:box.width-52,scale:(box.width-52)/900});this.refresh();},
  onShow(){selectTab(this,1);this.loadDrafts();},
  onHide(){this.finishAdjustment();this.endTextEdit();if(this.data.voiceRecording){this._voiceCancel=true;this._recorder?.stop();}},
  loadDrafts(){try{this.setData({drafts:readJournals().map(d=>({...d,cover:d.elements.find(e=>e.type==='photo')?.src||'/assets/samples/field-1.png'})),error:''});}catch(e){this.setData({error:errorText(e)});}},
  canOpenAnother(){if(this.data.busy||this.data.exporting)return false;if(this.data.doc&&this.data.dirty){wx.showToast({title:'请先继续并保存当前手帐',icon:'none'});return false;}return true;},
  newJournal(){if(!this.canOpenAnother())return;this._catalog=[];this.setData({view:'picker',headerTitle:'选择素材',assets:[],chosen:0,source:'observations',error:''});this.loadAssets();resetPageScroll(this);},
  sample(){if(!this.canOpenAnother())return;this._catalog=copy(samples).map(a=>({...a,source:'sample'}));this.setData({view:'picker',headerTitle:'选择素材',source:'sample',error:''});this.syncAssets();resetPageScroll(this);},
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
  openDraft(e:Touch){if(!this.canOpenAnother())return;const doc=this.data.drafts.find(d=>d.id===e.currentTarget.dataset.id);if(doc)this.openDocument(copy(doc),false);},
  openDocument(doc:JournalDocument,dirty:boolean){this._past=[];this._future=[];this._editBefore=null;this._adjustment=null;this._scrollTop=0;this.setData({doc,view:'editor',headerTitle:'编辑手帐',selectedId:'',backgroundSelected:false,dirty,ai:false,layersOpen:false,overview:false,cropOpen:false,cropDraft:null,numberEditing:'',numberDrafts:{},exportPath:'',error:''});resetPageScroll(this);this.refresh();},
  refresh(){const d=this.data.doc;if(!d)return;fit(d);const selected=d.elements.find(e=>e.id===this.data.selectedId)||null,scale=this.data.scale;
    const renderElements=d.elements.map(original=>{
      const e=this.data.cropDraft?.id===original.id?{...original,...this.data.cropDraft}:original;
      return {...e,...photoCrop(e,scale),label:elementLabel(e,d),left:e.x/d.width*100,top:e.y/d.height*100,width:e.w/d.width*100,height:e.h/d.height*100,fontPx:e.fontSize*scale,rows:e.type==='text'?textLayout(e,d).rows.map(r=>({...r,size:r.size*scale,y:r.y*scale})):[],overflow:e.type==='text'&&textLayout(e,d).overflow};
    });
    const crop=this.data.cropDraft,cropScale=crop?Math.min(Math.max(100,this.data.stageWidth-44)/crop.w,180/crop.h):1;
    const cropPreview=crop?{...photoCrop(crop,cropScale),width:round2(crop.w*cropScale),height:round2(crop.h*cropScale)}:null;
    const editorHeight=this.data.editorHeight||layout(true).height,{stageHeight,controlsHeight}=editorPanes(editorHeight,d.height*scale),showAll=this.data.overview||!selected;
    const viewportScale=showAll?Math.min(scale,stageHeight/d.height):scale;
    const shownHeight=d.height*viewportScale;
    this.setData({doc:d,renderElements,selected,selectedName:selected?elementLabel(selected,d):this.data.backgroundSelected?'背景':'',cropPreview,labels:d.elements.map(e=>({id:e.id,label:elementLabel(e,d)})),canUndo:!!this._past.length,canRedo:!!this._future.length,docHeight:d.height*scale,stageHeight,controlsHeight,maxWidth:floor2(d.width-(selected?.x||0)),maxHeight:floor2(d.height-(selected?.y||0)),paperScale:viewportScale/scale,paperLeft:(this.data.stageWidth-d.width*viewportScale)/2,focusY:showAll?0:((this._drag||this._adjustment)?this.data.focusY:focusOffset(selected||undefined,scale,d.height,stageHeight)),shownHeight});
  },
  before(){this.finishAdjustment();this.endTextEdit();return snapshot(this.data.doc!,this.data.selectedId);},
  commit(before:Snapshot){if(recordHistory(this._past,this._future,before,this.data.doc!))this.setData({dirty:true,exportPath:''});this.refresh();},
  select(e:Touch){this.finishAdjustment();this.endTextEdit();this.setData({selectedId:String(e.currentTarget.dataset.id),backgroundSelected:false,layersOpen:false,numberEditing:'',numberDrafts:{}});this.refresh();},
  beginTextEdit(){if(!this._editBefore)this._editBefore=snapshot(this.data.doc!,this.data.selectedId);},
  endTextEdit(){if(this._editBefore){const before=this._editBefore;this._editBefore=null;this.commit(before);}},
  text(e:Input){const d=this.data.doc,selected=this.data.selected;if(!d||!selected)return;this.beginTextEdit();const key=String(e.currentTarget.dataset.key);if(key==='title'||key==='text'){const a=d.elements.find(a=>a.id===selected.id)!;a[key]=e.detail.value;this.setData({doc:d,dirty:true,exportPath:''});this.refresh();}},
  previewAdjust(e:WechatMiniprogram.CustomEvent<{value:number|string}>){
    if(e.currentTarget.dataset.control==='slider')this.setData({numberEditing:''});
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
    (a as unknown as Record<string,unknown>)[key]=value;
    this.setData({dirty:true,exportPath:''});this.refresh();
  },
  adjust(e:WechatMiniprogram.CustomEvent<{value:number|string}>){this.previewAdjust(e);this.finishAdjustment();},
  finishAdjustment(){const pending=this._adjustment;if(!pending)return;this._adjustment=null;this.commit(pending.before);},
  cancelAdjustment(){const pending=this._adjustment;if(!pending)return;this._adjustment=null;this.setData({doc:copy(pending.before.document),selectedId:pending.before.selected});this.refresh();},
  resetRotation(){if(!this.data.selectedId||!this.data.doc)return;const before=this.before(),a=this.data.doc.elements.find(e=>e.id===this.data.selectedId);if(a){a.rotation=0;this.commit(before);}},
  numberInput(e:Input){
    const key=String(e.currentTarget.dataset.key),crop=e.currentTarget.dataset.scope==='crop';
    const target=crop?this.data.cropDraft:this.data.selected;if(!target)return '';
    const current=String((target as unknown as Record<string,unknown>)[key]??''),previous=this.data.numberEditing===key?this.data.numberDrafts[key]??current:current;
    const text=key==='fontSize'?(/^\d*$/.test(e.detail.value)?e.detail.value:previous):numberDraft(e.detail.value,previous);this.setData({numberEditing:key,numberDrafts:{...this.data.numberDrafts,[key]:text}});
    const value=parseNumberDraft(text);if(value!==null){const event={...e,detail:{value}};if(crop)this.previewCrop(event);else this.previewAdjust(event);}return text;
  },
  numberCommit(e:Input){
    const key=String(e.currentTarget.dataset.key);if(this.data.numberEditing!==key)return;
    const value=parseNumberDraft(this.data.numberDrafts[key]||''),crop=e.currentTarget.dataset.scope==='crop';
    if(value!==null){const event={...e,detail:{value}};if(crop)this.previewCrop(event);else this.adjust(event);}else if(!crop)this.cancelAdjustment();
    this.setData({numberEditing:''});
  },
  openCrop(){this.finishAdjustment();const a=this.data.selected;if(a?.type!=='photo')return;this.setData({cropOpen:true,cropDraft:copy(a),numberEditing:'',numberDrafts:{}});this.refresh();},
  previewCrop(e:WechatMiniprogram.CustomEvent<{value:number|string}>){
    if(e.currentTarget.dataset.control==='slider')this.setData({numberEditing:''});
    const draft=this.data.cropDraft,key=String(e.currentTarget.dataset.key),value=Number(e.detail.value);if(!draft||!Number.isFinite(value))return;
    if(key==='zoom')draft.zoom=round2(clamp(value,1,3));else if(key==='cropX'||key==='cropY')draft[key]=round2(clamp(value,0,100));else return;
    this.setData({cropDraft:{...draft}});this.refresh();
  },
  resetCrop(){const draft=this.data.cropDraft;if(draft){this.setData({cropDraft:{...draft,zoom:1,cropX:50,cropY:50},numberEditing:'',numberDrafts:{}});this.refresh();}},
  cancelCrop(){this.setData({cropOpen:false,cropDraft:null,numberEditing:'',numberDrafts:{}});this.refresh();},
  applyCrop(){const draft=this.data.cropDraft,d=this.data.doc;if(!draft||!d)return;const before=this.before(),a=d.elements.find(e=>e.id===draft.id);if(a)Object.assign(a,{zoom:draft.zoom,cropX:draft.cropX,cropY:draft.cropY});this.setData({cropOpen:false,cropDraft:null,numberEditing:'',numberDrafts:{}});this.commit(before);},
  dragStart(e:Touch){const d=this.data.doc,t=e.touches[0];if(!d||!t)return;const id=String(e.currentTarget.dataset.id);this.setData({selectedId:id,backgroundSelected:false});const a=d.elements.find(a=>a.id===id)!;this._drag={before:this.before(),x:t.clientX,y:t.clientY,element:copy(a),resize:e.currentTarget.dataset.resize==='yes'};this.refresh();},
  dragMove(e:Touch){const g=this._drag,t=e.touches[0],d=this.data.doc;if(!g||!t||!d)return;const a=d.elements.find(a=>a.id===g.element.id)!;if(g.resize){a.w=clamp(g.element.w+(t.clientX-g.x)/(this.data.scale*this.data.paperScale),60,d.width-a.x);if(a.type!=='text')a.h=clamp(g.element.h+(t.clientY-g.y)/(this.data.scale*this.data.paperScale),60,d.height-a.y);}else{a.x=clamp(g.element.x+(t.clientX-g.x)/(this.data.scale*this.data.paperScale),0,d.width-a.w);a.y=clamp(g.element.y+(t.clientY-g.y)/(this.data.scale*this.data.paperScale),0,d.height-Math.min(a.h,45));}this.refresh();},
  dragEnd(){if(this._drag){const before=this._drag.before;this._drag=null;this.commit(before);}},
  undo(){this.finishAdjustment();this.endTextEdit();const entry=this._past.pop();if(!entry)return;this._future.push(snapshot(this.data.doc!,this.data.selectedId));this.setData({doc:copy(entry.document),selectedId:entry.selected,dirty:true,exportPath:''});this.refresh();},
  redo(){this.finishAdjustment();this.endTextEdit();const entry=this._future.pop();if(!entry)return;this._past.push(snapshot(this.data.doc!,this.data.selectedId));this.setData({doc:copy(entry.document),selectedId:entry.selected,dirty:true,exportPath:''});this.refresh();},
  background(){this.finishAdjustment();this.endTextEdit();this.setData({selectedId:'',backgroundSelected:true,layersOpen:false,numberEditing:'',numberDrafts:{}});this.refresh();},
  backgroundColor(e:Touch){const color=String(e.currentTarget.dataset.color);if(!this.data.doc||!['#f5efdf','#eee8da','#ffffff'].includes(color))return;const before=this.before();this.data.doc.background=color;this.commit(before);},
  layoutRatio(){wx.showActionSheet({itemList:['竖版 3:4','方形 1:1','横版 4:3'],success:r=>{const before=this.before(),d=this.data.doc!,height=[1200,900,675][r.tapIndex],sy=height/d.height;for(const e of d.elements)if(e.type!=='photo'&&!e.photoId){e.y*=sy;if(e.type!=='text')e.h*=sy;}d.height=height;d.ratio=['3:4','1:1','4:3'][r.tapIndex];reflowJournalPhotos(d);this.commit(before);}});},
  addText(){const before=this.before(),d=this.data.doc!,a=element('text',{x:90,y:d.height*.45,w:600,h:60,title:'',text:'写下这一刻的感想',fontSize:28});d.elements.push(a);this.setData({selectedId:a.id});this.commit(before);},
  addDecoration(e:Touch){const before=this.before(),d=this.data.doc!,a=element(String(e.currentTarget.dataset.id),{x:700,y:d.height*.48,w:80,h:80,color:'#839771'});d.elements.push(a);this.setData({selectedId:a.id});this.commit(before);},
  addPhoto(){wx.chooseImage({count:1,sourceType:['album'],sizeType:['original'],success:r=>{const before=this.before(),d=this.data.doc!,number=Math.max(0,...d.elements.map(e=>e.photoNumber))+1,a=element('photo',{x:100,y:d.height*.3,w:360,h:270,src:r.tempFilePaths[0],photoNumber:number});d.elements.push(a);this.setData({selectedId:a.id});this.commit(before);}});},
  imageLoaded(e:WechatMiniprogram.CustomEvent<{width:number;height:number}>){
    const id=e.currentTarget.dataset.id,a=this.data.doc?.elements.find(a=>a.id===id);let changed=false;
    for(const image of [a,this.data.cropDraft?.id===id?this.data.cropDraft:null])if(image&&(image.iw!==e.detail.width||image.ih!==e.detail.height)){image.iw=e.detail.width;image.ih=e.detail.height;changed=true;}
    if(changed)this.refresh();
  },
  rememberMedia(oldPath:string,newPath:string){const replace=(d:JournalDocument)=>{for(const e of d.elements)if(e.type==='photo'&&e.src===oldPath){e.src=newPath;e.persisted=true;}};if(this.data.doc)replace(this.data.doc);for(const s of [...this._past,...this._future])replace(s.document);if(this._editBefore)replace(this._editBefore.document);},
  remove(){if(!this.data.selectedId)return;const before=this.before(),d=this.data.doc!;d.elements=d.elements.filter(e=>e.id!==this.data.selectedId);this.setData({selectedId:''});this.commit(before);},
  layer(e:Touch){const before=this.before(),d=this.data.doc!,i=d.elements.findIndex(e=>e.id===this.data.selectedId),to=clamp(i+Number(e.currentTarget.dataset.delta),0,d.elements.length-1);if(i>=0){const a=d.elements.splice(i,1)[0];d.elements.splice(to,0,a);}this.commit(before);},
  rearrange(){wx.showModal({title:'换一种构图？',content:'会重新安排照片位置，保留文本内容；可以撤销。',success:r=>{if(!r.confirm)return;const before=this.before(),d=this.data.doc!,photos=d.elements.filter(e=>e.type==='photo');for(const p of photos){p.x=d.width-p.x-p.w;p.rotation=-p.rotation;for(const caption of d.elements.filter(e=>e.photoId===p.id))caption.x=d.width-caption.x-caption.w;}d.variant++;this.commit(before);}});},
  save(){this.finishAdjustment();this.endTextEdit();if(this.data.busy||!this.data.doc)return;this.setData({busy:true,error:''});const d=this.data.doc;const persist=async()=>{for(const a of d.elements.filter(a=>a.type==='photo')){if(a.persisted||a.src.startsWith('/assets/'))continue;const oldPath=a.src,newPath=await persistImage(oldPath);this.rememberMedia(oldPath,newPath);}this.refresh();const existing=readJournals();d.updatedAt=new Date().toISOString();wx.setStorageSync(JOURNAL_KEY,[copy(d),...existing.filter(x=>x.id!==d.id)]);this.setData({busy:false,dirty:false});this.loadDrafts();wx.showToast({title:'手帐已保存到本机',icon:'success'});};persist().catch(e=>this.setData({busy:false,error:errorText(e)}));},
  openAi(){this.finishAdjustment();this.endTextEdit();const d=this.data.doc!;this.setData({ai:true,bundleSummary:'',error:'',aiPhotos:d.elements.filter(e=>e.type==='photo').map(e=>({id:e.id,src:e.src,label:elementLabel(e,d),selected:this.data.selected?.type==='photo'?e.id===this.data.selectedId:true}))});},closeAi(){if(this.data.voiceRecording){this._voiceCancel=true;this._recorder?.stop();}this.setData({ai:false});},
  prompt(e:Input){this.setData({prompt:e.detail.value});},toggleInput(){this.setData({inputMode:this.data.inputMode==='text'?'voice':'text'});},
  aiChoice(e:Input){const key=String(e.currentTarget.dataset.key);this.setData({[key]:Number(e.detail.value)});},
  aiPhoto(e:Touch){this.setData({aiPhotos:this.data.aiPhotos.map(p=>p.id===e.currentTarget.dataset.id?{...p,selected:!p.selected}:p),bundleSummary:''});},
  prepareAi(){const d=this.data.doc!,a=this.data.selected,photos=d.elements.filter(e=>e.type==='photo'&&this.data.aiPhotos.some(p=>p.id===e.id&&p.selected));const area=a?.type==='text'?a.w*Math.max(a.h,d.height-a.y):d.width*d.height*.15;const maxChars=Math.max(20,Math.floor(area/(28*28*1.4)));
    const request={prompt:this.data.prompt,purpose:this.data.purposes[this.data.purpose],target:a?.type==='text'?a.id:'new',placement:this.data.placements[this.data.placement],maxChars,images:photos.map(p=>({id:p.id,name:elementLabel(p,d),path:p.src})),voicePath:this.data.voicePath};
    this.setData({bundleSummary:'请求已整理：'+request.images.length+' 张关联图片，最多约 '+maxChars+' 字。'+(request.voicePath?'含语音，待接入转写。':''),error:'AI 写作服务尚未接入，尚未发送请求。可先在文本框中直接编辑。'});
  },
  voiceStart(e:Touch){if(this.data.voiceRecording)return;this._voiceStartX=e.touches[0]?.clientX||0;this._voiceCancel=false;if(!this._recorder){this._recorder=wx.getRecorderManager();this._recorder.onStop(r=>{if(!this.data.voiceRecording)return;this.setData({voiceRecording:false,voicePath:this._voiceCancel?'':r.tempFilePath,bundleSummary:this._voiceCancel?'已取消这段语音':'已保留语音 · ASR 尚未接入，可切回文字输入',voiceCancelled:false});});this._recorder.onError(()=>this.setData({voiceRecording:false,error:'录音未完成，请检查麦克风权限或切回文字输入。'}));}this.setData({voiceRecording:true,voiceCancelled:false,error:''});this._recorder.start({format:'mp3',duration:60000});},
  voiceMove(e:Touch){this._voiceCancel=(e.touches[0]?.clientX||0)<this._voiceStartX-65;this.setData({voiceCancelled:this._voiceCancel});},voiceEnd(){if(this.data.voiceRecording)this._recorder?.stop();},voiceCancel(){this._voiceCancel=true;this.voiceEnd();},
  async export(){
    this.finishAdjustment();this.endTextEdit();if(!this.data.doc||this.data.busy||this.data.exporting)return;
    const d=copy(this.data.doc);this.setData({exporting:true,error:'',exportPath:''});
    try{
      const canvas=await getCanvas(this,'#journal-export',d.width,d.height),ctx=canvas.getContext('2d');
      ctx.fillStyle=d.background;ctx.fillRect(0,0,d.width,d.height);
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
      const path=await exportCanvas(canvas);if(JSON.stringify(this.data.doc)===JSON.stringify(d))this.setData({exportPath:path});else this.setData({error:'已导出开始时的版本；画布已修改，请重新导出当前版本。'});
      wx.previewImage({urls:[path],fail:()=>this.setData({error:'成品图已生成，预览暂未打开；可点击保存到手机相册。'})});
    }catch(error){this.setData({error:errorText(error)});}
    finally {this.setData({exporting:false});}
  },
  saveExport(){if(this.data.exportPath)wx.saveImageToPhotosAlbum({filePath:this.data.exportPath,success:()=>wx.showToast({title:'已保存成品图',icon:'success'}),fail:()=>this.setData({error:'相册保存未完成，成品图仍可预览。'})});},
  toggleOverview(){this.setData({overview:!this.data.overview});this.refresh();},
  back(){if(this.data.busy||this.data.exporting)return;this.finishAdjustment();this.endTextEdit();if(this.data.layersOpen){this.closeLayers();return;}if(this.data.cropOpen){this.cancelCrop();return;}if(this.data.ai){this.closeAi();return;}if(this.data.view==='editor'&&this.data.dirty){wx.showModal({title:'返回手帐首页？',content:'未保存修改只保留在本次打开期间，关闭或重新编译后可能丢失。建议先保存草稿。',confirmText:'暂时返回',success:r=>{if(r.confirm){this.setData({view:'home',headerTitle:'羽迹'});resetPageScroll(this);}}});return;}const setup=this.data.view==='setup';this.setData({view:setup?'picker':'home',headerTitle:setup?'选择素材':'羽迹'});if(setup)this.syncAssets();resetPageScroll(this);},
  resume(){if(this.data.doc){this.setData({view:'editor',headerTitle:'编辑手帐'});resetPageScroll(this);this.refresh();}},noop(){}
});
