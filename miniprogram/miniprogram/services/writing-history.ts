import {JournalAiInput,JournalAiSuggestion,parseJournalSuggestion} from './journal-ai';
import {journalDateTime} from './journal-library';

export const WRITING_HISTORY_KEY='bird-assistant.writing-history.v1';
export type WritingFeature='journal'|'forum';
export interface WritingRecord {
  id:string;feature:WritingFeature;scope:string;createdAt:string;prompt:string;purpose:string;maxChars:number;
  images:Array<{id:string;label:string}>;suggestion:JournalAiSuggestion;applied:boolean;
}
const MAX_RECORDS=80;
const copy=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
function clean(value:any):WritingRecord {
  if(!value||typeof value.id!=='string'||!['journal','forum'].includes(value.feature)||typeof value.scope!=='string'||!value.scope||typeof value.createdAt!=='string'||!Number.isFinite(Date.parse(value.createdAt))||typeof value.prompt!=='string'||value.prompt.length>2000||typeof value.purpose!=='string'||value.purpose.length>64||!Number.isInteger(value.maxChars)||value.maxChars<20||value.maxChars>600||!Array.isArray(value.images)||value.images.length>4||value.images.some((p:any)=>typeof p?.id!=='string'||typeof p.label!=='string'))throw new Error('本机写作记录无法读取，原有记录未覆盖。');
  const images=value.images.map((p:{id:string;label:string})=>({id:p.id,label:p.label.slice(0,100)}));
  const suggestion=parseJournalSuggestion(value.suggestion,{version:1,requestId:value.id,prompt:value.prompt,purpose:value.purpose,maxChars:value.maxChars,images:images.map((p:{id:string;label:string})=>({...p,path:''}))});
  return {id:value.id,feature:value.feature,scope:value.scope,createdAt:value.createdAt,prompt:value.prompt,purpose:value.purpose,maxChars:value.maxChars,images,suggestion,applied:value.applied===true};
}
function all():WritingRecord[]{
  const value=wx.getStorageSync(WRITING_HISTORY_KEY);if(value===''||value==null)return [];
  if(value.version!==1||!Array.isArray(value.items)||value.items.length>MAX_RECORDS)throw new Error('本机写作记录无法读取，原有记录未覆盖。');
  return value.items.map(clean);
}
export function writingInstructions(prompt:string){
  try{const parsed=JSON.parse(prompt);if(typeof parsed.instructions==='string')return parsed.instructions;}catch{}
  return prompt;
}
export function readWritingHistory(feature:WritingFeature,scope:string){
  return all().filter(item=>item.feature===feature&&item.scope===scope).map(item=>({...copy(item),displayPrompt:writingInstructions(item.prompt),dateLabel:journalDateTime(item.createdAt)}));
}
/** Store notes/results only: never image bytes, local paths, session tokens or provider credentials. */
export function rememberWriting(feature:WritingFeature,scope:string,input:JournalAiInput,suggestion:JournalAiSuggestion){
  const item=clean({id:input.requestId,feature,scope,createdAt:new Date().toISOString(),prompt:input.prompt,purpose:input.purpose,maxChars:input.maxChars,
    images:input.images.map(p=>({id:p.id,label:p.label})),suggestion,applied:false});
  wx.setStorageSync(WRITING_HISTORY_KEY,{version:1,items:[item,...all().filter(old=>!(old.feature===feature&&old.scope===scope&&old.id===item.id))].slice(0,MAX_RECORDS)});
}
export function markWritingApplied(feature:WritingFeature,scope:string,id:string){
  wx.setStorageSync(WRITING_HISTORY_KEY,{version:1,items:all().map(item=>item.feature===feature&&item.scope===scope&&item.id===id?{...item,applied:true}:item)});
}
export function deleteWritingRecord(feature:WritingFeature,scope:string,id:string){
  wx.setStorageSync(WRITING_HISTORY_KEY,{version:1,items:all().filter(item=>!(item.feature===feature&&item.scope===scope&&item.id===id))});
}

export function deleteWritingScope(feature:WritingFeature,scope:string){
  wx.setStorageSync(WRITING_HISTORY_KEY,{version:1,items:all().filter(item=>!(item.feature===feature&&item.scope===scope))});
}
