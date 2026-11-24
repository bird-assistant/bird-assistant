import {api,hub,key,openMap} from '../../services/community';
import {beijingDate,beijingDateTime} from '../../services/observation-context';

type Tap = WechatMiniprogram.TouchEvent;
type Input = WechatMiniprogram.CustomEvent<{value:string}>;
type Point = {latitude:number;longitude:number};
type Park = {name:string;point:Point;source:string;km:number};
type Stop = {name:string;point:Point;km:number;count:number;latest:string;seasonal:number;park:Park|null;
  birds:{id:string;name:string;record:string;latest:string;count:number}[]};
type Plan = {engine:string;model:string;turn:string;answer:string;focus:string;start:string;end:string;
  sources:{id:string;label:string}[];guideCards:{id:string;name:string}[];
  weatherCards:{id:string;area:string;available:boolean;source:string;hours:{hour:string;wind:number;temp:number;rain:number|null}[]}[];
  stops:Stop[];parks:Park[];stages:{time:string;action:string}[]};
const day = 86400000;
const ranges = [10,30,80];
const times = Array.from({length:24},(_,hour)=>String(hour).padStart(2,'0')+':00');

Page({
  data:{point:null as Point|null,place:'还未选择起点',today:'',lastDay:'',date:'',hour:7,times,
    hours:2,durations:[1,2,3,4],radius:30,ranges,species:'',speciesLabel:'所有鸟种',question:'',
    exchanges:[] as {turn:string;question:string;answer:string}[],answer:null as Plan|null,asked:'',busy:false,error:'',windowLabel:''},
  _version:0,
  _pendingId:'',_pendingBody:'',
  onLoad(options:Record<string,string|undefined>){
    const now=Date.now(),instant=new Date(now).toISOString(),today=beijingDate(instant);
    const nextHour=Number(beijingDateTime(instant).slice(11,13))+1;
    const latitude=Number(options.lat),longitude=Number(options.lon);
    const point=Number.isFinite(latitude)&&Number.isFinite(longitude)?{latitude,longitude}:null;
    this.setData({point,place:point?'当前地图中心':'还未选择起点',today,lastDay:beijingDate(new Date(now+6*day).toISOString()),
      date:nextHour>17?beijingDate(new Date(now+day).toISOString()):today,hour:nextHour>17?7:Math.max(6,nextHour),
      species:options.species||'',speciesLabel:decodeURIComponent(options.label||'所有鸟种')});
  },
  onUnload(){this._version++;},
  changed(){this._version++;this._pendingBody='';this._pendingId='';this.setData({answer:null,asked:'',exchanges:[],error:'',busy:false});},
  restart(){this.changed();},
  setPoint(point:Point,place:string){
    this.changed();this.setData({point:{latitude:Number(point.latitude.toFixed(1)),longitude:Number(point.longitude.toFixed(1))},place});
  },
  async locate(){try{const point=await wx.getLocation({type:'gcj02'});this.setPoint(point,'我的位置附近');}
    catch{this.setData({error:'未取得定位，可以使用地图中心或手动选点。'});}},
  pick(){wx.navigateTo({url:'/field/picker/index',events:{point:(point:Point)=>this.setPoint(point,'手动选择的区域')}});},
  filters(event:Input){
    const field=event.currentTarget.dataset.field,value=event.detail.value;
    this.changed();
    if(field==='date')this.setData({date:value});
    if(field==='hour')this.setData({hour:Number(value)});
    if(field==='hours')this.setData({hours:Number(value)+1});
    if(field==='radius')this.setData({radius:ranges[Number(value)]});
  },
  allBirds(){this.changed();this.setData({species:'',speciesLabel:'所有鸟种'});},
  input(event:Input){this.setData({question:event.detail.value});},
  prompt(event:Tap){this.setData({question:String(event.currentTarget.dataset.text)});},
  async ask(){
    const data=this.data;
    if(data.busy)return;
    if(!data.point){this.setData({error:'请先定位或选择出发区域。'});return;}
    const question=data.question.trim()||'这个时段去哪儿观鸟，可以留意哪些鸟？';
    const version=++this._version;
    this.setData({busy:true,error:''});
    try{
      const payload={...data.point,date:data.date,startHour:data.hour,hours:data.hours,radius:data.radius,
        species:data.species,question,parentTurn:data.answer?.turn||null};
      const signature=JSON.stringify(payload);
      if(this._pendingBody!==signature){this._pendingId=key();this._pendingBody=signature;}
      const answer:Plan=await api('/api/v1/map/trip-plan','POST',{...payload,requestId:this._pendingId});
      if(version!==this._version)return;
      const exchanges=data.answer?[...data.exchanges,{turn:data.answer.turn,question:data.asked,answer:data.answer.answer}].slice(-3):[];
      this._pendingBody='';this.setData({answer,asked:question,question:'',exchanges,
        windowLabel:answer.start.slice(0,16).replace('T',' ')+' 至 '+answer.end.slice(5,16).replace('T',' ')});
    }catch(error){if(version===this._version)this.setData({error:error instanceof Error?error.message:'生成失败，请重试。'});}
    finally{if(version===this._version)this.setData({busy:false});}
  },
  map(event:Tap){const stop=this.data.answer?.stops[Number(event.currentTarget.dataset.index)];
    if(stop)openMap(stop.point,this.data.species,this.data.speciesLabel,1);},
  park(event:Tap){const {index,source}=event.currentTarget.dataset;
    const park=source==='site'?this.data.answer?.stops[Number(index)]?.park:this.data.answer?.parks[Number(index)];
    if(park)wx.openLocation({...park.point,name:park.name,scale:14});},
  bird(event:Tap){hub('species',event.currentTarget.dataset.id);},
  record(event:Tap){hub('record',event.currentTarget.dataset.id);}
});
