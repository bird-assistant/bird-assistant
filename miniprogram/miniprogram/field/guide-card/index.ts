import {api} from '../../services/community';
import {fieldCard,GuideBird,GuidePhoto,picture,speciesPath} from '../../services/field-guide';

Component({
  properties:{birdId:String,profile:{type:Object,value:null}},
  observers:{'birdId,profile':function(){void this.loadBird();}},
  data:{bird:null as GuideBird|null, photo:null as GuidePhoto|null, src:'',busy:false,notice:''},
  methods:{
    async loadBird(){
      const id=this.data.birdId;
      this.setData({bird:null,photo:null,src:'',notice:'',busy:false});
      if(!id)return;
      try{
        const profile=this.data.profile as GuideBird|null;
        const bird=profile?.id===id ? profile : await fieldCard(id);
        if(this.data.birdId!==id)return;
        this.setData({bird,photo:bird.guide.photo,src:bird.guide.photo?picture(id):''});
      }catch{if(this.data.birdId===id)this.setData({notice:'资料加载失败，请重试。'});}
    },
    async findPhoto(){
      const id=this.data.birdId;
      if(this.data.busy)return;
      this.setData({busy:true,notice:''});
      try{
        const result=await api(speciesPath(id)+'/reference');
        if(this.data.birdId===id)this.setData({photo:result.photo,src:result.photo?picture(id):'',notice:result.photo?'':'暂无符合许可的参考照片。'});
      }catch{if(this.data.birdId===id)this.setData({notice:'参考图库暂不可用，可稍后重试。'});}
      finally{if(this.data.birdId===id)this.setData({busy:false});}
    },
    showPhoto(){if(this.data.src)wx.previewImage({urls:[this.data.src]});},
    copySource(event:WechatMiniprogram.TouchEvent){const url=String(event.currentTarget.dataset.url||'');if(url)wx.setClipboardData({data:url});}
  }
});
