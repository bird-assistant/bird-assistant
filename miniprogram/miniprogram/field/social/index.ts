import {api, community, hub, key, sessionState, setSession} from '../../services/community';
import {beijingDateTime} from '../../services/observation-context';
import {connectBusiness} from '../../services/vision-network';

type Tap = WechatMiniprogram.TouchEvent;
type Input = WechatMiniprogram.CustomEvent<{value:string}>;
type Card = {id:string; nickname:string; handle:string; avatar:string; bio:string};
type Friend = Card & {relationship:string};
type ChatLine = {id:string; created:string; sender:string; body:string; nickname?:string};
const screens:Record<string,string> = {account:'社区账号', friends:'我的鸟友',member:'鸟友主页',
  inbox:'私信与通知',chat:'鸟友私信',groups:'观鸟群聊',group:'观鸟群聊',blocked:'屏蔽名单'};
const defaults = {nickname:'',handle:'',avatar:'owl',bio:'',discoverable:true,dm:'friends',bookmarks:'private'};
const call = (path:string, method:'GET'|'POST'|'PUT'|'DELETE'='GET', body?:object) => api(community+path,method,body);
const encoded = encodeURIComponent;
const explain = (error:unknown) => error instanceof Error ? error.message : '请求失败，请重试。';
function confirmAction(content:string){
  return new Promise<boolean>(resolve=>wx.showModal({title:'确认操作',content,success:value=>resolve(value.confirm),fail:()=>resolve(false)}));
}
function merged(history:ChatLine[], incoming:ChatLine[]) {
  const byId=new Map<string,ChatLine>();
  for(const line of history.concat(incoming)) byId.set(line.id,line);
  return Array.from(byId.values()).sort((left,right)=>left.created.localeCompare(right.created))
    .map(line=>({...line,timeLabel:beijingDateTime(line.created)}));
}

