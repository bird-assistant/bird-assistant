import {readPhotoDetails,readEmbeddedPhotoDetails} from './photo-details';
export function forumTime(value:unknown){
  if(typeof value!=='string'||!value)return '';
  if(/^\d{4}-\d{2}-\d{2}$/.test(value))return value;
  const stamp=Date.parse(value);return Number.isFinite(stamp)?new Date(stamp+8*3600000).toISOString().slice(0,16).replace('T',' '):'';
}
export function forumPost(row:any){
  const name=typeof row.publicName==='string'&&row.publicName?row.publicName:'鸟友';
  const reactions=Array.isArray(row.reactions)?row.reactions:[];
  const details=readPhotoDetails(row.body),embedded=readEmbeddedPhotoDetails(details.body);
  return {...row,body:embedded.body,manualCamera:details.camera,embeddedCamera:embedded.camera,publicName:name,initial:Array.from(name)[0],posted:forumTime(row.updatedAt||row.created),
    liked:reactions.includes('like'),favorited:row.bookmarked===true||reactions.includes('bookmark'),
    hasLikes:Number.isInteger(row.likes)&&row.likes>=0,hasReplies:Number.isInteger(row.replyCount)&&row.replyCount>=0,
    likes:Number.isInteger(row.likes)?row.likes:0,replyCount:Number.isInteger(row.replyCount)?row.replyCount:0,reacting:false,likePending:false,bookmarkPending:false};
}
export type ReplyView={id:string;memberId:string;publicName:string;body:string;species:string;parentId:string;replyToName:string;status:string;posted:string;created:string;initial:string};
export function forumThreads(value:any[]):Array<{id:string;root:ReplyView;children:ReplyView[]}>{
  const replies=new Map<string,ReplyView>();
  for(const item of value||[]){if(!item||typeof item.id!=='string')continue;const name=item.publicName||'鸟友';replies.set(item.id,{...item,publicName:name,initial:Array.from(String(name))[0],parentId:item.parentId||'',status:item.status||'approved',posted:forumTime(item.created)});}
  const groups=new Map<string,{id:string;root:ReplyView;children:ReplyView[]}>();
  for(const reply of replies.values()){
    let root=reply;const visited=new Set([reply.id]);
    while(root.parentId&&replies.has(root.parentId)){const parent=replies.get(root.parentId)!;if(visited.has(parent.id))break;visited.add(parent.id);root=parent;}
    if(!groups.has(root.id))groups.set(root.id,{id:root.id,root,children:[]});
    if(root.id!==reply.id)groups.get(root.id)!.children.push(reply);
  }
  const compare=(a:ReplyView,b:ReplyView)=>String(a.created||'').localeCompare(String(b.created||''))||a.id.localeCompare(b.id);
  const result=Array.from(groups.values()).sort((a,b)=>compare(a.root,b.root));for(const group of result)group.children.sort(compare);return result;
}
