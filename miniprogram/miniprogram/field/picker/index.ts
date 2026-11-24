import {Point} from '../../services/community';

Page({
  data:{latitude:39.92,longitude:116.4,point:null as Point|null,markers:[] as Array<{id:number;latitude:number;longitude:number;iconPath:string;width:number;height:number}>,error:''},
  select(latitude:number,longitude:number){
    this.setData({latitude,longitude,point:{latitude,longitude,system:'GCJ-02'},
      markers:[{id:1,latitude,longitude,iconPath:'/assets/icons/pin.png',width:26,height:30}]});
  },
  pick(event:WechatMiniprogram.CustomEvent<{latitude:number;longitude:number}>){this.select(event.detail.latitude,event.detail.longitude);},
  async locate(){try{const pos=await wx.getLocation({type:'gcj02'});this.select(pos.latitude,pos.longitude);}catch{this.setData({error:'未取得定位，可在地图上点选。'});}},
  done(){if(this.data.point){this.getOpenerEventChannel?.().emit?.('point',this.data.point);wx.navigateBack();}}
});
