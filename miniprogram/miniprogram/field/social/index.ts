import {api, community, hub, key, sessionState, sessionRevision, setSession} from '../../services/community';
import {beginSheetDrag,moveSheetDrag,endSheetDrag,resetSheetDrag} from '../../services/sheet-gesture';
import {installAdaptiveSheets,stopAdaptiveSheets} from '../../services/adaptive-sheets';
import {ConversationKind,conversationPrefs,saveConversationPrefs,localInbox,localGroups,localActivity,inboxFingerprint,dismissActivity,restoreActivity,readPublicShare,publicShareBody,PublicShare} from '../../services/social-local';
import {beijingDateTime} from '../../services/observation-context';
import {businessOrigin,connectBusiness} from '../../services/vision-network';

type Tap = WechatMiniprogram.TouchEvent;
type Input = WechatMiniprogram.CustomEvent<{value:string}>;
type Card = {id:string; nickname:string; handle:string; avatar:string; bio:string};
type Friend = Card & {relationship:string};
type ChatLine = {id:string; created:string; sender:string; body:string; nickname?:string};
const screens:Record<string,string> = {account:'社区账号', friends:'我的鸟友',member:'鸟友主页',
  inbox:'私信与通知',chat:'鸟友私信',groups:'观鸟群聊',group:'观鸟群聊',forward:'转发给鸟友',blocked:'屏蔽名单'};
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
    .map(line=>({...line,timeLabel:beijingDateTime(line.created),share:readPublicShare(line.body)}));
}

