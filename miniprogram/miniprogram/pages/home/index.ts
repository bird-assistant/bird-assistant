import {beginSheetDrag,moveSheetDrag,endSheetDrag,resetSheetDrag} from '../../services/sheet-gesture';
import {installAdaptiveSheets,fitAdaptiveSheets,stopAdaptiveSheets} from '../../services/adaptive-sheets';
import { round2 } from '../../services/numbers';
import { layout } from '../../services/layout';
import { flightFrame, placeAnchor, MAP_FLIGHT_MS, MapView } from '../../services/map-motion';
import { selectTab, syncNavigation } from '../../services/tabs';
import { places, currentPoint, mapRecords, clamp, markers, offsetFor, centerAt, regionAt } from '../../services/map-model';
const tiles=Array.from({length:9},(_,i)=>({id:i,x:(i%3-1)*100,y:(Math.floor(i/3)-1)*100}));
type Touch = WechatMiniprogram.TouchEvent;
Page({
  sheetDragStart(event:WechatMiniprogram.TouchEvent){beginSheetDrag(this,event);},sheetDragMove(event:WechatMiniprogram.TouchEvent){moveSheetDrag(this,event);},sheetDragEnd(){endSheetDrag(this);},sheetDragCancel(){resetSheetDrag(this);},
  holdSheet(){},
  mapOverlayChange(event:WechatMiniprogram.CustomEvent<{open:boolean}>){this.setData({mapOverlay:event.detail.open});syncNavigation(this);},
  openHomeFilter(event:Touch){const field=String(event.currentTarget.dataset.key),options=field==='visibility'?this.data.visibilityOptions:field==='date'?this.data.dateOptions:this.data.speciesOptions;this.setData({filterOpen:true,filterField:field,filterOptions:options,filterSelected:Number((this.data as Record<string,unknown>)[field])});syncNavigation(this);},
  closeHomeFilter(){this.setData({filterOpen:false});syncNavigation(this);},
  homeFilterChange(event:WechatMiniprogram.CustomEvent<{value:number}>){this.filter({currentTarget:{dataset:{key:this.data.filterField}},detail:{value:String(event.detail.value)}} as any);this.closeHomeFilter();},
  data: {sheetDragStyle:'',mapOverlay:false,filterOpen:false,filterField:'',filterOptions:[] as string[],filterSelected:0,sheetHeights:{} as Record<string,number>,mapMoving:false,searchFocused:false,screenMarkers:[] as Array<ReturnType<typeof markers>[number]&{screenX:number;screenY:number}>,focusPin:null as {screenX:number;screenY:number}|null,height:600,viewportW:390,sheetHeight:390,tiles,focusPoint:null as {x:number;y:number}|null,selectedMarkerIds:[] as string[],worldW:400,worldH:640,x:0,y:0,zoom:1,invZoom:1,markers:markers(mapRecords,400,640,1),query:'',searchOpen:false,results:places,visibility:0,date:0,species:0,visibilityOptions:['公开与我的','公开鸟讯','我的标记'],dateOptions:['所有示例日期','10月21日'],speciesOptions:['所有鸟种','树麻雀','大山雀','普通翠鸟'],region:'lake',regionName:'湖畔公园',focused:'',sheet:false,detail:null as typeof mapRecords[number]|null,sheetRecords:mapRecords.slice(0,1),saved:false,checked:false },
  _gesture:null as {x:number;y:number;offsetX:number;offsetY:number;distance:number;zoom:number;moved:boolean}|null,
  _flight:null as {from:MapView;to:MapView;startedAt:number|null}|null,
  _flightTimer:null as ReturnType<typeof setTimeout>|null,
  onLoad(){resetSheetDrag(this);installAdaptiveSheets(this,()=>this.data.sheet);const box=layout(),w=Math.max(box.width,box.height*.625);this.setData({height:box.height,viewportW:box.width,sheetHeight:Math.min(420,box.height*.65),worldW:w,worldH:w*1.6});this.updateMap();},
  onResize(){fitAdaptiveSheets(this);},
  onShow(){this.resetGesture();this.stopFlight();selectTab(this,0);},
  onHide(){resetSheetDrag(this);this.resetGesture();this.stopFlight();this.closeSearch();},onUnload(){stopAdaptiveSheets(this);this.resetGesture();this.stopFlight();},
  resetGesture(){this._gesture=null;},
  stopFlight(){
    if(this._flightTimer!==null){clearTimeout(this._flightTimer);this._flightTimer=null;}
    const flight=this._flight;this._flight=null;
    if(flight){this.setData({...flightFrame(flight.from,flight.to,flight.startedAt===null?0:Date.now()-flight.startedAt),mapMoving:false});this.updateMap();}else if(this.data.mapMoving)this.setData({mapMoving:false});
  },
  flyTo(point:{x:number;y:number},zoom:number,reveal=false){
    this.stopFlight();const d=this.data,offset=offsetFor(point,d.worldW,d.worldH,zoom);
    if(reveal)offset.y+=placeAnchor(layout(true).height,d.sheetHeight)-d.height/2;
    const maxX=Math.max(0,d.worldW*zoom*1.5-d.viewportW/2),maxY=Math.max(0,d.worldH*zoom*1.5-d.height/2);
    const flight={from:{x:d.x,y:d.y,zoom:d.zoom},to:{x:clamp(offset.x,-maxX,maxX),y:clamp(offset.y,-maxY,maxY),zoom},startedAt:null as number|null};
    this._flight=flight;this.updateMap();this.setData({mapMoving:true});
    // Render the start position before transitioning all map layers together.
    wx.nextTick(()=>{if(this._flight!==flight)return;flight.startedAt=Date.now();this.setData(flight.to);this.updateMap();this._flightTimer=setTimeout(()=>{if(this._flight!==flight)return;this._flight=null;this._flightTimer=null;this.setData({mapMoving:false});},MAP_FLIGHT_MS);});
  },
  visibleRecords(){return mapRecords.filter(r=>(this.data.visibility!==1||!r.private)&&(this.data.visibility!==2||r.private)&&(!this.data.date||r.date==='2026-10-21')&&(!this.data.species||r.name===this.data.speciesOptions[this.data.species]));},
  updateMap(){const d=this.data,region=regionAt(centerAt(d.x,d.y,d.worldW,d.worldH,d.zoom),d.region),focused=places.find(p=>p.id===d.focused),key=focused?.id||region;
    let activity:Record<string,{saved?:boolean;checked?:boolean}>={};try{activity=wx.getStorageSync('bird-assistant.place-demo.v1')||{};}catch{/* Map remains usable without activity storage. */}
    const records=this.visibleRecords().filter(r=>!r.private&&(d.selectedMarkerIds.length?d.selectedMarkerIds.includes(r.id):r.region===(focused?.region||region)));
    const groups=markers(this.visibleRecords(),d.worldW,d.worldH,d.zoom);
    const project=(p:{x:number;y:number})=>({screenX:round2(d.viewportW/2+d.x+(p.x/100-.5)*d.worldW*d.zoom),screenY:round2(d.height/2+d.y+(p.y/100-.5)*d.worldH*d.zoom)});
    this.setData({markers:groups,screenMarkers:groups.map(m=>({...m,...project(m)})),focusPin:d.focusPoint?project(d.focusPoint):null,invZoom:1/d.zoom,region,regionName:d.selectedMarkerIds.length>1?'聚合范围内的观察':focused?.name||places.find(p=>p.id===region)!.name,sheetRecords:records,saved:!!activity[key]?.saved,checked:!!activity[key]?.checked});},
  boundMap(){const d=this.data,maxX=Math.max(0,d.worldW*d.zoom*1.5-d.viewportW/2),maxY=Math.max(0,d.worldH*d.zoom*1.5-d.height/2);this.setData({x:clamp(d.x,-maxX,maxX),y:clamp(d.y,-maxY,maxY)});},
  touchStart(e:Touch){this.resetGesture();const t=e.touches[0];if(!t)return;this.stopFlight();const b=e.touches[1];this._gesture={x:t.clientX,y:t.clientY,offsetX:this.data.x,offsetY:this.data.y,distance:b?Math.hypot(t.clientX-b.clientX,t.clientY-b.clientY):0,zoom:this.data.zoom,moved:!!b};},
  touchMove(e:Touch){const g=this._gesture,t=e.touches[0];if(!t){this.resetGesture();return;}if(!g){this.touchStart(e);return;}const b=e.touches[1];if(!!b!==!!g.distance){this.touchStart(e);if(this._gesture)this._gesture.moved=true;return;}if(b||Math.hypot(t.clientX-g.x,t.clientY-g.y)>6)g.moved=true;if(b&&g.distance){const z=clamp(g.zoom*Math.hypot(t.clientX-b.clientX,t.clientY-b.clientY)/g.distance,.4,3);this.setData({zoom:z,x:g.offsetX*z/g.zoom,y:g.offsetY*z/g.zoom});}else this.setData({x:g.offsetX+t.clientX-g.x,y:g.offsetY+t.clientY-g.y});this.setData({focused:'',focusPoint:null,selectedMarkerIds:[]});this.boundMap();this.updateMap();},
  touchEnd(e?:Touch){if(e?.touches.length){this.touchStart(e);if(this._gesture)this._gesture.moved=true;return;}const tapped=this._gesture&&!this._gesture.moved;this.resetGesture();if(tapped)this.closeSearch();},
  touchCancel(){this.resetGesture();},
  zoom(e:Touch){this.stopFlight();const z=round2(clamp(this.data.zoom+Number(e.currentTarget.dataset.delta),.4,3)),ratio=z/this.data.zoom;this.setData({zoom:z,x:this.data.x*ratio,y:this.data.y*ratio});this.boundMap();this.updateMap();},
  locate(){this.setData({focused:'',focusPoint:null,selectedMarkerIds:[]});this.flyTo(currentPoint,this.data.zoom);wx.showToast({title:'已回到示例位置',icon:'none'});},
  search(e:WechatMiniprogram.CustomEvent<{value:string}>){const query=e.detail.value;this.setData({query,searchOpen:true,results:places.filter(p=>!query||p.name.includes(query))});},
  searchFocus(){if(!this.data.searchOpen||!this.data.searchFocused)this.setData({searchOpen:true,searchFocused:true});},searchBlur(){if(this.data.searchFocused)this.setData({searchFocused:false});},
  searchAction(){if(this.data.searchOpen)this.closeSearch();else this.searchFocus();},
  closeSearch(){if(this.data.searchOpen||this.data.searchFocused){this.setData({searchOpen:false,searchFocused:false});wx.hideKeyboard?.({fail:()=>{}});}},
  choosePlace(e:Touch){this.closeSearch();const p=places.find(p=>p.id===e.currentTarget.dataset.id);if(!p)return;const zoom=Math.max(.7,this.data.zoom);this.setData({focused:p.id,focusPoint:{x:p.x,y:p.y},selectedMarkerIds:[],query:p.name,sheet:true,detail:null});syncNavigation(this);this.flyTo(p,zoom,true);},
  filter(e:WechatMiniprogram.CustomEvent<{value:string}>){const key=String(e.currentTarget.dataset.key);if(['visibility','date','species'].includes(key)){this.stopFlight();this.setData({[key]:Number(e.detail.value),focused:'',focusPoint:null,selectedMarkerIds:[]});this.updateMap();}},
  openSummary(){this.closeSearch();const p=this.data.focusPoint||places.find(p=>p.id===(this.data.focused||this.data.region));this.setData({sheet:true,detail:null});syncNavigation(this);if(p)this.flyTo(p,this.data.zoom,true);},
  marker(e:Touch){this.closeSearch();const g=this.data.markers.find(m=>m.id===e.currentTarget.dataset.id);if(!g)return;const record=mapRecords.find(r=>r.id===g.ids[0])!,zoom=Math.max(.7,g.count>1?clamp(this.data.zoom*1.7,.4,3):this.data.zoom);
    this.setData({focused:record.region,focusPoint:{x:g.x,y:g.y},selectedMarkerIds:g.private?[]:g.ids,sheet:true,detail:g.private?record:null});syncNavigation(this);this.flyTo(g,zoom,true);},
  openRecord(e:Touch){this.setData({detail:mapRecords.find(r=>r.id===e.currentTarget.dataset.id)||null});},closeSheet(){this.resetGesture();this.stopFlight();this.setData({sheet:false,detail:null});syncNavigation(this);},
  back(){if(this.data.sheet&&this.data.detail){this.backToPlace();return;}if(this.data.sheet)this.closeSheet();else this.closeSearch();},
  backToPlace(){this.setData({detail:null});},
  activity(e:Touch){const kind=e.currentTarget.dataset.kind==='saved'?'saved':'checked',key=this.data.focused||this.data.region;wx.showModal({title:kind==='saved'?'公开收藏这个地点？':'公开打卡这个地点？',content:'当前是本机交互演示。正式接入后会公开名称与地点；私人观察和实时位置不会附带公开。',success:r=>{if(!r.confirm)return;try{const all=wx.getStorageSync('bird-assistant.place-demo.v1')||{};all[key]={...all[key],[kind]:!this.data[kind]};wx.setStorageSync('bird-assistant.place-demo.v1',all);this.updateMap();}catch{wx.showToast({title:'保存未完成，请重试',icon:'none'});}}});},
  noop(){}
});
