const gestures=new WeakMap<object,{x:number;y:number;moved:boolean;until:number}>();
Component({
  properties:{canSave:{type:Boolean,value:false},saving:{type:Boolean,value:false},src:{type:String,value:''},width:{type:Number,value:300},height:{type:Number,value:300},fileInfo:{type:Object,value:null},manualInfo:{type:Object,value:null},resolution:{type:String,value:''}},
  data:{flipped:false,canFlip:false},
  observers:{src(){this.setData({flipped:false});},'fileInfo,manualInfo'(fileInfo:unknown,manualInfo:unknown){this.setData({canFlip:!!(fileInfo||manualInfo),flipped:false});}},
  methods:{
    touchStart(event:WechatMiniprogram.TouchEvent){const touch=event.touches[0];if(touch)gestures.set(this,{x:touch.clientX,y:touch.clientY,moved:false,until:gestures.get(this)?.until||0});},
    touchMove(event:WechatMiniprogram.TouchEvent){const state=gestures.get(this),touch=event.touches[0];if(state&&touch&&Math.hypot(touch.clientX-state.x,touch.clientY-state.y)>8)state.moved=true;},
    parametersScrolled(){const state=gestures.get(this)||{x:0,y:0,moved:false,until:0};state.until=Date.now()+180;gestures.set(this,state);},
    tapCard(){const state=gestures.get(this);if(state&&(state.moved||Date.now()<state.until)){state.moved=false;return;}this.flip();},
    save(){if(this.data.canSave&&!this.data.saving)this.triggerEvent('save');},
    flip(){if(!this.data.fileInfo&&!this.data.manualInfo){wx.showToast({title:'暂无可用拍摄参数',icon:'none'});return;}this.setData({flipped:!this.data.flipped});},
    loaded(event:WechatMiniprogram.CustomEvent<{width:number;height:number}>){this.triggerEvent('loaded',event.detail);},
    failed(){this.triggerEvent('failed');},
    preview(){if(this.data.src)wx.previewImage({current:this.data.src,urls:[this.data.src]});}
  }
});
