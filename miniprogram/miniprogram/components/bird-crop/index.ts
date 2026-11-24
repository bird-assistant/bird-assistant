Component({
  properties:{src:String,box:{type:Object,value:null as {x1:number;y1:number;x2:number;y2:number}|null}},
  data:{style:'',height:'65%',width:0,pixelsHigh:0},
  observers:{'box,width,pixelsHigh':function(){this.reframe();}},
  methods:{
    loaded(event:WechatMiniprogram.CustomEvent<{width:number;height:number}>){this.setData({width:event.detail.width,pixelsHigh:event.detail.height});},
    reframe(){
      const {width,pixelsHigh}=this.data;
      const box=this.data.box as {x1:number;y1:number;x2:number;y2:number}|null;
      if(!width||!pixelsHigh||!box)return;
      const dx=box.x2-box.x1,dy=box.y2-box.y1;
      if(!(dx>0&&dy>0))return;
      const horizontal=Math.min(1,Math.max(dx*1.25,dy*pixelsHigh/width*1.4));
      const vertical=Math.min(1,Math.max(dy*1.25,horizontal*width/pixelsHigh/1.4));
      const left=Math.max(0,Math.min(1-horizontal,(box.x1+box.x2-horizontal)/2));
      const top=Math.max(0,Math.min(1-vertical,(box.y1+box.y2-vertical)/2));
      this.setData({style:`width:${100/horizontal}%;height:${100/vertical}%;left:${-100*left/horizontal}%;top:${-100*top/vertical}%`,
        height:100*vertical*pixelsHigh/(horizontal*width)+'%'});
    }
  }
});
