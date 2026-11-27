import {calendarCells,calendarMonth,orderedDates} from '../../services/calendar';
import {beijingDate} from '../../services/observation-context';
type Tap=WechatMiniprogram.TouchEvent;
const touches=new WeakMap<object,{date:string;x:number;y:number;dragged:boolean}>();
const grids=new WeakMap<object,WechatMiniprogram.BoundingClientRectCallbackResult>();
const suppressed=new WeakSet<object>();
Component({
  properties:{open:{type:Boolean,value:false},from:{type:String,value:''},to:{type:String,value:''},min:{type:String,value:''},max:{type:String,value:''},single:{type:Boolean,value:false}},
  data:{activeEdge:'',dragging:false,month:'',label:'',draftFrom:'',draftTo:'',stage:0,bodyHeight:350,weekdays:['一','二','三','四','五','六','日'],cells:[] as ReturnType<typeof calendarCells>},
  observers:{open:function(open:boolean){touches.delete(this);suppressed.delete(this);this.setData({dragging:false});if(open){this.setData({month:calendarMonth(this.data.from||this.data.min||beijingDate()),draftFrom:this.data.from,draftTo:this.data.to,stage:0,activeEdge:'',bodyHeight:Math.min(390,Math.max(40,wx.getWindowInfo().windowHeight-(this.data.single?210:270)))});this.project();}}},
  pageLifetimes:{resize(){touches.delete(this);this.setData({dragging:false,bodyHeight:Math.min(390,Math.max(40,wx.getWindowInfo().windowHeight-(this.data.single?210:270)))});}},
  methods:{
    noop(){},close(){touches.delete(this);this.setData({dragging:false});this.triggerEvent('close');},
    project(){this.setData({label:this.data.month.slice(0,4)+'年 '+Number(this.data.month.slice(5,7))+'月',cells:calendarCells(this.data.month,this.data.draftFrom,this.data.draftTo,this.data.min,this.data.max)});},
    monthChange(event:Tap){const next=calendarMonth(this.data.month,Number(event.currentTarget.dataset.delta));if(this.data.min&&next.slice(0,7)<this.data.min.slice(0,7)||this.data.max&&next.slice(0,7)>this.data.max.slice(0,7))return;this.setData({month:next});this.project();},
    edge(event:Tap){this.setData({activeEdge:event.currentTarget.dataset.edge==='end'?'end':'start'});},
    select(event:Tap){
      if(suppressed.has(this)){suppressed.delete(this);return;}
      const value=String(event.currentTarget.dataset.date);
      if(!this.data.cells.some(cell=>cell.value===value&&!cell.disabled))return;
      const {draftFrom:from,draftTo:to,activeEdge:edge}=this.data;
      if(this.data.single){this.setData({draftFrom:value,draftTo:value,stage:2});this.project();return;}
      if(from===value&&to===value){this.setData({draftFrom:'',draftTo:'',activeEdge:'',stage:0});}
      else if(from&&to&&value===from){this.setData({draftFrom:'',activeEdge:'start',stage:0});}
      else if(from&&to&&value===to){this.setData({draftTo:'',activeEdge:'end',stage:1});}
      else if(!from&&!to){this.setData({draftFrom:value,activeEdge:'end',stage:1});}
      else if(!from){const range=orderedDates(value,to);this.setData({draftFrom:range.from,draftTo:range.to,activeEdge:'',stage:2});}
      else if(!to){const range=orderedDates(from,value);this.setData({draftFrom:range.from,draftTo:range.to,activeEdge:'',stage:2});}
      else {
        const start=edge==='start'||!edge&&(Math.abs(Date.parse(value)-Date.parse(from))<=Math.abs(Date.parse(value)-Date.parse(to)));
        const range=start?orderedDates(value,to):orderedDates(from,value);
        this.setData({draftFrom:range.from,draftTo:range.to,activeEdge:edge?'':start?'end':'start',stage:2});
      }
      this.project();
    },
    dragStart(event:Tap){const date=String(event.currentTarget.dataset.date),touch=event.touches[0];if(this.data.single||this.data.stage!==1||date!==this.data.draftFrom||!touch||!this.data.cells.some(cell=>cell.value===date&&!cell.disabled))return;touches.set(this,{date,x:touch.clientX,y:touch.clientY,dragged:false});suppressed.delete(this);
      wx.createSelectorQuery().in(this).select('.calendar-grid').boundingClientRect(rect=>{if(rect)grids.set(this,rect as WechatMiniprogram.BoundingClientRectCallbackResult);}).exec();},
    dragMove(event:Tap){const start=touches.get(this),touch=event.touches[0],box=grids.get(this);if(!start||!touch||!box||event.touches.length!==1)return;if(!start.dragged&&Math.hypot(touch.clientX-start.x,touch.clientY-start.y)<8)return;
      const column=Math.floor((touch.clientX-box.left)/(box.width/7)),row=Math.floor((touch.clientY-box.top)/42);if(column<0||column>6||row<0||row>5)return;const cell=this.data.cells[row*7+column];if(cell.disabled)return;start.dragged=true;this.setData({dragging:true});const range=orderedDates(start.date,cell.value);this.setData({draftFrom:range.from,draftTo:range.to,activeEdge:'',stage:2});this.project();},
    dragEnd(){this.setData({dragging:false});if(touches.get(this)?.dragged)suppressed.add(this);touches.delete(this);},
    apply(){if(!this.data.draftFrom)return;this.triggerEvent('change',{from:this.data.draftFrom,to:this.data.draftTo||this.data.draftFrom});},
    clear(){this.triggerEvent('change',{from:'',to:''});}
  }
});
