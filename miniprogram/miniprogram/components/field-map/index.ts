import {api,hub,takeMapFocus} from '../../services/community';
import {beijingDate} from '../../services/observation-context';

interface Pin {id:string;speciesId:string;speciesName:string;source:string;placeName:string;date:string;displayLocation:{latitude:number;longitude:number};}
type Input=WechatMiniprogram.CustomEvent<{value:string}>;
Component({
  data:{_seq:0,_ready:false,_groups:[] as Pin[][],latitude:39.92,longitude:116.4,scale:4,scope:0,scopes:['公开与我的','公开鸟讯','我的标记'],
    origin:0,origins:['全部来源','羽迹鸟友','外部鸟讯'],period:0,periods:['所有日期','今天','近七天','近三十天'],keyword:'',species:'',speciesLabel:'所有鸟种',matches:[] as any[],
    markers:[] as Array<{id:number;latitude:number;longitude:number;iconPath:string;width:number;height:number}>,items:[] as Pin[],selected:[] as Pin[],total:0,error:'',loading:false,dirty:false},
  lifetimes:{ready(){void this.load();},detached(){this.data._seq++;}},
  pageLifetimes:{show(){const focus=takeMapFocus();if(focus){this.setData({...focus,scale:10,origin:0,period:0},()=>wx.nextTick(()=>void this.load()));}else if(this.data._ready)void this.load();}},
  methods:{
    async planTrip(){
      try{
        const map=wx.createMapContext('field-map',this);
        const center=await new Promise<WechatMiniprogram.GetCenterLocationSuccessCallbackResult>((resolve,reject)=>map.getCenterLocation({success:resolve,fail:reject}));
        const latitude=center.latitude.toFixed(1),longitude=center.longitude.toFixed(1);
        wx.navigateTo({url:`/field/trip/index?lat=${latitude}&lon=${longitude}&species=${encodeURIComponent(this.data.species)}&label=${encodeURIComponent(this.data.speciesLabel)}`});
      }catch{wx.navigateTo({url:'/field/trip/index'});}
    },
    async load(){
      this.data._ready=true;const seq=this.data._seq=(this.data._seq||0)+1;this.setData({loading:true,error:'',selected:[]});
      try{
        const map=wx.createMapContext('field-map',this);
        const region=await new Promise<WechatMiniprogram.GetRegionSuccessCallbackResult>((resolve,reject)=>map.getRegion({success:resolve,fail:reject}));
        const days=[0,1,7,30][this.data.period];const data={minLatitude:region.southwest.latitude,minLongitude:region.southwest.longitude,
          maxLatitude:region.northeast.latitude,maxLongitude:region.northeast.longitude,coordinateSystem:'GCJ-02',scope:['all','public','mine'][this.data.scope],
          origin:['all','local','external'][this.data.origin],speciesId:this.data.species,startDate:days?beijingDate(new Date(Date.now()-(days-1)*86400000).toISOString()):'',endDate:days?beijingDate():''};
        const items:Pin[]=[];let cursor='',total=0;
        do{const res=await api('/api/v1/map/observations','GET',{...data,cursor,limit:60});if(seq!==this.data._seq)return;
          items.push(...res.items);cursor=res.nextCursor;total=res.total;}while(cursor&&items.length<300);
        const groups=new Map<string,Pin[]>();
        for(const item of items){const point=item.displayLocation,key=point.latitude+','+point.longitude;
          const group=groups.get(key)||[];group.push(item);groups.set(key,group);}
        this.data._groups=Array.from(groups.values());
        const markers=this.data._groups.map((group,index)=>({id:index+1,...group[0].displayLocation,iconPath:'/assets/icons/pin.png',width:28,height:32,
          callout:{content:group.length>1?group.length+' 条':group[0].speciesName,display:'ALWAYS' as const,padding:4,borderRadius:5}}));
        this.setData({items,total,markers,dirty:false});
      }catch{if(seq===this.data._seq)this.setData({error:'地图记录加载失败，请重试。'});}finally{if(seq===this.data._seq)this.setData({loading:false});}
    },
    moved(event:WechatMiniprogram.CustomEvent){if(event.type==='end'||event.detail?.type==='end'){if(event.detail?.causedBy==='drag'||event.detail?.causedBy==='scale'){this.data._seq++;this.setData({dirty:true,loading:false});}}},
    filter(event:Input){const key=event.currentTarget.dataset.field;this.setData({[key]:Number(event.detail.value)});void this.load();},
    input(event:Input){this.setData({keyword:event.detail.value});},
    async search(){try{const res=await api('/api/v1/species','GET',{q:this.data.keyword,limit:12});this.setData({matches:[{id:'',name:'所有鸟种'},...res.items]});}catch{this.setData({error:'搜索失败，请重试'});}},
    species(event:WechatMiniprogram.TouchEvent){this.setData({species:event.currentTarget.dataset.id,speciesLabel:event.currentTarget.dataset.name,matches:[]});void this.load();},
    marker(event:WechatMiniprogram.CustomEvent<{markerId:number}>){this.setData({selected:this.data._groups?.[event.detail.markerId-1]||[]});},
    list(){this.setData({selected:this.data.selected.length?[]:this.data.items});},
    guide(event:WechatMiniprogram.TouchEvent){hub('species',event.currentTarget.dataset.id);},
    go(event:WechatMiniprogram.TouchEvent){hub('record',event.currentTarget.dataset.id);},
    async position(){try{const point=await wx.getLocation({type:'gcj02'});this.setData({latitude:point.latitude,longitude:point.longitude,scale:11,dirty:true});}catch{this.setData({error:'定位不可用，可拖动地图选区。'});}},
    async place(){try{const point=await wx.chooseLocation({});this.setData({latitude:point.latitude,longitude:point.longitude,scale:12,dirty:true});}catch{this.setData({dirty:true});}}
  }
});
