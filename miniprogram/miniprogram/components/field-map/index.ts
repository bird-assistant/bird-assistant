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
type MarkerTarget={group:Cluster;query:Record<string,unknown>;zoom:number};
const targets=new WeakMap<object,Map<number,MarkerTarget>>();
Component({
  data:{mapMoving:false,_restoreExpanded:true,sheetCollapsed:false,recordsLoading:false,recordsError:'',_recordSeq:0,_moving:false,_motionTimer:0,_nextMarkerId:0,_recordQuery:{} as Record<string,unknown>,searchHeight:176,drawerWidth:366,searchMore:false,headerHeight:88,fieldHeight:600,toolbarHeight:112,mapHeight:488,sheetHeight:224,sheetHeaderHeight:64,creditReserve:36,compact:false,listHeight:160,listTotal:0,listTitle:'本区域观察',wide:false,searching:false,searchError:'',_searchSeq:0,_visible:true,_seq:0,_viewRead:0,_viewKey:'',_ready:false,_timer:0,_zoom:4,_groups:[] as Cluster[],_query:{} as Record<string,unknown>,_bounds:{} as Partial<Bounds>,cursor:'',listOpen:false,latitude:39.92,longitude:116.4,scale:4,scope:0,scopes:['公开与我的','公开鸟讯','我的标记'],
    origin:0,origins:['全部来源','羽迹鸟友','外部鸟讯'],period:0,periods:['所有日期','今天','近七天','近三十天'],keyword:'',species:'',speciesLabel:'所有鸟种',matches:[] as any[],
    markers:[] as Array<{id:number;latitude:number;longitude:number;iconPath:string;width:number;height:number}>,selected:[] as Pin[],total:0,error:'',loading:false,dirty:false},
  lifetimes:{attached(){const view=readMapView();if(view)this.setData(view);},ready(){this.resizeMap();if(wx.nextTick)wx.nextTick(()=>void this.load());else void this.load();},detached(){this.suspend();searches.delete(this);targets.delete(this);this.data._ready=false;}},
  pageLifetimes:{resize(){this.resizeMap();this.queueLoad();},hide(){this.suspend();},show(){this.data._visible=true;const focus=takeMapFocus();if(focus){this.closeList();this.setData({...focus,scale:10,origin:0,period:0},()=>wx.nextTick(()=>void this.load()));}else if(this.data._ready)void this.load();}},
  methods:{
    suspend(){this.data._visible=false;this.data._moving=false;searches.get(this)?.close();this.data._viewRead++;this.data._seq++;this.data._recordSeq++;this.data._searchSeq++;clearTimeout(this.data._timer);clearTimeout(this.data._motionTimer);this.data._timer=0;this.data._motionTimer=0;this.setData({mapMoving:false,loading:false,recordsLoading:false,searching:false,matches:[],searchError:''});},
    resizeMap(){const box=layout();this.setData({headerHeight:box.headerHeight,...mapPanes(box.width,box.height)});},
    query(){let query=searches.get(this);if(!query){query=speciesSearch(state=>{if(this.data._visible)this.setData(state);});searches.set(this,query);}return query;},
    moreSpecies(){void this.query().more();},
    closeSearch(){searches.get(this)?.close();this.data._searchSeq++;this.setData({matches:[],searching:false,searchError:''});wx.hideKeyboard?.();},
    clearSpecies(){this.closeSearch();this.setData({species:'',keyword:'',speciesLabel:'所有鸟种'});void this.load();},
    closeList(){this.data._recordSeq++;this.setData({listOpen:false,sheetCollapsed:false,selected:[],cursor:'',recordsLoading:false,recordsError:''});},
    expandList(){this.data._restoreExpanded=this.data.sheetCollapsed;this.setData({sheetCollapsed:!this.data.sheetCollapsed});},
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
      clearTimeout(this.data._timer);this.data._timer=0;
      return this.updateViewport(true);
    },
    async updateViewport(force:boolean){
      if(!this.data._visible)return;
      const read=++this.data._viewRead;
      let seq=0;
      try{
        const map=wx.createMapContext('field-map',this);
        const viewport=await Promise.all([
          new Promise<WechatMiniprogram.GetRegionSuccessCallbackResult>((resolve,reject)=>map.getRegion({success:resolve,fail:reject})),
          new Promise<number>((resolve,reject)=>map.getScale({success:value=>resolve(value.scale),fail:reject})),
          new Promise<{latitude:number;longitude:number}|null>(resolve=>{if(typeof map.getCenterLocation==='function')map.getCenterLocation({success:resolve,fail:()=>resolve(null)});else resolve(null);})
        ]);
        if(read!==this.data._viewRead||!this.data._visible)return;
        const region=viewport[0],scale=viewport[1],center=viewport[2];
        if(center)saveMapView({...center,scale});
        const days=[0,1,7,30][this.data.period];const data={minLatitude:region.southwest.latitude,minLongitude:region.southwest.longitude,
          maxLatitude:region.northeast.latitude,maxLongitude:region.northeast.longitude,coordinateSystem:'GCJ-02',scope:['all','public','mine'][this.data.scope],
          origin:['all','local','external'][this.data.origin],speciesId:this.data.species,startDate:days?beijingDate(new Date(Date.now()-(days-1)*86400000).toISOString()):'',endDate:days?beijingDate():''};
        const zoom=Math.max(3,Math.min(20,Math.round(scale)));
        const key=JSON.stringify({...data,zoom});
        if(!force&&key===this.data._viewKey){
          // Even a gesture ending at the same coordinates restores the sheet.
          if(this.data.listOpen&&this.data._restoreExpanded&&!this.data._moving&&this.data.sheetCollapsed&&!this.data.recordsLoading){
            this.data._bounds={};this.setData({listTitle:'本区域观察'});void this.showRecords(false);
          }
          return;
        }
        this.data._viewKey=key;
        seq=++this.data._seq;
        this.data._query=data;this.data._zoom=zoom;
        this.setData({loading:true,dirty:true,error:''});
        if(this.data.listOpen){this.data._bounds={};this.setData({listTitle:'本区域观察'});void this.showRecords(false);}
        const res=await api(observations,'GET',{...data,zoom});
        if(seq!==this.data._seq)return;
        this.data._groups=res.clusters;
        const previous=targets.get(this)||new Map<number,MarkerTarget>(),next=new Map<number,MarkerTarget>();
        const markers=this.data._groups.map((group,index)=>{const marker=clusterMarker(group,index,zoom),id=++this.data._nextMarkerId;next.set(id,{group,query:data,zoom});return {...marker,id};});
        // Keep one native render's targets during the bridge handover. A tap
        // always uses the filters belonging to the marker the user actually saw.
        const oldTargets=this.data.markers.length?[...previous.entries()].slice(-this.data.markers.length):[];
        targets.set(this,new Map(oldTargets.concat([...next.entries()])));
        this.setData({total:res.total,markers,dirty:false});
      }catch{
        if(seq ? seq===this.data._seq : read===this.data._viewRead){
          this.data._viewKey='';
          this.setData({dirty:true,error:'地图记录加载失败，请重试。'});
        }
      }finally{if(seq&&seq===this.data._seq)this.setData({loading:false});}
    },
    queueLoad(delay=100){
      if(!this.data._visible||this.data._timer)return;
      // Throttle, do not debounce: native 'updated' events must not postpone
      // the viewport read indefinitely while zooming or rendering markers.
      this.data._timer=setTimeout(()=>{this.data._timer=0;void this.updateViewport(false);},delay);
    },
    pollMotion(){
      if(!this.data._moving||!this.data._visible)return;
      this.queueLoad(0);
      this.data._motionTimer=setTimeout(()=>this.pollMotion(),160);
    },
    moved(event:WechatMiniprogram.CustomEvent){
      if(!this.data._ready||!this.data._visible)return;
      const type=event.detail?.type||event.type,cause=event.detail?.causedBy||(event as unknown as {causedBy?:string}).causedBy;
      if(type==='begin'){
        this.closeSearch();
        if(cause!=='update'){
          if(!this.data._moving)this.data._restoreExpanded=!this.data.sheetCollapsed;
          this.data._moving=true;this.data._viewRead++;this.data._seq++;this.data._viewKey='';this.data._recordSeq++;
          if(this.data.listOpen){this.data._bounds={};this.setData({mapMoving:true,sheetCollapsed:true,recordsLoading:false,listTitle:'本区域观察',cursor:''});}
          clearTimeout(this.data._motionTimer);this.pollMotion();
        }
      }else if(type==='end'){
        this.data._moving=false;this.setData({mapMoving:false});clearTimeout(this.data._motionTimer);this.data._motionTimer=0;
        clearTimeout(this.data._timer);this.data._timer=0;
        this.data._viewRead++;
        this.queueLoad(30);
      }
    },
    mapUpdated(){
      if(this.data._ready&&!this.data.error)this.queueLoad();
    },
    filter(event:Input){const key=event.currentTarget.dataset.field;this.setData({[key]:Number(event.detail.value)});void this.load();},
    input(event:Input){this.setData({keyword:event.detail.value});this.query().input(event.detail.value);},
    search(){if(!this.data.keyword.trim()){this.clearSpecies();return;}return this.query().search(this.data.keyword);},
    species(event:WechatMiniprogram.TouchEvent){this.closeSearch();this.setData({species:event.currentTarget.dataset.id,speciesLabel:event.currentTarget.dataset.name,keyword:event.currentTarget.dataset.id?event.currentTarget.dataset.name:''});void this.load();},
    marker(event:WechatMiniprogram.CustomEvent<{markerId:number}>){
      const target=targets.get(this)?.get(event.detail.markerId);
      if(!target)return;
      const {group,query,zoom}=target;
      this.closeSearch();
      if(zoom<20 && (group.minLatitude!==group.maxLatitude||group.minLongitude!==group.maxLongitude)){
        this.setData({latitude:group.latitude,longitude:group.longitude,scale:Math.min(20,zoom+2)},()=>this.queueLoad());return;
      }
      const {minLatitude,maxLatitude,minLongitude,maxLongitude}=group;
      this.data._restoreExpanded=true;this.data._recordQuery=query;this.data._bounds={minLatitude,maxLatitude,minLongitude,maxLongitude};this.setData({listOpen:true,sheetCollapsed:false,listTotal:group.count,listTitle:'此位置观察'});void this.showRecords(false,true);
    },
    async showRecords(append:boolean,marker=false){
      if(append&&this.data.recordsLoading)return;
      if(!append&&!marker&&!Object.keys(this.data._bounds).length)this.data._recordQuery=this.data._query;
      const seq=++this.data._recordSeq;this.setData({recordsLoading:true,listOpen:true,recordsError:'',...(!append?{selected:[],cursor:''}: {})});
      try{const res=await api(observations,'GET',{...this.data._recordQuery,...this.data._bounds,cursor:append?this.data.cursor:'',limit:60});
        if(seq===this.data._recordSeq&&this.data._visible)this.setData({selected:append?Array.from(new Map(this.data.selected.concat(res.items).map((row:Pin)=>[row.id,row])).values()):res.items,cursor:res.nextCursor,listTotal:res.total??this.data.listTotal,...(!this.data._moving?{sheetCollapsed:!this.data._restoreExpanded}:{})});
      }catch{if(seq===this.data._recordSeq&&this.data._visible)this.setData({recordsError:'记录加载失败，请重试。',...(!this.data._moving?{sheetCollapsed:!this.data._restoreExpanded}:{})});}finally{if(seq===this.data._recordSeq&&this.data._visible)this.setData({recordsLoading:false});}
    },
    more(){if(this.data.cursor&&!this.data.recordsLoading)void this.showRecords(true);},
    list(){if(this.data.listOpen){this.closeList();return;}this.closeSearch();this.data._restoreExpanded=true;this.data._bounds={};this.setData({sheetCollapsed:false,listTotal:this.data.total,listTitle:'本区域观察'});void this.showRecords(false);},
    guide(event:WechatMiniprogram.TouchEvent){hub('species',event.currentTarget.dataset.id||this.data.species);},
    go(event:WechatMiniprogram.TouchEvent){hub('record',event.currentTarget.dataset.id);},
    async position(){try{const point=await wx.getLocation({type:'gcj02'});this.setData({latitude:point.latitude,longitude:point.longitude,scale:11},()=>this.queueLoad());}catch{this.setData({error:'定位不可用，可拖动地图选区。'});}},
    async place(){this.closeSearch();try{const point=await wx.chooseLocation({});this.setData({latitude:point.latitude,longitude:point.longitude,scale:12},()=>this.queueLoad());}catch(error){if(!/cancel/i.test(String((error as {errMsg?:string})?.errMsg)))this.setData({error:'地点选择未完成，可拖动地图选区。'});}}
  }
});
