import {hub} from '../../services/community';
import {comparisonWidth,SubjectPhoto} from '../../services/field-guide';

type Tap=WechatMiniprogram.TouchEvent;
Page({
  data:{columnWidth:340,ids:[] as string[],candidates:[] as string[],subject:null as SubjectPhoto|null,term:'',matches:[] as any[],notice:''},
  onLoad(options:Record<string,string|undefined>){
    const ids=(options.ids||'').split(',').filter(id=>/^[a-zA-Z0-9_-]{1,100}$/.test(id)).slice(0,3);
    this.setData({ids,candidates:options.select==='1'?ids:[]});this.resizeColumns();
    this.getOpenerEventChannel?.().on?.('subject',(subject:SubjectPhoto)=>this.setData({subject}));
  },
  onResize(){this.resizeColumns();},
  resizeColumns(){this.setData({columnWidth:comparisonWidth(wx.getWindowInfo().windowWidth,this.data.ids.length)});},
  add(event:Tap&{detail?:{id?:string}}){const id=String(event.detail?.id||event.currentTarget.dataset.id||'');const ids=this.data.ids;
    if(id&&!ids.includes(id)&&ids.length<3){this.setData({ids:ids.concat(id),notice:''});this.resizeColumns();}},
  remove(event:Tap){this.setData({ids:this.data.ids.filter(id=>id!==event.currentTarget.dataset.id)});this.resizeColumns();},
  detail(event:Tap){hub('species',event.currentTarget.dataset.id);},
  choose(event:Tap){const id=String(event.currentTarget.dataset.id);if(!this.data.candidates.includes(id))return;
    this.getOpenerEventChannel?.().emit?.('choose',{id});wx.navigateBack();}
});
