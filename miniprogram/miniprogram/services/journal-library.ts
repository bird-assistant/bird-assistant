import {JournalDocument} from './journal-model';

export interface JournalLibraryQuery {text:string;ratio:string;order:'updated'|'created';from:string;to:string;}
export const EMPTY_LIBRARY_QUERY:JournalLibraryQuery={text:'',ratio:'',order:'updated',from:'',to:''};
export function journalDate(value?:string){
  if(!value||!Number.isFinite(Date.parse(value)))return '未记录';
  const date=new Date(value),pad=(n:number)=>String(n).padStart(2,'0');
  return date.getFullYear()+'-'+pad(date.getMonth()+1)+'-'+pad(date.getDate());
}
export function journalDateTime(value?:string){const date=journalDate(value);if(date==='未记录')return date;const time=new Date(value!);return date+' '+String(time.getHours()).padStart(2,'0')+':'+String(time.getMinutes()).padStart(2,'0');}
type LibraryDocument=Pick<JournalDocument,'id'|'title'|'ratio'|'createdAt'|'updatedAt'>&{cover?:string;elements?:JournalDocument['elements']};
export function journalLibrary(documents:LibraryDocument[],query:JournalLibraryQuery){
  const needle=query.text.trim().toLocaleLowerCase();
  return documents.filter(d=>{
    const date=journalDate(query.order==='created'?d.createdAt:d.updatedAt);
    return (!needle||d.title.toLocaleLowerCase().includes(needle))&&(!query.ratio||d.ratio===query.ratio)&&
      (!query.from||(date!=='未记录'&&date>=query.from))&&(!query.to||(date!=='未记录'&&date<=query.to));
  }).sort((a,b)=>{
    const aa=query.order==='created'?a.createdAt:a.updatedAt,bb=query.order==='created'?b.createdAt:b.updatedAt;
    return (bb||'').localeCompare(aa||'')||a.id.localeCompare(b.id);
  }).map(d=>({id:d.id,title:d.title,ratio:d.ratio,createdAt:d.createdAt,updatedAt:d.updatedAt,cover:d.cover??d.elements?.find(e=>e.type==='photo')?.src??'',createdLabel:journalDate(d.createdAt),updatedLabel:journalDateTime(d.updatedAt)}));
}
