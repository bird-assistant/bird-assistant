import {cleanPhotoDetails,withPhotoDetails,withEmbeddedPhotoDetails,PhotoDetails} from '../../services/photo-details';
import {navigate} from '../../services/navigation';
import {api,community,Draft,getDraft,hub,imageUrl,key,openMap,Point,privatePhoto,sessionState,setCompose,setDraft,takeCompose,uploadPhoto} from '../../services/community';

import {forumPost,forumThreads,ReplyView} from '../../services/forum';
import {compareBirds,picture} from '../../services/field-guide';
import {photoInfo} from '../../services/photo-info';

const names:Record<string,string>={external:'外部社区鸟讯',library:'鸟种资料库',species:'鸟种资料',record:'观察与讨论',publish:'发布观察',
  feed:'鸟友讨论',mine:'我的发布',observations:'私人观察',bookmarks:'我的收藏',inbox:'私聊',chat:'与鸟友私聊',growth:'徽章与成长'};
type Tap=WechatMiniprogram.TouchEvent;
type Input=WechatMiniprogram.CustomEvent<{value:string}>;
function message(error:unknown){return error instanceof Error?error.message:'请求失败，请重试。';}

Page({
  data:{displayResolution:'',manualCamera:{} as PhotoDetails,manualPhotoInfo:null as ReturnType<typeof photoInfo>,photoInfo:null as ReturnType<typeof photoInfo>,postSpecies:'',postSpeciesName:'',speciesSupported:false,placeLoading:false,replyTarget:null as {id:string;name:string}|null,replyFocused:false,replySuggestOpen:false,replyThreads:[] as Array<{id:string;root:ReplyView;children:ReplyView[]}>,pendingReplies:[] as any[],photoWidth:300,photoFailed:false,photoHeight:200,featured:[] as {id:string;name:string;english:string;image:string;photo:{credit:string;license:string}|null}[],sourceId:'',tab:'identity',placeCount:0,recordCount:0,places:[] as any[],speciesPosts:[] as any[],screen:'',id:'',items:[] as any[],record:null as any,keyword:'',body:'',title:'',error:'',notice:'',busy:false,
    draft:null as Draft|null,anonymous:true,shareDate:false,shareCamera:false,sharePhoto:true,map:false,post:true,
    externalPage:0,externalNext:false,preview:null as any,previewLines:[] as string[],photo:'',replySpecies:'',self:'',selectedSpecies:'',matches:[] as any[]},
  _cameraDetails:{} as Record<string,string>,_media:'',_sighting:'',_generation:0,_submitKey:'',_replySignature:'',_path:'',_closed:false,_replyOffset:0,_replyLoading:false,
  onLoad(options:Record<string,string|undefined>){
    const screen=options.screen&&names[options.screen]?options.screen:'feed';
    this._submitKey=key();
    this.setData({screen,id:options.id||''});wx.setNavigationBarTitle({title:names[screen]});
    if(screen==='publish'){
      const draft=options.id==='compose'?null:getDraft();
      this._media=draft?.storedMedia||'';this._path=draft?.path||'';
      const compose=options.id==='compose'?takeCompose():null;
      this.setData({manualCamera:cleanPhotoDetails(compose?.manualCamera),draft,sourceId:compose?.sourceId||'',title:compose?.title||'',photo:draft?.path||compose?.photo||'',body:draft?.note||compose?.body||'',sharePhoto:!!(draft?.path||compose?.photo),postSpecies:compose?.speciesId||'',postSpeciesName:compose?.speciesName||'',speciesSupported:compose?.speciesSupported===true});
    }
    void this.load();
  },
  onUnload(){this._closed=true;this._generation++;},
  copyCredit(event:Tap){void wx.setClipboardData({data:event.currentTarget.dataset.url});},
  onShareAppMessage(){
    const record=this.data.record;
    if(this.data.screen==='record' && record?.sourceUrl && record.visibility==='public'){
      return {title:`${record.speciesName} · ${record.source}`,path:'/field/hub/index?screen=record&id='+encodeURIComponent(record.id)};
    }
    return {title:'羽迹 · 外部社区鸟讯',path:'/field/hub/index?screen=external'};
  },
  externalPage(event:Tap){const page=this.data.externalPage+Number(event.currentTarget.dataset.direction);
    if(this.data.busy||page<0)return;this.setData({externalPage:page});void this.load();},
  async onPullDownRefresh(){try{await this.load();}finally{wx.stopPullDownRefresh();}},
  async load(){
    const {screen,id,keyword}=this.data;const generation=++this._generation;
    const routes:Record<string,string>={external:community+'/external',feed:community+'/posts',mine:community+'/mine',inbox:community+'/inbox',
      bookmarks:community+'/bookmarks',observations:'/api/v2/observations',library:'/api/v1/species?featured=true&q='+encodeURIComponent(keyword),
      species:'/api/v1/species/'+id,record:id.startsWith('obs_')?'/api/v1/map/observations/'+id:community+'/publications/'+id,
      chat:community+'/messages/'+id,growth:community+'/me'};
    if(!routes[screen])return;
    this.setData({busy:true,error:'',photoFailed:false,displayResolution:''});
    try{
      const result=screen==='external'?await api(routes.external,'GET',{limit:40,offset:this.data.externalPage*40}):await api(routes[screen]);if(generation!==this._generation)return;
      if(screen==='library')this.setData({featured:(result.featured||[]).map((bird:{id:string;photo:object|null})=>({...bird,image:bird.photo?picture(bird.id):''}))});
      const items=result.items||result.records||[];
      this.setData({items,externalNext:result.hasMore??items.length===40,record:{...result,image:imageUrl(result.image)},photo:imageUrl(result.image)});
      if(screen==='record'){
        this._replyOffset=(result.replies||[]).length;
        const pending=result.features?.threadedReplies?[]:this.data.pendingReplies;
        const replies=(result.replies||[]).concat(pending),record={...result,...forumPost(result),image:imageUrl(result.image),replies,replyCount:result.replyCount??(result.replies||[]).length};
        this.setData({record,photoInfo:photoInfo(Object.keys(result.camera||{}).length?result.camera:record.embeddedCamera,Object.keys(result.camera||{}).length?'照片附带 / 已分享的参数':'从照片文件读取'),manualPhotoInfo:photoInfo(record.manualCamera,'作者填写'),replyThreads:forumThreads(replies)});wx.setNavigationBarTitle({title:result.channel==='post'?'帖子详情':'观察详情'});
      }
      if(screen==='species'){
        const responses=await Promise.all([api(routes.species+'/places'),api(community+'/posts','GET',{species:id})]);
        const places=responses[0],posts=responses[1];
        if(generation!==this._generation)return;
        this.setData({places:places.items,placeCount:places.placeCount,recordCount:places.recordCount,speciesPosts:posts.items});
      }
      if(result.visibility==='private'&&result.media){const path=await privatePhoto(id);if(generation===this._generation)this.setData({photo:path});}
      if((screen==='chat'||screen==='record') && sessionState()!=='out'){const self=await api(community+'/me');if(generation===this._generation)this.setData({self:self.id});}
    }catch(error){if(generation===this._generation)this.setData({error:message(error)});}
    finally{if(generation===this._generation)this.setData({busy:false});}
  },
  photoDetails(event:WechatMiniprogram.CustomEvent<PhotoDetails>){this.setData({manualCamera:cleanPhotoDetails(event.detail),preview:null});},
  photoError(){this.setData({photoFailed:true});},
  photoLoaded(event:WechatMiniprogram.CustomEvent<{width:number;height:number}>){
    const {width,height}=event.detail;if(width>0&&height>0)this.setData({displayResolution:width+' × '+height+' px',photoHeight:Math.max(60,Math.min(420,(Math.min(620,wx.getWindowInfo().windowWidth)-32)*height/width)),photoWidth:Math.min(Math.min(620,wx.getWindowInfo().windowWidth)-32,420*width/height)});
  },
  field(event:Input){const field=String(event.currentTarget.dataset.field);if(['keyword','title','body','replySpecies'].includes(field))this.setData({[field]:event.detail.value,preview:null});},
  flag(event:Tap){const field=event.currentTarget.dataset.field as 'post'|'map'|'anonymous'|'shareDate'|'shareCamera'|'sharePhoto';this.setData({[field]:!this.data[field],preview:null});},
  go(event:Tap){hub(event.currentTarget.dataset.screen,event.currentTarget.dataset.id||'');},
  sparrowPair(){compareBirds(['avibase-C22FBF8D','avibase-240E3390']);},
  compareSpecies(){compareBirds(this.data.screen==='species'?[this.data.id]:[]);},
  changeTab(event:Tap){this.setData({tab:event.currentTarget.dataset.tab});},
  async morePlaces(){if(this.data.placeLoading||this.data.places.length>=this.data.placeCount)return;const id=this.data.id,generation=this._generation;this.setData({placeLoading:true});
    try{const result=await api('/api/v1/species/'+id+'/places','GET',{limit:50,offset:this.data.places.length});if(generation===this._generation){const unique=new Map(this.data.places.concat(result.items).map((row:any)=>[row.id,row]));this.setData({places:Array.from(unique.values())});}}
    catch(error){if(generation===this._generation)this.setData({error:message(error)});}finally{if(generation===this._generation)this.setData({placeLoading:false});}},
  startSpeciesDiscussion(){const row=this.data.record;if(!row)return;setCompose({title:'关于'+(row.name||row.english)+'的讨论',body:'',photo:'',speciesId:this.data.id,speciesName:row.name||row.english,speciesSupported:row.features?.speciesPosts===true});hub('publish','compose');},
  chooseReplySpecies(event:WechatMiniprogram.CustomEvent<{id:string;name:string}>){this.setData({replySpecies:event.detail.id,selectedSpecies:event.detail.name,replySuggestOpen:false});},
  clearReplySpecies(){this.setData({replySpecies:'',selectedSpecies:''});},
  toggleReplySpecies(){this.setData({replySuggestOpen:!this.data.replySuggestOpen});},
  replyTo(event:Tap){const id=String(event.currentTarget.dataset.id),row=this.data.record?.replies?.find((item:any)=>item.id===id);if(!row||row.status==='pending')return;
    if(!this.data.record.features?.threadedReplies){this.setData({notice:'当前服务需更新后才能回复指定楼层，你仍可发表普通回复。'});this.focusReplies();return;}
    this.setData({replyTarget:{id,name:row.publicName||'鸟友'},replyFocused:true});wx.pageScrollTo({selector:'#reply-composer',duration:160});},
  cancelReply(){this.setData({replyTarget:null,replyFocused:false});},
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
  viewMap(){const record=this.data.record;if(!record?.displayLocation)return;const precise=record.visibility==='private',label=record.precisionLabel||'约十公里公开区域';openMap(record.displayLocation,'','所有鸟种',precise?2:1,{scale:precise?17:/一公里/.test(label)?13:11,precisionLabel:precise?'我的私人拍摄点':label+' · 非精确拍摄点'});},
  choosePoint(){navigate({url:'/field/picker/index',events:{point:(point:Point)=>{if(this.data.draft){this._sighting='';this.setData({draft:{...this.data.draft,point},preview:null});}}}});},
  async findSpecies(){try{const res=await api('/api/v1/species?q='+encodeURIComponent(this.data.keyword));this.setData({matches:res.items});}catch(error){this.setData({error:message(error)});}},
  pickSpecies(event:Tap){const item=this.data.matches.find(row=>row.id===event.currentTarget.dataset.id);if(!item)return;
    if(this.data.draft){this._sighting='';this.setData({draft:{...this.data.draft,species:item.id,speciesName:item.name||item.english||item.scientific},preview:null});}
    this.setData({replySpecies:item.id,selectedSpecies:item.name||item.english||item.scientific,matches:[]});},
  async attach(){try{const result=await wx.chooseImage({count:1,sizeType:['original'],sourceType:['album']});this._media='';this.setData({photo:result.tempFilePaths[0],manualCamera:{},sharePhoto:true,preview:null});}catch{}},
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
      const privateOnly=!!draft&&event.currentTarget.dataset.mode==='private';
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
        ...(d.postSpecies&&d.speciesSupported?{species:d.postSpecies}:{}),
        external:d.sourceId||null,title:d.title,body:withPhotoDetails(!draft&&d.shareCamera?withEmbeddedPhotoDetails(d.body,this._cameraDetails):d.body,d.manualCamera),anonymous:d.anonymous,share_camera:d.shareCamera,share_photo:d.sharePhoto,share_date:d.shareDate,
        channels:[...(d.post?['post']:[]),...(d.map?['map']:[])]});
      const previewLines=Object.keys(preview.display).map(channel=>{const row=preview.display[channel];
        return [channel==='map'?'地图鸟讯':'讨论帖',row.publicName,row.title,row.body,row.date,row.sourceRecord?'附外部鸟讯来源卡':'',row.media?'含照片':'无照片',
          ...Object.values(row.camera||{}),row.displayLocation?'区域中心 '+row.displayLocation.latitude+', '+row.displayLocation.longitude:'隐藏位置'].filter(Boolean).join(' · ');});
      this.setData({preview,previewLines});
    }catch(error){this.setData({error:message(error)});}finally{this.setData({busy:false});}
  },
  async submit(){if(this.data.busy||!this.data.preview)return;this.setData({busy:true,error:''});
    try{await api(community+'/publications','POST',{preview:this.data.preview.id});const screen=this._sighting?'record':'mine';
      this.setData({preview:null,screen,id:this._sighting,notice:'已提交审核，各渠道独立更新。'});
      wx.setNavigationBarTitle({title:names[screen]});await this.load();}
    catch(error){this.setData({error:message(error)});}finally{this.setData({busy:false});}},
  async action(event:Tap){
    if(this.data.busy||this._closed)return;const {op,id}=event.currentTarget.dataset;this.setData({busy:true,error:'',notice:''});
    try{
      if(op==='withdraw'){if(!(await wx.showModal({title:'撤回发布？',content:'此渠道的内容和照片将从公开页面移除。'})).confirm)return;
        await api(community+'/publications/'+id,'DELETE');}
      if(op==='reply'||op==='send'){
        if(!this.data.body.trim())throw new Error('请输入内容。');
        const text=this.data.body.trim(),parent=this.data.replyTarget;
        const signature=JSON.stringify([this.data.id,text,this.data.replySpecies,parent?.id||'']);
        if(this._replySignature&&this._replySignature!==signature)this._submitKey=key();this._replySignature=signature;
        const result=await api(op==='reply'?community+'/publications/'+this.data.id+'/replies':community+'/messages/'+this.data.id,'POST',
          {body:text,reference:this._submitKey,...(op==='reply'?{species:this.data.replySpecies||null,...(parent?{parentId:parent.id}:{})}:{})});
        if(this._closed)return;
        if(op==='reply'&&result.id)this.setData({pendingReplies:this.data.pendingReplies.concat({id:result.id,body:text,publicName:'我',memberId:this.data.self,species:this.data.replySpecies||'',parentId:parent?.id||'',replyToName:parent?.name||'',status:'pending',created:new Date().toISOString()})});
        this._submitKey=key();this._replySignature='';this.setData({body:'',replyTarget:null,replyFocused:false,replySuggestOpen:false,replySpecies:'',selectedSpecies:'',notice:op==='reply'?'回复已提交，审核通过后公开显示。':'已发送。'});wx.hideKeyboard?.();
      }
      if(op==='like'||op==='bookmark'){const base=community+'/publications/'+this.data.id;const active=this.data.record.reactions?.includes(op);await api(base+(active?'/reactions/':'/')+op,active?'DELETE':'PUT');}
      if(op==='adopt'){await api('/api/v2/observations/'+this.data.record.ownedSighting+'/adopt','POST',{reply:id});this.setData({notice:'已更新私人观察的鸟种。'});}
      if(op==='unbookmark'){await api(community+'/publications/'+id+'/reactions/bookmark','DELETE');}
      if(op==='block'||op==='unblock'){await api(community+'/blocks/'+this.data.id,op==='block'?'PUT':'DELETE');this.setData({notice:op==='block'?'已屏蔽':'已取消屏蔽'});}
      if(op==='report'){const res=await wx.showModal({title:'举报内容',editable:true,placeholderText:'请填写举报原因'});if(!res.confirm||!res.content)return;
        await api(community+'/reports/'+id,'POST',{reason:res.content});this.setData({notice:'举报已受理'});}
      if(op==='source'&&this.data.record?.sourceUrl)await wx.setClipboardData({data:this.data.record.sourceUrl});
      await this.load();
    }catch(error){if(!this._closed)this.setData({error:message(error)});}finally{if(!this._closed)this.setData({busy:false});}
  }
});
