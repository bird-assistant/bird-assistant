import {api,hub,takeMapFocus} from '../../services/community';
import {beijingDate} from '../../services/observation-context';
import {layout} from '../../services/layout';
import {readMapView,saveMapView} from '../../services/map-view';
import {speciesSearch} from '../../services/species-search';
import {mapPanes,clusterMarker} from '../../services/map-presentation';

interface Pin {id:string;speciesId:string;speciesName:string;source:string;placeName:string;date:string;displayLocation:{latitude:number;longitude:number};}
type Input=WechatMiniprogram.CustomEvent<{value:string}>;
type Bounds={minLatitude:number;maxLatitude:number;minLongitude:number;maxLongitude:number};
type Cluster=Bounds & {latitude:number;longitude:number;count:number};
const observations='/api/v1/map/observations';
const searches=new WeakMap<object,ReturnType<typeof speciesSearch>>();
Component({
  data:{searchHeight:176,drawerWidth:390,searchMore:false,headerHeight:88,fieldHeight:600,toolbarHeight:112,mapHeight:488,sheetHeight:325,sheetHeaderHeight:64,creditReserve:36,compact:false,listHeight:249,listTotal:0,listTitle:'本区域观察',wide:false,searching:false,searchError:'',_searchSeq:0,_visible:true,_seq:0,_viewRead:0,_viewKey:'',_ready:false,_timer:0,_zoom:4,_groups:[] as Cluster[],_query:{} as Record<string,unknown>,_bounds:{} as Partial<Bounds>,cursor:'',listOpen:false,latitude:39.92,longitude:116.4,scale:4,scope:0,scopes:['公开与我的','公开鸟讯','我的标记'],
    origin:0,origins:['全部来源','羽迹鸟友','外部鸟讯'],period:0,periods:['所有日期','今天','近七天','近三十天'],keyword:'',species:'',speciesLabel:'所有鸟种',matches:[] as any[],
    markers:[] as Array<{id:number;latitude:number;longitude:number;iconPath:string;width:number;height:number}>,selected:[] as Pin[],total:0,error:'',loading:false,dirty:false},
  lifetimes:{attached(){const view=readMapView();if(view)this.setData(view);},ready(){this.resizeMap();if(wx.nextTick)wx.nextTick(()=>void this.load());else void this.load();},detached(){this.data._visible=false;searches.get(this)?.close();searches.delete(this);this.data._searchSeq++;this.data._ready=false;this.data._viewRead++;this.data._seq++;clearTimeout(this.data._timer);}},
  pageLifetimes:{resize(){this.resizeMap();this.queueLoad();},hide(){this.data._visible=false;searches.get(this)?.close();this.data._viewRead++;this.data._seq++;this.data._searchSeq++;clearTimeout(this.data._timer);this.setData({loading:false,searching:false,matches:[],searchError:''});},show(){this.data._visible=true;const focus=takeMapFocus();if(focus){this.setData({...focus,scale:10,origin:0,period:0},()=>wx.nextTick(()=>void this.load()));}else if(this.data._ready)void this.load();}},
  methods:{
    resizeMap(){const box=layout();this.setData({headerHeight:box.headerHeight,...mapPanes(box.width,box.height)});},
    query(){let query=searches.get(this);if(!query){query=speciesSearch(state=>{if(this.data._visible)this.setData(state);});searches.set(this,query);}return query;},
    moreSpecies(){void this.query().more();},
    closeSearch(){searches.get(this)?.close();this.data._searchSeq++;this.setData({matches:[],searching:false,searchError:''});wx.hideKeyboard?.();},
    clearSpecies(){this.closeSearch();this.setData({species:'',keyword:'',speciesLabel:'所有鸟种'});void this.load();},
    closeList(){this.data._seq++;this.setData({listOpen:false,selected:[],cursor:'',loading:false,error:''});},
    retryRecords(){void this.showRecords(false);},
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
      if(this.data.listOpen){this.closeList();return new Promise<void>(done=>{const run=()=>void this.updateViewport(true).then(()=>done());if(wx.nextTick)wx.nextTick(run);else run();});}
      clearTimeout(this.data._timer);
      return this.updateViewport(true);
    },
    async updateViewport(force:boolean){
      if(this.data.listOpen)return;
      const read=++this.data._viewRead;
      let seq=0;
      try{
        const map=wx.createMapContext('field-map',this);
        const viewport=await Promise.all([
          new Promise<WechatMiniprogram.GetRegionSuccessCallbackResult>((resolve,reject)=>map.getRegion({success:resolve,fail:reject})),
          new Promise<number>((resolve,reject)=>map.getScale({success:value=>resolve(value.scale),fail:reject})),
          new Promise<{latitude:number;longitude:number}|null>(resolve=>{if(typeof map.getCenterLocation==='function')map.getCenterLocation({success:resolve,fail:()=>resolve(null)});else resolve(null);})
        ]);
        if(read!==this.data._viewRead)return;
        const region=viewport[0],scale=viewport[1],center=viewport[2];
        if(center)saveMapView({...center,scale});
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
        const markers=this.data._groups.map(clusterMarker);
        this.setData({total:res.total,markers,dirty:false});
      }catch{
        if(seq ? seq===this.data._seq : read===this.data._viewRead){
          this.data._viewKey='';
          this.setData({dirty:true,error:'地图记录加载失败，请重试。'});
        }
      }finally{if(seq&&seq===this.data._seq)this.setData({loading:false});}
    },
    queueLoad(){
      if(!this.data._visible)return;
      clearTimeout(this.data._timer);
      this.data._viewRead++;
      this.data._timer=setTimeout(()=>void this.updateViewport(false),260);
    },
    moved(event:WechatMiniprogram.CustomEvent){
      if(event.type==='begin'||event.detail?.type==='begin')this.closeSearch();
      if(this.data._ready && (event.type==='end'||event.detail?.type==='end')){const cause=event.detail?.causedBy||(event as unknown as {causedBy:string}).causedBy;if(this.data.listOpen){if(cause==='drag'||cause==='scale')this.closeList();else return;}this.queueLoad();}
    },
    mapUpdated(){
      if(this.data._ready&&!this.data.error&&!this.data.listOpen)this.queueLoad();
    },
    filter(event:Input){const key=event.currentTarget.dataset.field;this.setData({[key]:Number(event.detail.value)});void this.load();},
    input(event:Input){this.setData({keyword:event.detail.value});this.query().input(event.detail.value);},
    search(){if(!this.data.keyword.trim()){this.clearSpecies();return;}return this.query().search(this.data.keyword);},
    species(event:WechatMiniprogram.TouchEvent){this.closeSearch();this.setData({species:event.currentTarget.dataset.id,speciesLabel:event.currentTarget.dataset.name,keyword:event.currentTarget.dataset.id?event.currentTarget.dataset.name:''});void this.load();},
    marker(event:WechatMiniprogram.CustomEvent<{markerId:number}>){
      const group=this.data._groups[event.detail.markerId-1];if(!group||this.data.dirty)return;
      this.closeSearch();
      if(this.data._zoom<20 && (group.minLatitude!==group.maxLatitude||group.minLongitude!==group.maxLongitude)){
        this.setData({latitude:group.latitude,longitude:group.longitude,scale:Math.min(20,this.data._zoom+2)},()=>this.queueLoad());return;
      }
      const {minLatitude,maxLatitude,minLongitude,maxLongitude}=group;
      this.data._bounds={minLatitude,maxLatitude,minLongitude,maxLongitude};this.setData({listTotal:group.count,listTitle:'此位置观察'});void this.showRecords(false);
    },
    async showRecords(append:boolean){
      if(append&&this.data.loading)return;
      const seq=++this.data._seq;this.setData({loading:true,listOpen:true,error:'',...(!append?{selected:[]}: {})});
      try{const res=await api(observations,'GET',{...this.data._query,...this.data._bounds,cursor:append?this.data.cursor:'',limit:60});
        if(seq===this.data._seq)this.setData({selected:append?Array.from(new Map(this.data.selected.concat(res.items).map((row:Pin)=>[row.id,row])).values()):res.items,cursor:res.nextCursor,listTotal:res.total??this.data.listTotal});
      }catch{if(seq===this.data._seq)this.setData({error:'记录加载失败，请重试。'});}finally{if(seq===this.data._seq)this.setData({loading:false});}
    },
    more(){if(this.data.cursor&&!this.data.loading)void this.showRecords(true);},
    list(){if(this.data.listOpen){this.closeList();return;}this.closeSearch();this.data._bounds={};this.setData({listTotal:this.data.total,listTitle:'本区域观察'});void this.showRecords(false);},
    guide(event:WechatMiniprogram.TouchEvent){hub('species',event.currentTarget.dataset.id||this.data.species);},
    go(event:WechatMiniprogram.TouchEvent){hub('record',event.currentTarget.dataset.id);},
    async position(){try{const point=await wx.getLocation({type:'gcj02'});this.setData({latitude:point.latitude,longitude:point.longitude,scale:11},()=>this.queueLoad());}catch{this.setData({error:'定位不可用，可拖动地图选区。'});}},
    async place(){this.closeSearch();try{const point=await wx.chooseLocation({});this.setData({latitude:point.latitude,longitude:point.longitude,scale:12},()=>this.queueLoad());}catch(error){if(!/cancel/i.test(String((error as {errMsg?:string})?.errMsg)))this.setData({error:'地点选择未完成，可拖动地图选区。'});}}
  }
});
