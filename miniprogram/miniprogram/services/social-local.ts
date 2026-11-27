/** Device preferences only. Server membership, messages and unread state remain authoritative. */
export type ConversationKind='chat'|'group';
export interface ConversationPrefs {alias:string;pinned:boolean;quiet:boolean;hidden:string;draft:string;reference:string;}
interface Store {version:1;conversations:Record<string,ConversationPrefs>;dismissed:string[];}
const defaults=():ConversationPrefs=>({alias:'',pinned:false,quiet:false,hidden:'',draft:'',reference:''});
const storageKey=(owner:string)=>'bird-assistant.social-local.v1.'+encodeURIComponent(owner);
const conversation=(kind:ConversationKind,id:string)=>kind+':'+id;
function read(owner:string):Store {
  if(!owner||owner.length>160)throw new Error('请先加载社区账号。');
  const v=wx.getStorageSync(storageKey(owner));if(v===''||v==null)return {version:1,conversations:{},dismissed:[]};
  const valid=(p:any)=>p&&typeof p.alias==='string'&&p.alias.length<=40&&typeof p.pinned==='boolean'&&typeof p.quiet==='boolean'
    &&typeof p.hidden==='string'&&p.hidden.length<=2400&&typeof p.draft==='string'&&p.draft.length<=2000&&typeof p.reference==='string'&&p.reference.length<=160;
  if(v.version!==1||!v.conversations||typeof v.conversations!=='object'||Array.isArray(v.conversations)||Object.keys(v.conversations).length>120
    ||!Object.keys(v.conversations).every(k=>/^(chat|group):.{1,160}$/.test(k)&&valid(v.conversations[k]))
    ||!Array.isArray(v.dismissed)||v.dismissed.length>120||!v.dismissed.every((id:unknown)=>typeof id==='string'&&id.length<=160))throw new Error('本机会话设置无法读取，原内容未覆盖。');
  const conversations:Record<string,ConversationPrefs>={};for(const k of Object.keys(v.conversations))conversations[k]={...v.conversations[k]};
  return {version:1,conversations,dismissed:v.dismissed.slice()};
}
export function conversationPrefs(owner:string,kind:ConversationKind,id:string):ConversationPrefs {return {...(read(owner).conversations[conversation(kind,id)]||defaults())};}
export function saveConversationPrefs(owner:string,kind:ConversationKind,id:string,patch:Partial<ConversationPrefs>){
  if(!id||id.length>160)throw new Error('会话不存在。');
  const v=read(owner),k=conversation(kind,id),next={...(v.conversations[k]||defaults()),...patch};
  if(next.alias.length>40||next.draft.length>2000||next.reference.length>160)throw new Error('本机会话内容超出长度限制。');
  if(!v.conversations[k]&&Object.keys(v.conversations).length>=120)throw new Error('本机会话设置已达上限，文字仍保留。');
  v.conversations[k]=next;wx.setStorageSync(storageKey(owner),v);return {...next};
}
export function inboxFingerprint(item:{created?:string;body?:string}){return JSON.stringify([item.created||'',item.body||'']);}
export function localInbox(owner:string,items:any[],showHidden=false){
  const v=read(owner);
  return items.map(item=>{const p=v.conversations[conversation('chat',item.peer)]||defaults();return {...item,alias:p.alias,pinned:p.pinned,quiet:p.quiet,hidden:!!p.hidden&&p.hidden===inboxFingerprint(item),excerpt:p.draft?'草稿 · '+p.draft:item.body,hasDraft:!!p.draft};})
    .filter(item=>showHidden||!item.hidden).sort((a,b)=>Number(b.pinned)-Number(a.pinned)||String(b.created).localeCompare(String(a.created))||String(a.peer).localeCompare(String(b.peer)));
}
export function localGroups(owner:string,items:any[]){return items.map(item=>{const p=conversationPrefs(owner,'group',item.id);return {...item,alias:p.alias,pinned:p.pinned,quiet:p.quiet};}).sort((a,b)=>Number(b.pinned)-Number(a.pinned));}
export function dismissActivity(owner:string,id:string){const v=read(owner);v.dismissed=Array.from(new Set([id,...v.dismissed])).slice(0,120);wx.setStorageSync(storageKey(owner),v);}
export function localActivity(owner:string,items:any[],showHidden=false){const v=read(owner);return items.map(item=>({...item,hidden:v.dismissed.includes(item.id)})).filter(item=>showHidden||!item.hidden);}
export function restoreActivity(owner:string){const v=read(owner);v.dismissed=[];wx.setStorageSync(storageKey(owner),v);}

export interface PublicShare {kind:'publication';id:string;title:string;}
const SHARE_PREFIX='[羽迹公开内容] ';
export function publicShareBody(share:PublicShare){
  if(!/^(post|pub|obs)_[A-Za-z0-9_-]{1,140}$/.test(share.id))throw new Error('只能转发可识别的公开内容。');
  return SHARE_PREFIX+JSON.stringify({id:share.id,title:share.title.slice(0,100)});
}
/** Parse data, never a URL. Opening the card fetches visibility from the normal publication route. */
export function readPublicShare(body:string):PublicShare|null {
  if(!body.startsWith(SHARE_PREFIX))return null;
  try{const v=JSON.parse(body.slice(SHARE_PREFIX.length));if(typeof v.id!=='string'||typeof v.title!=='string'||v.title.length>100)return null;
    publicShareBody({kind:'publication',id:v.id,title:v.title});return {kind:'publication',id:v.id,title:v.title};
  }catch{return null;}
}
