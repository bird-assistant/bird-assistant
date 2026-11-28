import {publicGuidePhoto} from '../../services/public-guide-photos';
import {previewMedia} from '../../services/native-ui';
import {api} from '../../services/community';
import {fieldCard,rememberFieldCard,guideTraits,GuideBird,GuidePhoto,speciesPath} from '../../services/field-guide';
Component({
  properties:{birdId:String,profile:{type:Object,value:null},compact:Boolean,hideHeading:Boolean},
  observers:{'birdId,profile':function(){void this.loadBird();}},
  data:{bird:null as GuideBird|null,traits:[] as Array<{key:string;label:string;value:string}>,photo:null as GuidePhoto|null,src:'',busy:false,loading:true,photoLoaded:false,photoFailed:false,photoFetching:false,photoWidth:240,photoHeight:164,notice:'',_seq:0,_alive:true,_width:240,_iw:0,_ih:0},
  lifetimes:{attached(){this.data._alive=true;},ready(){this.measure();},detached(){this.data._alive=false;this.data._seq++;}},
  pageLifetimes:{resize(){this.measure();}},
  methods:{
    measure(){
      if(typeof wx.createSelectorQuery!=='function')return;
      wx.createSelectorQuery().in(this).select('.reference-box').boundingClientRect(rect=>{if(!this.data._alive)return;const box=rect as WechatMiniprogram.BoundingClientRectCallbackResult;if(box?.width){this.data._width=box.width;this.fitPhoto();}}).exec();
    },
    fitPhoto(){const width=this.data._iw,height=this.data._ih;if(!width||!height)return;const h=Math.min(this.data.compact?164:340,this.data._width*height/width);this.setData({photoWidth:Math.round(h*width/height),photoHeight:Math.round(h)});},
    loaded(event:WechatMiniprogram.CustomEvent<{width:number;height:number}>){this.data._iw=event.detail.width;this.data._ih=event.detail.height;this.setData({photoLoaded:true,photoFailed:false});this.fitPhoto();this.measure();},
    failed(){this.setData({photoFailed:true,photoLoaded:false});},
    retryPhoto(){void this.loadPhoto(this.data.birdId,this.data._seq);},
    async loadPhoto(id:string,seq:number){this.setData({photoFetching:true,photoFailed:false,photoLoaded:false});const src=await publicGuidePhoto(id,this.data.photo||undefined);if(this.data._alive&&this.data._seq===seq)this.setData({src,photoFetching:false});},
    async loadBird(){
      const id=this.data.birdId,seq=++this.data._seq;this.data._iw=0;this.data._ih=0;
      this.data._iw=0;this.data._ih=0;
      this.setData({bird:null,photo:null,src:'',photoFetching:false,notice:'',busy:false,loading:!!id,photoLoaded:false,photoFailed:false});
      if(!id)return;
      try{const profile=this.data.profile as GuideBird|null;const bird=profile?.id===id?profile:await fieldCard(id);
        if(seq!==this.data._seq||!this.data._alive)return;rememberFieldCard(bird);
        const traits=this.data.compact?guideTraits.map(key=>({...key,value:bird.guide.fields.find(row=>row.key===key.key)?.value||'—'})):bird.guide.fields;
        this.setData({bird,traits,photo:bird.guide.photo,src:'',photoFetching:!!bird.guide.photo,loading:false});if(bird.guide.photo)void this.loadPhoto(id,seq);wx.nextTick(()=>this.measure());
      }catch{if(seq===this.data._seq&&this.data._alive)this.setData({loading:false,notice:'资料加载失败，可重试。'});}
    },
    async findPhoto(){const id=this.data.birdId,seq=this.data._seq;if(this.data.busy)return;this.setData({busy:true,notice:''});
      try{const result=await api(speciesPath(id)+'/reference');if(seq!==this.data._seq||!this.data._alive)return;
        this.setData({photo:result.photo,src:'',photoFetching:!!result.photo,photoLoaded:false,photoFailed:false,notice:result.photo?'':'暂无符合许可的参考照片。'});
        if(result.photo)void this.loadPhoto(id,seq);
        if(this.data.bird){this.data.bird.guide.photo=result.photo;rememberFieldCard(this.data.bird);}
      }catch{if(seq===this.data._seq&&this.data._alive)this.setData({notice:'参考图库暂不可用，可稍后重试。'});}
      finally{if(seq===this.data._seq&&this.data._alive)this.setData({busy:false});}
    },
    showPhoto(){if(this.data.src&&!this.data.photoFailed)previewMedia([this.data.src]);},
    copySource(event:WechatMiniprogram.TouchEvent){const url=String(event.currentTarget.dataset.url||'');if(url)wx.setClipboardData({data:url});}
  }
});
