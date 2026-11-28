import {mapDateRange,mapRippleCircles,MapRipple} from '../../services/map-effects';
import {nativeDeadline} from '../../services/native-deadline';
import {readSavedPlaces,savePlace} from '../../services/saved-places';
import {navigate} from '../../services/navigation';
import {api,hub,takeMapFocus} from '../../services/community';
import {beijingDate} from '../../services/observation-context';
import {layout} from '../../services/layout';
import {readMapView,saveMapView} from '../../services/map-view';
import {speciesSearch} from '../../services/species-search';
import {spacedClusters} from '../../services/map-clusters';
import {mapPanes,clusterMarker,speciesResultsHeight,recordPane} from '../../services/map-presentation';
import {MapTargets} from '../../services/map-targets';
import {chinesePlace} from '../../services/place-names';
import {getCanvas} from '../../services/canvas';
import {MapIconCache} from '../../services/map-icons';

interface Pin {id:string;speciesId:string;speciesName:string;source:string;placeName:string;date:string;visibility?:string;precisionLabel?:string;displayLocation:{latitude:number;longitude:number};}
type Input=WechatMiniprogram.CustomEvent<{value:string}>;
type Bounds={minLatitude:number;maxLatitude:number;minLongitude:number;maxLongitude:number};
type Cluster=Bounds & {latitude:number;longitude:number;count:number};
type Viewport={region:WechatMiniprogram.GetRegionSuccessCallbackResult;scale:number;center:{latitude:number;longitude:number}|null};
const hints=new WeakMap<object,Partial<Viewport>>();
type Focus={latitude:number;longitude:number;scale:number;label:string;id?:string;until:number};
const focuses=new WeakMap<object,Focus>();
const ripples=new WeakMap<object,MapRipple>();
const savedTargets=new WeakMap<object,Map<number,ReturnType<typeof readSavedPlaces>[number]>>();
const placeChoices=new WeakMap<object,{point?:Focus}>();
const observations='/api/v1/map/observations';
const searches=new WeakMap<object,ReturnType<typeof speciesSearch>>();
const targets=new WeakMap<object,MapTargets>();
const cellQueries=new WeakMap<object,Record<string,unknown>>();
const icons=new WeakMap<object,MapIconCache>();
Component({
  data:{circles:[] as ReturnType<typeof mapRippleCircles>,_rippleTimer:0,_focusSeq:0,recordFocusLocked:false,recordAnchor:'',focusedRecordId:'',filterOpen:false,filterField:'',filterOptions:[] as string[],filterTitle:'',filterSelected:0,savedPlaceNotice:'',_iconSeq:0,_locationSeq:0,locating:false,showUserLocation:false,recordOrder:'recent',orderingNotice:'',focusLabel:'',nativeActive:true,_tripSeq:0,_watchTimer:0,mapMoving:false,_restoreExpanded:true,sheetCollapsed:false,recordsLoading:false,recordsError:'',_recordSeq:0,_moving:false,_motionTimer:0,_recordQuery:{} as Record<string,unknown>,searchHeight:176,drawerWidth:366,searchMore:false,headerHeight:88,fieldHeight:600,toolbarHeight:112,mapHeight:488,sheetHeight:224,sheetHeaderHeight:64,creditReserve:0,compact:false,listHeight:160,listTotal:0,listTitle:'本区域观察',wide:false,searching:false,searchError:'',_searchSeq:0,_visible:true,_seq:0,_viewRead:0,_viewKey:'',_ready:false,_timer:0,_zoom:4,_groups:[] as Cluster[],_query:{} as Record<string,unknown>,_bounds:{} as Partial<Bounds>,cursor:'',listOpen:false,latitude:39.92,longitude:116.4,scale:12,scope:0,scopes:['公开与我的','公开鸟讯','我的标记'],
    origin:0,origins:['全部来源','羽迹鸟友','外部鸟讯'],period:0,periods:['所有日期','近一周','近一月','近一季','近一年'],keyword:'',species:'',speciesLabel:'所有鸟种',matches:[] as any[],
    markers:[] as Array<{id:number;latitude:number;longitude:number;iconPath:string;width:number;height:number}>,selected:[] as Pin[],total:0,error:'',loading:false,dirty:false},
  lifetimes:{attached(){const view=readMapView();if(view)this.setData(view);},ready(){this.resizeMap();this.watchViewport();if(wx.nextTick)wx.nextTick(()=>void this.load());else void this.load();},detached(){this.suspend();icons.get(this)?.close();icons.delete(this);savedTargets.delete(this);searches.delete(this);targets.delete(this);cellQueries.delete(this);hints.delete(this);focuses.delete(this);placeChoices.delete(this);this.data._ready=false;}},
  pageLifetimes:{resize(){this.resizeMap();this.queueLoad();},hide(){this.suspend();},show(){
    this.data._visible=true;this.renderClusters(this.data._zoom||this.data.scale);hints.delete(this);const choice=placeChoices.get(this),focus=choice?choice.point:takeMapFocus();
    this.setData({nativeActive:true},()=>{
      if(choice&&!choice.point)return; // The native chooser may finish after onShow.
      if(choice)placeChoices.delete(this);
      if(focus){this.closeList();if('species' in focus)this.setData({species:focus.species,speciesLabel:focus.speciesLabel,scope:focus.scope,origin:0,period:0});this.focusMap({...focus,label:'label' in focus?String(focus.label):focus.focusLabel||focus.speciesLabel||'',until:Date.now()+5000});}
      else if(!focuses.has(this)){const view=readMapView();if(view)this.setData(view);this.watchViewport();if(this.data._ready){if(wx.nextTick)wx.nextTick(()=>void this.load());else void this.load();}}
    });
  }},
  methods:{
    openFilter(event:WechatMiniprogram.TouchEvent){const field=String(event.currentTarget.dataset.field),sets:Record<string,{title:string;options:string[];selected:number}>={scope:{title:'显示哪些观察',options:this.data.scopes,selected:this.data.scope},period:{title:'观察日期',options:this.data.periods,selected:this.data.period},origin:{title:'记录来源',options:this.data.origins,selected:this.data.origin}};const set=sets[field];if(!set)return;this.closeSearch();this.setData({filterOpen:true,filterField:field,filterTitle:set.title,filterOptions:set.options,filterSelected:set.selected});this.triggerEvent('overlaychange',{open:true});},
    closeFilter(){if(!this.data.filterOpen)return;this.setData({filterOpen:false});this.triggerEvent('overlaychange',{open:false});},
    chooseFilter(event:Input){const field=this.data.filterField,value=Number(event.detail.value);if(!['scope','period','origin'].includes(field)||!Number.isInteger(value)||value<0||value>=this.data.filterOptions.length)return;this.closeFilter();this.filter({currentTarget:{dataset:{field}},detail:{value:String(value)}} as unknown as Input);},
    async saveMapPlace(){try{const point=readMapView()||this.data;const choice=await wx.chooseLocation({latitude:point.latitude,longitude:point.longitude});const saved=savePlace({name:choice.name||'我的地点',address:choice.address||'',latitude:choice.latitude,longitude:choice.longitude});if(this.data._visible){this.setData({savedPlaceNotice:'已收藏 '+saved.name+' · 在「我的 → 收藏地点」查看'});this.renderClusters(this.data._zoom||this.data.scale);}wx.showToast({title:'已收藏地点',icon:'success'});}catch(error){if(!/cancel/i.test(String((error as {errMsg?:string})?.errMsg||''))&&this.data._visible)this.setData({error:error instanceof Error?error.message:'未能收藏地点，请重试。'});}},

    suspend(){this.stopMapRipple();this.data._focusSeq++;this.closeFilter();this.data._iconSeq++;this.data._locationSeq++;this.data._tripSeq++;clearTimeout(this.data._watchTimer);this.data._watchTimer=0;hints.delete(this);this.data._visible=false;this.data._moving=false;searches.get(this)?.close();this.data._viewRead++;this.data._seq++;this.data._recordSeq++;this.data._searchSeq++;clearTimeout(this.data._timer);clearTimeout(this.data._motionTimer);this.data._timer=0;this.data._motionTimer=0;this.setData({locating:false,nativeActive:false,mapMoving:false,loading:false,recordsLoading:false,searching:false,matches:[],searchError:''});},
    watchViewport(){
      if(!this.data._visible||this.data._watchTimer)return;
      this.data._watchTimer=setTimeout(()=>{this.data._watchTimer=0;if(!this.data._visible)return;void this.updateViewport(false).finally(()=>this.watchViewport());},2500);
    },
    mapSavedPlaces(){try{return readSavedPlaces();}catch{return [];}},
    renderClusters(scale:number){
      const version=++this.data._iconSeq;
      const groups=spacedClusters(this.data._groups,scale),registry=targets.get(this)||new MapTargets();
      targets.set(this,registry);
      const ids=registry.assign(groups,cellQueries.get(this)||this.data._query,scale);
      let cache=icons.get(this);if(!cache){cache=new MapIconCache(()=>getCanvas(this,'#map-marker-canvas',96,96),path=>{try{wx.getFileSystemManager().unlink({filePath:path,fail:()=>{}});}catch{}});icons.set(this,cache);}
      const markers=groups.map((group,index)=>{const marker={...clusterMarker(group,index,scale),id:ids[index]};const image=marker.anchor&&cache!.get(group.count,group.visibility||'public');return image?{...marker,iconPath:image}:marker;});
      const saved=new Map<number,ReturnType<typeof readSavedPlaces>[number]>();
      for(const entry of this.mapSavedPlaces().entries()){const index=entry[0],place=entry[1],id=2147483000+index;saved.set(id,place);markers.push({id,latitude:place.latitude,longitude:place.longitude,iconPath:'/assets/icons/map-bookmark.png',width:26,height:30,anchor:{x:.5,y:.5},callout:{content:'收藏 · '+place.name,display:'BYCLICK',padding:6,borderRadius:10,color:'#285b49',bgColor:'#fffef9'}});}
      savedTargets.set(this,saved);
      if(JSON.stringify(markers)!==JSON.stringify(this.data.markers))this.setData({markers});
      const variants=['public','private'];
      if(groups.some(group=>!cache!.get(group.count,group.visibility||'public')))void Promise.all(variants.map(variant=>cache!.prepare(groups.filter(group=>(group.visibility||'public')===variant).map(group=>group.count),variant))).then(()=>{
        if(!this.data._visible||version!==this.data._iconSeq)return;
        this.setData({markers:markers.map((marker,index)=>groups[index]&&marker.anchor&&cache!.get(groups[index].count,groups[index].visibility||'public')?{...marker,iconPath:cache!.get(groups[index].count,groups[index].visibility||'public')!}:marker)});
      }).catch(()=>{});
    },
    resizeMap(){const box=layout(),panes=mapPanes(box.width,box.height);this.setData({headerHeight:box.headerHeight,...panes,searchHeight:speciesResultsHeight(this.data.matches.length,this.data.searchMore,Math.max(0,panes.mapHeight-36))});this.sizeRecords?.();},
    sizeRecords(){const panes=mapPanes(wx.getWindowInfo().windowWidth,this.data.fieldHeight);this.setData(recordPane(panes.sheetHeight,this.data.sheetHeaderHeight,this.data.selected.length,!!this.data.cursor,this.data.recordsLoading));},
    focusMap(point:Focus){
      if(!Number.isFinite(point.latitude)||!Number.isFinite(point.longitude)||Math.abs(point.latitude)>90||Math.abs(point.longitude)>180)return;
      hints.delete(this);this.data._viewRead++;this.data._seq++;this.data._viewKey='';
      focuses.set(this,{...point,until:Date.now()+5000});
      this.startMapRipple(point);
      saveMapView({latitude:point.latitude,longitude:point.longitude,scale:point.scale});
      this.setData({latitude:point.latitude,longitude:point.longitude,scale:point.scale,focusLabel:point.label},()=>{
        const move=()=>{if(!this.data._visible)return;const map=wx.createMapContext('field-map',this);map.moveToLocation?.({latitude:point.latitude,longitude:point.longitude,complete:()=>this.queueLoad(0)});this.watchViewport();this.queueLoad(0);};
        if(wx.nextTick)wx.nextTick(move);else move();
      });
    },
    async focusRecord(event:WechatMiniprogram.TouchEvent){
      const row=this.data.selected.find(item=>item.id===event.currentTarget.dataset.id);if(!row?.displayLocation)return;
      const token=++this.data._focusSeq;this.setData({focusedRecordId:row.id,recordFocusLocked:true,recordAnchor:''});
      let scale=readMapView()?.scale??this.data.scale;
      try{const actual=await nativeDeadline<number>((resolve,reject)=>{wx.createMapContext('field-map',this).getScale({success:value=>resolve(value.scale),fail:reject});},1200,'地图倍率读取超时');if(Number.isFinite(actual))scale=actual;}catch{/* Preserve the last observed scale if native callbacks are unavailable. */}
      if(!this.data._visible||token!==this.data._focusSeq)return;
      this.focusMap({...row.displayLocation,scale,label:(row.placeName||row.speciesName)+' · '+(row.visibility==='private'?'我的拍摄点':row.precisionLabel||'公开区域，非精确拍摄点'),id:row.id,until:0});
      const anchor=()=>{if(this.data._visible&&token===this.data._focusSeq)this.setData({recordAnchor:'map-record-'+this.data.selected.findIndex(item=>item.id===row.id)});};if(wx.nextTick)wx.nextTick(anchor);else anchor();
    },
    startMapRipple(point:{latitude:number;longitude:number;id?:string}){
      this.stopMapRipple();const row=this.data.selected.find(item=>item.id===point.id);ripples.set(this,{latitude:point.latitude,longitude:point.longitude,started:Date.now(),color:row?.visibility==='private'?'#467f88':'#477e65'});this.paintMapRipple();
    },
    paintMapRipple(){const effect=ripples.get(this);if(!effect||!this.data._visible)return;const circles=mapRippleCircles(effect,Date.now(),hints.get(this)?.scale??this.data._zoom??this.data.scale);this.setData({circles});if(!circles.length){ripples.delete(this);this.data._rippleTimer=0;return;}this.data._rippleTimer=setTimeout(()=>this.paintMapRipple(),90);},
    stopMapRipple(){clearTimeout(this.data._rippleTimer);this.data._rippleTimer=0;ripples.delete(this);if(this.data.circles?.length)this.setData({circles:[]});},
    releaseRecordFocus(){this.stopMapRipple();this.data._focusSeq++;this.setData({focusedRecordId:'',recordFocusLocked:false,recordAnchor:''});},
    query(){let query=searches.get(this);if(!query){query=speciesSearch(state=>{if(this.data._visible)this.setData({...state,searchHeight:speciesResultsHeight(state.matches.length,state.searchMore,Math.max(0,this.data.mapHeight-36))});});searches.set(this,query);}return query;},
    moreSpecies(){void this.query().more();},
    closeSearch(){searches.get(this)?.close();this.data._searchSeq++;this.setData({matches:[],searching:false,searchError:''});wx.hideKeyboard?.({fail:()=>{}});},
    clearSpecies(){this.closeSearch();this.closeList();this.setData({species:'',keyword:'',speciesLabel:'所有鸟种'});void this.load();},
    closeList(){this.releaseRecordFocus();this.data._recordSeq++;this.setData({listOpen:false,sheetCollapsed:false,selected:[],cursor:'',recordsLoading:false,recordsError:''});},
    expandList(){const locked=this.data.recordFocusLocked;this.releaseRecordFocus();if(locked){this.data._bounds={};this.data._restoreExpanded=true;this.setData({sheetCollapsed:false,listTitle:'本区域观察'});void this.showRecords(false);return;}this.data._restoreExpanded=this.data.sheetCollapsed;this.setData({sheetCollapsed:!this.data.sheetCollapsed});},
    retryRecords(){void this.showRecords(false);},
    async planTrip(){
      const token=++this.data._tripSeq;let deadline=0;
      try{
        const map=wx.createMapContext('field-map',this);
        const center=await Promise.race([new Promise<WechatMiniprogram.GetCenterLocationSuccessCallbackResult>((resolve,reject)=>map.getCenterLocation({success:resolve,fail:reject})),new Promise<never>((_resolve,reject)=>{deadline=setTimeout(()=>reject(new Error('native map read timeout')),1800);})]);
        if(!this.data._visible||token!==this.data._tripSeq)return;
        const latitude=center.latitude.toFixed(1),longitude=center.longitude.toFixed(1);
        navigate({url:`/field/trip/index?lat=${latitude}&lon=${longitude}&species=${encodeURIComponent(this.data.species)}&label=${encodeURIComponent(this.data.speciesLabel)}&place=${encodeURIComponent(this.data.focusLabel||'')}`});
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
        const focus=focuses.get(this);
        if(focus&&viewport[2]&&(Math.abs(viewport[2].latitude-focus.latitude)>.003||Math.abs(viewport[2].longitude-focus.longitude)>.003)){
          if(Date.now()<focus.until)return;focuses.delete(this);this.setData({error:'地图尚未移动到所选地点，请重新选择或使用定位按钮。'});return;
        }
        if(focus)focus.until=0;
        const hint=hints.get(this),region=hint?.region||viewport[0],scale=hint?.scale??viewport[1],center=hint?.center||viewport[2];
        if(hint&&Math.abs(viewport[1]-scale)<.001)hints.delete(this);
        if(this.data._groups.length&&scale!==this.data._zoom)this.renderClusters(scale);
        if(center)saveMapView({...center,scale});
        const dates=mapDateRange(this.data.period,beijingDate());const data={minLatitude:region.southwest.latitude,minLongitude:region.southwest.longitude,
          maxLatitude:region.northeast.latitude,maxLongitude:region.northeast.longitude,coordinateSystem:'GCJ-02',scope:['all','public','mine'][this.data.scope],
          origin:['all','local','external'][this.data.origin],speciesId:this.data.species,...dates};
        const zoom=Math.max(3,Math.min(20,Math.round(scale)));
        const key=JSON.stringify({...data,zoom});
        if(!force&&key===this.data._viewKey){
          // Even a gesture ending at the same coordinates restores the sheet.
          if(!this.data.recordFocusLocked&&this.data.listOpen&&this.data._restoreExpanded&&!this.data._moving&&this.data.sheetCollapsed&&!this.data.recordsLoading){
            this.data._bounds={};this.setData({listTitle:'本区域观察'});void this.showRecords(false);
          }
          return;
        }
        this.data._viewKey=key;
        seq=++this.data._seq;
        this.data._query=data;this.data._zoom=scale;
        this.setData({loading:true,dirty:true,error:''});
        if(!this.data.recordFocusLocked&&this.data.listOpen&&!Object.keys(this.data._bounds).length){this.setData({listTitle:'本区域观察'});void this.showRecords(false);}
        const res=await api(observations,'GET',{...data,zoom});
        if(seq!==this.data._seq)return;
        this.data._groups=res.clusters.map((group:Cluster)=>({...group,...(this.data.scope===2?{visibility:'private' as const}:{})}));cellQueries.set(this,data);
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
        if(cause!=='update'&&(!(focuses.get(this)?.until&&Date.now()<focuses.get(this)!.until)||['drag','scale','gesture'].includes(cause||''))){
          focuses.delete(this);this.setData({focusLabel:''});
          if(!this.data._moving)this.data._restoreExpanded=!this.data.sheetCollapsed;
          this.data._moving=true;this.data._viewRead++;this.data._seq++;this.data._viewKey='';this.data._recordSeq++;
          if(this.data.listOpen&&!this.data.recordFocusLocked){this.data._bounds={};this.setData({mapMoving:true,sheetCollapsed:true,recordsLoading:false,listTitle:'本区域观察',cursor:''});}
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
      if(this.data._ready&&!this.data.error&&!ripples.has(this))this.queueLoad();
    },
    filter(event:Input){const key=event.currentTarget.dataset.field;this.closeList();this.setData({[key]:Number(event.detail.value)});void this.load();},
    input(event:Input){this.setData({keyword:event.detail.value});this.query().input(event.detail.value);},
    search(){if(!this.data.keyword.trim()){this.clearSpecies();return;}return this.query().search(this.data.keyword);},
    species(event:WechatMiniprogram.TouchEvent){this.closeSearch();this.closeList();this.setData({species:event.currentTarget.dataset.id,speciesLabel:event.currentTarget.dataset.name,keyword:event.currentTarget.dataset.id?event.currentTarget.dataset.name:''});void this.load();},
    marker(event:WechatMiniprogram.CustomEvent<{markerId:number|string}>){
      if(!this.data._visible||!this.data.nativeActive)return;
      const saved=savedTargets.get(this)?.get(Number(event.detail.markerId));if(saved){this.focusMap({...saved,scale:this.data._zoom||this.data.scale,label:'收藏 · '+saved.name,until:0});return;}this.releaseRecordFocus();
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
        if(seq===this.data._recordSeq&&this.data._visible)this.setData({recordOrder:res.sort||'collected',orderingNotice:res.sort==='recent'?'':'当前服务仍按收录时间返回，本批已按观察日期整理；完整日期排序需更新服务。',selected:(append?Array.from(new Map(this.data.selected.concat(items).map((row:Pin)=>[row.id,row])).values()):items).sort((a:Pin,b:Pin)=>(b.date||'').localeCompare(a.date||'')),cursor:res.nextCursor,listTotal:res.total??this.data.listTotal,...(!this.data._moving?{sheetCollapsed:!this.data._restoreExpanded}:{})});
      }catch{if(seq===this.data._recordSeq&&this.data._visible)this.setData({recordsError:'记录加载失败，请重试。',...(!this.data._moving?{sheetCollapsed:!this.data._restoreExpanded}:{})});}finally{if(seq===this.data._recordSeq&&this.data._visible){this.setData({recordsLoading:false});this.sizeRecords();}}
    },
    more(){if(this.data.cursor&&!this.data.recordsLoading)void this.showRecords(true);},
    list(){this.releaseRecordFocus();if(this.data.listOpen){this.closeList();return;}this.closeSearch();this.data._restoreExpanded=true;this.data._bounds={};this.setData({sheetCollapsed:false,listTotal:this.data.total,listTitle:'本区域观察'});void this.showRecords(false);},
    guide(event:WechatMiniprogram.TouchEvent){hub('species',event.currentTarget.dataset.id||this.data.species);},
    go(event:WechatMiniprogram.TouchEvent){hub('record',event.currentTarget.dataset.id);},
    async position(){
      if(this.data.locating)return;const token=++this.data._locationSeq;this.setData({locating:true,error:''});
      try{const point=await wx.getLocation({type:'gcj02',isHighAccuracy:true,highAccuracyExpireTime:6000});
        if(token!==this.data._locationSeq||!this.data._visible)return;
        if(!Number.isFinite(point.latitude)||!Number.isFinite(point.longitude)||Math.abs(point.latitude)>90||Math.abs(point.longitude)>180)throw new Error('invalid native location');
        this.closeList();this.setData({showUserLocation:true});this.focusMap({latitude:point.latitude,longitude:point.longitude,scale:16,label:point.accuracy>100?'定位精度约'+Math.ceil(point.accuracy)+'米，可重试':'我的位置',until:0});
      }catch{if(token===this.data._locationSeq&&this.data._visible)this.setData({error:'定位不可用，请检查微信与系统定位授权；仍可手动选区。'});}
      finally{if(token===this.data._locationSeq&&this.data._visible)this.setData({locating:false});}
    },
    async place(){
      if(placeChoices.has(this))return;this.closeSearch();const choice:{point?:Focus}={};placeChoices.set(this,choice);
      try{
        const point=await wx.chooseLocation({latitude:this.data.latitude,longitude:this.data.longitude});
        if(placeChoices.get(this)!==choice)return;
        if(!Number.isFinite(point.latitude)||!Number.isFinite(point.longitude))throw new Error('invalid location');
        choice.point={latitude:point.latitude,longitude:point.longitude,scale:16,label:point.name||point.address||'所选地点',until:Date.now()+5000};
        // chooseLocation legitimately hides the page. Keep its result until show.
        if(this.data._visible){placeChoices.delete(this);this.closeList();this.focusMap(choice.point);}
      }catch(error){if(placeChoices.get(this)===choice){placeChoices.delete(this);if(this.data._visible){this.watchViewport();this.queueLoad(0);}if(!/cancel/i.test(String((error as {errMsg?:string})?.errMsg)))this.setData({error:'地点选择未完成，可重试或拖动地图选区。'});}}
    }
  }
});
