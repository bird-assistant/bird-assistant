export interface ReplyDraft {post:string;body:string;species:string;speciesName:string;parentId:string;parentName:string;reference:string;}
const key=(owner:string)=>'bird-assistant.reply-drafts.v1.'+encodeURIComponent(owner);
function read(owner:string):ReplyDraft[]{
  if(!owner||owner.length>160)throw new Error('请先加载社区账号。');
  const value=wx.getStorageSync(key(owner));if(value===''||value==null)return [];
  const fields=['post','body','species','speciesName','parentId','parentName','reference'];
  if(value.version!==1||!Array.isArray(value.items)||value.items.length>80||!value.items.every((v:any)=>v&&fields.every(k=>typeof v[k]==='string'&&v[k].length<=(k==='body'?2000:160)))
    ||new Set(value.items.map((v:ReplyDraft)=>v.post)).size!==value.items.length)throw new Error('本机回复草稿无法读取，原内容未覆盖。');
  return value.items.map((v:ReplyDraft)=>({...v}));
}
export function readReplyDraft(owner:string,post:string){return read(owner).find(v=>v.post===post)||null;}
export function saveReplyDraft(owner:string,draft:ReplyDraft){
  const items=read(owner),rest=items.filter(v=>v.post!==draft.post);
  if(!draft.body&&!draft.species&&!draft.parentId){wx.setStorageSync(key(owner),{version:1,items:rest});return;}
  if(rest.length>=80)throw new Error('已有80篇帖子的回复草稿，请先整理后再保存。');
  if(draft.body.length>2000||['post','species','speciesName','parentId','parentName','reference'].some(k=>draft[k as keyof ReplyDraft].length>160))throw new Error('回复草稿超出长度限制。');
  wx.setStorageSync(key(owner),{version:1,items:[{...draft},...rest]});
}
