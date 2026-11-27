import {beginSheetDrag,moveSheetDrag,endSheetDrag,resetSheetDrag} from '../../services/sheet-gesture';
Component({
  properties:{open:{type:Boolean,value:false},title:{type:String,value:'选择'},options:{type:Array,value:[] as string[]},selected:{type:Number,value:0},maxBody:{type:Number,value:324}},
  data:{sheetDragStyle:'',bodyHeight:100},
  observers:{'open, options, maxBody':function(this:WechatMiniprogram.Component.TrivialInstance,open:boolean,options:string[],maxBody:number){resetSheetDrag(this);if(open)this.setData({bodyHeight:Math.min(Math.max(54,options.length*54),Math.max(54,Number(maxBody)||324),Math.max(54,wx.getWindowInfo().windowHeight-180))});}},
  methods:{sheetDragStart(event:WechatMiniprogram.TouchEvent){beginSheetDrag(this,event);},sheetDragMove(event:WechatMiniprogram.TouchEvent){moveSheetDrag(this,event);},sheetDragEnd(){endSheetDrag(this);},sheetDragCancel(){resetSheetDrag(this);},noop(){},close(){this.triggerEvent('close');},choose(event:WechatMiniprogram.TouchEvent){const value=Number(event.currentTarget.dataset.value);if(Number.isInteger(value)&&value>=0&&value<this.data.options.length)this.triggerEvent('change',{value});}}
});
