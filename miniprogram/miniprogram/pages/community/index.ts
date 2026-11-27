import {previewMedia} from '../../services/native-ui';
import {takePostDraft} from '../../services/draft-navigation';
import {installAdaptiveSheets,fitAdaptiveSheets,stopAdaptiveSheets} from '../../services/adaptive-sheets';
import {acceptPickedMedia} from '../../services/media-import';
import {readLocalPhotoMetadata,LocalPhotoMetadata} from '../../services/photo-metadata';
import {PostImage,postImage,postGallery,checkPostImages,POST_IMAGE_LIMIT,POST_JOURNAL_LIMIT} from '../../services/post-media';
import {readPostDraft,readPostDrafts,savePostDraft,cachePostDraft,deletePostDraft,newPostDraft,PostDraft} from '../../services/post-draft';
import {readWritingHistory,rememberWriting,markWritingApplied,deleteWritingRecord,writingInstructions} from '../../services/writing-history';
import {journalDateTime} from '../../services/journal-library';
import {readJournals,JournalDocument} from '../../services/journal-model';
import {getCanvas,exportCanvas} from '../../services/canvas';
import {renderJournal} from '../../services/journal-render';
import {api,community,hub,imageUrl,setCompose,takeForumTab} from '../../services/community';
import {cleanPhotoDetails,PhotoDetails} from '../../services/photo-details';
import {layout} from '../../services/layout';
import {forumReadStamp,rememberForumPost,knownForumPost,patchForumPost,patchForumReaction,needsForumDetails} from '../../services/forum-state';
import {sessionRevision} from '../../services/community';
import {forumPost} from '../../services/forum';
import { selectTab,syncNavigation } from '../../services/tabs';
import { errorText } from '../../services/media';
import { navigate,resetPageScroll } from '../../services/navigation';
import { postWritingBrief, POST_WRITING_PURPOSES } from '../../services/post-writing';
import {startJournalAi,journalAiAvailable,JournalAiSuggestion} from '../../services/journal-ai';
import {teamWritingTransport} from '../../services/writing-network';
type FeedCache=Map<string,{posts:any[];more:boolean;total:number;top:number}>;
const feedCaches=new WeakMap<object,FeedCache>();
function feedCache(page:object){let cache=feedCaches.get(page);if(!cache){cache=new Map();feedCaches.set(page,cache);}return cache;}
const reactionSets=new WeakMap<object,Set<string>>();
function reactions(page:object){let active=reactionSets.get(page);if(!active){active=new Set();reactionSets.set(page,active);}return active;}
Page({
  data:{draftIndex:0,draftDeckHeight:420,draftCompact:false,draftTiny:false,feedTab:'all',feedTabIndex:0,feedScrollTop:0,feedTabs:[{id:'all',name:'最新讨论'},{id:'mine',name:'我的发布'},{id:'bookmarks',name:'我的收藏'}],sheetHeights:{} as Record<string,number>,draftId:'',draftStatus:'',draftRows:[] as Array<{id:string;title:string;excerpt:string;date:string;created:string;modified:string;count:number;missing:number;cover:string}>,draftCount:0,latestDraftId:'',latestDraftTitle:'',writingPhotoIds:[] as string[],writingPhotos:[] as Array<{id:string;path:string;label:string;selected:boolean}>,writingPhotoCount:0,writingHistoryOpen:false,writingHistory:[] as ReturnType<typeof readWritingHistory>,writingHistoryNotice:'',writingVoice:false,writingSpeechApplied:'',activeMetadata:null as LocalPhotoMetadata|null,attachments:[] as PostImage[],activeAttachment:'',activeKind:'photo',journalPicker:false,journalChoices:[] as Array<{id:string;title:string;cover:string;selected:boolean}>,journalChosen:0,mediaLimit:POST_IMAGE_LIMIT,journalLimit:POST_JOURNAL_LIMIT,picking:false,feedHeight:600,refreshing:false,pullReady:false,pullProgress:0,manualCamera:{} as PhotoDetails,moreOpen:false,moreItems:[{id:'library',label:'鸟种资料库',icon:'journal',hint:'查阅与对比'},{id:'external',label:'外部鸟讯',icon:'pin',hint:'发现公开观察'},{id:'friends',label:'找鸟友',icon:'user',hint:'认识同行的人'},{id:'inbox',label:'消息',icon:'chat',hint:'继续一段对话'},{id:'groups',label:'群聊',icon:'leaf',hint:'一起聊聊观鸟'},{id:'draft',label:'本机草稿箱',icon:'image',hint:'查看、编辑与删除'}],feedTotal:0,writingBusy:false,writingSuggestion:null as JournalAiSuggestion|null,remotePosts:[] as any[],feedLoading:false,more:false,view:'feed',title:'',body:'',image:'',error:'',busy:false,writingOpen:false,writingPurposes:POST_WRITING_PURPOSES,writingPurpose:1,writingInstructions:'',writingIncludeImage:false,writingSummary:'',writingError:''},

  _composeGeneration:0,
  _restoringDraft:false,_draftCreatedAt:'',_draftDirty:false,_draftRevision:0,_draftTimer:0 as unknown as ReturnType<typeof setTimeout>,_draftSave:null as Promise<boolean>|null,
  _failedThumbnails:null as Set<string>|null,
  _journalDocuments:[] as JournalDocument[],
  _writingJob:null as ReturnType<typeof startJournalAi>|null,
  _writingContext:'',
  writingContext(){const d=this.data;return JSON.stringify([d.draftId,d.title,d.body,d.attachments.map(p=>[p.id,p.path]),d.writingPurpose,d.writingInstructions,d.writingPhotoIds,d.writingIncludeImage,d.image]);},
  _refreshSeq:0,_feedSeq:0,_visible:true,
  onLoad(){feedCaches.set(this,new Map());installAdaptiveSheets(this,()=>this.data.moreOpen||this.data.writingOpen||this.data.writingHistoryOpen||this.data.journalPicker);this._failedThumbnails=new Set();reactionSets.set(this,new Set());this.resizeFeed();this.refreshDrafts();},
  resizeFeed(){const height=layout(this.data.view!=='feed').height;this.setData({feedHeight:height,draftDeckHeight:Math.max(66,height-(height<340?80:138)),draftCompact:height<520,draftTiny:height<340});},onResize(){this.resizeFeed();fitAdaptiveSheets(this);},
  photoDetails(event:WechatMiniprogram.CustomEvent<PhotoDetails>){const manualCamera=cleanPhotoDetails(event.detail);this.setData({manualCamera,attachments:this.data.attachments.map(item=>item.id===this.data.activeAttachment?{...item,manualCamera}:item)});this.draftChanged();},
  pulling(event:WechatMiniprogram.CustomEvent<{dy:number}>){const dy=Number(event.detail.dy)||0;this.setData({pullReady:dy>=64,pullProgress:Math.min(1,dy/64)});},
  pullReset(){this.setData({pullReady:false,pullProgress:0});},
  async pullRefresh(){if(this.data.refreshing)return;const token=++this._refreshSeq;this.setData({refreshing:true});try{await this.loadFeed(false,true);}finally{if(token===this._refreshSeq)this.setData({refreshing:false,pullReady:false,pullProgress:0});}},
  onHide(){this.cacheCurrentDraft();void this.persistPostDraft(true);this._refreshSeq++;this._visible=false;this._feedSeq++;this.setData({feedLoading:false,refreshing:false,pullReady:false,pullProgress:0,moreOpen:false});this.closeWriting();},onUnload(){stopAdaptiveSheets(this);this.cacheCurrentDraft();clearTimeout(this._draftTimer);void this.persistPostDraft(true);this._composeGeneration++;this._refreshSeq++;this._visible=false;this._feedSeq++;this.closeWriting();reactionSets.delete(this);feedCaches.delete(this);},
  _writingBrief:null as ReturnType<typeof postWritingBrief>|null,
  onShow(){this._visible=true;const target=takeForumTab(),queuedDraft=takePostDraft();if(target){this.setData({view:'feed'});this.switchFeed({currentTarget:{dataset:{tab:target}}} as unknown as WechatMiniprogram.TouchEvent);}else if(queuedDraft)this.loadDraft(queuedDraft);this.refreshDrafts();this.resizeFeed();selectTab(this,3);if(this.data.view==='feed')void this.loadFeed();},
  async onPullDownRefresh(){try{if(this.data.view==='feed')await this.loadFeed(false,true);}finally{wx.stopPullDownRefresh?.();}},
  onReachBottom(){if(this.data.view==='feed'&&this.data.more)void this.loadFeed(true);},
  async loadFeed(append=false,force=false){
    if(this.data.feedLoading&&!force)return;
    if(force)this._failedThumbnails?.clear();const token=++this._feedSeq,previous=append?this.data.remotePosts:[];this.setData({feedLoading:true,error:''});
    const source=this.data.feedTab,stamp=forumReadStamp(),session=sessionRevision();try{const result=await api(community+(source==='mine'?'/mine':source==='bookmarks'?'/bookmarks':'/posts'),'GET',{limit:30,offset:previous.length,...(source==='all'?{}:{channel:'post'})});
      if(token!==this._feedSeq||!this._visible)return;
      const visible=(post:any)=>({...forumPost(rememberForumPost(post,stamp)),image:imageUrl(post.image),gallery:postGallery(post).map(item=>{const url=imageUrl(item.image);return {...item,image:this._failedThumbnails?.has(post.id+'|'+url)?'':url};})});
      const raw=result.items.filter((row:any)=>source==='all'||row.channel==='post').map((row:any)=>source==='bookmarks'&&!Array.isArray(row.reactions)?{...row,bookmarked:true}:row);
      const unique=new Map(previous.map((row:any)=>[row.id,row]));for(const row of raw)unique.set(row.id,visible(row));
      this.setData({remotePosts:Array.from(unique.values()),feedTotal:result.total??unique.size,more:result.hasMore??(source==='all'&&result.items.length===30)});
      // Old hosted mine/bookmark endpoints omit interactions. Hydrate with bounded concurrency.
      const pending=source==='all'?[]:raw.filter(needsForumDetails);
      let index=0;const worker=async()=>{while(index<pending.length){const row=pending[index++];try{const detail=await api(community+'/publications/'+encodeURIComponent(row.id));if(session!==sessionRevision())return;const hydrated=visible({...row,...detail});if(token!==this._feedSeq||!this._visible)return;this.setData({remotePosts:this.data.remotePosts.map((item:any)=>item.id===row.id?hydrated:item)});}catch{/* Keep readable list content; unknown counts are not fabricated. */}}};
      await Promise.all(Array.from({length:Math.min(3,pending.length)},worker));
    }catch(error){if(token===this._feedSeq&&this._visible)this.setData({error:errorText(error)});}finally{if(token===this._feedSeq&&this._visible)this.setData({feedLoading:false});}
  },
  feedScroll(event:WechatMiniprogram.CustomEvent<{scrollTop:number}>){this.data.feedScrollTop=event.detail.scrollTop;},
  switchFeed(event:WechatMiniprogram.TouchEvent){const tab=String(event.currentTarget.dataset.tab),index=this.data.feedTabs.findIndex(item=>item.id===tab);if(index<0||tab===this.data.feedTab)return;
    feedCache(this).set(this.data.feedTab,{posts:this.data.remotePosts,more:this.data.more,total:this.data.feedTotal,top:this.data.feedScrollTop});const cached=feedCache(this).get(tab);this._feedSeq++;this.closeMore();
    this.setData({feedTab:tab,feedTabIndex:index,remotePosts:cached?.posts.map(row=>({...row,...forumPost(knownForumPost(row))}))||[],feedTotal:cached?.total||0,more:cached?.more||false,feedScrollTop:cached?.top||0,feedLoading:false,error:''});void this.loadFeed(false,true);
  },
  openPostPoll(event:WechatMiniprogram.TouchEvent){const id=String(event.currentTarget.dataset.id);navigate({url:'/field/hub/index?screen=record&poll=1&id='+encodeURIComponent(id)});},
  refreshFeed(){void this.loadFeed(false,true);},nextPage(){void this.loadFeed(true);},
  patchPost(id:string,patch:Record<string,unknown>){
    patchForumPost(id,patch);const project=(row:any)=>row.id===id?{...row,...forumPost(knownForumPost({...row,...patch})),...patch}:row;
    for(const cache of feedCache(this).values())cache.posts=cache.posts.map(project);
    if(this._visible)this.setData({remotePosts:this.data.remotePosts.map(project)});
  },
  async react(event:WechatMiniprogram.TouchEvent){
    const id=String(event.currentTarget.dataset.id),kind=String(event.currentTarget.dataset.kind),post=this.data.remotePosts.find((row:any)=>row.id===id);
    const activeReactions=reactions(this);
    if(!post||!['like','bookmark'].includes(kind)||activeReactions.has(id+':'+kind))return;
    const lock=id+':'+kind,pending=kind==='like'?'likePending':'bookmarkPending';activeReactions.add(lock);this.patchPost(id,{[pending]:true});
    const active=kind==='like'?post.liked:post.favorited,revision=sessionRevision();
    try{const base=community+'/publications/'+id;const result=await api(base+(active?'/reactions/':'/')+kind,active?'DELETE':'PUT');
      if(revision!==sessionRevision())return;
      const knownLikes=Number.isInteger(result.likes)?result.likes:post.hasLikes?post.likes+(result.active?1:-1):undefined,patch=patchForumReaction(id,kind,!!result.active,knownLikes);
      this.patchPost(id,{...patch,...(kind==='like'?{liked:!!result.active,hasLikes:post.hasLikes||Number.isInteger(result.likes)}:{favorited:!!result.active})});
      if(this._visible)this.setData({error:''});
    }catch(error){if(this._visible)this.setData({error:errorText(error)});}finally{activeReactions.delete(lock);this.patchPost(id,{[pending]:false});}
  },
  moreSections(){this.setData({moreOpen:!this.data.moreOpen});syncNavigation(this);},
  closeMore(){this.setData({moreOpen:false});syncNavigation(this);},
  holdMenu(){},
  holdSheet(){},
  moreSection(event:WechatMiniprogram.TouchEvent){const id=String(event.currentTarget.dataset.id);if(!this.data.moreItems.some(item=>item.id===id))return;this.closeMore();if(id==='draft')void this.openDrafts();else hub(id);},
  section(event:WechatMiniprogram.TouchEvent){hub(event.currentTarget.dataset.screen,event.currentTarget.dataset.id||'');},
  ensureDraft(){if(!this.data.draftId){const draft=newPostDraft();this._draftCreatedAt=draft.createdAt||'';this.setData({draftId:draft.id!});}return this.data.draftId;},
  draftInput():PostDraft {return {version:2,id:this.ensureDraft(),...(this._draftCreatedAt?{createdAt:this._draftCreatedAt}:{}),title:this.data.title,body:this.data.body,images:this.data.attachments,activeAttachment:this.data.activeAttachment,writing:{purpose:this.data.writingPurpose,instructions:this.data.writingInstructions,includeImage:this.data.writingIncludeImage,imageIds:[...this.data.writingPhotoIds]}};},
  cacheCurrentDraft(){clearTimeout(this._draftTimer);if(!this._draftDirty||this.data.view!=='compose')return;try{cachePostDraft(this.draftInput());}catch{this.setData({draftStatus:'本机恢复记录未保存',error:'本机空间不足，当前编辑仍保留，请先处理可用空间。'});}},
  draftChanged(){if(this.data.view!=='compose'||this._restoringDraft)return;this._draftDirty=true;this._draftRevision++;this.cacheCurrentDraft();if(this.data.draftStatus!=='更改待保存')this.setData({draftStatus:'更改待保存'});this._draftTimer=setTimeout(()=>{void this.persistPostDraft(true);},900);},
  refreshDrafts(){try{const rows=readPostDrafts().map(d=>({id:d.id!,title:d.title||'未命名帖子',excerpt:d.body.slice(0,100),date:journalDateTime(d.updatedAt),created:journalDateTime(d.createdAt),modified:journalDateTime(d.updatedAt),count:d.images.length,missing:d.missingMedia||0,cover:d.images.find(p=>p.path)?.path||''}));this.setData({draftRows:rows,draftIndex:Math.min(this.data.draftIndex,Math.max(0,rows.length-1)),draftCount:rows.length,latestDraftId:rows[0]?.id||'',latestDraftTitle:rows[0]?.title||''});}catch(error){this.setData({error:errorText(error)});}},
  async compose(){if(this._draftDirty&&!await this.persistPostDraft(true))return;clearTimeout(this._draftTimer);this._composeGeneration++;this.clearWritingBrief();const d=newPostDraft();this._draftCreatedAt=d.createdAt||'';this._draftDirty=false;this.setData({view:'compose',draftId:d.id!,draftStatus:'尚未保存',title:'',body:'',attachments:[],activeAttachment:'',activeMetadata:null,image:'',manualCamera:{},writingInstructions:'',writingPurpose:1,writingPhotoIds:[],writingPhotos:[],writingPhotoCount:0,writingIncludeImage:false,error:'',moreOpen:false});this.resizeFeed();resetPageScroll(this);},
  async openDrafts(){if(this._draftDirty&&!await this.persistPostDraft(true))return;clearTimeout(this._draftTimer);this.closeWriting();this.refreshDrafts();this.setData({view:'drafts',moreOpen:false,error:''});this.resizeFeed();resetPageScroll(this);},
  draftDeckChange(event:WechatMiniprogram.CustomEvent<{current:number}>){const index=event.detail.current;if(Number.isInteger(index)&&index>=0&&index<this.data.draftRows.length)this.setData({draftIndex:index});},
  draftStep(event:WechatMiniprogram.TouchEvent){const index=this.data.draftIndex+Number(event.currentTarget.dataset.delta);if(index>=0&&index<this.data.draftRows.length)this.setData({draftIndex:index});},
  editDraft(e:WechatMiniprogram.TouchEvent){this.loadDraft(String(e.currentTarget.dataset.id));},
  resumeDraft(){if(this.data.latestDraftId)this.loadDraft(this.data.latestDraftId);},
  async removeDraft(e:WechatMiniprogram.TouchEvent){const id=String(e.currentTarget.dataset.id);if(!id)return;wx.showModal({title:'删除这份草稿？',content:'只删除本机草稿，设备相册里的原照片会保留。',success:async reply=>{if(!reply.confirm)return;try{await deletePostDraft(id);if(this.data.draftId===id){clearTimeout(this._draftTimer);this._draftDirty=false;this.setData({draftId:'',title:'',body:'',attachments:[],image:'',writingPhotoIds:[],writingIncludeImage:false});}this.refreshDrafts();}catch(error){this.setData({error:errorText(error)});}}});},
  clearWritingBrief(){this._writingJob?.cancel();this._writingJob=null;this._writingContext='';this._writingBrief=null;this.setData({writingBusy:false,writingSuggestion:null,writingSummary:'',writingError:''});},
  change(e:WechatMiniprogram.CustomEvent<{value:string}>){const key=String(e.currentTarget.dataset.key);if(['title','body'].includes(key)){this.setData({[key]:e.detail.value});this.clearWritingBrief();this.draftChanged();}},
  setImages(attachments:PostImage[],active?:string){
    active=active||this.data.activeAttachment;
    checkPostImages(attachments);const selected=attachments.find(item=>item.id===active)||attachments[0];
    const writingPhotoIds=this.data.writingPhotoIds.filter(id=>attachments.some(p=>p.id===id));this.setData({attachments,activeAttachment:selected?.id||'',activeKind:selected?.kind||'photo',activeMetadata:selected?.fileMetadata||null,image:selected?.path||'',manualCamera:selected?.manualCamera||{},writingPhotoIds,writingIncludeImage:writingPhotoIds.length>0});this.clearWritingBrief();this.projectWritingPhotos();this.draftChanged();
  },
  readImageMetadata(images:PostImage[]){const generation=this._composeGeneration;
    for(const image of images.filter(item=>item.kind==='photo'&&item.path&&!item.fileMetadata))void readLocalPhotoMetadata(image.path).then(fileMetadata=>{
      if(generation!==this._composeGeneration||!this.data.attachments.some(item=>item.id===image.id))return;
      this.setData({attachments:this.data.attachments.map(item=>item.id===image.id?{...item,fileMetadata}:item),...(this.data.activeAttachment===image.id?{activeMetadata:fileMetadata}:{})});
    }).catch(()=>{if(generation===this._composeGeneration)this.setData({error:'照片参数暂未读取，照片和草稿仍保留。'});});
  },
  attach(){
    if(this.data.busy||this.data.picking)return;const remaining=POST_IMAGE_LIMIT-this.data.attachments.length;
    if(remaining<=0){this.setData({error:'最多添加9张照片或手帐成品。'});return;}
    const generation=this._composeGeneration;this.setData({picking:true,error:''});
    wx.chooseImage({count:remaining,sourceType:['album'],sizeType:['original'],success:async r=>{
      try{const files=await acceptPickedMedia(r.tempFilePaths.slice(0,remaining).map(path=>({path,kind:'photo' as const})),()=>generation===this._composeGeneration);
        if(generation!==this._composeGeneration||!files.length)return;
        const images=files.map((file,i)=>postImage(file.path,'photo','照片 '+(this.data.attachments.length+i+1)));
        this.setImages([...this.data.attachments,...images],images[0]?.id);this.readImageMetadata(images);
      }catch{if(generation===this._composeGeneration)this.setData({error:'照片验证未完成，已有素材仍保留。'});}
      finally{if(generation===this._composeGeneration)this.setData({picking:false});}
    },fail:error=>{if(generation===this._composeGeneration){this.setData({picking:false});if(!/cancel/i.test(error.errMsg))this.setData({error:'照片选择未完成，已有素材仍保留。'});}}});
  },
  previewAttachment(event:WechatMiniprogram.TouchEvent){const id=String(event.currentTarget.dataset.id),item=this.data.attachments.find(image=>image.id===id);if(!item?.path)return;
    this.setData({activeAttachment:id,activeKind:item.kind,image:item.path,manualCamera:item.manualCamera,activeMetadata:item.fileMetadata||null});this.clearWritingBrief();this.draftChanged();previewMedia(this.data.attachments.map(image=>image.path).filter(Boolean),item.path);
  },
  attachmentDetails(event:WechatMiniprogram.TouchEvent){const item=this.data.attachments.find(image=>image.id===String(event.currentTarget.dataset.id));if(item){this.setData({activeAttachment:item.id,activeKind:item.kind,image:item.path,manualCamera:item.manualCamera,activeMetadata:item.fileMetadata||null});this.clearWritingBrief();this.draftChanged();}},
  removeAttachment(event:WechatMiniprogram.TouchEvent){if(this.data.busy)return;this.setImages(this.data.attachments.filter(item=>item.id!==String(event.currentTarget.dataset.id)));},
  previewPost(event:WechatMiniprogram.TouchEvent){const post=this.data.remotePosts.find((item:any)=>item.id===String(event.currentTarget.dataset.id));const urls=post?.gallery?.map((item:any)=>item.image).filter(Boolean)||[];const current=urls[Number(event.currentTarget.dataset.index)||0];if(current)previewMedia(urls,current);},
  chooseJournals(){if(this.data.busy||this.data.picking)return;try{this._journalDocuments=readJournals();const attached=new Set(this.data.attachments.filter(item=>item.kind==='journal').map(item=>item.journalId));
    this.setData({journalPicker:true,journalChosen:0,journalChoices:this._journalDocuments.filter(item=>!attached.has(item.id)).map(item=>({id:item.id,title:item.title,cover:item.elements.find(e=>e.type==='photo')?.src||'',selected:false})),error:''});
  }catch(error){this.setData({error:errorText(error)});}},
  closeJournals(){if(!this.data.busy)this.setData({journalPicker:false});},
  toggleJournal(event:WechatMiniprogram.TouchEvent){if(this.data.busy)return;const id=String(event.currentTarget.dataset.id),item=this.data.journalChoices.find(row=>row.id===id);if(!item)return;
    const remaining=Math.min(POST_JOURNAL_LIMIT-this.data.attachments.filter(row=>row.kind==='journal').length,POST_IMAGE_LIMIT-this.data.attachments.length);
    if(!item.selected&&this.data.journalChosen>=remaining){this.setData({error:'最多3份手帐，照片与手帐合计不超过9张。'});return;}
    const journalChoices=this.data.journalChoices.map(row=>row.id===id?{...row,selected:!row.selected}:row);this.setData({journalChoices,journalChosen:journalChoices.filter(row=>row.selected).length});
  },
  async addJournals(){if(this.data.busy||!this.data.journalChosen)return;const generation=this._composeGeneration;this.setData({busy:true,error:''});
    try{for(const choice of this.data.journalChoices.filter(item=>item.selected)){
      const document=this._journalDocuments.find(item=>item.id===choice.id);if(!document)continue;
      const canvas=await getCanvas(this,'#post-journal-export',document.width,document.height);await renderJournal(canvas,document);const path=await exportCanvas(canvas);
      if(generation!==this._composeGeneration)return;this.setImages([...this.data.attachments,postImage(path,'journal',document.title,document.id)]);this.setData({journalChoices:this.data.journalChoices.map(item=>item.id===choice.id?{...item,selected:false}:item),journalChosen:Math.max(0,this.data.journalChosen-1)});
    }this.setData({journalPicker:false,journalChosen:0});
    }catch(error){if(generation===this._composeGeneration)this.setData({error:errorText(error)});}finally{if(generation===this._composeGeneration)this.setData({busy:false});}
  },
  openWriting(){if(this.data.view!=='compose'||this.data.busy)return;this.ensureDraft();this.clearWritingBrief();this.projectWritingPhotos();this.setData({writingOpen:true,writingHistoryNotice:''});},
  closeWriting(){this.selectComponent?.('#post-speech')?.stopWork?.();this.clearWritingBrief();this.setData({writingOpen:false,writingHistoryOpen:false});},
  toggleWritingVoice(){this.setData({writingVoice:!this.data.writingVoice});},
  confirmWritingSpeech(event:WechatMiniprogram.CustomEvent<{text:string;id:string}>){
    if(!this.data.writingOpen||!this._visible||event.detail.id===this.data.writingSpeechApplied)return;const writingInstructions=[this.data.writingInstructions.trim(),event.detail.text].filter(Boolean).join('\n');
    if(writingInstructions.length>1200){this.setData({writingError:'写作要求合计最多1200字，请先缩短输入；转写结果仍保留。'});return;}
    this.clearWritingBrief();this.setData({writingInstructions,writingSpeechApplied:event.detail.id});this.draftChanged();
  },
  writingPurpose(e:WechatMiniprogram.CustomEvent<{value:string}>){const purpose=Number(e.detail.value);if(Number.isInteger(purpose)&&purpose>=0&&purpose<POST_WRITING_PURPOSES.length){this.setData({writingPurpose:purpose});this.clearWritingBrief();this.draftChanged();}},
  writingInstructions(e:WechatMiniprogram.CustomEvent<{value:string}>){this.setData({writingInstructions:e.detail.value});this.clearWritingBrief();this.draftChanged();},
  projectWritingPhotos(){const pictures=this.data.attachments.length?this.data.attachments.filter(p=>p.path):this.data.image?[{id:'post-photo',path:this.data.image,label:'当前照片'}]:[];this.setData({writingPhotos:pictures.map(p=>({id:p.id,path:p.path,label:p.label,selected:this.data.writingPhotoIds.includes(p.id)||(p.id==='post-photo'&&this.data.writingIncludeImage)})),writingPhotoCount:pictures.filter(p=>this.data.writingPhotoIds.includes(p.id)||(p.id==='post-photo'&&this.data.writingIncludeImage)).length});},
  writingImage(e?:WechatMiniprogram.TouchEvent){const id=String(e?.currentTarget?.dataset?.id||this.data.activeAttachment||'post-photo'),ids=this.data.writingPhotoIds.includes(id)?this.data.writingPhotoIds.filter(p=>p!==id):[...this.data.writingPhotoIds,id];this.setData({writingPhotoIds:ids,writingIncludeImage:ids.length>0});this.clearWritingBrief();this.projectWritingPhotos();this.draftChanged();},
  writingImagesAll(){const all=this.data.writingPhotos.length>0&&this.data.writingPhotos.every(p=>p.selected),ids=all?[]:this.data.writingPhotos.slice(0,4).map(p=>p.id);this.setData({writingPhotoIds:ids,writingIncludeImage:ids.length>0});this.clearWritingBrief();this.projectWritingPhotos();this.draftChanged();},
  async prepareWriting(){
    if(this.data.writingBusy)return;
    try{const d=this.data;this.ensureDraft();this.projectWritingPhotos();const brief=postWritingBrief({title:d.title,body:d.body,instructions:d.writingInstructions,purpose:d.writingPurpose,image:d.image,includeImage:d.writingIncludeImage,pictures:this.data.writingPhotos.filter(p=>p.selected).map(p=>({id:p.id,path:p.path,label:p.label}))});this._writingBrief=brief;
      this.setData({writingSummary:'已整理：'+brief.purpose+'；参考当前标题与正文，关联 '+brief.images.length+' 张照片。'+(brief.instructions?'\n写作要求：'+brief.instructions:''),writingError:''});
      const context=this.writingContext(),request={version:1 as const,requestId:'post-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8),purpose:'论坛：'+brief.purpose,
        prompt:JSON.stringify({title:brief.title,body:brief.body,instructions:brief.instructions,rules:brief.rules}),maxChars:600,
        images:brief.pictures.map(p=>({...p,label:p.label.slice(0,100)}))};
      const job=startJournalAi(request,journalAiAvailable()?undefined:teamWritingTransport(this));this._writingJob=job;this._writingContext=context;this.setData({writingBusy:true});
      try{const suggestion=await job.result;if(this._writingJob===job&&this.data.writingOpen&&context===this.writingContext()){this.setData({writingSuggestion:suggestion});try{rememberWriting('forum',this.data.draftId,request,suggestion);}catch{this.setData({writingHistoryNotice:'建议已生成，本机写作记录暂未保存。'});}}}
      catch(error){if(this._writingJob===job)this.setData({writingError:errorText(error)});}
      finally{if(this._writingJob===job){this._writingJob=null;this.setData({writingBusy:false});}}
    }catch(error){this._writingBrief=null;this.setData({writingSummary:'',writingError:errorText(error)});}
  },
  editWritingSuggestion(e:WechatMiniprogram.CustomEvent<{value:string}>){const key=String(e.currentTarget.dataset.key);if(this.data.writingSuggestion&&['title','body'].includes(key))this.setData({writingSuggestion:{...this.data.writingSuggestion,[key]:e.detail.value},writingError:''});},
  applyWriting(){const suggestion=this.data.writingSuggestion;if(suggestion&&!suggestion.body.trim()){this.setData({writingError:'请保留有效的建议正文。'});return;}if(!suggestion||this._writingContext!==this.writingContext()){this.setData({writingError:'帖子已修改，请重新生成；原稿仍保留。'});return;}this.setData({title:suggestion.title,body:suggestion.body,writingOpen:false});this.clearWritingBrief();this.draftChanged();try{markWritingApplied('forum',this.data.draftId,suggestion.requestId);}catch{}},
  publish(){if(this.data.busy||this.data.picking)return;if(!this.data.body.trim()){this.setData({error:'请写一点帖子内容，草稿仍然保留。'});return;}
    if(this.data.attachments.some(item=>!item.path)){this.setData({error:'请重新添加未保留的照片，或移除占位卡后继续。'});return;}
    setCompose({title:this.data.title,body:this.data.body,photo:this.data.image,manualCamera:this.data.manualCamera,attachments:this.data.attachments});hub('publish','compose');},
  async saveDraft(){await this.persistPostDraft(false);},
  async persistPostDraft(silent=true):Promise<boolean>{
    clearTimeout(this._draftTimer);if(this._draftSave){const ok=await this._draftSave;return ok&&this._draftDirty?this.persistPostDraft(silent):ok;}
    if(silent&&(!this._draftDirty||this.data.view!=='compose'))return true;if(this.data.picking)return false;
    const generation=this._composeGeneration,revision=this._draftRevision,input=this.draftInput();this.cacheCurrentDraft();if(!silent)this.setData({busy:true});this.setData({draftStatus:'正在保存'});
    this._draftSave=(async()=>{try{const saved=await savePostDraft(input);if(generation!==this._composeGeneration)return true;
      const attachments=this.data.attachments.map(current=>{const original=input.images.find(p=>p.id===current.id),durable=saved.images.find(p=>p.id===current.id);return original&&durable&&current.path===original.path?{...current,path:durable.path}:current;});
      this.setData({attachments,draftId:saved.id||input.id||'',image:attachments.find(p=>p.id===this.data.activeAttachment)?.path||attachments[0]?.path||''});this.projectWritingPhotos();
      if(revision===this._draftRevision){this._draftDirty=false;this.setData({draftStatus:'已自动保存到本机'});}else{this.cacheCurrentDraft();this.setData({draftStatus:'更改待保存'});}
      this.refreshDrafts();if(!silent)wx.showToast({title:revision===this._draftRevision?'草稿已保存到本机':'已保存开始时的版本',icon:'success'});return true;
    }catch(error){if(generation===this._composeGeneration)this.setData({draftStatus:'完整草稿未保存',error:errorText(error)});return false;}finally{if(!silent&&generation===this._composeGeneration)this.setData({busy:false});}})();
    const ok=await this._draftSave;this._draftSave=null;if(ok&&this._draftDirty&&this._visible)this._draftTimer=setTimeout(()=>{void this.persistPostDraft(true);},900);return ok;
  },
  loadDraft(id?:string){if(this.data.busy)return;try{const d=readPostDraft(id);if(d){clearTimeout(this._draftTimer);this._composeGeneration++;this._draftCreatedAt=d.createdAt||'';this._draftDirty=false;this.setData({view:'compose',draftId:d.id||'legacy-post-draft',title:d.title,body:d.body,writingOpen:false,writingHistoryOpen:false,draftStatus:d.missingMedia?'文字已恢复，照片待重选':'已保存在本机'});this._restoringDraft=true;this.setImages(d.images,d.activeAttachment);this._restoringDraft=false;this.readImageMetadata(d.images);const ids=d.writing.imageIds||((d.writing.includeImage&&this.data.activeAttachment)?[this.data.activeAttachment]:[]);this._draftDirty=false;clearTimeout(this._draftTimer);this.setData({writingPurpose:Number.isInteger(d.writing?.purpose)&&POST_WRITING_PURPOSES[d.writing.purpose]?d.writing.purpose:1,writingInstructions:d.writing.instructions||'',writingPhotoIds:ids,writingIncludeImage:ids.length>0,error:d.missingMedia?'文字与参数已恢复，请重新添加未保留的照片。':''});this.projectWritingPhotos();this.resizeFeed();resetPageScroll(this);}else wx.showToast({title:'还没有本机草稿',icon:'none'});}catch(error){this._restoringDraft=false;this.setData({error:errorText(error)});}},
  openWritingHistory(){this.ensureDraft();try{this.setData({writingHistory:readWritingHistory('forum',this.data.draftId),writingHistoryOpen:true});}catch(error){this.setData({writingError:errorText(error)});}},
  closeWritingHistory(){this.setData({writingHistoryOpen:false});},
  restoreWritingHistory(e:WechatMiniprogram.TouchEvent){const record=this.data.writingHistory.find(r=>r.id===e.currentTarget.dataset.id);if(!record)return;this.clearWritingBrief();const ids=record.images.filter(p=>this.data.attachments.some(a=>a.id===p.id)).map(p=>p.id);this.setData({writingInstructions:writingInstructions(record.prompt),writingPhotoIds:ids,writingIncludeImage:ids.length>0,writingSuggestion:record.suggestion,writingHistoryOpen:false,writingHistoryNotice:'已载入历史建议，当前帖子尚未修改。'});this.projectWritingPhotos();this._writingContext=this.writingContext();this.draftChanged();},
  deleteWritingHistory(e:WechatMiniprogram.TouchEvent){try{deleteWritingRecord('forum',this.data.draftId,String(e.currentTarget.dataset.id));this.openWritingHistory();}catch(error){this.setData({writingError:errorText(error)});}},
  thumbnailFailed(e:WechatMiniprogram.TouchEvent){const id=String(e.currentTarget.dataset.id),url=String(e.currentTarget.dataset.url||''),key=id+'|'+url;if(!url||this._failedThumbnails?.has(key))return;(this._failedThumbnails||(this._failedThumbnails=new Set())).add(key);this.setData({remotePosts:this.data.remotePosts.map((post:any)=>post.id===id?{...post,image:post.image===url?'':post.image,gallery:post.gallery?.map((photo:any)=>photo.image===url?{...photo,image:''}:photo)}:post)});},
  async back(){if(this.data.busy)return;if(this.data.journalPicker){this.closeJournals();return;}if(this.data.moreOpen){this.closeMore();return;}if(this.data.writingOpen){this.closeWriting();return;}if(this.data.view==='compose'&&this._draftDirty&&!await this.persistPostDraft(true))return;this._composeGeneration++;this.setData({view:'feed',error:'',picking:false});this.resizeFeed();resetPageScroll(this);void this.loadFeed();}
});
