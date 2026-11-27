import {beginSheetDrag,moveSheetDrag,endSheetDrag,resetSheetDrag} from '../../services/sheet-gesture';
import {previewMedia} from '../../services/native-ui';
import {displayedDistance} from '../../services/map-ordering';
import {acceptPickedMedia} from '../../services/media-import';
import {savePublishedPhoto} from '../services/media-save';
import {PostImage,postGallery,checkPostImages} from '../../services/post-media';
import {cleanPhotoDetails,withPhotoDetails,withEmbeddedPhotoDetails,PhotoDetails} from '../../services/photo-details';
import {forumReadStamp,rememberForumPost,patchForumPost,patchForumReaction} from '../../services/forum-state';
import {installAdaptiveSheets,stopAdaptiveSheets} from '../../services/adaptive-sheets';
import {navigate} from '../../services/navigation';
import {api,community,Draft,getDraft,hub,imageUrl,key,openMap,Point,privatePhoto,sessionRevision,sessionState,setCompose,setDraft,takeCompose,uploadPhoto} from '../../services/community';

import {forumPost,forumThreads,ReplyView} from '../../services/forum';
import {readReplyDraft,saveReplyDraft,ReplyDraft} from '../../services/reply-drafts';
import {publicGuidePhoto} from '../../services/public-guide-photos';
import {GuideSummary,guideSummary,readGuideShelf,rememberGuide,bookmarkGuide,guideGroups,externalExplore} from '../../services/guide-shelf';
import {compareBirds} from '../../services/field-guide';
import {chinesePlace} from '../../services/place-names';
import {readMapView} from '../../services/map-view';
import {photoInfo} from '../../services/photo-info';

const names:Record<string,string>={external:'外部社区鸟讯',library:'鸟种资料库',species:'鸟种资料',record:'观察与讨论',publish:'发布观察',
  feed:'鸟友讨论',mine:'我的发布',observations:'私人观察',bookmarks:'我的收藏',inbox:'私聊',chat:'与鸟友私聊',growth:'徽章与成长'};
type Tap=WechatMiniprogram.TouchEvent;
type Input=WechatMiniprogram.CustomEvent<{value:string}>;
function message(error:unknown){return error instanceof Error?error.message:'请求失败，请重试。';}

