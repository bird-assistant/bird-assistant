import {speciesSearch} from '../../services/species-search';
const searches=new WeakMap<object,ReturnType<typeof speciesSearch>>();
const guideVisits=new WeakSet<object>();
Component({
  properties:{placeholder:{type:String,value:'输入中文名、英文名或学名'},selectedIds:{type:Array,value:[] as string[]},showGuide:{type:Boolean,value:false}},
  data:{above:false,query:'',matches:[] as Array<{id:string;name?:string;english?:string;scientific?:string;chosen?:boolean}>,searching:false,searchError:'',searchMore:false,listHeight:220},
  lifetimes:{attached(){searches.set(this,speciesSearch(state=>{if(searches.has(this))this.setData({...state,matches:state.matches.map(row=>({...row,chosen:(this.data.selectedIds as string[]).includes(row.id)}))});}));this.resizeResults();},detached(){const query=searches.get(this);searches.delete(this);query?.close();}},
  pageLifetimes:{
    hide(){if(!guideVisits.has(this))searches.get(this)?.close();},
    show(){guideVisits.delete(this);},
    resize(){this.resizeResults();}
  },
  methods:{
    resizeResults(){const height=wx.getWindowInfo().windowHeight;this.setData({listHeight:Math.max(88,Math.min(240,Math.floor(height*.32)))});
      if(typeof wx.createSelectorQuery==='function')wx.createSelectorQuery().in(this).select('.search-field').boundingClientRect(rect=>{
        if(!searches.has(this))return;const box=rect as WechatMiniprogram.BoundingClientRectCallbackResult;if(!box)return;
        const below=height-box.bottom-66,above=box.top-100,up=below<120&&above>below;
        this.setData({above:up,listHeight:Math.max(60,Math.min(240,Math.floor(up?above:below)))});
      }).exec();},
    input(event:WechatMiniprogram.CustomEvent<{value:string}>){this.setData({query:event.detail.value});this.resizeResults();searches.get(this)?.input(event.detail.value);},
    search(){void searches.get(this)?.search(this.data.query);},
    more(){void searches.get(this)?.more();},
    clear(){this.setData({query:''});searches.get(this)?.close();},
    close(){searches.get(this)?.close();wx.hideKeyboard?.();},
    openGuide(event:WechatMiniprogram.TouchEvent){
      const id=event.currentTarget.dataset.id;
      if(!this.data.showGuide||guideVisits.has(this)||!this.data.matches.some(bird=>bird.id===id))return;
      guideVisits.add(this);
      wx.navigateTo({
        url:'/field/hub/index?screen=species&id='+encodeURIComponent(id),
        fail:()=>{
          guideVisits.delete(this);
          wx.showToast({title:'鸟种资料暂时无法打开',icon:'none'});
        }
      });
    },
    select(event:WechatMiniprogram.TouchEvent){const id=String(event.currentTarget.dataset.id);if((this.data.selectedIds as string[]).includes(id))return;
      const row=this.data.matches.find(item=>item.id===id);if(!row)return;
      this.triggerEvent('select',{id:row.id,name:row.name||row.english||row.scientific||'',scientific:row.scientific||''});this.clear();wx.hideKeyboard?.();}
  }
});
