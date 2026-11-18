import { selectTab } from '../../services/tabs';
import { errorText, persistImage } from '../../services/media';
import { resetPageScroll } from '../../services/navigation';
import { postWritingBrief, POST_WRITING_PURPOSES } from '../../services/post-writing';
interface Post {id:string;author:string;title:string;body:string;image:string;sample:boolean;likes:number;liked:boolean;saved:boolean;replies:Array<{author:string;body:string}>;}
const samplePost:Post={id:'post-a',author:'美宁',title:'辨认一只鸟时，你会先看哪里？',body:'我正在练习先观察体形，再看颜色。大家觉得哪些特征最有帮助？',image:'/assets/bird-preview.png',sample:true,likes:12,liked:false,saved:false,replies:[{author:'林栖',body:'可以先留意大小、嘴形和姿态。'}]};
const KEY='bird-assistant.community-demo.v1';
Page({
  data:{view:'feed',posts:[samplePost],current:null as Post|null,title:'',body:'',reply:'',image:'',error:'',busy:false,writingOpen:false,writingPurposes:POST_WRITING_PURPOSES,writingPurpose:1,writingInstructions:'',writingIncludeImage:false,writingSummary:'',writingError:''},
  _writingBrief:null as ReturnType<typeof postWritingBrief>|null,
  onShow(){selectTab(this,3);try{const stored=wx.getStorageSync(KEY);if(stored){if(!Array.isArray(stored)||!stored.every(p=>typeof p.id==='string'&&Array.isArray(p.replies)))throw new Error('讨论演示资料无法读取，未覆盖。');this.setData({posts:stored.map(p=>p.id==='post-a'&&p.sample&&p.image==='/assets/samples/field-0.png'?{...p,image:samplePost.image}:p)});}}catch(e){this.setData({error:errorText(e)});}},
  open(e:WechatMiniprogram.TouchEvent){const current=this.data.posts.find(p=>p.id===e.currentTarget.dataset.id);if(current){this.setData({current,view:'post',reply:'',error:''});resetPageScroll(this);}},
  compose(){this.setData({view:'compose',error:''});resetPageScroll(this);},
  clearWritingBrief(){this._writingBrief=null;this.setData({writingSummary:'',writingError:''});},
  change(e:WechatMiniprogram.CustomEvent<{value:string}>){const key=String(e.currentTarget.dataset.key);if(['title','body','reply'].includes(key)){this.setData({[key]:e.detail.value});if(key!=='reply')this.clearWritingBrief();}},
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
  commit(posts:Post[]){wx.setStorageSync(KEY,posts);this.setData({posts,current:posts.find(p=>p.id===this.data.current?.id)||this.data.current});},
  react(e:WechatMiniprogram.TouchEvent){const posts=JSON.parse(JSON.stringify(this.data.posts)) as Post[],p=posts.find(p=>p.id===e.currentTarget.dataset.id);if(!p)return;const key=e.currentTarget.dataset.kind==='saved'?'saved':'liked';p[key]=!p[key];try{this.commit(posts);}catch(error){this.setData({error:errorText(error)});}},
  publish(){if(!this.data.body.trim()){this.setData({error:'请写一点帖子内容，草稿仍然保留。'});return;}this.setData({error:'社区服务尚未接入，尚未公开发布。草稿已保留在当前页面；可保存为本机草稿。'});},
  saveDraft(){if(this.data.busy)return;this.setData({busy:true});const image=this.data.image;const persist=!image||image.startsWith('/assets/')||image===this._savedImage?Promise.resolve(image):persistImage(image);persist.then(path=>{this._savedImage=path;this.setData({image:path});this.clearWritingBrief();wx.setStorageSync('bird-assistant.post-draft.v1',{title:this.data.title,body:this.data.body,image:path,writing:{purpose:this.data.writingPurpose,instructions:this.data.writingInstructions,includeImage:this.data.writingIncludeImage}});this.setData({busy:false});wx.showToast({title:'草稿已保存到本机',icon:'success'});}).catch(e=>this.setData({busy:false,error:errorText(e)}));},
  _savedImage:'',
  loadDraft(){try{const d=wx.getStorageSync('bird-assistant.post-draft.v1');if(d){this._savedImage=d.image||'';this.clearWritingBrief();this.setData({title:d.title||'',body:d.body||'',image:d.image||'',view:'compose',writingOpen:false,writingPurpose:Number.isInteger(d.writing?.purpose)&&POST_WRITING_PURPOSES[d.writing.purpose]?d.writing.purpose:1,writingInstructions:typeof d.writing?.instructions==='string'?d.writing.instructions:'',writingIncludeImage:!!(d.image&&d.writing?.includeImage)});resetPageScroll(this);}else wx.showToast({title:'还没有本机草稿',icon:'none'});}catch(e){this.setData({error:errorText(e)});}},
  sendReply(){if(!this.data.reply.trim())return;this.setData({error:'回复服务尚未接入，文字仍保留，尚未发送给其他用户。'});},
  author(){wx.showModal({title:this.data.current?.author||'示例作者',content:'这是原型中的示例鸟友。真实主页、好友和消息服务待接入。',showCancel:false});},
  back(){if(this.data.writingOpen){this.closeWriting();return;}this.setData({view:'feed',error:''});resetPageScroll(this);}
});
