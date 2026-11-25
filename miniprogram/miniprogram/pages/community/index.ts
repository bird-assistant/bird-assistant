import {api,community,hub,imageUrl,setCompose} from '../../services/community';
import {cleanPhotoDetails,PhotoDetails} from '../../services/photo-details';
import {layout} from '../../services/layout';
import {forumPost} from '../../services/forum';
import { selectTab } from '../../services/tabs';
import { errorText, persistImage } from '../../services/media';
import { resetPageScroll } from '../../services/navigation';
import { postWritingBrief, POST_WRITING_PURPOSES } from '../../services/post-writing';
import {startJournalAi,journalAiAvailable,JournalAiSuggestion} from '../../services/journal-ai';
import {teamWritingTransport} from '../../services/writing-network';
const reactionSets=new WeakMap<object,Set<string>>();
function reactions(page:object){let active=reactionSets.get(page);if(!active){active=new Set();reactionSets.set(page,active);}return active;}
Page({
  data:{feedHeight:600,refreshing:false,pullReady:false,pullProgress:0,manualCamera:{} as PhotoDetails,moreOpen:false,moreItems:[{id:'library',label:'鸟种资料库',icon:'journal',hint:'查阅与对比'},{id:'external',label:'外部鸟讯',icon:'pin',hint:'发现公开观察'},{id:'friends',label:'找鸟友',icon:'user',hint:'认识同行的人'},{id:'inbox',label:'消息',icon:'chat',hint:'继续一段对话'},{id:'groups',label:'群聊',icon:'leaf',hint:'一起聊聊观鸟'},{id:'draft',label:'本机草稿',icon:'image',hint:'接着上次写'}],feedTotal:0,writingBusy:false,writingSuggestion:null as JournalAiSuggestion|null,remotePosts:[] as any[],feedLoading:false,more:false,view:'feed',title:'',body:'',image:'',error:'',busy:false,writingOpen:false,writingPurposes:POST_WRITING_PURPOSES,writingPurpose:1,writingInstructions:'',writingIncludeImage:false,writingSummary:'',writingError:''},
  _writingJob:null as ReturnType<typeof startJournalAi>|null,
  _writingContext:'',
  writingContext(){const d=this.data;return JSON.stringify([d.title,d.body,d.image,d.writingPurpose,d.writingInstructions,d.writingIncludeImage]);},
  _refreshSeq:0,_feedSeq:0,_visible:true,
  onLoad(){reactionSets.set(this,new Set());this.resizeFeed();},
  resizeFeed(){this.setData({feedHeight:layout(this.data.view!=='feed').height});},onResize(){this.resizeFeed();},
  photoDetails(event:WechatMiniprogram.CustomEvent<PhotoDetails>){this.setData({manualCamera:cleanPhotoDetails(event.detail)});},
  pulling(event:WechatMiniprogram.CustomEvent<{dy:number}>){const dy=Number(event.detail.dy)||0;this.setData({pullReady:dy>=64,pullProgress:Math.min(1,dy/64)});},
  pullReset(){this.setData({pullReady:false,pullProgress:0});},
  async pullRefresh(){if(this.data.refreshing)return;const token=++this._refreshSeq;this.setData({refreshing:true});try{await this.loadFeed(false,true);}finally{if(token===this._refreshSeq)this.setData({refreshing:false,pullReady:false,pullProgress:0});}},
  onHide(){this._refreshSeq++;this._visible=false;this._feedSeq++;this.setData({feedLoading:false,refreshing:false,pullReady:false,pullProgress:0,moreOpen:false});this.closeWriting();},onUnload(){this._refreshSeq++;this._visible=false;this._feedSeq++;this.closeWriting();reactionSets.delete(this);},
  _writingBrief:null as ReturnType<typeof postWritingBrief>|null,
  onShow(){this._visible=true;this.resizeFeed();selectTab(this,3);if(this.data.view==='feed')void this.loadFeed();},
  async onPullDownRefresh(){try{if(this.data.view==='feed')await this.loadFeed(false,true);}finally{wx.stopPullDownRefresh?.();}},
  onReachBottom(){if(this.data.view==='feed'&&this.data.more)void this.loadFeed(true);},
  async loadFeed(append=false,force=false){
    if(this.data.feedLoading&&!force)return;
    const token=++this._feedSeq,previous=append?this.data.remotePosts:[];this.setData({feedLoading:true,error:''});
    try{const result=await api(community+'/posts','GET',{limit:30,offset:previous.length});
      if(token!==this._feedSeq||!this._visible)return;
      const unique=new Map(previous.map((row:any)=>[row.id,row]));for(const post of result.items)unique.set(post.id,{...forumPost(post),image:imageUrl(post.image)});
      this.setData({remotePosts:Array.from(unique.values()),feedTotal:result.total??unique.size,more:result.hasMore??result.items.length===30});
    }catch(error){if(token===this._feedSeq&&this._visible)this.setData({error:errorText(error)});}finally{if(token===this._feedSeq&&this._visible)this.setData({feedLoading:false});}
  },
  refreshFeed(){void this.loadFeed(false,true);},nextPage(){void this.loadFeed(true);},
  patchPost(id:string,patch:Record<string,unknown>){this.setData({remotePosts:this.data.remotePosts.map((row:any)=>row.id===id?{...row,...patch}:row)});},
  async react(event:WechatMiniprogram.TouchEvent){
    const id=String(event.currentTarget.dataset.id),kind=String(event.currentTarget.dataset.kind),post=this.data.remotePosts.find((row:any)=>row.id===id);
    const activeReactions=reactions(this);
    if(!post||!['like','bookmark'].includes(kind)||activeReactions.has(id))return;
    activeReactions.add(id);this.patchPost(id,{reacting:true});
    const active=kind==='like'?post.liked:post.favorited;
    try{const base=community+'/publications/'+id;const result=await api(base+(active?'/reactions/':'/')+kind,active?'DELETE':'PUT');
      this._feedSeq++;if(!this._visible)return;
      const reactions=Array.isArray(result.reactions)?result.reactions:null;
      this.patchPost(id,{liked:reactions?reactions.includes('like'):kind==='like'?result.active:post.liked,
        favorited:typeof result.bookmarked==='boolean'?result.bookmarked:kind==='bookmark'?result.active:post.favorited,
        likes:Number.isInteger(result.likes)?result.likes:post.likes+(kind==='like'&&post.hasLikes?(result.active?1:-1):0),
        hasLikes:post.hasLikes||Number.isInteger(result.likes)});this.setData({feedLoading:false,error:''});
    }catch(error){if(this._visible)this.setData({error:errorText(error)});}finally{activeReactions.delete(id);if(this._visible)this.patchPost(id,{reacting:false});}
  },
  moreSections(){this.setData({moreOpen:!this.data.moreOpen});},
  closeMore(){this.setData({moreOpen:false});},
  holdMenu(){},
  moreSection(event:WechatMiniprogram.TouchEvent){const id=String(event.currentTarget.dataset.id);if(!this.data.moreItems.some(item=>item.id===id))return;this.closeMore();if(id==='draft')this.loadDraft();else hub(id);},
  section(event:WechatMiniprogram.TouchEvent){hub(event.currentTarget.dataset.screen,event.currentTarget.dataset.id||'');},
  compose(){this.setData({view:'compose',error:'',moreOpen:false});this.resizeFeed();resetPageScroll(this);},
  clearWritingBrief(){this._writingJob?.cancel();this._writingJob=null;this._writingContext='';this._writingBrief=null;this.setData({writingBusy:false,writingSuggestion:null,writingSummary:'',writingError:''});},
  change(e:WechatMiniprogram.CustomEvent<{value:string}>){const key=String(e.currentTarget.dataset.key);if(['title','body'].includes(key)){this.setData({[key]:e.detail.value});this.clearWritingBrief();}},
  attach(){wx.chooseImage({count:1,sourceType:['album'],sizeType:['original'],success:r=>{this.setData({image:r.tempFilePaths[0],manualCamera:{},writingIncludeImage:false});this.clearWritingBrief();}});},
  openWriting(){if(this.data.view!=='compose'||this.data.busy)return;this.clearWritingBrief();this.setData({writingOpen:true});},
  closeWriting(){this.clearWritingBrief();this.setData({writingOpen:false});},
  writingPurpose(e:WechatMiniprogram.CustomEvent<{value:string}>){const purpose=Number(e.detail.value);if(Number.isInteger(purpose)&&purpose>=0&&purpose<POST_WRITING_PURPOSES.length){this.setData({writingPurpose:purpose});this.clearWritingBrief();}},
  writingInstructions(e:WechatMiniprogram.CustomEvent<{value:string}>){this.setData({writingInstructions:e.detail.value});this.clearWritingBrief();},
  writingImage(){this.setData({writingIncludeImage:!!this.data.image&&!this.data.writingIncludeImage});this.clearWritingBrief();},
  async prepareWriting(){
    if(this.data.writingBusy)return;
    try{const d=this.data,brief=postWritingBrief({title:d.title,body:d.body,instructions:d.writingInstructions,purpose:d.writingPurpose,image:d.image,includeImage:d.writingIncludeImage});this._writingBrief=brief;
      this.setData({writingSummary:'已整理：'+brief.purpose+'；参考当前标题与正文，关联 '+brief.images.length+' 张照片。'+(brief.instructions?'\n写作要求：'+brief.instructions:''),writingError:''});
      const context=this.writingContext(),request={version:1 as const,requestId:'post-'+Date.now().toString(36),purpose:'论坛：'+brief.purpose,
        prompt:JSON.stringify({title:brief.title,body:brief.body,instructions:brief.instructions,rules:brief.rules}),maxChars:600,
        images:brief.images.map(path=>({id:'post-photo',path,label:'用户明确勾选的帖子照片'}))};
      const job=startJournalAi(request,journalAiAvailable()?undefined:teamWritingTransport(this));this._writingJob=job;this._writingContext=context;this.setData({writingBusy:true});
      try{const suggestion=await job.result;if(this._writingJob===job&&this.data.writingOpen&&context===this.writingContext())this.setData({writingSuggestion:suggestion});}
      catch(error){if(this._writingJob===job)this.setData({writingError:errorText(error)});}
      finally{if(this._writingJob===job){this._writingJob=null;this.setData({writingBusy:false});}}
    }catch(error){this._writingBrief=null;this.setData({writingSummary:'',writingError:errorText(error)});}
  },
  applyWriting(){const suggestion=this.data.writingSuggestion;if(!suggestion||this._writingContext!==this.writingContext()){this.setData({writingError:'帖子已修改，请重新生成；原稿仍保留。'});return;}this.setData({title:suggestion.title,body:suggestion.body,writingOpen:false});this.clearWritingBrief();},
  publish(){if(!this.data.body.trim()){this.setData({error:'请写一点帖子内容，草稿仍然保留。'});return;}setCompose({title:this.data.title,body:this.data.body,photo:this.data.image,manualCamera:this.data.manualCamera});hub('publish','compose');},
  saveDraft(){if(this.data.busy)return;this.setData({busy:true});const image=this.data.image;const persist=!image||image.startsWith('/assets/')||image===this._savedImage?Promise.resolve(image):persistImage(image);persist.then(path=>{this._savedImage=path;this.setData({image:path});this.clearWritingBrief();wx.setStorageSync('bird-assistant.post-draft.v1',{title:this.data.title,body:this.data.body,image:path,manualCamera:this.data.manualCamera,writing:{purpose:this.data.writingPurpose,instructions:this.data.writingInstructions,includeImage:this.data.writingIncludeImage}});this.setData({busy:false});wx.showToast({title:'草稿已保存到本机',icon:'success'});}).catch(e=>this.setData({busy:false,error:errorText(e)}));},
  _savedImage:'',
  loadDraft(){try{const d=wx.getStorageSync('bird-assistant.post-draft.v1');if(d){this._savedImage=d.image||'';this.clearWritingBrief();this.setData({manualCamera:cleanPhotoDetails(d.manualCamera),title:d.title||'',body:d.body||'',image:d.image||'',view:'compose',writingOpen:false,writingPurpose:Number.isInteger(d.writing?.purpose)&&POST_WRITING_PURPOSES[d.writing.purpose]?d.writing.purpose:1,writingInstructions:typeof d.writing?.instructions==='string'?d.writing.instructions:'',writingIncludeImage:!!(d.image&&d.writing?.includeImage)});this.resizeFeed();resetPageScroll(this);}else wx.showToast({title:'还没有本机草稿',icon:'none'});}catch(e){this.setData({error:errorText(e)});}},
  back(){if(this.data.moreOpen){this.closeMore();return;}if(this.data.writingOpen){this.closeWriting();return;}this.setData({view:'feed',error:''});this.resizeFeed();resetPageScroll(this);void this.loadFeed();}
});