Page({
  sheetDragStart(event:WechatMiniprogram.TouchEvent){beginSheetDrag(this,event);},sheetDragMove(event:WechatMiniprogram.TouchEvent){moveSheetDrag(this,event);},sheetDragEnd(){endSheetDrag(this);},sheetDragCancel(){resetSheetDrag(this);},
  data:{replyDraftBlocked:false,replyDraftError:'',replyDraftSaved:'',expandedThreads:{} as Record<string,boolean>,guideShelf:'catalogue',guidePage:0,guideQuery:'',guideTotal:0,guideHasMore:false,guideBookmarked:false,guideSavedIds:[] as string[],guideGroups:[] as Array<{family:string;items:GuideSummary[]}>,guideLocalError:'',externalSource:'',externalQuery:'',externalPhotos:false,externalView:'gallery',externalSources:[] as Array<{name:string;count:number}>,externalShown:[] as any[],externalDays:[] as Array<{day:string;items:any[]}>,sheetDragStyle:'',pollOpen:false,pollBusy:false,pollError:'',pollSelection:'',pollSelectionName:'',sheetHeights:{} as Record<string,number>,savingPhoto:false,publishAttachments:[] as PostImage[],recordGallery:[] as any[],reactionBusy:{like:false,bookmark:false},placesError:'',postsError:'',placeSort:'recent',placePoint:null as {latitude:number;longitude:number}|null,mapOpening:false,displayResolution:'',manualCamera:{} as PhotoDetails,manualPhotoInfo:null as ReturnType<typeof photoInfo>,photoInfo:null as ReturnType<typeof photoInfo>,postSpecies:'',postSpeciesName:'',speciesSupported:false,placeLoading:false,replyTarget:null as {id:string;name:string}|null,replyFocused:false,replySuggestOpen:false,replyThreads:[] as Array<{id:string;root:ReplyView;children:ReplyView[]}>,pendingReplies:[] as any[],photoWidth:300,photoFailed:false,photoHeight:200,featured:[] as {id:string;name:string;english:string;image:string;photo:{credit:string;license:string}|null}[],sourceId:'',tab:'identity',placeCount:0,recordCount:0,places:[] as any[],speciesPosts:[] as any[],screen:'',id:'',items:[] as any[],record:null as any,keyword:'',body:'',title:'',error:'',notice:'',busy:false,
    draft:null as Draft|null,anonymous:true,shareDate:false,shareCamera:false,sharePhoto:true,map:false,post:true,identificationHelp:false,
    externalPage:0,externalNext:false,preview:null as any,previewLines:[] as string[],photo:'',replySpecies:'',self:'',selectedSpecies:'',matches:[] as any[]},
  _replyPrevious:null as ReplyDraft|null,_replyOwner:'',_replyRevision:0,_replyTimer:0,_sessionSeen:0,
  _galleryUploads:null as unknown as Map<string,{id:string;camera:Record<string,string>}>,
  _pollGeneration:0,_pollNeedsRefresh:false,
  _placesSequence:0,_mapGeneration:0,_cameraDetails:{} as Record<string,string>,_media:'',_sighting:'',_generation:0,_submitKey:'',_replySignature:'',_path:'',_closed:false,_replyOffset:0,_replyLoading:false,
  onLoad(options:Record<string,string|undefined>){this._sessionSeen=sessionRevision();resetSheetDrag(this);
    installAdaptiveSheets(this,()=>this.data.pollOpen);this.setData({pollOpen:options.poll==='1'});this._galleryUploads=new Map();
    const screen=options.screen&&names[options.screen]?options.screen:'feed';
    this._submitKey=key();
    const placePoint=readMapView();this.setData({screen,id:options.id||'',placePoint,placeSort:'recent'});wx.setNavigationBarTitle({title:names[screen]});
    if(screen==='publish'){
      const draft=options.id==='compose'?null:getDraft();
      this._media=draft?.storedMedia||'';this._path=draft?.path||'';
      const compose=options.id==='compose'?takeCompose():null;
      this.setData({publishAttachments:compose?.attachments||[],manualCamera:cleanPhotoDetails(compose?.attachments?.[0]?.manualCamera||compose?.manualCamera),draft,sourceId:compose?.sourceId||'',title:compose?.title||'',photo:draft?.path||compose?.attachments?.[0]?.path||compose?.photo||'',body:draft?.note||compose?.body||'',sharePhoto:!!(draft?.path||compose?.photo),postSpecies:compose?.speciesId||'',postSpeciesName:compose?.speciesName||'',speciesSupported:compose?.speciesSupported===true});
    }
    if(screen==='library')this.projectGuide();
    void this.load();
  },
  onShow(){if(this._sessionSeen!==sessionRevision()){this._sessionSeen=sessionRevision();this._generation++;this._replyOwner='';this._replyPrevious=null;this._submitKey=key();this._replySignature='';this.setData({record:null,photo:'',recordGallery:[],items:[],self:'',body:'',replySpecies:'',selectedSpecies:'',replyTarget:null,replyThreads:[],pendingReplies:[],replyDraftBlocked:false,replyDraftError:'',replyDraftSaved:'',busy:false});void this.load();}if(this.data.screen==='library')this.projectGuide();if(this._pollNeedsRefresh){this._pollNeedsRefresh=false;void this.load();}},
  onHide(){this.storeReplyDraft();resetSheetDrag(this);this._pollNeedsRefresh=this.data.pollBusy;this._pollGeneration++;this.setData({pollBusy:false,pollOpen:false});this._mapGeneration++;this.setData({mapOpening:false});},
  onUnload(){this.storeReplyDraft();clearTimeout(this._replyTimer);stopAdaptiveSheets(this);this._pollGeneration++;this._mapGeneration++;this._closed=true;this._generation++;},
  copyCredit(event:Tap){void wx.setClipboardData({data:event.currentTarget.dataset.url});},
  onShareAppMessage(){
    const record=this.data.record;
    if(this.data.screen==='record' && record?.id && record.visibility==='public'){
      return {title:String(record.title||record.speciesName||'羽迹 · 鸟友讨论').slice(0,80),path:'/field/hub/index?screen=record&id='+encodeURIComponent(record.id)};
    }
    return {title:'羽迹 · 外部社区鸟讯',path:'/field/hub/index?screen=external'};
  },
  externalPage(event:Tap){const page=this.data.externalPage+Number(event.currentTarget.dataset.direction);
    if(this.data.busy||page<0)return;this.setData({externalPage:page});void this.load();},
  async onPullDownRefresh(){try{await this.load();}finally{wx.stopPullDownRefresh();}},
  async load(){
    const {screen,id}=this.data;const generation=++this._generation,revision=sessionRevision();
    const routes:Record<string,string>={external:community+'/external',feed:community+'/posts',mine:community+'/mine',inbox:community+'/inbox',
      bookmarks:community+'/bookmarks',observations:'/api/v2/observations',library:'/api/v1/species?featured=true&limit=30&offset='+(this.data.guidePage*30)+'&q='+encodeURIComponent(this.data.guideQuery),
      species:'/api/v1/species/'+id,record:id.startsWith('obs_')?'/api/v1/map/observations/'+id:community+'/publications/'+id,
      chat:community+'/messages/'+id,growth:community+'/me'};
    if(!routes[screen])return;
    this._mapGeneration++;this.setData({mapOpening:false,busy:true,error:'',photoFailed:false,displayResolution:''});
    try{
      const readStamp=forumReadStamp();const result=screen==='external'?await api(routes.external,'GET',{limit:40,offset:this.data.externalPage*40}):await api(routes[screen]);if(generation!==this._generation||revision!==sessionRevision())return;
      if(screen==='library')this.setData({guideTotal:result.total??result.items?.length??0,guideHasMore:result.hasMore===true,featured:(result.featured||[]).map((bird:{id:string;photo:object|null})=>({...bird,image:''}))});
      const items=(result.items||result.records||[]).map((row:any)=>({...row,image:imageUrl(row.image),placeName:chinesePlace(row.placeName)}));
      this.setData({items,externalNext:result.hasMore??items.length===40,record:{...result,image:imageUrl(result.image)},photo:imageUrl(result.image)});
      if(screen==='library'){
        this.projectGuide();
        for(const bird of this.data.featured){if(bird.photo)void publicGuidePhoto(bird.id,bird.photo).then(src=>{
          if(!this._closed&&generation===this._generation)this.setData({featured:this.data.featured.map(item=>item.id===bird.id?{...item,image:src}:item)});
        });}
      }
      if(screen==='external')this.projectExternal();
      if(screen==='record'){
        Object.assign(result,rememberForumPost(result,readStamp));this._replyOffset=(result.replies||[]).length;
        const pending=result.features?.threadedReplies?[]:this.data.pendingReplies;
        const replies=(result.replies||[]).concat(pending),record={...result,...forumPost(result),placeName:chinesePlace(result.placeName),place:chinesePlace(result.place),image:imageUrl(result.image),replies,replyCount:result.replyCount??(result.replies||[]).length};
        const recordGallery=postGallery(result).map(image=>({...image,image:imageUrl(image.image)}));
        this.setData({recordGallery,record,photoInfo:photoInfo(Object.keys(result.camera||{}).length?result.camera:record.embeddedCamera,Object.keys(result.camera||{}).length?'照片附带 / 已分享的参数':'从照片文件读取'),manualPhotoInfo:photoInfo(record.manualCamera,'作者填写'),replyThreads:forumThreads(replies)});if(result.gallery?.length)this.setData({photo:recordGallery[0].image,photoInfo:photoInfo(recordGallery[0].camera),manualPhotoInfo:photoInfo(recordGallery[0].manualCamera,'作者填写')});wx.setNavigationBarTitle({title:result.channel==='post'?'帖子详情':'观察详情'});
      }
      if(screen==='species'){
        try{rememberGuide(guideSummary(result));this.setData({guideBookmarked:readGuideShelf().saved.some(b=>b.id===id)});}catch(error){this.setData({guideLocalError:message(error)});}
        await Promise.all([this.loadPlaces(false),api(community+'/posts','GET',{species:id}).then(posts=>{if(generation===this._generation)this.setData({speciesPosts:posts.items,postsError:''});}).catch(error=>{if(generation===this._generation)this.setData({postsError:message(error)});})]);
      }
      if(result.visibility==='private'&&result.media){const path=await privatePhoto(id);if(generation===this._generation)this.setData({photo:path});}
      if((screen==='chat'||screen==='record') && sessionState()!=='out'){const self=await api(community+'/me');if(generation===this._generation&&revision===sessionRevision()){this.setData({self:self.id});this.restoreReplyDraft();}}
    }catch(error){if(generation===this._generation&&revision===sessionRevision())this.setData({error:message(error)});}
    finally{if(generation===this._generation)this.setData({busy:false});}
  },
  async saveRecordImage(){if(this.data.savingPhoto||this.data.record?.visibility!=='public'||!this.data.photo)return;
    const generation=this._generation,photo=this.data.photo;this.setData({savingPhoto:true,error:''});
    try{await savePublishedPhoto(photo);if(!this._closed&&generation===this._generation)wx.showToast({title:'已保存公开图片',icon:'success'});}
    catch(error){if(!this._closed&&generation===this._generation)this.setData({error:message(error)});}finally{if(!this._closed)this.setData({savingPhoto:false});}
  },
  previewGallery(event:Tap){const index=Number(event.currentTarget.dataset.index)||0,urls=this.data.publishAttachments.map(item=>item.path);if(urls[index])previewMedia(urls,urls[index]);},
  selectRecordImage(event:Tap){const image=this.data.recordGallery[Number(event.currentTarget.dataset.index)];if(!image)return;
    this.setData({photo:image.image,photoFailed:false,displayResolution:'',photoInfo:photoInfo(image.camera),manualPhotoInfo:photoInfo(image.manualCamera,'作者填写')});
  },
  photoDetails(event:WechatMiniprogram.CustomEvent<PhotoDetails>){this.setData({manualCamera:cleanPhotoDetails(event.detail),preview:null});},
  photoError(){this.setData({photoFailed:true});},
  photoLoaded(event:WechatMiniprogram.CustomEvent<{width:number;height:number}>){
    const {width,height}=event.detail;if(width>0&&height>0)this.setData({displayResolution:width+' × '+height+' px',photoHeight:Math.max(60,Math.min(420,(Math.min(620,wx.getWindowInfo().windowWidth)-32)*height/width)),photoWidth:Math.min(Math.min(620,wx.getWindowInfo().windowWidth)-32,420*width/height)});
  },
  searchGuide(){this.setData({guidePage:0,guideQuery:this.data.keyword.trim(),guideShelf:'catalogue'});void this.load();},
  guidePage(event:Tap){const page=this.data.guidePage+Number(event.currentTarget.dataset.direction);if(this.data.busy||page<0)return;this.setData({guidePage:page});void this.load();},
  guideShelf(event:Tap){const shelf=String(event.currentTarget.dataset.shelf);if(!['catalogue','saved','recent'].includes(shelf))return;this.setData({guideShelf:shelf});this.projectGuide();},
  projectGuide(){try{const shelf=readGuideShelf(),items=this.data.guideShelf==='saved'?shelf.saved:this.data.guideShelf==='recent'?shelf.recent:this.data.items.map(guideSummary);this.setData({guideGroups:guideGroups(items,this.data.guideShelf==='catalogue'?'':this.data.keyword),guideSavedIds:shelf.saved.map(b=>b.id),guideLocalError:''});}catch(error){this.setData({guideGroups:guideGroups(this.data.items.map(guideSummary)),guideLocalError:message(error)});}},
  bookmarkBird(){if(!this.data.record||this.data.screen!=='species')return;try{const active=bookmarkGuide(guideSummary(this.data.record));this.setData({guideBookmarked:active,guideLocalError:''});}catch(error){this.setData({guideLocalError:message(error)});}},
  projectExternal(){const result=externalExplore(this.data.items,this.data.externalSource,this.data.externalQuery,this.data.externalPhotos);this.setData({externalShown:result.shown,externalSources:result.sources,externalDays:result.days});},
  exploreSource(event:Tap){this.setData({externalSource:String(event.currentTarget.dataset.source||'')});this.projectExternal();},
  exploreInput(event:Input){this.setData({externalQuery:event.detail.value});this.projectExternal();},
  explorePhotos(){this.setData({externalPhotos:!this.data.externalPhotos});this.projectExternal();},
  exploreView(event:Tap){const view=String(event.currentTarget.dataset.view);if(view==='gallery'||view==='timeline')this.setData({externalView:view});},
  forwardPost(){const record=this.data.record;if(record?.visibility==='public')hub('forward',record.id);},
  field(event:Input){const field=String(event.currentTarget.dataset.field);if(['keyword','title','body','replySpecies'].includes(field))this.setData({[field]:event.detail.value,preview:null});if(field==='body'&&this.data.screen==='record')this.replyEdited();if(field==='keyword'&&this.data.screen==='library'&&this.data.guideShelf!=='catalogue')this.projectGuide();},
  flag(event:Tap){if(this.data.busy)return;const field=event.currentTarget.dataset.field as 'post'|'map'|'anonymous'|'shareDate'|'shareCamera'|'sharePhoto'|'identificationHelp';this.setData({[field]:!this.data[field],preview:null});},
  go(event:Tap){hub(event.currentTarget.dataset.screen,event.currentTarget.dataset.id||'');},
  sparrowPair(){compareBirds(['avibase-C22FBF8D','avibase-240E3390']);},
  compareSpecies(){compareBirds(this.data.screen==='species'?[this.data.id]:[]);},
  changeTab(event:Tap){const tab=String(event.currentTarget.dataset.tab);if(['identity','places','posts'].includes(tab))this.setData({tab});},
  sortPlaces(event:Tap){const sort=String(event.currentTarget.dataset.sort);if(!['distance','recent'].includes(sort)||sort==='distance'&&!this.data.placePoint)return;this.setData({placeSort:sort});void this.loadPlaces(false);},
  async loadPlaces(append:boolean){
    if(append&&(this.data.placeLoading||this.data.places.length>=this.data.placeCount))return;
    const id=this.data.id,generation=this._generation,sort=this.data.placeSort,sequence=++this._placesSequence;this.setData({placeLoading:true,placesError:''});
    try{const point=this.data.placePoint,result=await api('/api/v1/species/'+id+'/places','GET',{limit:50,offset:append?this.data.places.length:0,sort,...(point?{latitude:point.latitude,longitude:point.longitude}:{})});
      if(generation!==this._generation||sequence!==this._placesSequence||this._closed)return;
      const incoming=result.items.map((row:any)=>{const km=typeof row.km==='number'&&Number.isFinite(row.km)?row.km:displayedDistance(point,row.displayLocation);return {...row,km,placeName:chinesePlace(row.placeName),distanceLabel:typeof km==='number'?'距地图中心约 '+km.toFixed(1)+' 公里':''};});
      this.setData({places:(append?Array.from(new Map(this.data.places.concat(incoming).map((row:any)=>[row.id,row])).values()):incoming).sort((a:any,b:any)=>sort==='distance'?(a.km??Infinity)-(b.km??Infinity)||(b.latest||'').localeCompare(a.latest||''):(b.latest||'').localeCompare(a.latest||'')||(a.km??Infinity)-(b.km??Infinity)),placeCount:result.placeCount,recordCount:result.recordCount,placeSort:sort,placesError:result.sort!==sort?'服务尚未支持所选排序；当前已载入区域按你的选择整理。':''});
    }catch(error){if(generation===this._generation&&sequence===this._placesSequence)this.setData({placesError:message(error)});}
    finally{if(generation===this._generation&&sequence===this._placesSequence)this.setData({placeLoading:false});}
  },
  morePlaces(){return this.loadPlaces(true);},
  startSpeciesDiscussion(){const row=this.data.record;if(!row)return;setCompose({title:'关于'+(row.name||row.english)+'的讨论',body:'',photo:'',speciesId:this.data.id,speciesName:row.name||row.english,speciesSupported:row.features?.speciesPosts===true});hub('publish','compose');},
  chooseReplySpecies(event:WechatMiniprogram.CustomEvent<{id:string;name:string}>){this.setData({replySpecies:event.detail.id,selectedSpecies:event.detail.name,replySuggestOpen:false});this.replyEdited();},
  clearReplySpecies(){this.setData({replySpecies:'',selectedSpecies:''});this.replyEdited();},
  toggleReplySpecies(){this.setData({replySuggestOpen:!this.data.replySuggestOpen});},
  holdPoll(){},
  openPoll(){const poll=this.data.record?.poll;if(!poll)return;const candidate=poll.candidates.find((item:{id:string})=>item.id===poll.mine);this.setData({pollOpen:true,pollSelection:poll.mine||'',pollSelectionName:candidate?.name||'',pollError:''});},
  closePoll(){this.setData({pollOpen:false});},
  openIdentification(){this.openPoll();},
  selectPollCandidate(event:Tap){const candidate=this.data.record?.poll?.candidates.find((item:{id:string})=>item.id===event.currentTarget.dataset.id);if(candidate)this.setData({pollSelection:candidate.id,pollSelectionName:candidate.name});},
  choosePollSpecies(event:WechatMiniprogram.CustomEvent<{id:string;name:string}>){this.setData({pollSelection:event.detail.id,pollSelectionName:event.detail.name});},
  async submitPollVote(){if(!this.data.pollSelection)return;await this.changePollVote(false);},
  async retractPollVote(){await this.changePollVote(true);},
  async changePollVote(retract:boolean){const poll=this.data.record?.poll;if(!poll||poll.result||this.data.pollBusy||this._closed||retract&&!poll.mine)return;
    const token=++this._pollGeneration,id=this.data.id;this.setData({pollBusy:true,pollError:''});
    try{const result=await api(community+'/publications/'+id+'/identification/vote',retract?'DELETE':'PUT',retract?undefined:{species:this.data.pollSelection});if(this._closed||token!==this._pollGeneration||id!==this.data.id)return;
      patchForumPost(id,{poll:result});const candidate=result.candidates.find((item:{id:string})=>item.id===result.mine);this.setData({record:{...this.data.record,poll:result},pollSelection:result.mine||'',pollSelectionName:candidate?.name||'',notice:retract?'已撤回你的鉴定票。':'已记录你的鉴定票。'});
    }catch(error){if(!this._closed&&token===this._pollGeneration)this.setData({pollError:retract&&([404,405].includes(Number((error as {statusCode?:number}).statusCode))||/撤回或不可见/.test(message(error)))?'线上投票服务尚未更新撤票接口，当前票保留。请维护者更新业务服务。':message(error)});}
    finally{if(!this._closed&&token===this._pollGeneration)this.setData({pollBusy:false});}
  },
  replyTo(event:Tap){const id=String(event.currentTarget.dataset.id),row=this.data.record?.replies?.find((item:any)=>item.id===id);if(!row||row.status==='pending')return;
    if(!this.data.record.features?.threadedReplies){this.setData({notice:'当前服务需更新后才能回复指定楼层，你仍可发表普通回复。'});this.focusReplies();return;}
    this.setData({replyTarget:{id,name:row.publicName||'鸟友'},replyFocused:true});this.replyEdited();wx.pageScrollTo({selector:'#reply-composer',duration:160});},
  restoreReplyDraft(){
    if(this.data.screen!=='record'||!this.data.self||this._replyOwner===this.data.self&&this._replyRevision===sessionRevision())return;
    this._replyOwner=this.data.self;this._replyRevision=sessionRevision();
    try{const draft=readReplyDraft(this.data.self,this.data.id);if(!draft)return;
      if((this.data.body||this.data.replySpecies||this.data.replyTarget)&&this.data.body!==draft.body){this._replyPrevious=draft;this.setData({replyDraftBlocked:true,replyDraftError:'本机还保存着另一份回复草稿。当前文字保留，请选择使用哪一份。'});return;}
      // Keep the target explicit if this service lacks threaded replies; never silently retarget a reply.
      const target=draft.parentId?{id:draft.parentId,name:draft.parentName}:null;
      this._submitKey=draft.reference||key();this._replySignature=JSON.stringify([this.data.id,draft.body.trim(),draft.species,draft.parentId]);
      this.setData({body:draft.body,replySpecies:draft.species,selectedSpecies:draft.speciesName,replyTarget:target,replyDraftSaved:'已恢复本机回复草稿',replyDraftError:''});
    }catch(error){this.setData({replyDraftError:message(error)});}
  },
  chooseReplyDraft(event:Tap){
    const previous=this._replyPrevious;if(!previous)return;
    const restore=event.currentTarget.dataset.choice==='previous';
    wx.showModal({title:restore?'恢复上次的回复草稿？':'使用当前文字替换旧草稿？',content:restore?'将替换当前页面中的回复文字和引用。':'将用当前页面的文字更新这篇帖子的本机回复草稿。',confirmText:restore?'恢复':'替换',success:reply=>{
      if(!reply.confirm||this._replyPrevious!==previous)return;this.setData({replyDraftBlocked:false,replyDraftError:''});this._replyPrevious=null;
      if(restore)this.setData({body:previous.body,replySpecies:previous.species,selectedSpecies:previous.speciesName,replyTarget:previous.parentId?{id:previous.parentId,name:previous.parentName}:null});this.replyEdited();this.storeReplyDraft();
    }});
  },
  replyEdited(){this._submitKey=key();this._replySignature='';clearTimeout(this._replyTimer);this._replyTimer=setTimeout(()=>this.storeReplyDraft(),450);},
  storeReplyDraft(){
    clearTimeout(this._replyTimer);if(this.data.replyDraftBlocked)return;if(!this._replyOwner||this._replyOwner!==this.data.self||this._replyRevision!==sessionRevision()||sessionState()==='out'||this.data.screen!=='record')return;
    try{saveReplyDraft(this.data.self,{post:this.data.id,body:this.data.body,species:this.data.replySpecies,speciesName:this.data.selectedSpecies,parentId:this.data.replyTarget?.id||'',parentName:this.data.replyTarget?.name||'',reference:this._submitKey});this.setData({replyDraftSaved:this.data.body?'未发送文字已保存在本机':'',replyDraftError:''});}
    catch(error){this.setData({replyDraftSaved:'',replyDraftError:message(error)});}
  },
  toggleThread(event:Tap){const id=String(event.currentTarget.dataset.id);if(this.data.replyThreads.some(t=>t.id===id))this.setData({expandedThreads:{...this.data.expandedThreads,[id]:!this.data.expandedThreads[id]}});},
  cancelReply(){this.setData({replyTarget:null,replyFocused:false});this.replyEdited();},
  blurReply(){this.setData({replyFocused:false});},
  async moreReplies(){
    if(this._replyLoading||!this.data.record?.replyHasMore)return;
    const generation=this._generation;this._replyLoading=true;
    try{const result=await api(community+'/publications/'+this.data.id,'GET',{replyOffset:this._replyOffset});
      if(generation!==this._generation||this._closed)return;
      this._replyOffset+=(result.replies||[]).length;
      const replies=Array.from(new Map(this.data.record.replies.concat(result.replies||[]).map((row:any)=>[row.id,row])).values());
      this.setData({record:{...this.data.record,replies,replyHasMore:result.replyHasMore===true&&(result.replies||[]).length>0},replyThreads:forumThreads(replies)});
    }catch(error){if(generation===this._generation&&!this._closed)this.setData({error:message(error)});}finally{this._replyLoading=false;}
  },
  focusReplies(){this.setData({replyFocused:true});wx.pageScrollTo({selector:'#reply-composer',duration:160});},
  speciesMap(event:Tap){const place=this.data.places.find(row=>row.id===event.currentTarget.dataset.id);if(place)openMap(place.displayLocation,this.data.id,this.data.record.name||this.data.record.english,1);},
  async viewMap(){
    if(this.data.mapOpening||this._closed)return;
    const record=this.data.record;if(!record)return;
    const token=++this._mapGeneration;this.setData({mapOpening:true});
    try{
      let point=record.displayLocation,precise=record.visibility==='private';
      if(typeof record.ownedSighting==='string'&&record.ownedSighting.startsWith('obs_')){
        const original=await api('/api/v1/map/observations/'+encodeURIComponent(record.ownedSighting));
        if(token!==this._mapGeneration||this._closed)return;
        if(original.id===record.ownedSighting&&original.visibility==='private'&&original.displayLocation){point=original.displayLocation;precise=true;}
      }
      if(!point){this.setData({notice:'这条观察没有记录拍摄位置。'});return;}
      const label=record.precisionLabel||'约十公里公开区域';
      openMap(point,'','所有鸟种',precise?2:1,{scale:precise?17:/一公里/.test(label)?13:11,precisionLabel:precise?'我的私人拍摄点':label+' · 非精确拍摄点'});
    }catch(error){if(token===this._mapGeneration&&!this._closed)this.setData({error:message(error)});}
    finally{if(token===this._mapGeneration&&!this._closed)this.setData({mapOpening:false});}
  },
  choosePoint(){navigate({url:'/field/picker/index',events:{point:(point:Point)=>{if(this.data.draft){this._sighting='';this.setData({draft:{...this.data.draft,point},preview:null});}}}});},
  async findSpecies(){try{const res=await api('/api/v1/species?q='+encodeURIComponent(this.data.keyword));this.setData({matches:res.items});}catch(error){this.setData({error:message(error)});}},
  pickSpecies(event:Tap){const item=this.data.matches.find(row=>row.id===event.currentTarget.dataset.id);if(!item)return;
    if(this.data.draft){this._sighting='';this.setData({draft:{...this.data.draft,species:item.id,speciesName:item.name||item.english||item.scientific},preview:null});}
    this.setData({replySpecies:item.id,selectedSpecies:item.name||item.english||item.scientific,matches:[]});},
  async attach(){if(this.data.publishAttachments.length){wx.showToast({title:'请返回帖子编辑中调整素材',icon:'none'});return;}try{const result=await wx.chooseImage({count:1,sizeType:['original'],sourceType:['album']});const files=await acceptPickedMedia(result.tempFilePaths.map(path=>({path,kind:'photo' as const})),()=>!this._closed);if(this._closed||!files.length)return;this._media='';this.setData({photo:files[0].path,manualCamera:{},sharePhoto:true,preview:null});}catch{}},
  discussExternal(){
    const record=this.data.record;
    if(!record?.sourceUrl)return;
    setCompose({title:'讨论：'+record.speciesName,body:'',photo:'',sourceId:record.id});
    hub('publish','compose');
  },
  shareExisting(){
    const row=this.data.record;
    if(row?.visibility!=='private')return;
    setDraft({reference:row.reference,path:this.data.photo,storedMedia:row.media,species:row.species,
      speciesName:row.speciesName,analysis:row.analysis,target:row.target,date:row.date||'',time:row.time,
      note:row.note,place:row.place,point:row.point,device:row.camera?.device||''});
    hub('publish');
  },
  async prepare(event:Tap){
    if(this.data.busy)return;this.setData({busy:true,error:'',notice:'',preview:null});
    try{
      const d=this.data,draft=d.draft;
      const images=d.publishAttachments;checkPostImages(images);
      let gallery:object[]|undefined;
      if(!draft&&d.sharePhoto&&(images.length>1||images.some(item=>item.kind==='journal'))){
        let capability;try{capability=await api(community+'/capabilities');}catch{if(images.length>1)throw new Error('服务暂未支持多图发布，素材仍在草稿中；请稍后重试。');}
        if(capability?.postGallery!==1&&images.length>1)throw new Error('服务暂未支持当前图片数量，素材仍保留。');
        if(capability?.postGallery===1){
        if(capability.maxImages<images.length)throw new Error('服务暂未支持当前图片数量，素材仍保留。');
        gallery=[];
        for(const image of images){
          if(!image.path)throw new Error('有照片未保留，请返回重新选择。');
          this._galleryUploads??=new Map();let uploaded=this._galleryUploads.get(image.path);
          if(!uploaded){uploaded=await uploadPhoto(image.path);this._galleryUploads.set(image.path,uploaded);}
          if(this._closed)return;
          gallery.push({media:uploaded.id,kind:image.kind,label:image.label,manual_camera:cleanPhotoDetails(image.manualCamera)});
        }
        this._media=(gallery[0] as {media:string}).media;this._path=d.photo;this._cameraDetails=this._galleryUploads.get(images[0].path)?.camera||{};
        }
      }
      const privateOnly=!!draft&&event.currentTarget.dataset.mode==='private';
      const help=d.identificationHelp&&d.post&&!d.map&&!d.sourceId&&!d.postSpecies&&!draft?.species;
      if(!privateOnly&&!d.post&&!d.map)throw new Error('请选择一个发布渠道。');
      if(!privateOnly&&d.map&&(!draft?.point||!draft.species))throw new Error('地图鸟讯需要选择鸟种和地点。');
      if(!draft&&!d.body.trim())throw new Error('请填写讨论内容。');
      if(d.photo&&(draft||d.sharePhoto)&&(!this._media||this._path!==d.photo)){
        const uploaded=await uploadPhoto(d.photo);this._media=uploaded.id;this._cameraDetails=uploaded.camera;this._path=d.photo;
      }
      if(draft&&!this._sighting){
        const result=await api('/api/v2/observations/by-reference/'+encodeURIComponent(draft.reference),'PUT',{reference:draft.reference,
          species:draft.species,analysis:draft.analysis,target:draft.target,date:draft.date||null,time:draft.time,place:draft.place,
          point:draft.point,note:draft.note,media:this._media||null,camera:{device:draft.device}});
        this._sighting=result.id;
      }
      if(privateOnly){this.setData({screen:'record',id:this._sighting,notice:'已保存到云端私人观察。'});await this.load();return;}
      const preview=await api(community+'/previews','POST',{sighting:this._sighting||null,media:this._media||null,
        ...(help?{identification_help:true}:{}),
        ...(d.postSpecies&&d.speciesSupported?{species:d.postSpecies}:{}),
        ...(gallery?{gallery}:{}),external:d.sourceId||null,title:d.title,body:withPhotoDetails(!draft&&d.shareCamera?withEmbeddedPhotoDetails(d.body,this._cameraDetails):d.body,gallery?{}:d.manualCamera),anonymous:d.anonymous,share_camera:d.shareCamera,share_photo:d.sharePhoto,share_date:d.shareDate,
        channels:[...(d.post?['post']:[]),...(d.map?['map']:[])]});
      if(help&&!preview.display?.post?.identificationHelp)throw new Error('当前服务尚未支持求鉴定帖，请更新业务后端后重试。');
      const previewLines=Object.keys(preview.display).map(channel=>{const row=preview.display[channel];
        return [channel==='map'?'地图鸟讯':row.identificationHelp?'鸟种求鉴定':'讨论帖',row.publicName,row.title,row.body,row.date,row.sourceRecord?'附外部鸟讯来源卡':'',row.media?(gallery?'含'+gallery.length+'张图片':'含照片'):'无照片',
          ...Object.values(row.camera||{}),row.displayLocation?'区域中心 '+row.displayLocation.latitude+', '+row.displayLocation.longitude:'隐藏位置'].filter(Boolean).join(' · ');});
      if(!this._closed)this.setData({preview,previewLines});
    }catch(error){this.setData({error:message(error)});}finally{this.setData({busy:false});}
  },
  async submit(){if(this.data.busy||!this.data.preview)return;this.setData({busy:true,error:''});
    try{await api(community+'/publications','POST',{preview:this.data.preview.id});const screen=this._sighting?'record':'mine';
      this.setData({preview:null,screen,id:this._sighting,notice:'已提交审核，各渠道独立更新。'});
      wx.setNavigationBarTitle({title:names[screen]});await this.load();}
    catch(error){this.setData({error:message(error)});}finally{this.setData({busy:false});}},
  async react(event:Tap){
    const op=event.currentTarget.dataset.op as 'like'|'bookmark',id=this.data.id,generation=this._generation;
    if(!['like','bookmark'].includes(op)||this.data.reactionBusy[op]||this._closed||!this.data.record)return;
    this.setData({reactionBusy:{...this.data.reactionBusy,[op]:true},error:''});
    try{const active=this.data.record.reactions?.includes(op),base=community+'/publications/'+id;
      const result=await api(base+(active?'/reactions/':'/')+op,active?'DELETE':'PUT');
      if(this._closed||generation!==this._generation||this.data.id!==id)return;
      const record=this.data.record,reactions=(record.reactions||[]).filter((item:string)=>item!==op);if(result.active)reactions.push(op);
      patchForumReaction(id,op,!!result.active,result.likes??record.likes);this.setData({record:{...record,reactions,...(op==='like'?{liked:!!result.active,likes:result.likes??record.likes,hasLikes:typeof result.likes==='number'||record.hasLikes}:{bookmarked:!!result.active})}});
    }catch(error){if(!this._closed&&generation===this._generation)this.setData({error:message(error)});}
    finally{if(!this._closed)this.setData({reactionBusy:{...this.data.reactionBusy,[op]:false}});}
  },
  async action(event:Tap){
    if(['like','bookmark'].includes(event.currentTarget.dataset.op)){await this.react(event);return;}
    if(this.data.busy||this._closed)return;const revision=sessionRevision(),current=()=>!this._closed&&revision===sessionRevision();const {op,id}=event.currentTarget.dataset;this.setData({busy:true,error:'',notice:''});
    try{
      if(op==='withdraw'){if(!(await wx.showModal({title:'撤回发布？',content:'此渠道的内容和照片将从公开页面移除。'})).confirm)return;
        await api(community+'/publications/'+id,'DELETE');}
      if(op==='vote'||op==='resolve'){
        const candidate=this.data.record.poll.candidates.find((bird:{id:string})=>bird.id===id);
        if(!candidate)return;
        if(op==='resolve'&&!(await wx.showModal({title:'采纳'+candidate.name+'？',content:'采纳后结束投票，所有鸟友都能在帖子里看到结果。',confirmText:'采纳'})).confirm)return;
        await api(community+'/publications/'+this.data.id+'/identification/'+op,'PUT',{species:id});
        this.setData({notice:op==='vote'?'已记录你的鉴定票。':'已采纳'+candidate.name+'。'});
      }
      if(op==='reply'||op==='send'){
        const draftBody=this.data.body,text=draftBody.trim(),parent=this.data.replyTarget,species=this.data.replySpecies;
        if(this.data.replyDraftBlocked)throw new Error('请先选择使用当前文字或上次草稿。');if(!text)throw new Error('请输入内容。');if(parent&&!this.data.record?.features?.threadedReplies)throw new Error('当前服务不支持引用楼层，请取消引用后发送普通回复。');
        const signature=JSON.stringify([this.data.id,text,this.data.replySpecies,parent?.id||'']);
        if(this._replySignature&&this._replySignature!==signature)this._submitKey=key();this._replySignature=signature;
        if(op==='reply')this.storeReplyDraft();
        const result=await api(op==='reply'?community+'/publications/'+this.data.id+'/replies':community+'/messages/'+this.data.id,'POST',
          {body:text,reference:this._submitKey,...(op==='reply'?{species:species||null,...(parent?{parentId:parent.id}:{})}:{})});
        if(!current())return;
        if(op==='reply'&&result.id)this.setData({pendingReplies:this.data.pendingReplies.concat({id:result.id,body:text,publicName:'我',memberId:this.data.self,species:species||'',parentId:parent?.id||'',replyToName:parent?.name||'',status:'pending',created:new Date().toISOString()})});
        this._submitKey=key();this._replySignature='';
        const unchanged=this.data.body===draftBody&&this.data.replySpecies===species&&this.data.replyTarget?.id===parent?.id;
        this.setData({...(unchanged?{body:'',replyTarget:null,replyFocused:false,replySuggestOpen:false,replySpecies:'',selectedSpecies:''}:{}),notice:op==='reply'?'回复已提交，审核通过后公开显示。':'已发送。'});if(op==='reply')this.storeReplyDraft();if(unchanged)wx.hideKeyboard?.({fail:()=>{}});
      }
      if(op==='adopt'){await api('/api/v2/observations/'+this.data.record.ownedSighting+'/adopt','POST',{reply:id});this.setData({notice:'已更新私人观察的鸟种。'});}
      if(op==='unbookmark'){await api(community+'/publications/'+id+'/reactions/bookmark','DELETE');}
      if(op==='block'||op==='unblock'){await api(community+'/blocks/'+this.data.id,op==='block'?'PUT':'DELETE');this.setData({notice:op==='block'?'已屏蔽':'已取消屏蔽'});}
      if(op==='report'){const res=await wx.showModal({title:'举报内容',editable:true,placeholderText:'请填写举报原因'});if(!res.confirm||!res.content)return;
        await api(community+'/reports/'+id,'POST',{reason:res.content});this.setData({notice:'举报已受理'});}
      if(op==='source'&&this.data.record?.sourceUrl)await wx.setClipboardData({data:this.data.record.sourceUrl});
      if(current())await this.load();
    }catch(error){if(current())this.setData({error:message(error)});}finally{if(current())this.setData({busy:false});}
  }
});