Page({
  data:{screen:'account',id:'',self:'',active:false,ready:false,working:false,editing:false,error:'',
    registered:false,form:{...defaults},account:null as (Card & typeof defaults)|null,
    avatars:['owl','finch','leaf','mountain','water','letter'],visibilities:['private','friends','public'],
    visibilityNames:['仅自己','好友','公开'], term:'', searched:false, matches:[] as Card[],friends:[] as Friend[],
    incoming:[] as Friend[],outgoing:[] as Friend[],accepted:[] as Friend[],blocked:[] as Card[],
    inbox:[] as any[],activity:[] as any[],identifications:[] as any[],groups:[] as any[],invites:[] as any[],group:null as any,
    member:null as any, lines:[] as ChatLine[], earlier:false, text:'',groupName:'', invitees:[] as Friend[]},
  _timer:0,_generation:0,_pending:false,_visible:false,_reference:'',_groupReference:'',_seen:'',
  onLoad(options:Record<string,string|undefined>){
    const screen=options.screen && screens[options.screen]?options.screen:'account';
    this.setData({screen,id:options.id || ''});
    wx.setNavigationBarTitle({title:screens[screen]});
  },
  onShow(){
    this._visible=true;
    if(sessionState()==='active')void this.start();
    else this.clearPrivate();
    if(['inbox','chat','group','groups','friends'].includes(this.data.screen)){
      this._timer=setInterval(()=>{if(this.data.registered && !this.data.working)void this.refresh();},10000);
    }
  },
  onHide(){this.stop();},onUnload(){this.stop();},
  stop(){this._visible=false;this._generation++;this._pending=false;clearInterval(this._timer);},
  onPullDownRefresh(){void this.start().finally(()=>wx.stopPullDownRefresh());},
  clearPrivate(){this._generation++;this._pending=false;this._reference='';this._groupReference='';this._seen='';
    this.setData({active:false,ready:true,registered:false,self:'',account:null,editing:false,form:{...defaults},
      friends:[],incoming:[],outgoing:[],accepted:[],matches:[],blocked:[],inbox:[],activity:[],identifications:[],groups:[],invites:[],
      member:null,group:null,invitees:[],lines:[],earlier:false,text:'',groupName:'',term:'',searched:false,error:''});},
  async start(){
    if(sessionState()!=='active'){this.clearPrivate();return;}
    const generation=++this._generation;
    this._pending=false;this.setData({active:true,error:''});
    try{
      const account=await call('/account');
      if(generation!==this._generation)return;
      this.setData({self:account.id,account:account.profile,registered:!!account.profile,ready:true});
      if(account.profile)await this.refresh();
    }catch(error){if(generation===this._generation)this.setData({error:explain(error),ready:true});}
  },
  async login(){if(this.data.working)return;this.setData({working:true});
    try{await connectBusiness(true);setSession(true);await this.start();}
    catch(error){this.setData({error:explain(error)});}finally{this.setData({working:false});}},
  async logout(){if(!await confirmAction('退出这台设备上的社区账号？'))return;setSession(false);this.clearPrivate();},
  edit(){this.setData({editing:true,form:{...defaults,...this.data.account},error:''});},
  cancel(){this.setData({editing:false,error:''});},
  formInput(event:Input){const field=String(event.currentTarget.dataset.field);this.setData({['form.'+field]:event.detail.value});},
  choice(event:Tap){this.setData({['form.'+event.currentTarget.dataset.field]:event.currentTarget.dataset.value});},
  toggleSearch(event:WechatMiniprogram.CustomEvent<{value:boolean}>){this.setData({'form.discoverable':event.detail.value});},
  async save(){
    const form=this.data.form;
    if(!form.nickname.trim() || !/^[A-Za-z0-9_]{3,24}$/.test(form.handle)){this.setData({error:'请填写昵称，鸟友号需为 3–24 位字母、数字或下划线。'});return;}
    await this.run(async()=>{
      await call('/account','PUT',{nickname:form.nickname,handle:form.handle,bio:form.bio,avatar:form.avatar,
        discoverable:!!form.discoverable,dm:form.dm,bookmarks:form.bookmarks});
      this.setData({editing:false});await this.start();
    });
  },
  go(event:Tap){hub(String(event.currentTarget.dataset.screen),String(event.currentTarget.dataset.id||''));},
  input(event:Input){const field=String(event.currentTarget.dataset.field);this.setData({[field]:event.detail.value});
    if(field==='text')this._reference='';if(field==='groupName')this._groupReference='';},
  async run(action:()=>Promise<void>){
    if(this.data.working)return;this.setData({working:true,error:''});
    try{await action();}catch(error){if(this._visible)this.setData({error:explain(error)});}finally{this.setData({working:false});}
  },
  async refresh(older=false){
    if(!this.data.registered || sessionState()!=='active' || this._pending)return;
    const generation=this._generation;
    this._pending=true;
    const valid=()=>this._visible && generation===this._generation && sessionState()==='active';
    const screen=this.data.screen, peer=encoded(this.data.id);
    try{
      if(screen==='friends' || screen==='inbox' || screen==='group'){
        const friends:Friend[]=(await call('/friends')).items;
        if(!valid())return;
        this.setData({friends,incoming:friends.filter(item=>item.relationship==='incoming'),
          outgoing:friends.filter(item=>item.relationship==='outgoing'),accepted:friends.filter(item=>item.relationship==='friends')});
      }
      if(screen==='member'||screen==='chat'){
        const member=await call('/members/'+peer);if(!valid())return;this.setData({member});
        if(screen==='chat')wx.setNavigationBarTitle({title:member.profile.nickname});
      }
      if(screen==='inbox'||screen==='groups'){
        const groups=(await call('/groups')).items;if(!valid())return;
        this.setData({groups:groups.filter((item:any)=>item.state==='joined'),invites:groups.filter((item:any)=>item.state==='invited')});
        if(screen==='inbox'){
          const result=await Promise.all([call('/inbox'),call('/activity')]);if(!valid())return;
          this.setData({inbox:result[0].items,activity:result[1].items,identifications:result[1].identifications||[]});
        }
      }
      if(screen==='blocked'){const result=await call('/blocks');if(valid())this.setData({blocked:result.items});}
      if(screen==='chat'||screen==='group'){
        const history=this.data.lines;
        const cursor=older && history.length?'?before='+encoded(history[0].created):'';
        const path=(screen==='chat'?'/messages/':'/groups/')+peer;
        const result=await call(path+cursor);if(!valid())return;
        const incoming:ChatLine[]=result.items;
        this.setData({lines:merged(history,incoming),earlier:older||!history.length?incoming.length===60:this.data.earlier});
        if(screen==='group'){
          const members=new Set(result.members.map((member:Card)=>member.id));
          this.setData({group:result,invitees:this.data.accepted.filter(friend=>!members.has(friend.id))});
          wx.setNavigationBarTitle({title:result.name});
        }
        const received=incoming.filter(line=>line.sender!==this.data.self);
        const last=received[received.length-1];
        if(!older && last && this._seen!==last.id){await call(path+'/read/'+encoded(last.id),'PUT');if(valid())this._seen=last.id;}
      }
    }catch(error){if(valid()){this.setData({error:explain(error)});}}
    finally{if(valid())this._pending=false;}
  },
  older(){void this.refresh(true);},
  async search(){if(!this.data.term.trim())return;await this.run(async()=>{
    const result=await call('/members?q='+encoded(this.data.term.trim()));this.setData({matches:result.items,searched:true});});},
  async mutate(event:Tap){
    const op=String(event.currentTarget.dataset.op), id=encoded(String(event.currentTarget.dataset.id||this.data.id));
    const confirmations:Record<string,string>={remove:'解除好友关系？',block:'屏蔽后将解除好友关系并停止私信。',leave:'退出这个群聊？',disband:'解散后将删除该群和聊天记录。'};
    if(confirmations[op] && !await confirmAction(confirmations[op]))return;
    await this.run(async()=>{
      if(['request','accept','decline','cancel','remove'].includes(op))await call('/friends/'+id+'/'+op,'PUT');
      else if(op==='block'||op==='unblock')await call('/blocks/'+id,op==='block'?'PUT':'DELETE');
      else if(op==='invite')await call('/groups/'+encoded(this.data.id)+'/invites/'+id,'PUT');
      else if(['join','reject','leave','disband'].includes(op))await call('/groups/'+id+'/membership/'+({join:'accept',reject:'decline'}[op]||op),'PUT');
      else if(op==='report')await call('/reports/'+id,'POST',{reason:'举报不当聊天内容，请审核'});
      wx.showToast({title:'已处理',icon:'success'});
      if(['leave','disband','block'].includes(op)){wx.navigateBack();return;}
      await this.start();
    });
  },
  async createGroup(){const name=this.data.groupName.trim();if(!name)return;
    await this.run(async()=>{if(!this._groupReference)this._groupReference=key();
      const result=await call('/groups','POST',{name,reference:this._groupReference});
      this._groupReference='';this.setData({groupName:''});hub('group',result.id);});},
  async send(){const body=this.data.text.trim();if(!body)return;
    await this.run(async()=>{if(!this._reference)this._reference=key();
      const path=this.data.screen==='group'?'/groups/'+encoded(this.data.id)+'/messages':'/messages/'+encoded(this.data.id);
      await call(path,'POST',{body,reference:this._reference});this._reference='';this.setData({text:''});await this.start();});}
});
