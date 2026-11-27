import {calendarCells,calendarMonth,orderedDates} from '../../services/calendar';
import {beijingDate} from '../../services/observation-context';
type Tap=WechatMiniprogram.TouchEvent;
const touches=new WeakMap<object,{date:string;x:number;y:number;dragged:boolean}>();
const grids=new WeakMap<object,WechatMiniprogram.BoundingClientRectCallbackResult>();
const suppressed=new WeakSet<object>();
Component({
  properties:{open:{type:Boolean,value:false},from:{type:String,value:''},to:{type:String,value:''},min:{type:String,value:''},max:{type:String,value:''},single:{type:Boolean,value:false}},
  data:{dragging:false,month:'',label:'',draftFrom:'',draftTo:'',stage:0,bodyHeight:350,weekdays:['一','二','三','四','五','六','日'],cells:[] as ReturnType<typeof calendarCells>},
  observers:{open:function(open:boolean){touches.delete(this);suppressed.delete(this);this.setData({dragging:false});if(open){this.setData({month:calendarMonth(this.data.from||this.data.min||beijingDate()),draftFrom:this.data.from,draftTo:this.data.to,stage:0,bodyHeight:Math.min(390,Math.max(80,wx.getWindowInfo().windowHeight-210))});this.project();}}},
  pageLifetimes:{resize(){touches.delete(this);this.setData({dragging:false,bodyHeight:Math.min(390,Math.max(80,wx.getWindowInfo().windowHeight-210))});}},
  methods:{
    noop(){},close(){touches.delete(this);this.setData({dragging:false});this.triggerEvent('close');},
    project(){this.setData({label:this.data.month.slice(0,4)+'年 '+Number(this.data.month.slice(5,7))+'月',cells:calendarCells(this.data.month,this.data.draftFrom,this.data.draftTo,this.data.min,this.data.max)});},
    monthChange(event:Tap){const next=calendarMonth(this.data.month,Number(event.currentTarget.dataset.delta));if(this.data.min&&next.slice(0,7)<this.data.min.slice(0,7)||this.data.max&&next.slice(0,7)>this.data.max.slice(0,7))return;this.setData({month:next});this.project();},
    select(event:Tap){if(suppressed.has(this)){suppressed.delete(this);return;}const value=String(event.currentTarget.dataset.date);if(!this.data.cells.some(cell=>cell.value===value&&!cell.disabled))return;
      if(this.data.single)this.setData({draftFrom:value,draftTo:value,stage:2});else if(this.data.stage===1)this.setData({draftFrom:orderedDates(this.data.draftFrom,value).from,draftTo:orderedDates(this.data.draftFrom,value).to,stage:2});else this.setData({draftFrom:value,draftTo:'',stage:1});this.project();},
    dragStart(event:Tap){const date=String(event.currentTarget.dataset.date),touch=event.touches[0];if(this.data.single||this.data.stage!==1||date!==this.data.draftFrom||!touch||!this.data.cells.some(cell=>cell.value===date&&!cell.disabled))return;touches.set(this,{date,x:touch.clientX,y:touch.clientY,dragged:false});suppressed.delete(this);
      wx.createSelectorQuery().in(this).select('.calendar-grid').boundingClientRect(rect=>{if(rect)grids.set(this,rect as WechatMiniprogram.BoundingClientRectCallbackResult);}).exec();},
    dragMove(event:Tap){const start=touches.get(this),touch=event.touches[0],box=grids.get(this);if(!start||!touch||!box||event.touches.length!==1)return;if(!start.dragged&&Math.hypot(touch.clientX-start.x,touch.clientY-start.y)<8)return;
      const column=Math.floor((touch.clientX-box.left)/(box.width/7)),row=Math.floor((touch.clientY-box.top)/42);if(column<0||column>6||row<0||row>5)return;const cell=this.data.cells[row*7+column];if(cell.disabled)return;start.dragged=true;this.setData({dragging:true});const range=orderedDates(start.date,cell.value);this.setData({draftFrom:range.from,draftTo:range.to,stage:2});this.project();},
    dragEnd(){this.setData({dragging:false});if(touches.get(this)?.dragged)suppressed.add(this);touches.delete(this);},
    apply(){if(!this.data.draftFrom)return;this.triggerEvent('change',{from:this.data.draftFrom,to:this.data.draftTo||this.data.draftFrom});},
    clear(){this.triggerEvent('change',{from:'',to:''});}
  }
});
