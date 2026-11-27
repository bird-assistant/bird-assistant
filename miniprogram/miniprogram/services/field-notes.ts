import {key} from './community';

export const FIELD_NOTES_KEY='bird-assistant.field-notes.v1';
export interface FieldNote {
  id:string;title:string;body:string;tags:string[];observationId:string;pinned:boolean;
  createdAt:string;updatedAt:string;deletedAt:string;revision:number;
}
export type NoteInput=Pick<FieldNote,'title'|'body'|'tags'|'observationId'|'pinned'>;
const invalid=()=>new Error('本机笔记无法读取，原内容未覆盖。');
const stamp=(v:unknown):v is string=>typeof v==='string'&&Number.isFinite(Date.parse(v));
function valid(note:any):note is FieldNote {
  return note&&typeof note.id==='string'&&!!note.id&&typeof note.title==='string'&&note.title.length<=80
    &&typeof note.body==='string'&&note.body.length<=5000&&Array.isArray(note.tags)&&note.tags.length<=6
    &&note.tags.every((t:unknown)=>typeof t==='string'&&t.length<=16)&&typeof note.observationId==='string'
    &&typeof note.pinned==='boolean'&&stamp(note.createdAt)&&stamp(note.updatedAt)
    &&(note.deletedAt===''||stamp(note.deletedAt))&&Number.isSafeInteger(note.revision)&&note.revision>0;
}
export function readFieldNotes():FieldNote[]{
  const value=wx.getStorageSync(FIELD_NOTES_KEY);if(value===''||value==null)return [];
  if(value.version!==1||!Array.isArray(value.items)||value.items.length>300||!value.items.every(valid)
    ||new Set(value.items.map((n:FieldNote)=>n.id)).size!==value.items.length)throw invalid();
  return value.items.map((n:FieldNote)=>({...n,tags:n.tags.slice()}));
}
export function noteTags(text:string){return Array.from(new Set(text.split(/[,，、\n]/).map(t=>t.trim()).filter(Boolean))).slice(0,6).map(t=>t.slice(0,16));}
export function blankFieldNote():FieldNote {const time=new Date().toISOString();return {id:key(),title:'',body:'',tags:[],observationId:'',pinned:false,createdAt:time,updatedAt:time,deletedAt:'',revision:0};}
function persist(items:FieldNote[]){wx.setStorageSync(FIELD_NOTES_KEY,{version:1,items});}
/** Compare the edited note, then merge against a fresh store so another page's notes survive. */
export function saveFieldNote(id:string,input:NoteInput,expectedRevision:number):FieldNote {
  if(!id||input.title.length>80||input.body.length>5000||input.tags.length>6)throw new Error('笔记超出长度限制。');
  const items=readFieldNotes(),previous=items.find(n=>n.id===id);
  if((previous?.revision||0)!==expectedRevision)throw new Error('这篇笔记已在别处更改。请保留当前文字，或另存一份。');
  if(previous?.deletedAt)throw new Error('笔记已移入回收站，请先还原或另存一份。');
  if(!previous&&items.length>=300)throw new Error('本机已保存300篇笔记，请先整理笔记。');
  const time=new Date().toISOString(),note:FieldNote={...input,id,title:input.title.trim(),tags:noteTags(input.tags.join(',')),
    observationId:input.observationId.slice(0,160),createdAt:previous?.createdAt||time,updatedAt:time,deletedAt:'',revision:expectedRevision+1};
  if(!valid(note))throw new Error('笔记格式不完整，当前文字仍保留。');
  persist([note,...items.filter(n=>n.id!==id)]);return {...note,tags:note.tags.slice()};
}
export function trashFieldNote(id:string,expectedRevision:number,restore=false){
  const items=readFieldNotes(),previous=items.find(n=>n.id===id);if(!previous)return;
  if(previous.revision!==expectedRevision)throw new Error('笔记已变化，请重新打开后操作。');
  const time=new Date().toISOString(),note={...previous,deletedAt:restore?'':time,updatedAt:time,revision:previous.revision+1};
  persist(items.map(n=>n.id===id?note:n));
}
export function findFieldNotes(items:FieldNote[],query:string,tag:string,trash=false){
  const q=query.trim().toLocaleLowerCase();
  return items.filter(n=>!!n.deletedAt===trash&&(!tag||n.tags.includes(tag))&&(!q||[n.title,n.body,...n.tags].join(' ').toLocaleLowerCase().includes(q)))
    .sort((a,b)=>Number(b.pinned&&!trash)-Number(a.pinned&&!trash)||b.updatedAt.localeCompare(a.updatedAt)||a.id.localeCompare(b.id));
}
