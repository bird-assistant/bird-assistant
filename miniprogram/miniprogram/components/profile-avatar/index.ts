import {profileInitials} from '../../services/profile-initials';
Component({
  properties:{avatar:{type:String,value:'owl'},name:{type:String,value:''},size:{type:Number,value:64}},
  data:{initials:'鸟',letters:false,path:'/assets/avatars/owl.png'},
  observers:{'avatar,name'(avatar:string,name:string){this.setData({initials:profileInitials(name),letters:avatar==='letter'||avatar==='/assets/avatars/letter.png',path:avatar.includes('/')?avatar:'/assets/avatars/'+avatar+'.png'});}}
});
