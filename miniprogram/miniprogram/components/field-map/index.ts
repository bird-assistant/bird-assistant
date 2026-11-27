import {navigate} from '../../services/navigation';
import {api,hub,takeMapFocus} from '../../services/community';
import {beijingDate} from '../../services/observation-context';
import {layout} from '../../services/layout';
import {readMapView,saveMapView} from '../../services/map-view';
import {speciesSearch} from '../../services/species-search';
import {spacedClusters} from '../../services/map-clusters';
import {mapPanes,clusterMarker,speciesResultsHeight} from '../../services/map-presentation';
import {MapTargets} from '../../services/map-targets';
import {chinesePlace} from '../../services/place-names';
import {getCanvas} from '../../services/canvas';
import {MapIconCache} from '../../services/map-icons';

interface Pin {id:string;speciesId:string;speciesName:string;source:string;placeName:string;date:string;displayLocation:{latitude:number;longitude:number};}
type Input=WechatMiniprogram.CustomEvent<{value:string}>;
type Bounds={minLatitude:number;maxLatitude:number;minLongitude:number;maxLongitude:number};
type Cluster=Bounds & {latitude:number;longitude:number;count:number};
type Viewport={region:WechatMiniprogram.GetRegionSuccessCallbackResult;scale:number;center:{latitude:number;longitude:number}|null};
const hints=new WeakMap<object,Partial<Viewport>>();
const observations='/api/v1/map/observations';
const searches=new WeakMap<object,ReturnType<typeof speciesSearch>>();
const targets=new WeakMap<object,MapTargets>();
const cellQueries=new WeakMap<object,Record<string,unknown>>();
const icons=new WeakMap<object,MapIconCache>();
Component({
  data:{_iconSeq:0,_locationSeq:0,locating:false,showUserLocation:false,recordOrder:'collected',focusLabel:'',nativeActive:true,_tripSeq:0,_watchTimer:0,mapMoving:false,_restoreExpanded:true,sheetCollapsed:false,recordsLoading:false,recordsError:'',_recordSeq:0,_moving:false,_motionTimer:0,_recordQuery:{} as Record<string,unknown>,searchHeight:176,drawerWidth:366,searchMore:false,headerHeight:88,fieldHeight:600,toolbarHeight:112,mapHeight:488,sheetHeight:224,sheetHeaderHeight:64,creditReserve:0,compact:false,listHeight:160,listTotal:0,listTitle:'本区域观察',wide:false,searching:false,searchError:'',_searchSeq:0,_visible:true,_seq:0,_viewRead:0,_viewKey:'',_ready:false,_timer:0,_zoom:4,_groups:[] as Cluster[],_query:{} as Record<string,unknown>,_bounds:{} as Partial<Bounds>,cursor:'',listOpen:false,latitude:39.92,longitude:116.4,scale:12,scope:0,scopes:['公开与我的','公开鸟讯','我的标记'],
    origin:0,origins:['全部来源','羽迹鸟友','外部鸟讯'],period:0,periods:['所有日期','今天','近七天','近三十天'],keyword:'',species:'',speciesLabel:'所有鸟种',matches:[] as any[],
    markers:[] as Array<{id:number;latitude:number;longitude:number;iconPath:string;width:number;height:number}>,selected:[] as Pin[],total:0,error:'',loading:false,dirty:false},
  lifetimes:{attached(){const view=readMapView();if(view)this.setData(view);},ready(){this.resizeMap();this.watchViewport();if(wx.nextTick)wx.nextTick(()=>void this.load());else void this.load();},detached(){this.suspend();icons.get(this)?.close();icons.delete(this);searches.delete(this);targets.delete(this);cellQueries.delete(this);hints.delete(this);this.data._ready=false;}},
  pageLifetimes:{resize(){this.resizeMap();this.queueLoad();},hide(){this.suspend();},show(){this.data._visible=true;hints.delete(this);const focus=takeMapFocus();if(focus)this.closeList();this.setData({nativeActive:true,...(focus?{...focus,origin:0,period:0}:readMapView()||{})},()=>{this.watchViewport();if(this.data._ready){if(wx.nextTick)wx.nextTick(()=>void this.load());else void this.load();}});}},
  methods:{
    suspend(){this.data._iconSeq++;this.data._locationSeq++;this.data._tripSeq++;clearTimeout(this.data._watchTimer);this.data._watchTimer=0;hints.delete(this);this.data._visible=false;this.data._moving=false;searches.get(this)?.close();this.data._viewRead++;this.data._seq++;this.data._recordSeq++;this.data._searchSeq++;clearTimeout(this.data._timer);clearTimeout(this.data._motionTimer);this.data._timer=0;this.data._motionTimer=0;this.setData({locating:false,nativeActive:false,mapMoving:false,loading:false,recordsLoading:false,searching:false,matches:[],searchError:''});},
    watchViewport(){
      if(!this.data._visible||this.data._watchTimer)return;
      this.data._watchTimer=setTimeout(()=>{this.data._watchTimer=0;if(!this.data._visible)return;void this.updateViewport(false).finally(()=>this.watchViewport());},240);
    },
    renderClusters(scale:number){
      const version=++this.data._iconSeq;
      const groups=spacedClusters(this.data._groups,scale),registry=targets.get(this)||new MapTargets();
      targets.set(this,registry);
      const ids=registry.assign(groups,cellQueries.get(this)||this.data._query,scale);
      let cache=icons.get(this);if(!cache){cache=new MapIconCache(()=>getCanvas(this,'#map-marker-canvas',96,96),path=>{try{wx.getFileSystemManager().unlink({filePath:path,fail:()=>{}});}catch{}});icons.set(this,cache);}
      const markers=groups.map((group,index)=>{const marker={...clusterMarker(group,index,scale),id:ids[index]};const image=marker.anchor&&cache!.get(group.count);return image?{...marker,iconPath:image}:marker;});
      if(JSON.stringify(markers)!==JSON.stringify(this.data.markers))this.setData({markers});
      const counts=groups.filter((_group,index)=>!!markers[index].anchor).map(group=>group.count);
      if(counts.some(count=>!cache!.get(count)))void cache.prepare(counts).then(()=>{
        if(!this.data._visible||version!==this.data._iconSeq)return;
        this.setData({markers:markers.map((marker,index)=>marker.anchor&&cache!.get(groups[index].count)?{...marker,iconPath:cache!.get(groups[index].count)!}:marker)});
      }).catch(()=>{});
    },
    resizeMap(){const box=layout(),panes=mapPanes(box.width,box.height);this.setData({headerHeight:box.headerHeight,...panes,searchHeight:speciesResultsHeight(this.data.matches.length,this.data.searchMore,Math.max(0,panes.mapHeight-36))});},
    query(){let query=searches.get(this);if(!query){query=speciesSearch(state=>{if(this.data._visible)this.setData({...state,searchHeight:speciesResultsHeight(state.matches.length,state.searchMore,Math.max(0,this.data.mapHeight-36))});});searches.set(this,query);}return query;},
    moreSpecies(){void this.query().more();},
    closeSearch(){searches.get(this)?.close();this.data._searchSeq++;this.setData({matches:[],searching:false,searchError:''});wx.hideKeyboard?.();},
    clearSpecies(){this.closeSearch();this.closeList();this.setData({species:'',keyword:'',speciesLabel:'所有鸟种'});void this.load();},
    closeList(){this.data._recordSeq++;this.setData({listOpen:false,sheetCollapsed:false,selected:[],cursor:'',recordsLoading:false,recordsError:''});},
    expandList(){this.data._restoreExpanded=this.data.sheetCollapsed;this.setData({sheetCollapsed:!this.data.sheetCollapsed});},
    retryRecords(){void this.showRecords(false);},
    async planTrip(){
      const token=++this.data._tripSeq;let deadline=0;
      try{
        const map=wx.createMapContext('field-map',this);
        const center=await Promise.race([new Promise<WechatMiniprogram.GetCenterLocationSuccessCallbackResult>((resolve,reject)=>map.getCenterLocation({success:resolve,fail:reject})),new Promise<never>((_resolve,reject)=>{deadline=setTimeout(()=>reject(new Error('native map read timeout')),1800);})]);
        if(!this.data._visible||token!==this.data._tripSeq)return;
        const latitude=center.latitude.toFixed(1),longitude=center.longitude.toFixed(1);
        navigate({url:`/field/trip/index?lat=${latitude}&lon=${longitude}&species=${encodeURIComponent(this.data.species)}&label=${encodeURIComponent(this.data.speciesLabel)}`});
      }catch{if(this.data._visible&&token===this.data._tripSeq)navigate({url:'/field/trip/index'});}finally{clearTimeout(deadline);}
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
        let deadline:ReturnType<typeof setTimeout>=0;
        const viewport=await Promise.race([Promise.all([
          new Promise<WechatMiniprogram.GetRegionSuccessCallbackResult>((resolve,reject)=>map.getRegion({success:resolve,fail:reject})),
          new Promise<number>((resolve,reject)=>map.getScale({success:value=>resolve(value.scale),fail:reject})),
          new Promise<{latitude:number;longitude:number}|null>(resolve=>{if(typeof map.getCenterLocation==='function')map.getCenterLocation({success:resolve,fail:()=>resolve(null)});else resolve(null);})
        ]),new Promise<never>((_resolve,reject)=>{deadline=setTimeout(()=>reject(new Error('native map read timeout')),1800);})]).finally(()=>clearTimeout(deadline));
        if(read!==this.data._viewRead||!this.data._visible)return;
        const hint=hints.get(this),region=hint?.region||viewport[0],scale=hint?.scale??viewport[1],center=hint?.center||viewport[2];
        if(hint&&Math.abs(viewport[1]-scale)<.001)hints.delete(this);
        if(this.data._groups.length&&scale!==this.data._zoom)this.renderClusters(scale);
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
        this.data._query=data;this.data._zoom=scale;
        this.setData({loading:true,dirty:true,error:''});
        if(this.data.listOpen&&!Object.keys(this.data._bounds).length){this.setData({listTitle:'本区域观察'});void this.showRecords(false);}
        const res=await api(observations,'GET',{...data,zoom});
        if(seq!==this.data._seq)return;
        this.data._groups=res.clusters;cellQueries.set(this,data);
        this.renderClusters(scale);
        this.setData({total:res.total,dirty:false});
      }catch{
        if(seq ? seq===this.data._seq : read===this.data._viewRead){
          if(!seq)this.data._seq++;
          this.setData({loading:false,dirty:true,error:'地图记录加载失败，请重试。'});
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
      const detail=event.detail||{},reported=Number(detail.scale);
      if(type==='begin')hints.delete(this);
      if(Number.isFinite(reported)&&reported>=3&&reported<=20){
        const region=detail.region,center=detail.centerLocation;
        hints.set(this,{scale:reported,...(region?{region}:{}),...(center?{center}:{})});
        if(this.data._groups.length)this.renderClusters(reported);
      }
      if(type==='begin'){
        this.closeSearch();
        if(cause!=='update'){
          this.setData({focusLabel:''});
          if(!this.data._moving)this.data._restoreExpanded=!this.data.sheetCollapsed;
          this.data._moving=true;this.data._viewRead++;this.data._seq++;this.data._viewKey='';this.data._recordSeq++;
          if(this.data.listOpen){this.data._bounds={};this.setData({mapMoving:true,sheetCollapsed:true,recordsLoading:false,listTitle:'本区域观察',cursor:''});}
          clearTimeout(this.data._motionTimer);this.pollMotion();
        }
      }else if(type==='end'){
        this.data._moving=false;this.setData({mapMoving:false});clearTimeout(this.data._motionTimer);this.data._motionTimer=0;
        clearTimeout(this.data._timer);this.data._timer=0;
        this.data._viewRead++;
        this.queueLoad(0);
      }else if(hints.has(this))this.queueLoad(0);
    },
    mapUpdated(){
      if(this.data._ready&&!this.data.error)this.queueLoad();
    },
    filter(event:Input){const key=event.currentTarget.dataset.field;this.closeList();this.setData({[key]:Number(event.detail.value)});void this.load();},
    input(event:Input){this.setData({keyword:event.detail.value});this.query().input(event.detail.value);},
    search(){if(!this.data.keyword.trim()){this.clearSpecies();return;}return this.query().search(this.data.keyword);},
    species(event:WechatMiniprogram.TouchEvent){this.closeSearch();this.closeList();this.setData({species:event.currentTarget.dataset.id,speciesLabel:event.currentTarget.dataset.name,keyword:event.currentTarget.dataset.id?event.currentTarget.dataset.name:''});void this.load();},
    marker(event:WechatMiniprogram.CustomEvent<{markerId:number|string}>){
      if(!this.data._visible||!this.data.nativeActive)return;
      const target=targets.get(this)?.get(event.detail.markerId);
      if(!target)return;
      const {group,query,zoom}=target;
      this.closeSearch();
      const {minLatitude,maxLatitude,minLongitude,maxLongitude}=group;
      this.data._restoreExpanded=true;this.data._recordQuery=query;this.data._bounds={minLatitude,maxLatitude,minLongitude,maxLongitude};
      this.setData({listOpen:true,sheetCollapsed:false,mapMoving:false,listTotal:group.count,listTitle:'此位置观察'});void this.showRecords(false,true);
      if(zoom<20 && (group.minLatitude!==group.maxLatitude||group.minLongitude!==group.maxLongitude)){
        hints.delete(this);
        const map=wx.createMapContext('field-map',this);
        const fallback=()=>this.setData({latitude:group.latitude,longitude:group.longitude,scale:Math.min(20,zoom+2)},()=>this.queueLoad());
        if(typeof map.includePoints==='function')map.includePoints({points:[{latitude:minLatitude,longitude:minLongitude},{latitude:maxLatitude,longitude:maxLongitude}],padding:[32,36,Math.min(this.data.sheetHeight+32,this.data.mapHeight/2),36],fail:fallback,complete:()=>this.queueLoad()});
        else fallback();
      }
    },
    async showRecords(append:boolean,marker=false){
      if(append&&this.data.recordsLoading)return;
      if(!append&&!marker&&!Object.keys(this.data._bounds).length)this.data._recordQuery=this.data._query;
      const seq=++this.data._recordSeq;this.setData({recordsLoading:true,listOpen:true,recordsError:'',...(!append?{selected:[],cursor:''}: {})});
      try{const res=await api(observations,'GET',{...this.data._recordQuery,...this.data._bounds,sort:'recent',cursor:append?this.data.cursor:'',limit:60});
        const items=res.items.map((row:Pin)=>({...row,placeName:chinesePlace(row.placeName)}));
        if(seq===this.data._recordSeq&&this.data._visible)this.setData({recordOrder:res.sort||'collected',selected:append?Array.from(new Map(this.data.selected.concat(items).map((row:Pin)=>[row.id,row])).values()):items,cursor:res.nextCursor,listTotal:res.total??this.data.listTotal,...(!this.data._moving?{sheetCollapsed:!this.data._restoreExpanded}:{})});
      }catch{if(seq===this.data._recordSeq&&this.data._visible)this.setData({recordsError:'记录加载失败，请重试。',...(!this.data._moving?{sheetCollapsed:!this.data._restoreExpanded}:{})});}finally{if(seq===this.data._recordSeq&&this.data._visible)this.setData({recordsLoading:false});}
    },
    more(){if(this.data.cursor&&!this.data.recordsLoading)void this.showRecords(true);},
    list(){if(this.data.listOpen){this.closeList();return;}this.closeSearch();this.data._restoreExpanded=true;this.data._bounds={};this.setData({sheetCollapsed:false,listTotal:this.data.total,listTitle:'本区域观察'});void this.showRecords(false);},
    guide(event:WechatMiniprogram.TouchEvent){hub('species',event.currentTarget.dataset.id||this.data.species);},
    go(event:WechatMiniprogram.TouchEvent){hub('record',event.currentTarget.dataset.id);},
    async position(){
      if(this.data.locating)return;const token=++this.data._locationSeq;this.setData({locating:true,error:''});
      try{const point=await wx.getLocation({type:'gcj02',isHighAccuracy:true,highAccuracyExpireTime:6000});
        if(token!==this.data._locationSeq||!this.data._visible)return;
        if(!Number.isFinite(point.latitude)||!Number.isFinite(point.longitude)||Math.abs(point.latitude)>90||Math.abs(point.longitude)>180)throw new Error('invalid native location');
        hints.delete(this);this.closeList();saveMapView({latitude:point.latitude,longitude:point.longitude,scale:16});
        this.setData({showUserLocation:true,focusLabel:point.accuracy>100?'定位精度约'+Math.ceil(point.accuracy)+'米，可重试':'',latitude:point.latitude,longitude:point.longitude,scale:16},()=>this.queueLoad());
      }catch{if(token===this.data._locationSeq&&this.data._visible)this.setData({error:'定位不可用，请检查微信与系统定位授权；仍可手动选区。'});}
      finally{if(token===this.data._locationSeq&&this.data._visible)this.setData({locating:false});}
    },
    async place(){this.closeSearch();try{const point=await wx.chooseLocation({latitude:this.data.latitude,longitude:this.data.longitude});if(!this.data._visible)return;hints.delete(this);saveMapView({latitude:point.latitude,longitude:point.longitude,scale:16});this.setData({focusLabel:point.name||'',latitude:point.latitude,longitude:point.longitude,scale:16},()=>this.queueLoad());}catch(error){if(!/cancel/i.test(String((error as {errMsg?:string})?.errMsg)))this.setData({error:'地点选择未完成，可拖动地图选区。'});}}
  }
});
