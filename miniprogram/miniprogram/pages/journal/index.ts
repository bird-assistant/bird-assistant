import {beginSheetDrag,moveSheetDrag,endSheetDrag,resetSheetDrag} from '../../services/sheet-gesture';
import {queuePostDraft} from '../../services/draft-navigation';
import {newPostDraft,savePostDraft} from '../../services/post-draft';
import {postImage} from '../../services/post-media';
import {paperDrag,paperCloudOpacity,PAPER_HOLD_MS,PAPER_HOLD_SLOP} from '../../services/paper-gesture';
import {installAdaptiveSheets,fitAdaptiveSheets,stopAdaptiveSheets} from '../../services/adaptive-sheets';
import {readJournalShelf,readJournalPreview,saveJournalThumbnail,persistJournalThumbnail,prepareThumbnailDocument,discardThumbnail,ShelfRow} from '../../services/journal-shelf';
import {journalThumbnail} from '../../services/journal-thumbnail';
import {acceptPickedMedia} from '../../services/media-import';
import {renderJournal} from '../../services/journal-render';
import { selectTab,syncNavigation } from '../../services/tabs';
import { layout, editorPanes, EDITOR_CHROME_HEIGHT } from '../../services/layout';
import { localRepository, isSampleObservation } from '../../services/repository';
import { errorText, persistImage } from '../../services/media';
import { photoCrop } from '../../services/crop';
import { previewQueue } from '../../services/journal-preview';
import { JournalAiSuggestion, startJournalAi, journalAiAvailable } from '../../services/journal-ai';
import { teamWritingTransport } from '../../services/writing-network';
import {journalWritingBrief,applyJournalWriting,journalHeading,writingDestinationLabel,JournalWritingContext,WritingDestination} from '../../services/journal-writing';
import {journalLibrary} from '../../services/journal-library';
import {editorHistory,restoreEditorHistory,saveJournalState,deleteJournalState} from '../../services/journal-storage';
import {readWritingHistory,rememberWriting,markWritingApplied,deleteWritingRecord,deleteWritingScope,writingInstructions} from '../../services/writing-history';
import { ratioLocks, ratioLock, setRatioLock, resizePhoto, resizeOrnament, isOrnament, pixelValues, RatioLock } from '../../services/journal-resize';
import { papers, paperColors, paperSource } from '../../services/journal-paper';
import { round2, floor2, numberDraft, parseNumberDraft } from '../../services/numbers';
import { clamp } from '../../services/map-model';
import { getCanvas, exportCanvas } from '../../services/canvas';
import { resetPageScroll } from '../../services/navigation';
import { JournalAsset, JournalDocument, JournalElement, Snapshot, positionJournalText, journalContent, copy, element, elementLabel, fit, focusOffset, makeJournal, compositionName, changeJournalRatio, reflowJournalPhotos, journalFingerprint, readJournals, recordHistory, snapshot, textLayout } from '../../services/journal-model';
type Touch=WechatMiniprogram.TouchEvent;
type Input=WechatMiniprogram.CustomEvent<{value:string}>;
const samples=Array.from({length:4},(_,i)=>({id:'sample-'+i,src:'/assets/samples/field-'+i+'.png',label:['湖边停留','枝头一瞥','待鉴定','林间相遇'][i],notes:'示例插画',sample:true,selected:true,date:'2026-10-21'}));
function projectElement(e:JournalElement,d:JournalDocument,scale:number) {
  const text=e.type==='text'?textLayout(e,d):null;
  return {...e,...photoCrop(e,scale),label:elementLabel(e,d),left:e.x/d.width*100,top:e.y/d.height*100,width:e.w/d.width*100,height:e.h/d.height*100,fontPx:e.fontSize*scale,rows:text?text.rows.map(r=>({...r,size:r.size*scale,y:r.y*scale})):[],overflow:!!text?.overflow};
}
Page({
  sheetDragStart(event:WechatMiniprogram.TouchEvent){beginSheetDrag(this,event);},sheetDragMove(event:WechatMiniprogram.TouchEvent){moveSheetDrag(this,event);},sheetDragEnd(){endSheetDrag(this);},sheetDragCancel(){resetSheetDrag(this);},
  data:{deckLaneWidth:340,sheetDragStyle:'',homeHeight:600,homeCompact:false,homeTiny:false,libraryToolsOpen:false,shareStatus:'',filterOpen:false,filterField:'',filterOptions:[] as string[],filterSelected:0,filterTitle:'',calendarOpen:false,calendarTarget:'library',calendarFrom:'',calendarTo:'',paperVisualId:'',paperPhase:'',paperCloudTop:140,paperCloudHeight:208,deckHeight:340,deckPreviewHeight:170,deckArrival:'',sharePreviewWidth:120,sharePreviewHeight:160,deckSlots:[] as Array<ReturnType<typeof journalLibrary>[number]&{slot:number;index:number}>,deckOffset:0,deckSettling:false,paperArmedId:'',paperDragDown:false,paperDragUp:false,paperDragProgress:0,paperFog:0,paperDragStyle:'',paperDragAction:'',shareOpen:false,shareId:'',shareTitle:'',shareRatio:'',shareBitmap:'',sharePreview:null as ReturnType<typeof journalThumbnail>|null,shareError:'',resumeRow:null as ShelfRow|null,deckThumbnails:{} as Record<string,string>,previewErrors:{} as Record<string,boolean>,sheetHeights:{} as Record<string,number>,deckPreviews:{} as Record<string,ReturnType<typeof journalThumbnail>>,libraryText:'',libraryFrom:'',libraryTo:'',libraryOrder:0,libraryOrders:['最近修改','创建时间'],libraryRatio:0,libraryRatios:['全部比例','3:4','1:1','4:3'],libraryRows:[] as ReturnType<typeof journalLibrary>,deckIndex:0,libraryTotal:0,aiDestination:'new' as WritingDestination,aiDestinations:[{id:'new',name:'新增文字框'},{id:'selected',name:'所选文本框'},{id:'overview',name:'页首概述'}],aiSelectedAvailable:false,aiIncludeTitle:false,aiIncludeCaptions:false,aiPhotoCount:0,aiTargetLabel:'',aiCaptionPreviews:[] as Array<{id:string;label:string;text:string}>,aiHistoryOpen:false,aiHistory:[] as ReturnType<typeof readWritingHistory>,aiHistoryNotice:'',templateWidth:150,saveStatus:'',ratioLocks,ratioMode:'current',pixels:{w:0,h:0,fontSize:0},papers,paperColors,paperSource:'',templateOpen:false,templateOptions:[] as Array<{id:number;name:string;photos:Array<{src:string;style:string;imageStyle:string}>}>,composition:'',aiBusy:false,aiSuggestion:null as JournalAiSuggestion|null,backgroundSelected:false,layersOpen:false,selectedName:'',numberEditing:'',numberDrafts:{} as Record<string,string>,cropOpen:false,cropDraft:null as JournalElement|null,cropPreview:null as (ReturnType<typeof photoCrop>&{width:number;height:number})|null,editorChromeHeight:EDITOR_CHROME_HEIGHT,maxWidth:900,maxHeight:1200,assetImageHeight:114,from:'',to:'',unknown:true,picked:[] as JournalAsset[],period:0,periods:['自选素材','每日','每周','每月','每年'],includeNotes:false,aiPhotos:[] as Array<{id:string;src:string;label:string;selected:boolean}>,exporting:false,editorHeight:650,controlsHeight:200,overview:false,paperScale:1,paperLeft:0,shownHeight:400,view:'home',headerTitle:'羽迹',drafts:[] as ReturnType<typeof journalLibrary>,assets:[] as JournalAsset[],source:'observations',chosen:0,title:'沿着鸟鸣，慢慢走',ratio:'3:4',style:'nature',styles:[{id:'nature',name:'自然留白'},{id:'magazine',name:'纸上故事'},{id:'minimal',name:'极简图鉴'}],ratios:['3:4','1:1','4:3'],doc:null as JournalDocument|null,renderElements:[] as Array<Record<string,unknown>>,selected:null as JournalElement|null,labels:[] as Array<{id:string;label:string}>,selectedId:'',canUndo:false,canRedo:false,dirty:false,stageWidth:320,stageHeight:390,docHeight:427,focusY:0,headerHeight:88,scale:1,error:'',busy:false,ai:false,inputMode:'text',prompt:'',purpose:0,purposes:['观察正文','鸟类介绍','分享文案','照片手帐','概述与总结','照片说明'],placement:1,placements:['照片区上方','照片区下方','自由放置','照片区左侧','照片区右侧'],speechApplied:'',bundleSummary:'',decorations:[{id:'leaf',name:'叶子'},{id:'flower',name:'小花'},{id:'star',name:'星星'},{id:'feather',name:'羽毛'},{id:'stamp',name:'邮戳'},{id:'tape',name:'纸胶带'},{id:'sprig',name:'枝叶'},{id:'grass',name:'芦苇'},{id:'sun',name:'日光'},{id:'moon',name:'月相'},{id:'waves',name:'水纹'},{id:'compass',name:'方位'}],exportPath:''},
  _past:[] as Snapshot[],_future:[] as Snapshot[],_drag:null as {before:Snapshot;x:number;y:number;element:JournalElement;resize:boolean}|null,_editBefore:null as Snapshot|null,
  _adjustment:null as {before:Snapshot;key:string;id:string}|null,
  _previews:null as ReturnType<typeof previewQueue>|null,
  _aiJob:null as ReturnType<typeof startJournalAi>|null,
  _aiGeneration:0,
  _aiContext:null as JournalWritingContext|null,
  _aiOriginSelection:'',
  _documents:[] as ShelfRow[],
  _paperTouch:null as {x:number;y:number;lastX:number;lastY:number;id:string;active:boolean;started:number}|null,_paperSuppressTap:false,_deckSlideTimer:0 as ReturnType<typeof setTimeout>,_deckWidth:360,
  _paperDeleteY:170,_paperShareY:-180,_paperOrigin:500,_paperCardHeight:320,_paperCardWidth:280,_paperFog:0,_paperCloudBottom:300,
  _paperFlightTimer:0 as ReturnType<typeof setTimeout>,_paperFlightGeneration:0,
  _paperHoldTimer:0 as ReturnType<typeof setTimeout>,_paperViewport:900,_paperLatest:null as ReturnType<typeof paperDrag>|null,
  _paperPreviews:null as ReturnType<typeof previewQueue>|null,_shareGeneration:0,_shareBefore:'',_shareSnapshot:null as JournalDocument|null,
  _thumbTimer:0 as ReturnType<typeof setTimeout>,_thumbGeneration:0,_thumbBusy:false,
  _failedPhotos:null as Map<string,string>|null,
  _failedCovers:null as Map<string,string>|null,
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
  onUnload(){this.closePaperAction();this._shareGeneration++;clearTimeout(this._thumbTimer);this._thumbGeneration++;stopAdaptiveSheets(this);this._assetPickToken++;this.selectComponent?.('#journal-speech')?.stopWork?.();this._active=false;clearTimeout(this._autosave);this.finishAdjustment();this.endTextEdit();if(this._saveJob)this.cacheEditorState();void this.persistDraft();this._previews?.cancel();this._aiGeneration++;this._aiJob?.cancel();this._aiJob=null;},
  _autosave:0 as unknown as ReturnType<typeof setTimeout>,
  _saveJob:null as Promise<boolean>|null,
  _revision:0,_savedRevision:-1,_savedDocumentId:'',_deletingJournal:'',
  _active:true,
  _assetPickToken:0,
  holdSheet(){},
  scheduleSave(){
    this._revision++;clearTimeout(this._autosave);
    this.setData({saveStatus:'更改待保存'});
    this._autosave=setTimeout(()=>{void this.persistDraft();},700);
  },
  async persistDraft():Promise<boolean>{
    clearTimeout(this._autosave);
    if(this._saveJob){const ok=await this._saveJob;return ok&&this.data.dirty?this.persistDraft():ok;}
    if(!this.data.doc||!this.data.dirty||this._deletingJournal===this.data.doc.id)return true;
    const document=journalContent(this.data.doc),revision=this._revision,history=this.captureEditorHistory();
    this.setData({saveStatus:'正在保存'});
    this._saveJob=(async()=>{
      try{
        const documents=[document,...history.past.map(step=>step.document),...history.future.map(step=>step.document)],failed:string[]=[];
        for(const value of documents)for(const photo of value.elements.filter(e=>e.type==='photo')){
          if(photo.persisted||photo.src.startsWith('/assets/')||failed.includes(photo.src))continue;
          const previous=photo.src;
          try{
            const durable=await persistImage(previous);
            for(const doc of documents)for(const image of doc.elements)if(image.type==='photo'&&image.src===previous){image.src=durable;image.persisted=true;}
            this.rememberMedia(previous,durable);
          }catch(error){if(document.elements.some(e=>e.type==='photo'&&e.src===previous))throw error;failed.push(previous);}
        }
        if(failed.length){history.past=history.past.filter(step=>!step.document.elements.some(e=>e.type==='photo'&&failed.includes(e.src)));history.future=history.future.filter(step=>!step.document.elements.some(e=>e.type==='photo'&&failed.includes(e.src)));}
        if(this._savedDocumentId===document.id&&this._savedRevision>revision)return true;
        const saved=saveJournalState(document,history);document.updatedAt=saved.updatedAt;
        if(this.data.doc?.id===document.id){this._savedDocumentId=document.id;this._savedRevision=revision;}
        if(failed.length)this.setData({error:'手帐已保存，有旧素材无法保留，对应编辑步骤未缓存。'});
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
  captureEditorHistory(){
    const pending=this._editBefore,changed=pending&&this.data.doc&&journalFingerprint(pending.document)!==journalFingerprint(this.data.doc);
    return editorHistory(changed?[...this._past,pending!]:this._past,changed?[]:this._future,this.data.selectedId);
  },
  cacheEditorState(){
    const d=this.data.doc;if(!d||!this.data.dirty||this._deletingJournal===d.id)return false;
    const history=this.captureEditorHistory(),documents=[d,...history.past.map(step=>step.document),...history.future.map(step=>step.document)];
    if(documents.some(doc=>doc.elements.some(e=>e.type==='photo'&&!e.persisted&&!e.src.startsWith('/assets/'))))return false;
    try{const saved=saveJournalState(d,history);this._savedDocumentId=d.id;this._savedRevision=this._revision;this.data.doc!.updatedAt=saved.updatedAt;this.data.dirty=false;this.data.saveStatus='已自动保存';if(this._active)this.setData({dirty:false,saveStatus:'已自动保存'});return true;}
    catch(error){this.data.saveStatus='保存未完成';this.data.error='自动保存未完成，当前编辑仍保留。'+errorText(error);return false;}
  },
  restoreEditorSession(document:JournalDocument){
    this._past=[];this._future=[];this._savedRevision=-1;this._savedDocumentId=document.id;
    try{const state=restoreEditorHistory(document);this._past=state.past;this._future=state.future;return {selectedId:document.elements.some(e=>e.id===state.selected)?state.selected:'',error:''};}
    catch(error){return {selectedId:'',error:errorText(error)};}
  },
  _scrollTop:0,
  _catalog:[] as JournalAsset[],
  openLayers(){this.finishAdjustment();this.endTextEdit();this.setData({layersOpen:true});},
  closeLayers(){this.setData({layersOpen:false});},
  onEditorScroll(e:WechatMiniprogram.CustomEvent<{scrollTop:number}>){this._scrollTop=round2(e.detail.scrollTop);},
  onLoad(){resetSheetDrag(this);installAdaptiveSheets(this,()=>this.data.libraryToolsOpen||this.data.shareOpen||this.data.ai||this.data.aiHistoryOpen||this.data.cropOpen||this.data.layersOpen||this.data.templateOpen);this._failedPhotos=new Map();this._failedCovers=new Map();this.resizeEditor();},
  onResize(){this.closePaperAction();this.resizeEditor();this.projectDeck();fitAdaptiveSheets(this);},
  resizeEditor(){const box=layout();this.setData({homeHeight:Math.max(0,box.height),homeCompact:box.height<560,homeTiny:box.height<340,templateWidth:Math.min(150,Math.floor((box.width-48)/2-22)),headerHeight:box.headerHeight,assetImageHeight:round2((box.width-86)*.375),editorHeight:layout(true).height,stageWidth:box.width-52,scale:(box.width-52)/900});this.refresh();},
  onShow(){this._active=true;this.closePaperAction();this.resizeEditor();this.setData({filterOpen:false,calendarOpen:false,libraryToolsOpen:false,exporting:false});this.loadDrafts();if(this.data.shareOpen){if(this.data.libraryRows.some(row=>row.id===this.data.shareId)||this.data.doc?.id===this.data.shareId)this.setData({paperVisualId:this.data.shareId,paperPhase:'hidden'});else this.closeShare();}selectTab(this,1);if(this.data.doc&&this.data.view==='editor')this.refresh();},
  onHide(){resetSheetDrag(this);this.setData({filterOpen:false,calendarOpen:false,libraryToolsOpen:false,exporting:false});this._shareGeneration++;this.closePaperAction();clearTimeout(this._thumbTimer);this._thumbGeneration++;this._active=false;clearTimeout(this._autosave);this._aiGeneration++;this._aiJob?.cancel();this._aiJob=null;this.setData({aiBusy:false});this.finishAdjustment();this.endTextEdit();if(this._saveJob)this.cacheEditorState();void this.persistDraft();this.selectComponent?.('#journal-speech')?.stopWork?.();},
  loadDrafts(){try{
    this._documents=readJournalShelf();const id=wx.getStorageSync('bird-assistant.journal.last.v1');
    this.setData({resumeRow:this._documents.find(row=>row.id===id)||(typeof id==='string'&&id?{id,title:'上次编辑的手帐',ratio:'',updatedAt:'',revision:'',cover:'',thumbnail:''}:null),drafts:journalLibrary(this._documents,{text:'',ratio:'',order:'updated',from:'',to:''}),libraryTotal:this._documents.length});this.filterLibrary(false);
  }catch(e){this.setData({error:errorText(e)});}},
  filterLibrary(reset=true){this.closePaperAction();const d=this.data,rows=journalLibrary(this._documents,{text:d.libraryText,ratio:d.libraryRatio?d.libraryRatios[d.libraryRatio]:'',order:d.libraryOrder===1?'created':'updated',from:d.libraryFrom,to:d.libraryTo});
    const thumbnails:Record<string,string>={};for(const row of this._documents)if(row.thumbnail)thumbnails[row.id]=row.thumbnail;
    this.setData({libraryRows:rows,deckThumbnails:thumbnails,deckIndex:reset?0:Math.min(this.data.deckIndex,Math.max(0,rows.length-1))});this.projectDeck();
  },
  projectDeck(){
    clearTimeout(this._thumbTimer);this._thumbGeneration++;if(this.data.view!=='home')return;
    this._deckWidth=this.data.deckLaneWidth||Math.min(620,wx.getWindowInfo?.().windowWidth||360)-10;
    this.setData({deckSlots:this.data.libraryRows.slice(Math.max(0,this.data.deckIndex-1),this.data.deckIndex+2).map((row,index)=>({...row,index:index+Math.max(0,this.data.deckIndex-1),slot:index+Math.max(0,this.data.deckIndex-1)-this.data.deckIndex}))});
    // The animation only moves existing bitmap nodes. Decode/compose after it settles.
    this._thumbTimer=setTimeout(()=>void this.prepareDeckThumbnail(),320);if(wx.nextTick)wx.nextTick(()=>this.fitDeck());
  },
  fitDeck(){
    if(this.data.view!=='home'||this._paperTouch||this.data.paperPhase||typeof wx.createSelectorQuery!=='function')return;
    wx.createSelectorQuery().select('.journal-deck-frame').boundingClientRect(rect=>{if(!this._active||this._paperTouch||this.data.paperPhase||this.data.view!=='home')return;const box=rect as WechatMiniprogram.BoundingClientRectCallbackResult;if(!box||!Number.isFinite(box.height)||box.height<=0)return;const height=Math.max(66,Math.min(420,Math.floor(box.height-62))),preview=Math.max(24,Math.min(220,height-(this.data.homeTiny?62:132)));const width=Math.floor(Math.min(wx.getWindowInfo().windowWidth-16,Math.max(264,Math.min(430,(height*.78+86)/.84))));this._deckWidth=width;if(height!==this.data.deckHeight||preview!==this.data.deckPreviewHeight||width!==this.data.deckLaneWidth)this.setData({deckHeight:height,deckPreviewHeight:preview,deckLaneWidth:width});}).exec();
  },
  async prepareDeckThumbnail(){
    if(this._thumbBusy||!this._active||this.data.view!=='home'||this._paperTouch||this.data.deckSettling)return;
    const generation=this._thumbGeneration,rows=this.data.libraryRows.slice(Math.max(0,this.data.deckIndex-1),this.data.deckIndex+2);
    const row=rows.find(row=>!this.data.deckThumbnails[row.id]&&!this.data.previewErrors[row.id]);if(!row)return;
    const source=this._documents.find(item=>item.id===row.id),document=readJournalPreview(row.id);if(!source||!document){this.setData({previewErrors:{...this.data.previewErrors,[row.id]:true}});return;}
    this._thumbBusy=true;let release=()=>{},canvas:WechatMiniprogram.Canvas|undefined,pendingPath='';
    try{
      const prepared=await prepareThumbnailDocument(document);release=prepared.release;
      const scale=384/document.height,width=Math.max(1,Math.round(document.width*scale));
      canvas=await getCanvas(this,'#journal-thumbnail-export',width,384);canvas.getContext('2d').scale(scale,scale);
      await renderJournal(canvas,prepared.document);const temporary=await exportCanvas(canvas),path=await persistJournalThumbnail(temporary,row.id,source.revision);pendingPath=path;
      if(!saveJournalThumbnail(row.id,source.revision,path))return;pendingPath='';
      const current=this._documents.find(item=>item.id===row.id);if(current)current.thumbnail=path;
      if(this._active&&this.data.view==='home')this.setData({deckThumbnails:{...this.data.deckThumbnails,[row.id]:path}});
    }catch{if(this._active)this.setData({previewErrors:{...this.data.previewErrors,[row.id]:true}});}
    finally{if(pendingPath)discardThumbnail(pendingPath);release();if(canvas){canvas.width=1;canvas.height=1;}this._thumbBusy=false;if(this._active&&this.data.view==='home'){if(generation!==this._thumbGeneration)this.projectDeck();else this._thumbTimer=setTimeout(()=>void this.prepareDeckThumbnail(),80);}}
  },
  thumbnailFailed(e:Touch){const id=String(e.currentTarget.dataset.id);this.setData({previewErrors:{...this.data.previewErrors,[id]:true},deckThumbnails:{...this.data.deckThumbnails,[id]:''}});},
  retryThumbnail(e:Touch){const id=String(e.currentTarget.dataset.id);this.setData({previewErrors:{...this.data.previewErrors,[id]:false},deckThumbnails:{...this.data.deckThumbnails,[id]:''}});this.projectDeck();},
  librarySearch(e:Input){this.setData({libraryText:e.detail.value});this.filterLibrary();},
  openLibraryTools(){this.closePaperAction();this.setData({libraryToolsOpen:true});syncNavigation(this);},
  closeLibraryTools(){this.setData({libraryToolsOpen:false});syncNavigation(this);},
  openJournalChoice(e:Touch){
    this.closePaperAction();const field=String(e.currentTarget.dataset.key),d=this.data;
    const sets:Record<string,{title:string;options:string[];selected:number}>={libraryOrder:{title:'手帐排序',options:d.libraryOrders,selected:d.libraryOrder},libraryRatio:{title:'画布比例',options:d.libraryRatios,selected:d.libraryRatio},period:{title:'整理类型',options:d.periods,selected:d.period},purpose:{title:'这次写什么',options:d.purposes,selected:d.purpose},placement:{title:'文字放在哪里',options:d.placements,selected:d.placement},editorRatio:{title:'画布比例',options:d.ratios,selected:d.ratios.indexOf(d.doc?.ratio||'3:4')},editorStyle:{title:'手帐风格',options:d.styles.map(item=>item.name),selected:d.styles.findIndex(item=>item.id===d.doc?.style)}};
    const set=sets[field];if(!set)return;this.setData({filterOpen:true,filterField:field,filterTitle:set.title,filterOptions:set.options,filterSelected:set.selected});syncNavigation(this);
  },
  closeJournalChoice(){this.setData({filterOpen:false});syncNavigation(this);},
  chooseJournalChoice(e:WechatMiniprogram.CustomEvent<{value:number}>){const field=this.data.filterField,value=Number(e.detail.value);if(!Number.isInteger(value)||value<0||value>=this.data.filterOptions.length)return;this.closeJournalChoice();
    if(field==='libraryOrder'||field==='libraryRatio'){this.setData({[field]:value});this.filterLibrary();}
    else if(field==='period')this.setData({period:value});
    else if(field==='purpose'||field==='placement')this.aiChoice({currentTarget:{dataset:{key:field}},detail:{value:String(value)}} as unknown as Input);
    else if(field==='editorRatio')this.applyRatio(this.data.ratios[value]);
    else if(field==='editorStyle'&&this.data.doc){const before=this.before(),d=this.data.doc;d.style=this.data.styles[value].id;d.background=d.style==='minimal'?'#ffffff':d.style==='magazine'?'#eee8da':'#f5efdf';reflowJournalPhotos(d);this.setData({selectedId:'',overview:true});this.commit(before);}
  },
  openCalendar(e:Touch){this.closePaperAction();const target=e.currentTarget.dataset.target==='assets'?'assets':'library';this.setData({calendarOpen:true,calendarTarget:target,calendarFrom:target==='library'?this.data.libraryFrom:this.data.from,calendarTo:target==='library'?this.data.libraryTo:this.data.to});syncNavigation(this);},
  closeCalendar(){this.setData({calendarOpen:false});syncNavigation(this);},
  calendarChange(e:WechatMiniprogram.CustomEvent<{from:string;to:string}>){if(this.data.calendarTarget==='library'){this.setData({libraryFrom:e.detail.from,libraryTo:e.detail.to});this.filterLibrary();}else{this.setData({from:e.detail.from,to:e.detail.to});this.syncAssets();}this.closeCalendar();},
  libraryChoice(e:Input){const key=String(e.currentTarget.dataset.key);if(key==='libraryOrder'||key==='libraryRatio')this.setData({[key]:Number(e.detail.value)});else if(key==='libraryFrom'||key==='libraryTo')this.setData({[key]:e.detail.value});this.filterLibrary();},
  clearLibraryFilters(){this.setData({libraryText:'',libraryFrom:'',libraryTo:'',libraryOrder:0,libraryRatio:0});this.filterLibrary();},
  deckChange(e:WechatMiniprogram.CustomEvent<{current:number}>){const index=e.detail.current;if(Number.isInteger(index)&&index>=0&&index<this.data.libraryRows.length&&index!==this.data.deckIndex){this.closePaperAction();this.setData({deckIndex:index});this.projectDeck();}},
  deckCard(e:Touch){if(this._paperSuppressTap){this._paperSuppressTap=false;return;}if(this.data.deckSettling)return;const index=Number(e.currentTarget.dataset.index);if(index!==this.data.deckIndex)this.slideDeck(Math.sign(index-this.data.deckIndex));else this.openDraft(e);},
  slideDeck(direction:number){
    const next=this.data.deckIndex+direction;if(this.data.deckSettling||next<0||next>=this.data.libraryRows.length)return;
    this.setData({deckSettling:true,deckOffset:-direction*this._deckWidth*.84});
    clearTimeout(this._deckSlideTimer);this._deckSlideTimer=setTimeout(()=>{
      if(!this._active||this.data.view!=='home')return;
      this.setData({deckIndex:next,deckSettling:false,deckOffset:0});this.projectDeck();
    },220);
  },
  settleDeck(){
    this.setData({deckSettling:true,deckOffset:0});clearTimeout(this._deckSlideTimer);
    this._deckSlideTimer=setTimeout(()=>{if(this._active){this.setData({deckSettling:false});this.projectDeck();}},220);
  },
  deckTouchStart(e:Touch){
    clearTimeout(this._paperHoldTimer);this._paperSuppressTap=false;
    const touch=e.touches[0],id=String(e.currentTarget.dataset.id);
    if(e.touches.length!==1){this.closePaperAction();return;}
    if(!touch||this.data.deckSettling||id!==this.data.libraryRows[this.data.deckIndex]?.id||this.data.busy||this.data.exporting||this.data.shareOpen)return;
    clearTimeout(this._thumbTimer);
    const active=this.data.paperArmedId===id;
    this._paperTouch={x:touch.clientX,y:touch.clientY,lastX:touch.clientX,lastY:touch.clientY,id,active,started:Date.now()};
    if(active){this._paperSuppressTap=true;return;}
    const pending=this._paperTouch;
    this._paperHoldTimer=setTimeout(()=>{if(this._paperTouch===pending&&Math.hypot(pending.lastX-pending.x,pending.lastY-pending.y)<=PAPER_HOLD_SLOP)this.startDeckGesture(e);},PAPER_HOLD_MS);
  },
  startDeckGesture(e:Touch){
    const start=this._paperTouch,id=String(e.currentTarget.dataset.id);
    if(!this._active||this.data.view!=='home'||!start||start.id!==id||start.active||Date.now()-start.started<PAPER_HOLD_MS||id!==this.data.libraryRows[this.data.deckIndex]?.id||this.data.busy||this.data.shareOpen)return;
    start.active=true;start.x=start.lastX;start.y=start.lastY;this._paperViewport=wx.getWindowInfo?.().windowHeight||900;
    this._paperSuppressTap=true;this._paperLatest=null;
    this.setData({paperArmedId:id,paperDragStyle:'',paperDragAction:'',paperDragDown:false,paperDragUp:false,paperDragProgress:0,paperFog:0});
    this.setData({paperVisualId:id,paperPhase:'armed',paperFog:0});
    if(typeof wx.createSelectorQuery==='function'){
      // Measure the title, controls and card together so the fog keeps its accepted lower boundary.
      wx.createSelectorQuery().select('.library-heading').boundingClientRect()
        .select(this.data.homeCompact?'.library-tools-button':'.library-dates').boundingClientRect()
        .select('.deck-active .deck-card').boundingClientRect().exec(results=>{
          if(this.data.paperArmedId!==id)return;
          const rows=results as Array<WechatMiniprogram.BoundingClientRectCallbackResult|null>,heading=rows[0],controls=rows[1],box=rows[2];
          const top=Math.max(this.data.headerHeight,heading?.bottom||this.data.headerHeight);
          const bottom=Math.max(top+24,controls?.bottom||this._paperCloudBottom);
          this._paperCloudBottom=bottom;
          this.setData({paperCloudTop:top,paperCloudHeight:bottom-top});
          if(!box)return;
          const window=wx.getWindowInfo(),safe=Math.max(0,(window.screenHeight||window.windowHeight)-(window.safeArea?.bottom||window.screenHeight||window.windowHeight)),origin=box.top+box.height*.6;
          this._paperOrigin=origin;this._paperCardHeight=box.height;this._paperCardWidth=box.width;
          this._paperDeleteY=window.windowHeight-124-safe-origin;this._paperShareY=bottom-36-origin;
        });
    }
  },
  deckTouchMove(e:Touch){
    const start=this._paperTouch,touch=e.touches[0];if(!start)return;
    if(e.touches.length!==1||!touch){this.closePaperAction();return;}
    start.lastX=touch.clientX;start.lastY=touch.clientY;
    const dx=touch.clientX-start.x,dy=touch.clientY-start.y;
    if(!start.active){
      if(Math.hypot(dx,dy)>PAPER_HOLD_SLOP){clearTimeout(this._paperHoldTimer);this._paperSuppressTap=true;}
      if(Math.abs(dx)>Math.abs(dy)*1.25){
        const edge=dx>0?this.data.deckIndex===0:this.data.deckIndex===this.data.libraryRows.length-1;
        this.setData({deckOffset:Math.max(-this._deckWidth*.75,Math.min(this._deckWidth*.75,dx*(edge?.22:.85)))});
      }
      return;
    }
    const drag=paperDrag(dx,dy,this._paperViewport);if(drag.cancel){this.closePaperAction();return;}
    if(drag.down)drag.style=drag.style.replace(/translateY\([^)]*\)/,'translateY('+(Math.max(0,Math.min(116,this._paperDeleteY))*drag.progress)+'px)');if(drag.up)drag.style=drag.style.replace(/translateY\([^)]*\)/,'translateY('+(this._paperShareY*drag.progress)+'px)');const fog=dy<0?paperCloudOpacity(this._paperOrigin,this._paperCardHeight,this._paperCardWidth,this._paperShareY,drag.progress,this._paperCloudBottom):0;this._paperFog=fog;this._paperLatest=drag;
    if(!this._paperPreviews)this._paperPreviews=previewQueue(()=>{const latest=this._paperLatest;if(latest&&this.data.paperArmedId)this.setData({paperFog:this._paperFog,paperDragStyle:latest.style,paperDragAction:latest.action,paperDragDown:latest.down,paperDragUp:latest.up,paperDragProgress:latest.progress});},20);
    this._paperPreviews.request();
  },
  deckTouchEnd(){
    clearTimeout(this._paperHoldTimer);const start=this._paperTouch;
    if(!start?.active){
      this._paperTouch=null;if(!start)return;
      const dx=start.lastX-start.x,dy=start.lastY-start.y,step=dx<0?1:-1,next=this.data.deckIndex+step;
      if(Math.hypot(dx,dy)<=PAPER_HOLD_SLOP){this.projectDeck();return;}
      if(Math.abs(dx)>=Math.max(54,this._deckWidth*.16)&&Math.abs(dx)>Math.abs(dy)*1.3&&next>=0&&next<this.data.libraryRows.length)this.slideDeck(step);
      else this.settleDeck();return;
    }
    this._paperPreviews?.flush();const action=this._paperLatest?.action||'',id=start.id;this._paperTouch=null;this._paperSuppressTap=true;
    if(action)this.departPaper(id,action);
    else {this._paperLatest=null;this.setData({paperDragStyle:'',paperDragAction:'',paperDragDown:false,paperDragUp:false,paperDragProgress:0,paperFog:0});}
  },

  cancelPaper(){if(this.data.paperPhase==='depart-share'||this.data.paperPhase==='depart-delete')this.returnPaper();else this.closePaperAction();},
  departPaper(id:string,action:'share'|'delete'){
    this._paperPreviews?.cancel();const token=++this._paperFlightGeneration;
    this.setData({paperArmedId:'',paperVisualId:id,paperPhase:'depart-'+action,paperFog:action==='share'?1:0,paperDragAction:action,paperDragDown:action==='delete',paperDragStyle:'transform:translateY('+(action==='share'?this._paperShareY:this._paperDeleteY)+'px) scale(.08);opacity:0'});
    clearTimeout(this._paperFlightTimer);this._paperFlightTimer=setTimeout(()=>{
      if(!this._active||token!==this._paperFlightGeneration)return;if(this.data.view!=='home'){this.closePaperAction();return;}
      this.setData({paperPhase:'hidden'});const event={currentTarget:{dataset:{id}}} as unknown as Touch;
      if(action==='share')this.shareJournal(event,true);else this.deleteJournal(event,true);
    },360);
  },
  returnPaper(){
    clearTimeout(this._paperFlightTimer);this._paperFlightGeneration++;this._paperTouch=null;this._paperLatest=null;this._paperPreviews?.cancel();
    if(!this.data.paperVisualId){this.closePaperAction();return;}
    this.setData({paperArmedId:'',paperPhase:'returning',paperDragAction:'',paperDragDown:false,paperDragUp:false,paperDragProgress:0,paperFog:0,paperDragStyle:'',deckSettling:false,deckOffset:0});
    this._paperFlightTimer=setTimeout(()=>{if(this._active)this.setData({paperPhase:'',paperVisualId:''});},340);
  },
  closePaperAction(){
    clearTimeout(this._paperHoldTimer);clearTimeout(this._deckSlideTimer);clearTimeout(this._paperFlightTimer);this._paperFlightGeneration++;this._paperPreviews?.cancel();this._paperTouch=null;this._paperLatest=null;this._paperSuppressTap=false;
    if(this.data.deckSettling||this.data.deckOffset)this.setData({deckSettling:false,deckOffset:0});
    if(this.data.paperArmedId||this.data.paperDragStyle||this.data.paperPhase)this.setData({paperArmedId:'',paperVisualId:'',paperPhase:'',paperDragStyle:'',paperDragAction:'',paperDragDown:false,paperDragUp:false,paperDragProgress:0,paperFog:0});
  },
  shareJournal(e?:Touch,fromGesture=false){
    if(this.data.busy||this.data.exporting){if(fromGesture)this.returnPaper();return;}
    if(!fromGesture)this.closePaperAction();this.finishAdjustment();this.endTextEdit();
    const id=String(e?.currentTarget?.dataset?.id||this.data.doc?.id||'');if(!id){if(fromGesture)this.returnPaper();return;}
    try{
      const doc=this.data.doc?.id===id?journalContent(this.data.doc):readJournals().find(item=>item.id===id);if(!doc){this.setData({error:'手帐未找到，请重新打开。'});if(fromGesture)this.returnPaper();return;}
      this._shareGeneration++;this._shareSnapshot=journalContent(doc);this._shareBefore=journalFingerprint(doc);
      const bitmap=this.data.doc?.id===id&&this.data.dirty?'':this.data.deckThumbnails[id]||'';const viewport=wx.getWindowInfo(),ratio=doc.width/doc.height,width=Math.min(160,(viewport.windowWidth-82)*.46,viewport.windowHeight*.23*ratio),height=width/ratio;
      this.setData({shareOpen:true,shareId:id,shareTitle:doc.title,shareRatio:doc.ratio,shareBitmap:bitmap,sharePreviewWidth:width,sharePreviewHeight:height,sharePreview:bitmap?null:journalThumbnail(doc,height),shareError:'',shareStatus:''});syncNavigation(this);
    }catch(error){this.setData({error:errorText(error)});if(fromGesture)this.returnPaper();}
  },
  closeShare(){this._shareGeneration++;this._shareSnapshot=null;const open=this.data.shareOpen;if(open)this.setData({shareOpen:false,sharePreview:null,shareBitmap:'',shareError:'',shareStatus:''});if(open||this.data.paperPhase==='hidden')this.returnPaper();syncNavigation(this);},
  sharePreviewFailed(){try{const document=this.data.doc?.id===this.data.shareId?this.data.doc:readJournals().find(item=>item.id===this.data.shareId);this.setData({shareBitmap:'',sharePreview:document?journalThumbnail(document,this.data.sharePreviewHeight||128):null});}catch{this.setData({shareBitmap:'',shareError:'预览暂不可读，手帐仍保留。请关闭后重新打开。'});}},
  chooseShare(e:Touch){const destination=Number(e.currentTarget.dataset.destination);if(this.data.shareOpen&&[0,1,2].includes(destination))void this.shareJournalImage(this.data.shareId,destination);},
  async shareJournalImage(id:string,destination:number){
    if(this.data.busy||this.data.exporting||![0,1,2].includes(destination))return;
    const generation=this._shareGeneration;
    this.setData({exporting:true,shareError:'',shareStatus:'',error:''});
    const current=()=>generation===this._shareGeneration&&this._active;
    try{
      if(this.data.doc?.id===id&&this.data.dirty&&!await this.persistDraft())throw new Error('手帐保存尚未完成，请先保存后再分享。');
      if(!current())return;
      const document=readJournals().find(item=>item.id===id);if(!document)throw new Error('手帐未找到，请重新打开。');
      if(this.data.shareOpen&&this._shareBefore!==journalFingerprint(document))throw new Error('手帐内容已更新，请关闭分享后重新预览。');
      const canvas=await getCanvas(this,'#journal-export',document.width,document.height);if(!current())return;
      await renderJournal(canvas,document);if(!current())return;const path=await exportCanvas(canvas);if(!current())return;
      if(destination===0){await wx.saveImageToPhotosAlbum({filePath:path});if(current())wx.showToast({title:'已保存PNG成品图',icon:'success'});}
      else if(destination===1){
        const draft=newPostDraft();draft.title=document.title;draft.images=[postImage(path,'journal',document.title,document.id)];
        const saved=await savePostDraft(draft);
        if(!current())return;queuePostDraft(saved.id!);
        wx.switchTab({url:'/pages/community/index',fail:()=>{if(this._active)this.setData({error:'手帐已放入本机帖子草稿，可从讨论页的草稿箱继续。'});}});
      }else if(typeof wx.showShareImageMenu==='function'){
        await new Promise<void>((resolve,reject)=>wx.showShareImageMenu({path,needShowEntrance:false,success:()=>resolve(),fail:reject}));
      }else throw new Error('当前微信版本暂不支持图片分享菜单，可选择保存到相册后分享。');
      if(current())this.setData({shareStatus:destination===0?'已保存到相册，可继续选择其他分享方式。':destination===1?'已加入帖子草稿，可继续分享。':'已返回，可继续选择分享方式。'});
    }catch(error){if(current()){if(/cancel/i.test(String((error as {errMsg?:string})?.errMsg||'')))this.setData({shareStatus:'已取消，可继续选择分享方式。'});else this.setData({shareError:error instanceof Error?error.message:'分享未完成，手帐和原图仍保留。'});}}
    finally{if(this._active){this.setData({exporting:false});syncNavigation(this);}else this.data.exporting=false;}
  },
  deckImageFailed(e:Touch){const id=String(e.currentTarget.dataset.doc),partId=String(e.currentTarget.dataset.id),preview=this.data.deckPreviews[id],part=preview?.elements.find(e=>e.id===partId);if(!part?.src)return;const key=id+':'+partId;(this._failedCovers||(this._failedCovers=new Map())).set(key,part.src);this.setData({deckPreviews:{...this.data.deckPreviews,[id]:{...preview,elements:preview.elements.map(e=>e.id===partId?{...e,src:''}:e)}}});},
  coverFailed(e:Touch){const id=String(e.currentTarget.dataset.id),row=this.data.libraryRows.find(row=>row.id===id);if(row?.cover&&this._failedCovers?.get(id)!==row.cover){(this._failedCovers||(this._failedCovers=new Map())).set(id,row.cover);this.filterLibrary(false);}},
  renameJournal(e?:Touch){const id=String(e?.currentTarget?.dataset?.id||this.data.doc?.id||''),doc=this.data.doc?.id===id?this.data.doc:readJournals().find(d=>d.id===id);if(!doc||this.data.busy)return;wx.showModal({title:'手帐名称',editable:true,content:doc.title,placeholderText:'给这份手帐起个名字',success:reply=>{if(!reply.confirm)return;const name=reply.content?.trim();if(!name){wx.showToast({title:'名称不能为空',icon:'none'});return;}if(Array.from(name).length>80){wx.showToast({title:'名称最多80字',icon:'none'});return;}try{if(this.data.doc?.id===id&&this.data.view==='editor'){const before=this.before();this.data.doc.title=name;this.commit(before);}else{const items=readJournals(),item=items.find(d=>d.id===id);if(!item)return;const before=snapshot(item,''),history=restoreEditorHistory(item);item.title=name;saveJournalState(item,editorHistory([...history.past,before],[],history.selected));if(this.data.doc?.id===id){const saved=readJournals().find(d=>d.id===id)!;const state=this.restoreEditorSession(saved);this.setData({doc:journalContent(saved),selectedId:state.selectedId,canUndo:!!this._past.length,canRedo:!!this._future.length});}this.loadDrafts();}}catch(error){this.setData({error:errorText(error)});}}});},
  deleteJournal(e?:Touch,fromGesture=false){
    const id=String(e?.currentTarget?.dataset?.id||this.data.doc?.id||''),doc=this.data.doc?.id===id?this.data.doc:readJournals().find(item=>item.id===id);
    if(!doc||this.data.busy||this.data.exporting){if(fromGesture)this.returnPaper();return;}
    wx.showModal({title:'删除这份手帐？',content:'“'+doc.title+'”及其本机编辑、AI建议记录会删除。原照片和已加入帖子的成品图保留。',confirmText:'删除手帐',confirmColor:'#a65e40',success:reply=>{if(reply.confirm)void this.confirmDeleteJournal(id);else if(fromGesture)this.returnPaper();},fail:()=>{if(fromGesture)this.returnPaper();}});
  },
  async confirmDeleteJournal(id:string){
    if(this.data.busy||this.data.exporting||!id)return;this._deletingJournal=id;this.setData({busy:true});
    try{
      const index=this.data.libraryRows.findIndex(row=>row.id===id),arrival=index>=0&&index<this.data.libraryRows.length-1?'right':'left';
      const active=this.data.doc?.id===id;if(active){clearTimeout(this._autosave);this.closeAi();this._assetPickToken++;}
      if(this._saveJob)await this._saveJob;
      deleteJournalState(id);
      let warning='';try{deleteWritingScope('journal',id);}catch{warning='手帐已删除，AI建议记录暂未清理。';}
      if(this.data.doc?.id===id){this._past=[];this._future=[];this._editBefore=null;this._adjustment=null;this._drag=null;this._catalog=[];this._previews?.cancel();this.setData({doc:null,view:'home',headerTitle:'羽迹',dirty:false,selectedId:'',selected:null,renderElements:[],labels:[],canUndo:false,canRedo:false,ai:false,aiSuggestion:null,aiHistory:[],aiPhotos:[],prompt:'',templateOptions:[],layersOpen:false,cropOpen:false,cropDraft:null,templateOpen:false,exportPath:'',saveStatus:'',error:''});}
      this.loadDrafts();this.setData({deckArrival:arrival});clearTimeout(this._paperFlightTimer);this._paperFlightTimer=setTimeout(()=>{if(this._active)this.setData({deckArrival:''});},360);if(warning)this.setData({error:warning});wx.showToast({title:warning?'手帐已删除，记录清理未完成':'手帐已删除',icon:warning?'none':'success'});
    }catch(error){this.setData({error:'手帐未删除。'+errorText(error)});this.returnPaper();}
    finally{this._deletingJournal='';this.setData({busy:false});}
  },
  canOpenAnother(then?:()=>void){
    if(this.data.busy||this.data.exporting)return false;
    if(this.data.doc&&this.data.dirty){void this.persistDraft().then(ok=>{if(ok)then?.();});return false;}
    return true;
  },
  newJournal(){if(!this.canOpenAnother(()=>this.newJournal()))return;this._catalog=[];this.setData({title:'',view:'picker',headerTitle:'选择素材',assets:[],chosen:0,source:'observations',error:''});this.loadAssets();resetPageScroll(this);},
  sample(e?:Touch){if(!this.canOpenAnother(()=>this.sample(e)))return;const count=Number(e?.currentTarget.dataset.count)||4;this._catalog=copy(samples).map((a,i)=>({...a,source:'sample',selected:i<count}));this.setData({title:'',view:'picker',headerTitle:'选择素材',source:'sample',error:''});this.syncAssets();resetPageScroll(this);},
  syncAssets(){const favorites=this.data.source==='collection'?(wx.getStorageSync('bird-assistant.favorites.v1')||[]):[],d=this.data;this.setData({assets:this._catalog.filter(a=>(d.source==='collection'?favorites.includes(a.id):a.source===d.source)&&(!a.date?d.unknown:(!d.from||a.date>=d.from)&&(!d.to||a.date<=d.to))),chosen:this._catalog.filter(a=>a.selected).length,picked:this._catalog.filter(a=>a.selected)});},
  date(e:Input){const key=String(e.currentTarget.dataset.key);if(key==='from'||key==='to'){this.setData({[key]:e.detail.value});this.syncAssets();}},
  clearDates(){this.setData({from:'',to:''});this.syncAssets();},
  unknown(){this.setData({unknown:!this.data.unknown});this.syncAssets();},
  clearSelection(){for(const a of this._catalog)a.selected=false;this.syncAssets();},
  reorder(e:Touch){const picked=this._catalog.filter(a=>a.selected),i=picked.findIndex(a=>a.id===e.currentTarget.dataset.id),j=clamp(i+Number(e.currentTarget.dataset.delta),0,picked.length-1);if(i<0||i===j)return;const a=this._catalog.indexOf(picked[i]),b=this._catalog.indexOf(picked[j]),first=this._catalog[a];this._catalog[a]=this._catalog[b];this._catalog[b]=first;this.syncAssets();},
  period(e:Input){this.setData({period:Number(e.detail.value)});},notes(){this.setData({includeNotes:!this.data.includeNotes});},
  loadAssets(){try{const records=localRepository().list().filter(r=>!r.mediaKind||r.mediaKind==='photo');for(const r of records)if(!this._catalog.some(a=>a.id===r.id))this._catalog.push({id:r.id,src:r.imagePath,label:r.birdName,notes:r.notes,sample:isSampleObservation(r),selected:false,persisted:true,source:'observations',date:r.observedDate||undefined});this.syncAssets();}catch(e){this.setData({error:errorText(e)});}},
  source(e:Touch){const source=String(e.currentTarget.dataset.id);this.setData({source});if(source==='sample'&&!this._catalog.some(a=>a.source==='sample'))this._catalog.push(...copy(samples).map(a=>({...a,source:'sample',selected:false})));if(source==='observations'||source==='collection')this.loadAssets();else this.syncAssets();},
  importPhotos(){
    const count=6-this.data.chosen;if(count<1){wx.showToast({title:'每页先选最多 6 张，可先取消一张',icon:'none'});return;}
    const token=++this._assetPickToken,catalog=this._catalog;
    wx.chooseImage({count,sizeType:['original'],sourceType:['album'],success:async r=>{
      const active=()=>token===this._assetPickToken&&catalog===this._catalog&&this.data.view==='picker';
      try{const files=await acceptPickedMedia(r.tempFilePaths.map(path=>({path,kind:'photo' as const})),active);if(!active()||!files.length)return;
      this._catalog.push(...files.map((file,i)=>({id:'album-'+Date.now()+'-'+i,src:file.path,label:'片段 '+(i+1),notes:'',sample:false,selected:true,source:'album'})));this.setData({source:'album',error:''});this.syncAssets();}catch(error){if(active())this.setData({error:'照片导入未完成，已有素材仍保留。'+errorText(error)});}
    },fail:e=>{if(token===this._assetPickToken&&!/cancel/i.test(e.errMsg))this.setData({error:'照片选择未完成，已有素材保留。'});}});
  },
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
    this.setData({purpose:3,placement:2,aiDestination:'overview',aiIncludeTitle:true,aiIncludeCaptions:true,aiTargetLabel:'更新页首概述及照片说明 · 手帐名称不变',prompt:''});
  },
  openDraft(e:Touch){if(!this.canOpenAnother(()=>this.openDraft(e)))return;const doc=readJournals().find(d=>d.id===e.currentTarget.dataset.id);if(doc)this.openDocument(copy(doc),false);},
  assetLoaded(e:WechatMiniprogram.CustomEvent<{width:number;height:number}>){const a=this._catalog.find(a=>a.id===e.currentTarget.dataset.id);if(a&&e.detail.width>0&&e.detail.height>0){a.width=e.detail.width;a.height=e.detail.height;}},
  openDocument(doc:JournalDocument,dirty:boolean){clearTimeout(this._autosave);if(!dirty&&wx.setStorageSync){try{wx.setStorageSync('bird-assistant.journal.last.v1',doc.id);}catch{/* draft data remains independently readable */}}this._aiGeneration++;this._aiJob?.cancel();this._aiJob=null;this._aiContext=null;const state=dirty?{selectedId:'',error:''}:this.restoreEditorSession(doc);if(dirty){this._past=[];this._future=[];this._savedRevision=-1;this._savedDocumentId=doc.id;}this._editBefore=null;this._adjustment=null;this._scrollTop=0;this.setData({doc:journalContent(doc),view:'editor',headerTitle:'编辑手帐',selectedId:state.selectedId,backgroundSelected:false,dirty,ai:false,aiBusy:false,aiSuggestion:null,layersOpen:false,overview:false,cropOpen:false,cropDraft:null,numberEditing:'',numberDrafts:{},exportPath:'',error:state.error,saveStatus:dirty?'更改待保存':'已自动保存'});resetPageScroll(this);this.refresh();if(dirty)this.scheduleSave();},
  refresh(){this._previews?.cancel();const d=this.data.doc;if(!d)return;fit(d);const selected=d.elements.find(e=>e.id===this.data.selectedId)||null,scale=this.data.scale;
    const renderElements=d.elements.map(original=>{
      const e=this.data.cropDraft?.id===original.id?{...original,...this.data.cropDraft}:original;
      return {...projectElement(e,d,scale),unreadable:this._failedPhotos?.get(e.id)===e.src};
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
  text(e:Input){const d=this.data.doc,selected=this.data.selected;if(!d||!selected)return;this.beginTextEdit();const key=String(e.currentTarget.dataset.key);if(key==='title'||key==='text'){const a=d.elements.find(a=>a.id===selected.id)!;a[key]=e.detail.value;a.maxLines=0;this.setData({doc:d,dirty:true,exportPath:''});this.scheduleSave();this.refresh();}},
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
    this.openJournalChoice({currentTarget:{dataset:{key:'editorRatio'}}} as unknown as Touch);
  },
  applyRatio(ratio:string){if(!this.data.doc||this.data.doc.ratio===ratio)return;const before=this.before();if(!changeJournalRatio(this.data.doc,ratio))return;this.setData({selectedId:'',backgroundSelected:false,overview:true,error:''});this.commit(before);},
  changeStyle(){
    if(this.data.busy||this.data.exporting||!this.data.doc)return;
    this.openJournalChoice({currentTarget:{dataset:{key:'editorStyle'}}} as unknown as Touch);
  },
  placeText(e:Touch){if(!this.data.doc||this.data.selected?.type!=='text')return;const before=this.before();try{const doc=positionJournalText(this.data.doc,this.data.selectedId,String(e.currentTarget.dataset.position));this.setData({doc,error:''});this.commit(before);}catch(error){this.setData({error:errorText(error)});}},
  addText(){const before=this.before(),d=this.data.doc!,a=element('text',{x:90,y:d.height*.45,w:600,h:60,title:'',text:'写下这一刻的感想',fontSize:28});d.elements.push(a);this.setData({selectedId:a.id});this.commit(before);},
  addDecoration(e:Touch){const before=this.before(),d=this.data.doc!,a=element(String(e.currentTarget.dataset.id),{x:700,y:d.height*.48,w:80,h:80,color:'#839771',ornamentOriginalRatio:1,ornamentRatioLocked:false});d.elements.push(a);this.setData({selectedId:a.id});this.commit(before);},
  addPhoto(){
    const id=this.data.doc?.id;if(!id)return;const token=++this._assetPickToken;
    wx.chooseImage({count:1,sourceType:['album'],sizeType:['original'],success:async r=>{
      const active=()=>token===this._assetPickToken&&this.data.doc?.id===id&&this.data.view==='editor';
      try{const files=await acceptPickedMedia(r.tempFilePaths.map(path=>({path,kind:'photo' as const})),active);if(!active()||!files.length)return;
      const before=this.before(),d=this.data.doc!,number=Math.max(0,...d.elements.map(e=>e.photoNumber))+1,a=element('photo',{x:100,y:d.height*.3,w:360,h:270,src:files[0].path,photoNumber:number});d.elements.push(a);this.setData({selectedId:a.id});this.commit(before);}catch(error){if(active())this.setData({error:'照片导入未完成，已有素材仍保留。'+errorText(error)});}
    }});
  },
  imageLoaded(e:WechatMiniprogram.CustomEvent<{width:number;height:number}>){
    if(!Number.isFinite(e.detail.width)||!Number.isFinite(e.detail.height)||e.detail.width<=0||e.detail.height<=0)return;
    const id=e.currentTarget.dataset.id,a=this.data.doc?.elements.find(a=>a.id===id);let changed=false;
    for(const image of [a,this.data.cropDraft?.id===id?this.data.cropDraft:null])if(image&&(image.iw!==e.detail.width||image.ih!==e.detail.height)){image.iw=e.detail.width;image.ih=e.detail.height;changed=true;}
    if(changed)this.refresh();
  },
  rememberMedia(oldPath:string,newPath:string){
    const replace=(d:JournalDocument)=>{for(const e of d.elements)if(e.type==='photo'&&e.src===oldPath){e.src=newPath;e.persisted=true;}};
    if(this.data.doc)replace(this.data.doc);
    // Saving an original changes its local path, not the composition the user previewed.
    if(this.data.shareOpen&&this._shareSnapshot){replace(this._shareSnapshot);this._shareBefore=journalFingerprint(this._shareSnapshot);}
    const patch:Record<string,unknown>={};
    this.data.renderElements.forEach((e,i)=>{if(e.src===oldPath){const value={...e,src:newPath,persisted:true};this.data.renderElements[i]=value;patch['renderElements['+i+']']=value;}});
    if(this.data.cropDraft?.src===oldPath){this.data.cropDraft.src=newPath;patch.cropDraft=this.data.cropDraft;}
    for(const a of this._catalog)if(a.src===oldPath){a.src=newPath;a.persisted=true;}
    const aiPhotos=this.data.aiPhotos.map(photo=>photo.src===oldPath?{...photo,src:newPath}:photo);this.data.aiPhotos=aiPhotos;patch.aiPhotos=aiPhotos;
    const assets=this.data.assets.map(a=>a.src===oldPath?{...a,src:newPath,persisted:true}:a);this.data.assets=assets;patch.assets=assets;
    const picked=this.data.picked.map(a=>a.src===oldPath?{...a,src:newPath,persisted:true}:a);this.data.picked=picked;patch.picked=picked;
    const templateOptions=this.data.templateOptions.map(option=>({...option,photos:option.photos.map(photo=>photo.src===oldPath?{...photo,src:newPath}:photo)}));this.data.templateOptions=templateOptions;patch.templateOptions=templateOptions;
    if(this._active&&Object.keys(patch).length)this.setData(patch);
    if(this._aiContext){const d=JSON.parse(this._aiContext.before);replace(d);this._aiContext.before=journalFingerprint(d);}
    for(const history of [...this._past,...this._future])replace(history.document);if(this._editBefore)replace(this._editBefore.document);
  },
  remove(){if(!this.data.selectedId)return;const before=this.before(),d=this.data.doc!;d.elements=d.elements.filter(e=>e.id!==this.data.selectedId);this.setData({selectedId:''});this.commit(before);},
  layer(e:Touch){const before=this.before(),d=this.data.doc!,i=d.elements.findIndex(e=>e.id===this.data.selectedId),to=clamp(i+Number(e.currentTarget.dataset.delta),0,d.elements.length-1);if(i>=0){const a=d.elements.splice(i,1)[0];d.elements.splice(to,0,a);}this.commit(before);},
  rearrange(){if(!this.data.doc||this.data.busy||this.data.exporting)return;const before=this.before(),d=this.data.doc;d.variant=d.variant%(d.elements.filter(e=>e.type==='photo').length<=2?3:2)+1;reflowJournalPhotos(d);this.setData({selectedId:'',backgroundSelected:false,overview:true,error:''});this.commit(before);},
  async save(){this.finishAdjustment();this.endTextEdit();if(this.data.busy||!this.data.doc)return;this.setData({busy:true});const ok=await this.persistDraft();this.setData({busy:false});if(ok)wx.showToast({title:'手帐已保存到本机',icon:'success'});},
  openAi(){
    if(this.data.busy||this.data.exporting||!this.data.doc)return;this.finishAdjustment();this.endTextEdit();const d=this.data.doc;
    this._aiGeneration++;this._aiJob?.cancel();this._aiJob=null;this._aiContext=null;
    this._aiOriginSelection=this.data.selected?.type==='text'?this.data.selectedId:'';
    const aiDestination:WritingDestination=this._aiOriginSelection?'selected':'new';
    const aiPhotos=d.elements.filter(e=>e.type==='photo').map(e=>({id:e.id,src:e.src,label:elementLabel(e,d),selected:this.data.selected?.type==='photo'?e.id===this.data.selectedId:true}));
    this.setData({ai:true,aiBusy:false,aiSuggestion:null,prompt:'',inputMode:'text',purpose:0,placement:1,speechApplied:'',bundleSummary:'',error:'',aiDestination,aiSelectedAvailable:!!this._aiOriginSelection,aiIncludeTitle:false,aiIncludeCaptions:false,aiPhotos,aiPhotoCount:aiPhotos.filter(p=>p.selected).length,aiCaptionPreviews:[],aiHistoryNotice:'',aiTargetLabel:writingDestinationLabel({destination:aiDestination,placement:1})});
  },
  closeAi(){this._aiGeneration++;this._aiJob?.cancel();this._aiJob=null;this._aiContext=null;this.selectComponent?.('#journal-speech')?.stopWork?.();this.setData({ai:false,aiBusy:false,aiHistoryOpen:false});},
  prompt(e:Input){this._aiGeneration++;this._aiJob?.cancel();this._aiJob=null;this.setData({prompt:e.detail.value,aiBusy:false,aiSuggestion:null,error:''});},
  toggleInput(){this.setData({inputMode:this.data.inputMode==='text'?'voice':'text'});},
  aiChoice(e:Input){const key=String(e.currentTarget.dataset.key);if(key==='placement'){const placement=Number(e.detail.value);this.setData({placement,aiTargetLabel:writingDestinationLabel({destination:this.data.aiDestination,placement})});return;}if(key!=='purpose')return;this._aiGeneration++;this._aiJob?.cancel();this._aiJob=null;this.setData({purpose:Number(e.detail.value),aiIncludeCaptions:Number(e.detail.value)===3,aiBusy:false,aiSuggestion:null,error:''});},
  chooseAiDestination(e:Touch){const destination=String(e.currentTarget.dataset.id) as WritingDestination;if(!['new','selected','overview'].includes(destination)||destination==='selected'&&!this._aiOriginSelection)return;this.setData({aiDestination:destination,aiTargetLabel:writingDestinationLabel({destination,placement:this.data.placement})});},
  aiTitle(){this.setData({aiIncludeTitle:!this.data.aiIncludeTitle});},
  aiCaptions(){this.setData({aiIncludeCaptions:!this.data.aiIncludeCaptions});},
  aiPhoto(e:Touch){this._aiGeneration++;this._aiJob?.cancel();this._aiJob=null;const aiPhotos=this.data.aiPhotos.map(p=>p.id===e.currentTarget.dataset.id?{...p,selected:!p.selected}:p),count=aiPhotos.filter(p=>p.selected).length;this.setData({aiBusy:false,aiSuggestion:null,aiPhotos,aiPhotoCount:count,error:count>4?'已选择 '+count+' 张，每次最多关联4张。请取消多余照片。':'',bundleSummary:''});},
  aiPhotosAll(){this._aiGeneration++;this._aiJob?.cancel();this._aiJob=null;const all=this.data.aiPhotos.every(p=>p.selected),aiPhotos=this.data.aiPhotos.map((p,index)=>({...p,selected:!all&&index<4}));this.setData({aiPhotos,aiPhotoCount:aiPhotos.filter(p=>p.selected).length,aiBusy:false,aiSuggestion:null,error:'',bundleSummary:''});},
  async prepareAi(){
    const d=this.data.doc;if(!d||this.data.aiBusy)return;const generation=++this._aiGeneration;
    try{
      const ids=this.data.aiPhotos.filter(p=>p.selected).map(p=>p.id);
      if(ids.length>4)throw new Error('已选择 '+ids.length+' 张，每次最多关联4张。请取消多余照片。');
      if(d.elements.some(e=>e.type==='photo'&&!e.persisted&&!e.src.startsWith('/assets/'))&&!await this.persistDraft())return;
      if(generation!==this._aiGeneration||!this.data.ai||this.data.doc?.id!==d.id)return;
      const prepared=journalWritingBrief(d,{destination:this.data.aiDestination,selectedId:this._aiOriginSelection,placement:this.data.placement,includeTitle:this.data.aiIncludeTitle,includeCaptions:this.data.aiIncludeCaptions,purpose:this.data.purposes[this.data.purpose],prompt:this.data.prompt,photoIds:ids});
      this.setData({bundleSummary:ids.length+' 张关联图片 · 最多约 '+prepared.input.maxChars+' 字',aiSuggestion:null,aiCaptionPreviews:[],error:'',aiHistoryNotice:''});
      const job=startJournalAi(prepared.input,journalAiAvailable()?undefined:teamWritingTransport(this));this._aiJob=job;this._aiContext=prepared.context;this.setData({aiBusy:true});
      try{const suggestion=await job.result;if(this._aiJob===job&&this.data.ai&&this.data.doc?.id===d.id){this.setData({aiSuggestion:suggestion,aiCaptionPreviews:(suggestion.captions||[]).map(p=>({...p,label:'照片 '+d.elements.find(e=>e.id===p.id)?.photoNumber}))});try{rememberWriting('journal',d.id,prepared.input,suggestion);}catch{this.setData({aiHistoryNotice:'建议已生成，本机写作记录暂未保存。'});}}}
      catch(error){if(this._aiJob===job)this.setData({error:errorText(error)});}
      finally{if(this._aiJob===job){this._aiJob=null;this.setData({aiBusy:false});}}
    }catch(error){if(generation===this._aiGeneration)this.setData({aiBusy:false,error:error instanceof Error?error.message:errorText(error)});}
  },
  editAiSuggestion(e:Input){const key=String(e.currentTarget.dataset.key);if(this.data.aiSuggestion&&['title','body'].includes(key))this.setData({aiSuggestion:{...this.data.aiSuggestion,[key]:e.detail.value},error:''});},
  editAiCaption(e:Input){const id=String(e.currentTarget.dataset.id),suggestion=this.data.aiSuggestion;if(!suggestion)return;this.setData({aiSuggestion:{...suggestion,captions:(suggestion.captions||[]).map(p=>p.id===id?{...p,text:e.detail.value}:p)},aiCaptionPreviews:this.data.aiCaptionPreviews.map(p=>p.id===id?{...p,text:e.detail.value}:p),error:''});},
  applyAi(e:Touch){
    const suggestion=this.data.aiSuggestion,context=this._aiContext,d=this.data.doc;if(!suggestion||!context||!d)return;
    try{const before=this.before(),applied=applyJournalWriting(d,{...context,destination:this.data.aiDestination,target:this.data.aiDestination==='selected'?this._aiOriginSelection:this.data.aiDestination==='overview'?(journalHeading(d)?.id||''):'',placement:this.data.placement,includeTitle:this.data.aiIncludeTitle,includeCaptions:this.data.aiIncludeCaptions},suggestion,e.currentTarget.dataset.design==='yes');this.setData({doc:applied.document,selectedId:applied.targetId,overview:true,ai:false,aiSuggestion:null,error:''});this._aiContext=null;this.commit(before);try{markWritingApplied('journal',d.id,suggestion.requestId);}catch{}}
    catch(error){this.setData({error:errorText(error)});}
  },
  openAiRecords(){this.openAi();this.openAiHistory();},
  openAiHistory(){if(!this.data.doc)return;try{this.setData({aiHistory:readWritingHistory('journal',this.data.doc.id),aiHistoryOpen:true});}catch(error){this.setData({error:errorText(error)});}},
  closeAiHistory(){this.setData({aiHistoryOpen:false});},
  restoreAiHistory(e:Touch){const record=this.data.aiHistory.find(row=>row.id===e.currentTarget.dataset.id),d=this.data.doc;if(!record||!d)return;this._aiGeneration++;this._aiJob?.cancel();this._aiJob=null;const ids=record.images.filter(p=>d.elements.some(e=>e.id===p.id&&e.type==='photo')).map(p=>p.id),prompt=writingInstructions(record.prompt);try{const prepared=journalWritingBrief(d,{destination:this.data.aiDestination,selectedId:this._aiOriginSelection,placement:this.data.placement,includeTitle:this.data.aiIncludeTitle,includeCaptions:this.data.aiIncludeCaptions,purpose:record.purpose,prompt,photoIds:ids});this._aiContext=prepared.context;this.setData({prompt,purpose:Math.max(0,this.data.purposes.indexOf(record.purpose)),aiPhotos:this.data.aiPhotos.map(p=>({...p,selected:ids.includes(p.id)})),aiPhotoCount:ids.length,aiHistoryOpen:false,aiBusy:false,aiSuggestion:record.suggestion,aiCaptionPreviews:(record.suggestion.captions||[]).filter(p=>ids.includes(p.id)).map(p=>({...p,label:'照片 '+d.elements.find(e=>e.id===p.id)?.photoNumber})),aiHistoryNotice:'已载入历史建议，当前手帐尚未修改。',error:''});}catch(error){this.setData({error:errorText(error)});}},
  deleteAiHistory(e:Touch){if(!this.data.doc)return;try{deleteWritingRecord('journal',this.data.doc.id,String(e.currentTarget.dataset.id));this.openAiHistory();}catch(error){this.setData({error:errorText(error)});}},
  imageFailed(e:Touch){const id=String(e.currentTarget.dataset.id),photo=this.data.doc?.elements.find(p=>p.id===id);if(photo&&this._failedPhotos?.get(id)!==photo.src){(this._failedPhotos||(this._failedPhotos=new Map())).set(id,photo.src);this.refresh();}},
  retryPhoto(e:Touch){this._failedPhotos?.delete(String(e.currentTarget.dataset.id));this.refresh();},
  confirmSpeech(event:WechatMiniprogram.CustomEvent<{text:string;id:string}>){
    if(!this.data.ai||!this._active||event.detail.id===this.data.speechApplied)return;const prompt=[this.data.prompt.trim(),event.detail.text].filter(Boolean).join('\n');
    if(prompt.length>2000){this.setData({error:'文字要求合计最多2000字，请先缩短输入；转写结果仍保留。'});return;}
    this._aiGeneration++;this._aiJob?.cancel();this._aiJob=null;this.setData({prompt,speechApplied:event.detail.id,aiBusy:false,aiSuggestion:null,error:''});
  },
  async export(){
    this.finishAdjustment();this.endTextEdit();if(!this.data.doc||this.data.busy||this.data.exporting)return;
    const d=copy(this.data.doc);this.setData({exporting:true,error:'',exportPath:''});
    try{
      const canvas=await getCanvas(this,'#journal-export',d.width,d.height);
      await renderJournal(canvas,d);
      const path=await exportCanvas(canvas);if(this.data.doc&&journalFingerprint(this.data.doc)===journalFingerprint(d))this.setData({exportPath:path});else this.setData({error:'已导出开始时的版本；画布已修改，请重新导出当前版本。'});
      wx.previewImage({urls:[path],fail:()=>this.setData({error:'成品图已生成，预览暂未打开；可点击保存到手机相册。'})});
    }catch(error){this.setData({error:errorText(error)});}
    finally {this.setData({exporting:false});}
  },
  saveExport(){if(this.data.exportPath)wx.saveImageToPhotosAlbum({filePath:this.data.exportPath,success:()=>wx.showToast({title:'已保存成品图',icon:'success'}),fail:()=>this.setData({error:'相册保存未完成，成品图仍可预览。'})});},
  toggleOverview(){this.setData({overview:!this.data.overview});this.refresh();},
  back(){if(this.data.busy||this.data.exporting)return;this.finishAdjustment();this.endTextEdit();if(this.data.layersOpen){this.closeLayers();return;}if(this.data.cropOpen){this.cancelCrop();return;}if(this.data.ai){this.closeAi();return;}if(this.data.templateOpen){this.closeTemplates();return;}if(this.data.view==='editor'&&this.data.dirty){void this.persistDraft().then(ok=>{if(ok){this.setData({view:'home',headerTitle:'羽迹'});resetPageScroll(this);}});return;}const setup=this.data.view==='setup';this.setData({view:setup?'picker':'home',headerTitle:setup?'选择素材':'羽迹'});if(setup)this.syncAssets();resetPageScroll(this);},
  resume(){if(this.data.doc){this.setData({view:'editor',headerTitle:'编辑手帐'});resetPageScroll(this);this.refresh();}else if(this.data.resumeRow){this.openDraft({currentTarget:{dataset:{id:this.data.resumeRow.id}}} as unknown as Touch);}},noop(){}
});
