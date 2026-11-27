import {approximateRegion} from '../../services/region-label';
import {navigate} from '../../services/navigation';
import {api,hub,key,openMap,sessionRevision,sessionState} from '../../services/community';
import {beijingDate,beijingDateTime} from '../../services/observation-context';
import {presentTrip,TripPlan as Plan} from '../services/trip-plan';
import {readTripHistory,saveTripHistory,removeTripHistory,tripHistoryOwner,TripConversation,TripConditions} from '../services/trip-history';
import {adviceParagraphs,adviceSections} from '../services/trip-advice';

type Tap = WechatMiniprogram.TouchEvent;
type Input = WechatMiniprogram.CustomEvent<{value:string}>;
type Point = {latitude:number;longitude:number};
const day = 86400000;
const ranges = [10,30,80];
const times = Array.from({length:24},(_,hour)=>String(hour).padStart(2,'0')+':00');

Page({
  data:{regionLabel:'',filterMaxBody:216,filterOpen:false,filterField:'',filterOptions:[] as string[],filterSelected:0,filterTitle:'',calendarOpen:false,answerExpanded:false,tripExpanded:{} as Record<string,boolean>,accountChecking:false,showHistory:false,historyLoading:false,historyRows:[] as {id:string;question:string;place:string;updated:string;date:string;conditions:string;excerpt:string;turns:number}[],historyNotice:'',historySaved:'',point:null as Point|null,place:'还未选择起点',today:'',lastDay:'',date:'',hour:7,times,
    hours:2,durations:[1,2,3,4],radius:30,ranges,species:'',speciesLabel:'所有鸟种',question:'',
    sections:[] as {title:string;lines:string[]}[],paragraphs:[] as string[],sourcesOpen:false,detailOpen:false,historyOpen:false,exchanges:[] as {turn:string;question:string;answer:string}[],answer:null as Plan|null,asked:'',busy:false,error:'',windowLabel:''},
  _owner:'',_accountVersion:0,_version:0,_conversation:null as TripConversation|null,
  _pendingId:'',_pendingBody:'',
  onLoad(options:Record<string,string|undefined>){
    if(options.history==='1'){this.setData({showHistory:true});wx.setNavigationBarTitle?.({title:'观鸟咨询记录'});void this.loadHistory();return;}
    const now=Date.now(),instant=new Date(now).toISOString(),today=beijingDate(instant);
    const nextHour=Number(beijingDateTime(instant).slice(11,13))+1;
    const latitude=Number(options.lat),longitude=Number(options.lon);
    const point=Number.isFinite(latitude)&&Number.isFinite(longitude)?{latitude,longitude}:null;
    this.setData({point,place:point?(options.place?decodeURIComponent(options.place):'当前地图中心'):'还未选择起点',regionLabel:approximateRegion(point),today,lastDay:beijingDate(new Date(now+6*day).toISOString()),
      date:nextHour>17?beijingDate(new Date(now+day).toISOString()):today,hour:nextHour>17?7:Math.max(6,nextHour),
      species:options.species||'',speciesLabel:decodeURIComponent(options.label||'所有鸟种')});
  },
  onHide(){this.setData({filterOpen:false,calendarOpen:false});this._version++;this._accountVersion++;this.setData({busy:false,accountChecking:!!this._owner});},
  onShow(){if(this.data.accountChecking)void this.checkAccount();},
  onUnload(){this._version++;this._accountVersion++;},
  clearAccount(){this._conversation=null;this._owner='';this._pendingId='';this._pendingBody='';this.setData({answer:null,exchanges:[],historyRows:[],point:null,place:'还未选择起点',regionLabel:'',asked:'',question:'',historyNotice:'',historySaved:'',accountChecking:false,busy:false,error:'请先登录当前社区账号，再打开咨询记录。'});},
  async checkAccount(){const token=++this._accountVersion,revision=sessionRevision();if(sessionState()==='out'){this.clearAccount();return;}try{const owner=await tripHistoryOwner();if(token!==this._accountVersion||revision!==sessionRevision())return;if(owner!==this._owner)this.clearAccount();else this.setData({accountChecking:false});}catch{if(token===this._accountVersion)this.setData({error:'暂时无法确认当前账号，请重试。'});}},
  newConsultation(){this.restart();this.onLoad({});this.setData({showHistory:false});wx.setNavigationBarTitle?.({title:'观鸟出行顾问'});},
  changed(){this._conversation=null;this._version++;this._pendingBody='';this._pendingId='';this.setData({answer:null,asked:'',exchanges:[],historyOpen:false,error:'',busy:false});},
  restart(){this.changed();this.setData({historyNotice:'',historySaved:''});},
  async loadHistory(){const version=++this._version,revision=sessionRevision();this.setData({historyLoading:true,error:''});try{const owner=await tripHistoryOwner();if(version!==this._version||revision!==sessionRevision())return;this._owner=owner;const rows=readTripHistory(owner);this.setData({historyRows:rows.map(row=>({id:row.id,question:row.turns[row.turns.length-1]?.question||'观鸟咨询',place:row.conditions.place,updated:beijingDateTime(row.updated),date:row.conditions.date,conditions:row.conditions.hours+'小时 · '+row.conditions.radius+'公里 · '+row.conditions.speciesLabel,excerpt:row.turns[row.turns.length-1]?.plan.brief?.headline||row.turns[row.turns.length-1]?.plan.answer.slice(0,110)||'',turns:row.turns.length}))});}catch(error){if(version===this._version)this.setData({error:error instanceof Error?error.message:'记录暂时无法读取。'});}finally{if(version===this._version)this.setData({historyLoading:false});}},
  async removeHistory(event:Tap){const id=String(event.currentTarget.dataset.id);if(!id||!this._owner)return;const owner=this._owner,revision=sessionRevision();const result=await wx.showModal({title:'删除这次咨询记录？',content:'只删除当前账号保存在本机的这段咨询，不影响其他记录。',confirmText:'删除记录'});if(!result.confirm||owner!==this._owner||revision!==sessionRevision())return;try{removeTripHistory(owner,id);void this.loadHistory();}catch(error){this.setData({error:error instanceof Error?error.message:'记录未删除。'});}},
  async openHistory(event:Tap){const version=++this._version,revision=sessionRevision();try{const owner=await tripHistoryOwner();if(version!==this._version||revision!==sessionRevision())return;this._owner=owner;const row=readTripHistory(owner).find(item=>item.id===event.currentTarget.dataset.id);if(!row)return;this._conversation=row;const last=row.turns[row.turns.length-1];this.onLoad({});this._conversation=row;const answer=presentTrip(last.plan),expired=Date.now()-Date.parse(last.saved)>=3600000;
    this.setData({...row.conditions,regionLabel:approximateRegion(row.conditions.point),...(row.conditions.date<this.data.today?{date:this.data.date,hour:this.data.hour}:{}),showHistory:false,answer,asked:last.question,sections:adviceSections(answer.brief),paragraphs:adviceParagraphs(answer.answer),exchanges:row.turns.slice(0,-1).map(turn=>({turn:turn.plan.turn,question:turn.question,answer:turn.plan.answer})),historyNotice:expired?'这是保存的历史建议，天气和鸟讯可能已变化。追问将开启新一轮咨询。':'这是保存的咨询，可在原对话有效期内继续追问。',windowLabel:answer.start.slice(0,16).replace('T',' ')+' 至 '+answer.end.slice(5,16).replace('T',' ')});
    wx.setNavigationBarTitle?.({title:'观鸟出行顾问'});wx.pageScrollTo?.({scrollTop:0,duration:0});
  }catch(error){if(version===this._version)this.setData({error:error instanceof Error?error.message:'记录未打开。'});}},
  listHistory(){this.setData({showHistory:true});void this.loadHistory();},
  setPoint(point:Point,place:string){
    this.changed();this.setData({point:{latitude:Number(point.latitude.toFixed(1)),longitude:Number(point.longitude.toFixed(1))},place,regionLabel:approximateRegion(point)});
  },
  async locate(){try{const point=await wx.getLocation({type:'gcj02'});this.setPoint(point,'我的位置附近');}
    catch{this.setData({error:'未取得定位，可以使用地图中心或手动选点。'});}},
  pick(){navigate({url:'/field/picker/index',events:{point:(point:Point&{name?:string;address?:string})=>this.setPoint(point,point.address||point.name||'手动选择的区域')}});},
  openCondition(event:Tap){const field=String(event.currentTarget.dataset.field);if(field==='date'){this.setData({calendarOpen:true});return;}const options=field==='hour'?this.data.times:field==='hours'?this.data.durations.map(value=>String(value)+' 小时'):this.data.ranges.map(value=>String(value)+' 公里');this.setData({filterMaxBody:field==='hour'?216:270,filterOpen:true,filterField:field,filterTitle:field==='hour'?'出发时间':field==='hours'?'停留时长':'搜索范围',filterOptions:options,filterSelected:field==='hour'?this.data.hour:field==='hours'?this.data.hours-1:this.data.ranges.indexOf(this.data.radius)});},
  closeCondition(){this.setData({filterOpen:false,calendarOpen:false});},
  chooseCondition(event:WechatMiniprogram.CustomEvent<{value:number}>){this.filters({currentTarget:{dataset:{field:this.data.filterField}},detail:{value:String(event.detail.value)}} as unknown as Input);this.closeCondition();},
  chooseDate(event:WechatMiniprogram.CustomEvent<{from:string}>){if(event.detail.from)this.filters({currentTarget:{dataset:{field:'date'}},detail:{value:event.detail.from}} as unknown as Input);this.closeCondition();},
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
    const data={...this.data},baseConversation=this._conversation?JSON.parse(JSON.stringify(this._conversation)) as TripConversation:null;
    if(data.busy)return;
    if(!data.point){this.setData({error:'请先定位或选择出发区域。'});return;}
    const question=data.question.trim()||'这个时段去哪儿观鸟，可以留意哪些鸟？';
    const version=++this._version,revision=sessionRevision();
    this.setData({busy:true,error:''});
    try{
      const owner=await tripHistoryOwner();if(version!==this._version||revision!==sessionRevision())return;if(this._owner&&this._owner!==owner){this.clearAccount();return;}this._owner=owner;
      const last=baseConversation?.turns[baseConversation.turns.length-1],expired=last&&Date.now()-Date.parse(last.saved)>=3600000;
      const payload={...data.point,date:data.date,startHour:data.hour,hours:data.hours,radius:data.radius,
        species:data.species,question,parentTurn:expired?null:data.answer?.turn||null};
      const signature=JSON.stringify(payload);
      if(this._pendingBody!==signature){this._pendingId=key();this._pendingBody=signature;}
      const requestId=this._pendingId;
      const raw:Plan=await api('/api/v1/map/trip-plan','POST',{...payload,requestId});
      const answer=presentTrip(raw);
      if(revision!==sessionRevision())return;
      const saved=new Date().toISOString(),conditions:TripConditions={point:data.point,place:data.place,date:data.date,hour:data.hour,hours:data.hours,radius:data.radius,species:data.species,speciesLabel:data.speciesLabel};
      const conversation:TripConversation={id:baseConversation?.id||requestId,updated:saved,conditions,turns:[...(baseConversation?.turns||[]),{question,plan:answer,saved}].slice(-6)};
      let historySaved='已保存到本机咨询记录';try{saveTripHistory(owner,conversation);}catch(error){historySaved=error instanceof Error?error.message:'本机记录未保存，请先保留本次回答。';}
      if(version!==this._version)return;
      this._conversation=conversation;
      const exchanges=data.answer?[...data.exchanges,{turn:data.answer.turn,question:data.asked,answer:data.answer.answer}].slice(-3):[];
      this._pendingBody='';this.setData({answer,historySaved,historyNotice:expired?'原对话已过期，本次已开启新咨询。':'',sections:adviceSections(answer.brief),paragraphs:adviceParagraphs(answer.answer),sourcesOpen:false,detailOpen:false,answerExpanded:false,tripExpanded:{},asked:question,question:'',exchanges,
        windowLabel:answer.start.slice(0,16).replace('T',' ')+' 至 '+answer.end.slice(5,16).replace('T',' ')});
    }catch(error){if(version===this._version){if(error instanceof Error&&/对话已过期/.test(error.message)&&this._conversation?.turns.length)this._conversation.turns[this._conversation.turns.length-1].saved='1970-01-01T00:00:00Z';this.setData({error:error instanceof Error?error.message:'生成失败，请重试。'});}}
    finally{if(version===this._version)this.setData({busy:false});}
  },
  referenceMap(event:Tap){const item=this.data.answer?.referenceMap?.find(row=>row.id===event.currentTarget.dataset.id);if(item)openMap(item.point,this.data.species,this.data.speciesLabel,item.kind==='area'?1:0,{scale:item.kind==='area'?11:14,precisionLabel:item.precisionLabel});},
  map(event:Tap){const stop=this.data.answer?.stops[Number(event.currentTarget.dataset.index)];
    if(stop)openMap(stop.point,this.data.species,this.data.speciesLabel,1);},
  history(){this.setData({historyOpen:!this.data.historyOpen});},
  toggleAnswer(){this.setData({answerExpanded:!this.data.answerExpanded});},
  toggleTripSection(event:Tap){const id=String(event.currentTarget.dataset.id);this.setData({tripExpanded:{...this.data.tripExpanded,[id]:!this.data.tripExpanded[id]}});},
  details(){this.setData({detailOpen:!this.data.detailOpen});},
  copySource(event:Tap){const url=event.currentTarget.dataset.url;if(typeof url==='string'&&url.startsWith('https://'))void wx.setClipboardData({data:url});},
  sources(){this.setData({sourcesOpen:!this.data.sourcesOpen});},
  externalMap(event:Tap){const stop=this.data.answer?.stops[Number(event.currentTarget.dataset.index)];
    if(stop)wx.openLocation({...stop.point,name:stop.name+'（公开观测区域）',address:'约十公里的公开区域中心，并非照片的精确拍摄位置。',scale:11,fail:()=>this.setData({error:'位置未打开，可使用「羽迹地图」查看该区域。'})});},
  park(event:Tap){const {index,source}=event.currentTarget.dataset;
    const park=source==='site'?this.data.answer?.stops[Number(index)]?.park:this.data.answer?.parks[Number(index)];
    if(park)wx.openLocation({...park.point,name:park.name,scale:14,fail:()=>this.setData({error:'地点未打开，请稍后重试。'})});},
  bird(event:Tap){hub('species',event.currentTarget.dataset.id);},
  record(event:Tap){hub('record',event.currentTarget.dataset.id);}
});