Page({
  sheetDragStart(event:Tap){beginSheetDrag(this,event);},sheetDragMove(event:Tap){moveSheetDrag(this,event);},sheetDragEnd(){endSheetDrag(this);},sheetDragCancel(){resetSheetDrag(this);},
  data:{settingsOpen:false,sheetDragStyle:'',sheetHeights:{} as Record<string,number>,localError:'',showHidden:false,aliasDraft:'',memberQuery:'',visibleMembers:[] as Card[],prefs:{alias:'',pinned:false,quiet:false},forwardShare:null as PublicShare|null,forwardTarget:null as {id:string;name:string;kind:ConversationKind}|null,forwardReceipt:'',friendTab:'accepted',pageTitle:'社区账号',screen:'account',id:'',self:'',active:false,ready:false,working:false,editing:false,error:'',
    registered:false,form:{...defaults},account:null as (Card & typeof defaults)|null,
    avatars:['owl','finch','leaf','mountain','water','letter'],visibilities:['private','friends','public'],
    visibilityNames:['仅自己','好友','公开'], term:'', searched:false, matches:[] as Card[],friends:[] as Friend[],
    incoming:[] as Friend[],outgoing:[] as Friend[],accepted:[] as Friend[],blocked:[] as Card[],
    inbox:[] as any[],activity:[] as any[],identifications:[] as any[],groups:[] as any[],invites:[] as any[],group:null as any,
    member:null as any, lines:[] as ChatLine[], earlier:false, text:'',groupName:'', invitees:[] as Friend[]},
  _rawInbox:null as any[]|null,_rawActivity:null as any[]|null,_sessionSeen:0,_draftOwner:'',_draftRevision:0,_draftTimer:0,
  _timer:0,_generation:0,_operation:0,_pending:false,_visible:false,_reference:'',_groupReference:'',_seen:'',
  onLoad(options:Record<string,string|undefined>){
    this._sessionSeen=sessionRevision();this._rawInbox=[];this._rawActivity=[];installAdaptiveSheets(this,()=>this.data.settingsOpen);
    const screen=options.screen && screens[options.screen]?options.screen:'account';
    this.setData({screen,id:options.id || '',pageTitle:screens[screen],friendTab:['accepted','incoming','outgoing'].includes(options.tab||'')?options.tab!:'accepted'});
    wx.setNavigationBarTitle({title:screens[screen]});
  },
  onShow(){
    clearInterval(this._timer);this._visible=true;
    if(sessionState()==='active')void this.start();
    else this.clearPrivate();
    if(['inbox','chat','group','groups','friends'].includes(this.data.screen)){
      this._timer=setInterval(()=>{if(this.data.registered && !this.data.working)void this.refresh();},10000);
    }
  },
  onHide(){this.saveDraft();this.stop();},onUnload(){this.saveDraft();this.stop();stopAdaptiveSheets(this);},
  stop(){clearTimeout(this._draftTimer);resetSheetDrag(this);this.setData({settingsOpen:false});this._visible=false;this._generation++;this._operation++;this._pending=false;clearInterval(this._timer);this.setData({working:false});},
  onPullDownRefresh(){if(this.data.settingsOpen){wx.stopPullDownRefresh();return;}void this.start().finally(()=>wx.stopPullDownRefresh());},
  clearPrivate(){clearTimeout(this._draftTimer);this._draftOwner='';this._rawInbox=[];this._rawActivity=[];this._generation++;this._operation++;this._pending=false;this._reference='';this._groupReference='';this._seen='';
    this.setData({active:false,ready:true,working:false,registered:false,self:'',account:null,editing:false,form:{...defaults},
      friends:[],incoming:[],outgoing:[],accepted:[],matches:[],blocked:[],inbox:[],activity:[],identifications:[],groups:[],invites:[],
      settingsOpen:false,prefs:{alias:'',pinned:false,quiet:false},aliasDraft:'',memberQuery:'',showHidden:false,localError:'',forwardShare:null,forwardTarget:null,forwardReceipt:'',visibleMembers:[],member:null,group:null,invitees:[],lines:[],earlier:false,text:'',groupName:'',term:'',searched:false,error:''});},
  async start(){
    if(this._sessionSeen!==sessionRevision()){this._sessionSeen=sessionRevision();this.clearPrivate();this.setData({ready:false});}
    if(sessionState()!=='active'){this.clearPrivate();return;}
    const generation=++this._generation,revision=sessionRevision();
    this._pending=false;this.setData({active:true,error:''});
    try{
      const account=await call('/account');
      if(!this._visible||generation!==this._generation||revision!==sessionRevision()||sessionState()!=='active')return;
      this.setData({self:account.id,account:account.profile,registered:!!account.profile,ready:true});
      if(account.profile){this.restoreDraft();await this.refresh();}
    }catch(error){if(this._visible&&generation===this._generation&&revision===sessionRevision())this.setData({error:explain(error),ready:true});}
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
    await this.run(async current=>{
      await call('/account','PUT',{nickname:form.nickname,handle:form.handle,bio:form.bio,avatar:form.avatar,
        discoverable:!!form.discoverable,dm:form.dm,bookmarks:form.bookmarks});
      if(current()){this.setData({editing:false});await this.start();}
    });
  },
  friendTab(event:Tap){const tab=String(event.currentTarget.dataset.tab);if(['accepted','incoming','outgoing'].includes(tab))this.setData({friendTab:tab});},
  copyAccountIdentity(){if(!this.data.self||sessionState()!=='active')return;let appId='未提供';try{appId=wx.getAccountInfoSync?.().miniProgram.appId||appId;}catch{}const data=['羽迹账号核对（不含登录令牌）','小程序：'+appId,'服务：'+businessOrigin(),'社区ID：'+this.data.self,'鸟友号：'+(this.data.account?.handle||'未创建')].join('\n');wx.setClipboardData({data,fail:()=>this.setData({localError:'账号核对信息未能复制，请重试。'})});},
  copyHandle(){const handle=this.data.account?.handle;if(handle)wx.setClipboardData({data:handle,fail:()=>this.setData({localError:'鸟友号未能复制，请重试。'})});},
  friendRequests(){wx.navigateTo({url:'/field/social/index?screen=friends&tab=incoming'});},
  back(){wx.navigateBack({fail:()=>wx.switchTab({url:'/pages/community/index'})});},
  go(event:Tap){hub(String(event.currentTarget.dataset.screen),String(event.currentTarget.dataset.id||''));},
  input(event:Input){const field=String(event.currentTarget.dataset.field);this.setData({[field]:event.detail.value});
    if(field==='text'){this._reference='';clearTimeout(this._draftTimer);this._draftTimer=setTimeout(()=>this.saveDraft(),450);}if(field==='memberQuery')this.projectMembers();if(field==='groupName')this._groupReference='';},
  async run(action:(current:()=>boolean)=>Promise<void>){
    if(this.data.working)return;const operation=++this._operation,revision=sessionRevision();this.setData({working:true,error:''});
    const current=()=>this._visible&&operation===this._operation&&revision===sessionRevision()&&sessionState()==='active';
    try{await action(current);}catch(error){if(current())this.setData({error:explain(error)});}finally{if(current())this.setData({working:false});}
  },
  async refresh(older=false){
    if(!this.data.registered || sessionState()!=='active' || this._pending)return;
    const generation=this._generation,revision=sessionRevision();
    this._pending=true;
    const valid=()=>this._visible && generation===this._generation && revision===sessionRevision() && sessionState()==='active';
    const screen=this.data.screen, peer=encoded(this.data.id);
    try{
      if(screen==='friends' || screen==='inbox' || screen==='group' || screen==='forward'){
        const friends:Friend[]=(await call('/friends')).items;
        if(!valid())return;
        this.setData({friends,incoming:friends.filter(item=>item.relationship==='incoming'),
          outgoing:friends.filter(item=>item.relationship==='outgoing'),accepted:friends.filter(item=>item.relationship==='friends')});
      }
      if(screen==='member'||screen==='chat'){
        const member=await call('/members/'+peer);if(!valid())return;this.setData({member});
        if(screen==='chat'){wx.setNavigationBarTitle({title:member.profile.nickname});this.setData({pageTitle:member.profile.nickname});}
      }
      if(screen==='inbox'||screen==='groups'||screen==='forward'){
        const groups=(await call('/groups')).items;if(!valid())return;
        let joined=groups.filter((item:any)=>item.state==='joined');try{joined=localGroups(this.data.self,joined);}catch(error){this.setData({localError:explain(error)});}
        this.setData({groups:joined,invites:groups.filter((item:any)=>item.state==='invited')});
        if(screen==='inbox'){
          const result=await Promise.all([call('/inbox'),call('/activity')]);if(!valid())return;
          this._rawInbox=result[0].items.map((item:any)=>({...item,timeLabel:beijingDateTime(item.created)}));this._rawActivity=result[1].items.map((item:any)=>({...item,timeLabel:beijingDateTime(item.created)}));this.projectInbox();this.setData({identifications:result[1].identifications||[]});
        }
      }
      if(screen==='forward'){const post=await call('/publications/'+peer);if(!valid())return;if(post.visibility!=='public')throw new Error('仅可转发公开内容。');const share:PublicShare={kind:'publication',id:post.id,title:String(post.title||post.speciesName||'羽迹公开内容')};publicShareBody(share);this.setData({forwardShare:share});}
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
          this.setData({group:result,invitees:this.data.accepted.filter(friend=>!members.has(friend.id))});this.projectMembers();
          wx.setNavigationBarTitle({title:result.name});this.setData({pageTitle:result.name});
        }
        const received=incoming.filter(line=>line.sender!==this.data.self);
        const last=received[received.length-1];
        if(!older && last && this._seen!==last.id){await call(path+'/read/'+encoded(last.id),'PUT');if(valid())this._seen=last.id;}
      }
    }catch(error){if(valid()){this.setData({error:explain(error)});}}
    finally{if(valid())this._pending=false;}
  },
  older(){void this.refresh(true);},
  async search(){const term=this.data.term.trim();if(!term)return;await this.run(async current=>{
    const result=await call('/members?q='+encoded(term));if(current()&&this.data.term.trim()===term)this.setData({matches:result.items,searched:true});});},
  async mutate(event:Tap){
    const op=String(event.currentTarget.dataset.op), id=encoded(String(event.currentTarget.dataset.id||this.data.id));
    const confirmations:Record<string,string>={remove:'解除好友关系？',block:'屏蔽后将解除好友关系并停止私信。',leave:'退出这个群聊？',disband:'解散后将删除该群和聊天记录。'};
    if(confirmations[op] && !await confirmAction(confirmations[op]))return;
    await this.run(async current=>{
      if(['request','accept','decline','cancel','remove'].includes(op))await call('/friends/'+id+'/'+op,'PUT');
      else if(op==='block'||op==='unblock')await call('/blocks/'+id,op==='block'?'PUT':'DELETE');
      else if(op==='invite')await call('/groups/'+encoded(this.data.id)+'/invites/'+id,'PUT');
      else if(['join','reject','leave','disband'].includes(op))await call('/groups/'+id+'/membership/'+({join:'accept',reject:'decline'}[op]||op),'PUT');
      else if(op==='report')await call('/reports/'+id,'POST',{reason:'举报不当聊天内容，请审核'});
      if(!current())return;wx.showToast({title:'已处理',icon:'success'});
      if(['leave','disband','block'].includes(op)){wx.navigateBack();return;}
      await this.start();
    });
  },
  async createGroup(){const name=this.data.groupName.trim();if(!name)return;
    await this.run(async current=>{if(!this._groupReference)this._groupReference=key();const reference=this._groupReference;
      const result=await call('/groups','POST',{name,reference});if(!current())return;
      if(this._groupReference===reference)this._groupReference='';
      if(this.data.groupName.trim()===name){this.setData({groupName:''});hub('group',result.id);}else{wx.showToast({title:'群聊已创建，可从群聊列表查看',icon:'none'});await this.refresh();}
    });},
  restoreDraft(){
    if(!['chat','group'].includes(this.data.screen)||this._draftOwner===this.data.self&&this._draftRevision===sessionRevision())return;
    this._draftOwner=this.data.self;this._draftRevision=sessionRevision();this.setData({text:'',lines:[],prefs:{alias:'',pinned:false,quiet:false},aliasDraft:'',localError:''});this._reference='';
    try{const prefs=conversationPrefs(this.data.self,this.data.screen as ConversationKind,this.data.id);this._reference=prefs.reference;this.setData({text:prefs.draft,prefs,aliasDraft:prefs.alias});}
    catch(error){this.setData({localError:explain(error)});}
  },
  saveDraft(){
    clearTimeout(this._draftTimer);if(!this._draftOwner||this._draftOwner!==this.data.self||this._draftRevision!==sessionRevision()||sessionState()!=='active')return;
    try{saveConversationPrefs(this._draftOwner,this.data.screen as ConversationKind,this.data.id,{draft:this.data.text,reference:this._reference});}
    catch(error){this.setData({localError:explain(error)});}
  },
  projectInbox(){
    try{this.setData({inbox:localInbox(this.data.self,this._rawInbox||[],this.data.showHidden).map(item=>({...item,excerpt:item.hasDraft?item.excerpt:readPublicShare(item.body)?.title?'公开内容 · '+readPublicShare(item.body)!.title:item.body})),activity:localActivity(this.data.self,this._rawActivity||[],this.data.showHidden)});}
    catch(error){this.setData({inbox:this._rawInbox||[],activity:this._rawActivity||[],localError:explain(error)});}
  },
  hidden(){this.setData({showHidden:!this.data.showHidden});this.projectInbox();},
  toggleHiddenConversation(event:Tap){const item=this.data.inbox.find(row=>row.peer===event.currentTarget.dataset.id);if(item?.hidden)this.restoreConversation(event);else this.hideConversation(event);},
  hideConversation(event:Tap){const item=this._rawInbox?.find(row=>row.peer===event.currentTarget.dataset.id);if(!item)return;
    try{saveConversationPrefs(this.data.self,'chat',item.peer,{hidden:inboxFingerprint(item)});this.projectInbox();}catch(error){this.setData({localError:explain(error)});}},
  restoreConversation(event:Tap){try{saveConversationPrefs(this.data.self,'chat',String(event.currentTarget.dataset.id),{hidden:''});this.projectInbox();}catch(error){this.setData({localError:explain(error)});}},
  hideActivity(event:Tap){try{dismissActivity(this.data.self,String(event.currentTarget.dataset.id));this.projectInbox();}catch(error){this.setData({localError:explain(error)});}},
  restoreNotifications(){try{restoreActivity(this.data.self);this.projectInbox();}catch(error){this.setData({localError:explain(error)});}},
  openSettings(){if(!this.data.self)return;try{const prefs=conversationPrefs(this.data.self,this.data.screen as ConversationKind,this.data.id);this.setData({prefs,aliasDraft:prefs.alias,settingsOpen:true,memberQuery:'',localError:''});this.projectMembers();}catch(error){this.setData({localError:explain(error)});}},
  closeSettings(){resetSheetDrag(this);this.setData({settingsOpen:false});},
  stopTouch(){},
  preference(event:Tap){const field=String(event.currentTarget.dataset.field);if(field!=='pinned'&&field!=='quiet')return;
    try{const prefs=saveConversationPrefs(this.data.self,this.data.screen as ConversationKind,this.data.id,{[field]:!this.data.prefs[field]});this.setData({prefs,localError:''});}catch(error){this.setData({localError:explain(error)});}},
  saveAlias(){try{const prefs=saveConversationPrefs(this.data.self,this.data.screen as ConversationKind,this.data.id,{alias:this.data.aliasDraft.trim()});this.setData({prefs,localError:''});wx.showToast({title:'本机备注已保存',icon:'success'});}catch(error){this.setData({localError:explain(error)});}},
  projectMembers(){const q=this.data.memberQuery.trim().toLocaleLowerCase();this.setData({visibleMembers:(this.data.group?.members||[]).filter((m:Card)=>!q||(m.nickname+' '+m.handle).toLocaleLowerCase().includes(q))});},
  openShared(event:Tap){const line=this.data.lines.find(item=>item.id===event.currentTarget.dataset.id),share=line?readPublicShare(line.body):null;if(share)hub('record',share.id);},
  chooseForward(event:Tap){const kind=String(event.currentTarget.dataset.kind),id=String(event.currentTarget.dataset.id);const item=kind==='chat'?this.data.accepted.find(m=>m.id===id):kind==='group'?this.data.groups.find(m=>m.id===id):null;if(!item)return;this.setData({forwardTarget:{id,kind:kind as ConversationKind,name:item.nickname||item.name},forwardReceipt:''});this._reference='';},
  async sendForward(){const share=this.data.forwardShare,target=this.data.forwardTarget;if(!share||!target)return;
    await this.run(async current=>{
      const post=await call('/publications/'+encoded(share.id));if(!current())return;if(post.visibility!=='public')throw new Error('内容已撤回或不再公开。');
      if(!this._reference)this._reference=key();const path=target.kind==='group'?'/groups/'+encoded(target.id)+'/messages':'/messages/'+encoded(target.id);
      await call(path,'POST',{body:publicShareBody(share),reference:this._reference});if(!current())return;
      this._reference='';this.setData({forwardReceipt:'已转发给 '+target.name,forwardTarget:null});
    });
  },
  async send(){const draft=this.data.text,body=draft.trim();if(!body)return;
    await this.run(async current=>{if(!this._reference)this._reference=key();const reference=this._reference;
      const path=this.data.screen==='group'?'/groups/'+encoded(this.data.id)+'/messages':'/messages/'+encoded(this.data.id);
      await call(path,'POST',{body,reference});if(!current())return;
      if(this._reference===reference)this._reference='';if(this.data.text===draft)this.setData({text:''});this.saveDraft();await this.refresh();});}
});
