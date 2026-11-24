import {api,hub,takeMapFocus} from '../../services/community';
import {beijingDate} from '../../services/observation-context';

interface Pin {id:string;speciesId:string;speciesName:string;source:string;placeName:string;date:string;displayLocation:{latitude:number;longitude:number};}
type Input=WechatMiniprogram.CustomEvent<{value:string}>;
type Bounds={minLatitude:number;maxLatitude:number;minLongitude:number;maxLongitude:number};
type Cluster=Bounds & {latitude:number;longitude:number;count:number};
const observations='/api/v1/map/observations';
Component({
  data:{_seq:0,_viewRead:0,_viewKey:'',_ready:false,_timer:0,_zoom:4,_groups:[] as Cluster[],_query:{} as Record<string,unknown>,_bounds:{} as Partial<Bounds>,cursor:'',listOpen:false,latitude:39.92,longitude:116.4,scale:4,scope:0,scopes:['公开与我的','公开鸟讯','我的标记'],
    origin:0,origins:['全部来源','羽迹鸟友','外部鸟讯'],period:0,periods:['所有日期','今天','近七天','近三十天'],keyword:'',species:'',speciesLabel:'所有鸟种',matches:[] as any[],
    markers:[] as Array<{id:number;latitude:number;longitude:number;iconPath:string;width:number;height:number}>,selected:[] as Pin[],total:0,error:'',loading:false,dirty:false},
  lifetimes:{ready(){void this.load();},detached(){this.data._ready=false;this.data._viewRead++;this.data._seq++;clearTimeout(this.data._timer);}},
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
    load(){
      this.data._ready=true;
      clearTimeout(this.data._timer);
      return this.updateViewport(true);
    },
    async updateViewport(force:boolean){
      const read=++this.data._viewRead;
      let seq=0;
      try{
        const map=wx.createMapContext('field-map',this);
        const viewport=await Promise.all([
          new Promise<WechatMiniprogram.GetRegionSuccessCallbackResult>((resolve,reject)=>map.getRegion({success:resolve,fail:reject})),
          new Promise<number>((resolve,reject)=>map.getScale({success:value=>resolve(value.scale),fail:reject}))
        ]);
        if(read!==this.data._viewRead)return;
        const region=viewport[0],scale=viewport[1];
        const days=[0,1,7,30][this.data.period];const data={minLatitude:region.southwest.latitude,minLongitude:region.southwest.longitude,
          maxLatitude:region.northeast.latitude,maxLongitude:region.northeast.longitude,coordinateSystem:'GCJ-02',scope:['all','public','mine'][this.data.scope],
          origin:['all','local','external'][this.data.origin],speciesId:this.data.species,startDate:days?beijingDate(new Date(Date.now()-(days-1)*86400000).toISOString()):'',endDate:days?beijingDate():''};
        const zoom=Math.max(3,Math.min(20,Math.round(scale)));
        const key=JSON.stringify({...data,zoom});
        if(!force&&key===this.data._viewKey)return;
        this.data._viewKey=key;
        seq=++this.data._seq;
        this.setData({loading:true,dirty:true,error:'',selected:[],listOpen:false,cursor:''});
        const res=await api(observations,'GET',{...data,zoom});
        if(seq!==this.data._seq)return;
        this.data._query=data;this.data._zoom=zoom;this.data._groups=res.clusters;
        const markers=this.data._groups.map((group,index)=>({id:index+1,latitude:group.latitude,longitude:group.longitude,iconPath:'/assets/icons/pin.png',width:28,height:32,
          callout:{content:group.count+' 条',display:'ALWAYS' as const,padding:4,borderRadius:5}}));
        this.setData({total:res.total,markers,dirty:false});
      }catch{
        if(seq ? seq===this.data._seq : read===this.data._viewRead){
          this.data._viewKey='';
          this.setData({dirty:true,error:'地图记录加载失败，请重试。'});
        }
      }finally{if(seq&&seq===this.data._seq)this.setData({loading:false});}
    },
    queueLoad(){
      clearTimeout(this.data._timer);
      this.data._viewRead++;
      this.data._timer=setTimeout(()=>void this.updateViewport(false),260);
    },
    moved(event:WechatMiniprogram.CustomEvent){
      if(this.data._ready && (event.type==='end'||event.detail?.type==='end'))this.queueLoad();
    },
    mapUpdated(){
      if(this.data._ready&&!this.data.error)this.queueLoad();
    },
    filter(event:Input){const key=event.currentTarget.dataset.field;this.setData({[key]:Number(event.detail.value)});void this.load();},
    input(event:Input){this.setData({keyword:event.detail.value});},
    async search(){try{const res=await api('/api/v1/species','GET',{q:this.data.keyword,limit:12});this.setData({matches:[{id:'',name:'所有鸟种'},...res.items]});}catch{this.setData({error:'搜索失败，请重试'});}},
    species(event:WechatMiniprogram.TouchEvent){this.setData({species:event.currentTarget.dataset.id,speciesLabel:event.currentTarget.dataset.name,matches:[]});void this.load();},
    marker(event:WechatMiniprogram.CustomEvent<{markerId:number}>){
      const group=this.data._groups[event.detail.markerId-1];if(!group||this.data.dirty)return;
      if(this.data._zoom<20 && (group.minLatitude!==group.maxLatitude||group.minLongitude!==group.maxLongitude)){
        this.setData({latitude:group.latitude,longitude:group.longitude,scale:Math.min(20,this.data._zoom+2)},()=>this.queueLoad());return;
      }
      const {minLatitude,maxLatitude,minLongitude,maxLongitude}=group;
      this.data._bounds={minLatitude,maxLatitude,minLongitude,maxLongitude};void this.showRecords(false);
    },
    async showRecords(append:boolean){
      const seq=++this.data._seq;this.setData({loading:true,listOpen:true,error:''});
      try{const res=await api(observations,'GET',{...this.data._query,...this.data._bounds,cursor:append?this.data.cursor:'',limit:60});
        if(seq===this.data._seq)this.setData({selected:append?this.data.selected.concat(res.items):res.items,cursor:res.nextCursor});
      }catch{if(seq===this.data._seq)this.setData({error:'记录加载失败，请重试。'});}finally{if(seq===this.data._seq)this.setData({loading:false});}
    },
    more(){if(this.data.cursor&&!this.data.loading)void this.showRecords(true);},
    list(){if(this.data.listOpen){this.data._seq++;this.setData({listOpen:false,selected:[],loading:false});return;}this.data._bounds={};void this.showRecords(false);},
    guide(event:WechatMiniprogram.TouchEvent){hub('species',event.currentTarget.dataset.id);},
    go(event:WechatMiniprogram.TouchEvent){hub('record',event.currentTarget.dataset.id);},
    async position(){try{const point=await wx.getLocation({type:'gcj02'});this.setData({latitude:point.latitude,longitude:point.longitude,scale:11},()=>this.queueLoad());}catch{this.setData({error:'定位不可用，可拖动地图选区。'});}},
    async place(){try{const point=await wx.chooseLocation({});this.setData({latitude:point.latitude,longitude:point.longitude,scale:12},()=>this.queueLoad());}catch{this.setData({dirty:true});}}
  }
});
