import {api,community,hub,imageUrl,setCompose} from '../../services/community';
import { selectTab } from '../../services/tabs';
import { errorText, persistImage } from '../../services/media';
import { resetPageScroll } from '../../services/navigation';
import { postWritingBrief, POST_WRITING_PURPOSES } from '../../services/post-writing';
Page({
  data:{remotePosts:[] as any[],feedLoading:false,more:false,view:'feed',title:'',body:'',image:'',error:'',busy:false,writingOpen:false,writingPurposes:POST_WRITING_PURPOSES,writingPurpose:1,writingInstructions:'',writingIncludeImage:false,writingSummary:'',writingError:''},
  _writingBrief:null as ReturnType<typeof postWritingBrief>|null,
  onShow(){selectTab(this,3);void this.loadFeed();},
  async loadFeed(append=false){
    if(this.data.feedLoading)return;
    this.setData({feedLoading:true,error:''});
    try{const previous=append?this.data.remotePosts:[];const result=await api(community+'/posts','GET',{limit:30,offset:previous.length});
      this.setData({remotePosts:[...previous,...result.items.map((post:any)=>({...post,image:imageUrl(post.image)}))],more:result.items.length===30});
    }catch(error){this.setData({error:errorText(error)});}finally{this.setData({feedLoading:false});}
  },
  refreshFeed(){void this.loadFeed();}, nextPage(){void this.loadFeed(true);},
  section(event:WechatMiniprogram.TouchEvent){hub(event.currentTarget.dataset.screen,event.currentTarget.dataset.id||'');},
  compose(){this.setData({view:'compose',error:''});resetPageScroll(this);},
  clearWritingBrief(){this._writingBrief=null;this.setData({writingSummary:'',writingError:''});},
  change(e:WechatMiniprogram.CustomEvent<{value:string}>){const key=String(e.currentTarget.dataset.key);if(['title','body'].includes(key)){this.setData({[key]:e.detail.value});this.clearWritingBrief();}},
  attach(){wx.chooseImage({count:1,sourceType:['album'],sizeType:['original'],success:r=>{this.setData({image:r.tempFilePaths[0],writingIncludeImage:false});this.clearWritingBrief();}});},
  openWriting(){if(this.data.view!=='compose'||this.data.busy)return;this.clearWritingBrief();this.setData({writingOpen:true});},
  closeWriting(){this.setData({writingOpen:false});},
  writingPurpose(e:WechatMiniprogram.CustomEvent<{value:string}>){const purpose=Number(e.detail.value);if(Number.isInteger(purpose)&&purpose>=0&&purpose<POST_WRITING_PURPOSES.length){this.setData({writingPurpose:purpose});this.clearWritingBrief();}},
  writingInstructions(e:WechatMiniprogram.CustomEvent<{value:string}>){this.setData({writingInstructions:e.detail.value});this.clearWritingBrief();},
  writingImage(){this.setData({writingIncludeImage:!!this.data.image&&!this.data.writingIncludeImage});this.clearWritingBrief();},
  prepareWriting(){
    try{const d=this.data,brief=postWritingBrief({title:d.title,body:d.body,instructions:d.writingInstructions,purpose:d.writingPurpose,image:d.image,includeImage:d.writingIncludeImage});this._writingBrief=brief;
      this.setData({writingSummary:'已整理：'+brief.purpose+'；参考当前标题与正文，关联 '+brief.images.length+' 张照片。'+(brief.instructions?'\n写作要求：'+brief.instructions:''),writingError:''});
    }catch(error){this._writingBrief=null;this.setData({writingSummary:'',writingError:errorText(error)});}
  },
  publish(){if(!this.data.body.trim()){this.setData({error:'请写一点帖子内容，草稿仍然保留。'});return;}setCompose({title:this.data.title,body:this.data.body,photo:this.data.image});hub('publish','compose');},
  saveDraft(){if(this.data.busy)return;this.setData({busy:true});const image=this.data.image;const persist=!image||image.startsWith('/assets/')||image===this._savedImage?Promise.resolve(image):persistImage(image);persist.then(path=>{this._savedImage=path;this.setData({image:path});this.clearWritingBrief();wx.setStorageSync('bird-assistant.post-draft.v1',{title:this.data.title,body:this.data.body,image:path,writing:{purpose:this.data.writingPurpose,instructions:this.data.writingInstructions,includeImage:this.data.writingIncludeImage}});this.setData({busy:false});wx.showToast({title:'草稿已保存到本机',icon:'success'});}).catch(e=>this.setData({busy:false,error:errorText(e)}));},
  _savedImage:'',
  loadDraft(){try{const d=wx.getStorageSync('bird-assistant.post-draft.v1');if(d){this._savedImage=d.image||'';this.clearWritingBrief();this.setData({title:d.title||'',body:d.body||'',image:d.image||'',view:'compose',writingOpen:false,writingPurpose:Number.isInteger(d.writing?.purpose)&&POST_WRITING_PURPOSES[d.writing.purpose]?d.writing.purpose:1,writingInstructions:typeof d.writing?.instructions==='string'?d.writing.instructions:'',writingIncludeImage:!!(d.image&&d.writing?.includeImage)});resetPageScroll(this);}else wx.showToast({title:'还没有本机草稿',icon:'none'});}catch(e){this.setData({error:errorText(e)});}},
  back(){if(this.data.writingOpen){this.closeWriting();return;}this.setData({view:'feed',error:''});resetPageScroll(this);}
});
