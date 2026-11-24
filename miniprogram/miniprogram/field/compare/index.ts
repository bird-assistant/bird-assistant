import {api,hub} from '../../services/community';
import type {SubjectPhoto} from '../../services/field-guide';

type Tap=WechatMiniprogram.TouchEvent;
Page({
  data:{ids:[] as string[],candidates:[] as string[],subject:null as SubjectPhoto|null,term:'',matches:[] as any[],notice:''},
  onLoad(options:Record<string,string|undefined>){
    const ids=(options.ids||'').split(',').filter(id=>/^[a-zA-Z0-9_-]{1,100}$/.test(id)).slice(0,3);
    this.setData({ids,candidates:options.select==='1'?ids:[]});
    this.getOpenerEventChannel?.().on?.('subject',(subject:SubjectPhoto)=>this.setData({subject}));
  },
  input(event:WechatMiniprogram.CustomEvent<{value:string}>){this.setData({term:event.detail.value});},
  async search(){const q=this.data.term.trim();if(!q)return;
    try{const result=await api('/api/v1/species','GET',{q,limit:10});this.setData({matches:result.items,notice:result.items.length?'':'没有匹配的鸟种。'});}
    catch{this.setData({notice:'搜索失败，请重试。'});}},
  add(event:Tap){const id=String(event.currentTarget.dataset.id);const ids=this.data.ids;
    if(!ids.includes(id)&&ids.length<3)this.setData({ids:ids.concat(id),matches:[],term:'',notice:''});},
  remove(event:Tap){this.setData({ids:this.data.ids.filter(id=>id!==event.currentTarget.dataset.id)});},
  detail(event:Tap){hub('species',event.currentTarget.dataset.id);},
  choose(event:Tap){const id=String(event.currentTarget.dataset.id);if(!this.data.candidates.includes(id))return;
    this.getOpenerEventChannel?.().emit?.('choose',{id});wx.navigateBack();}
});
