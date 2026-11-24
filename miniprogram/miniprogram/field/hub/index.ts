import {api,community,Draft,getDraft,hub,imageUrl,key,openMap,Point,privatePhoto,sessionState,setCompose,setDraft,takeCompose,uploadPhoto} from '../../services/community';

import {compareBirds,picture} from '../../services/field-guide';

const names:Record<string,string>={external:'外部社区鸟讯',library:'鸟种资料库',species:'鸟种资料',record:'观察与讨论',publish:'发布观察',
  feed:'鸟友讨论',mine:'我的发布',observations:'私人观察',bookmarks:'我的收藏',inbox:'私聊',chat:'与鸟友私聊',growth:'徽章与成长'};
type Tap=WechatMiniprogram.TouchEvent;
type Input=WechatMiniprogram.CustomEvent<{value:string}>;
function message(error:unknown){return error instanceof Error?error.message:'请求失败，请重试。';}

Page({
  data:{featured:[] as {id:string;name:string;english:string;image:string;photo:{credit:string;license:string}|null}[],sourceId:'',tab:'identity',placeCount:0,recordCount:0,places:[] as any[],speciesPosts:[] as any[],screen:'',id:'',items:[] as any[],record:null as any,keyword:'',body:'',title:'',error:'',notice:'',busy:false,
    draft:null as Draft|null,anonymous:true,shareDate:false,shareCamera:false,sharePhoto:true,map:false,post:true,
    externalPage:0,externalNext:false,preview:null as any,previewLines:[] as string[],photo:'',replySpecies:'',self:'',selectedSpecies:'',matches:[] as any[]},
  _media:'',_sighting:'',_generation:0,_submitKey:'',_path:'',
  onLoad(options:Record<string,string|undefined>){
    const screen=options.screen&&names[options.screen]?options.screen:'feed';
    this._submitKey=key();
    this.setData({screen,id:options.id||''});wx.setNavigationBarTitle({title:names[screen]});
    if(screen==='publish'){
      const draft=options.id==='compose'?null:getDraft();
      this._media=draft?.storedMedia||'';this._path=draft?.path||'';
      const compose=options.id==='compose'?takeCompose():null;
      this.setData({draft,sourceId:compose?.sourceId||'',title:compose?.title||'',photo:draft?.path||compose?.photo||'',body:draft?.note||compose?.body||'',sharePhoto:!!(draft?.path||compose?.photo)});
    }
    void this.load();
  },
  onUnload(){this._generation++;},
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
    this.setData({busy:true,error:''});
    try{
      const result=screen==='external'?await api(routes.external,'GET',{limit:40,offset:this.data.externalPage*40}):await api(routes[screen]);if(generation!==this._generation)return;
      if(screen==='library')this.setData({featured:(result.featured||[]).map((bird:{id:string;photo:object|null})=>({...bird,image:bird.photo?picture(bird.id):''}))});
      const items=result.items||result.records||[];
      this.setData({items,externalNext:result.hasMore??items.length===40,record:{...result,image:imageUrl(result.image)},photo:imageUrl(result.image)});
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
  field(event:Input){const field=String(event.currentTarget.dataset.field);if(['keyword','title','body','replySpecies'].includes(field))this.setData({[field]:event.detail.value,preview:null});},
  flag(event:Tap){const field=event.currentTarget.dataset.field as 'post'|'map'|'anonymous'|'shareDate'|'shareCamera'|'sharePhoto';this.setData({[field]:!this.data[field],preview:null});},
  go(event:Tap){hub(event.currentTarget.dataset.screen,event.currentTarget.dataset.id||'');},
  sparrowPair(){compareBirds(['avibase-C22FBF8D','avibase-240E3390']);},
  compareSpecies(){compareBirds(this.data.screen==='species'?[this.data.id]:[]);},
  changeTab(event:Tap){this.setData({tab:event.currentTarget.dataset.tab});},
  speciesMap(event:Tap){const place=this.data.places.find(row=>row.id===event.currentTarget.dataset.id);if(place)openMap(place.displayLocation,this.data.id,this.data.record.name||this.data.record.english,1);},
  viewMap(){if(this.data.record?.displayLocation)openMap(this.data.record.displayLocation);},
  choosePoint(){wx.navigateTo({url:'/field/picker/index',events:{point:(point:Point)=>{if(this.data.draft){this._sighting='';this.setData({draft:{...this.data.draft,point},preview:null});}}}});},
  async findSpecies(){try{const res=await api('/api/v1/species?q='+encodeURIComponent(this.data.keyword));this.setData({matches:res.items});}catch(error){this.setData({error:message(error)});}},
  pickSpecies(event:Tap){const item=this.data.matches.find(row=>row.id===event.currentTarget.dataset.id);if(!item)return;
    if(this.data.draft){this._sighting='';this.setData({draft:{...this.data.draft,species:item.id,speciesName:item.name||item.english||item.scientific},preview:null});}
    this.setData({replySpecies:item.id,selectedSpecies:item.name||item.english||item.scientific,matches:[]});},
  async attach(){try{const result=await wx.chooseImage({count:1,sizeType:['original'],sourceType:['album']});this._media='';this.setData({photo:result.tempFilePaths[0],sharePhoto:true,preview:null});}catch{}},
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
        this._media=(await uploadPhoto(d.photo)).id;this._path=d.photo;
      }
      if(draft&&!this._sighting){
        const result=await api('/api/v2/observations/by-reference/'+encodeURIComponent(draft.reference),'PUT',{reference:draft.reference,
          species:draft.species,analysis:draft.analysis,target:draft.target,date:draft.date||null,time:draft.time,place:draft.place,
          point:draft.point,note:draft.note,media:this._media||null,camera:{device:draft.device}});
        this._sighting=result.id;
      }
      if(privateOnly){this.setData({screen:'record',id:this._sighting,notice:'已保存到云端私人观察。'});await this.load();return;}
      const preview=await api(community+'/previews','POST',{sighting:this._sighting||null,media:this._media||null,
        external:d.sourceId||null,title:d.title,body:d.body,anonymous:d.anonymous,share_camera:d.shareCamera,share_photo:d.sharePhoto,share_date:d.shareDate,
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
    if(this.data.busy)return;const {op,id}=event.currentTarget.dataset;this.setData({busy:true,error:'',notice:''});
    try{
      if(op==='withdraw'){if(!(await wx.showModal({title:'撤回发布？',content:'此渠道的内容和照片将从公开页面移除。'})).confirm)return;
        await api(community+'/publications/'+id,'DELETE');}
      if(op==='reply'||op==='send'){
        if(!this.data.body.trim())throw new Error('请输入内容。');
        await api(op==='reply'?community+'/publications/'+this.data.id+'/replies':community+'/messages/'+this.data.id,'POST',
          {body:this.data.body,reference:this._submitKey,...(op==='reply'?{species:this.data.replySpecies||null}:{})});
        this._submitKey=key();this.setData({body:'',notice:op==='reply'?'回复已提交审核。':'已发送。'});
      }
      if(op==='like'||op==='bookmark'){const base=community+'/publications/'+this.data.id;const active=this.data.record.reactions?.includes(op);await api(base+(active?'/reactions/':'/')+op,active?'DELETE':'PUT');}
      if(op==='adopt'){await api('/api/v2/observations/'+this.data.record.ownedSighting+'/adopt','POST',{reply:id});this.setData({notice:'已更新私人观察的鸟种。'});}
      if(op==='unbookmark'){await api(community+'/publications/'+id+'/reactions/bookmark','DELETE');}
      if(op==='block'||op==='unblock'){await api(community+'/blocks/'+this.data.id,op==='block'?'PUT':'DELETE');this.setData({notice:op==='block'?'已屏蔽':'已取消屏蔽'});}
      if(op==='report'){const res=await wx.showModal({title:'举报内容',editable:true,placeholderText:'请填写举报原因'});if(!res.confirm||!res.content)return;
        await api(community+'/reports/'+id,'POST',{reason:res.content});this.setData({notice:'举报已受理'});}
      if(op==='source'&&this.data.record?.sourceUrl)await wx.setClipboardData({data:this.data.record.sourceUrl});
      await this.load();
    }catch(error){this.setData({error:message(error)});}finally{this.setData({busy:false});}
  }
});
