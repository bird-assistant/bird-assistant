import {JournalDocument,JournalEditHistory,Snapshot,JOURNAL_KEY,journalContent,readJournals,validJournal} from './journal-model';

export const JOURNAL_EDIT_LIMIT=20;
export const JOURNAL_HISTORY_BYTES=350000;
const LAST_JOURNAL='bird-assistant.journal.last.v1';
const bytes=(value:unknown)=>{let size=0;for(const char of JSON.stringify(value)){const code=char.codePointAt(0)!;size+=code<128?1:code<2048?2:code<65536?3:4;}return size;};
const dropFarthest=(state:JournalEditHistory)=>{if(state.past.length>=state.future.length&&state.past.length)state.past.shift();else state.future.shift();};

/** Snapshots never contain other snapshots; keep steps nearest the current state. */
export function editorHistory(past:Snapshot[],future:Snapshot[],selected=''):JournalEditHistory {
  const clean=(steps:Snapshot[])=>steps.map(step=>({document:journalContent(step.document),selected:step.selected}));
  const state:JournalEditHistory={version:1,past:clean(past.slice(-JOURNAL_EDIT_LIMIT)),future:clean(future.slice(-JOURNAL_EDIT_LIMIT)),selected};
  while(state.past.length+state.future.length>JOURNAL_EDIT_LIMIT)dropFarthest(state);
  return state;
}
export function restoreEditorHistory(document:JournalDocument):JournalEditHistory {
  const state=document.editHistory;
  if(state==null)return editorHistory([],[]);
  const valid=(step:Snapshot)=>step&&typeof step.selected==='string'&&validJournal(step.document)&&step.document.id===document.id&&step.document.editHistory==null;
  if(state.version!==1||typeof state.selected!=='string'||!Array.isArray(state.past)||!Array.isArray(state.future)||state.past.length+state.future.length>JOURNAL_EDIT_LIMIT||!state.past.every(valid)||!state.future.every(valid))throw new Error('这份手帐的编辑历史暂不能恢复，手帐内容仍保留。');
  return editorHistory(state.past,state.future,state.selected);
}
/** One storage commit contains both the saved document and matching Undo/Redo. */
export function saveJournalState(document:JournalDocument,history:JournalEditHistory,touch=true):JournalDocument {
  const content=journalContent(document);if(touch)content.updatedAt=new Date().toISOString();
  const saved:JournalDocument={...content,editHistory:editorHistory(history.past,history.future,history.selected)};
  restoreEditorHistory(saved);
  const items=[saved,...readJournals().filter(item=>item.id!==content.id)];
  // Bound only cached editing steps. Never evict a journal or its current content.
  const histories=items.filter(item=>{if(!item.editHistory)return false;try{restoreEditorHistory(item);return true;}catch{return false;}}).sort((a,b)=>a.updatedAt.localeCompare(b.updatedAt));
  const sizes=histories.map(item=>bytes(item.editHistory));let total=sizes.reduce((a,b)=>a+b,0);
  for(let index=0;index<histories.length&&total>JOURNAL_HISTORY_BYTES;index++){
    const state=histories[index].editHistory!;
    while(total>JOURNAL_HISTORY_BYTES&&(state.past.length||state.future.length)){
      dropFarthest(state);const next=bytes(state);total+=next-sizes[index];sizes[index]=next;
    }
  }
  // Leave headroom under the native single-key limit when the library grows.
  let excess=bytes(items)-900000;
  for(const item of histories){
    const state=item.editHistory!;let previous=bytes(state);
    while(excess>0&&(state.past.length||state.future.length)){dropFarthest(state);const next=bytes(state);excess+=next-previous;previous=next;}
  }
  wx.setStorageSync(JOURNAL_KEY,items);
  try{wx.setStorageSync(LAST_JOURNAL,content.id);}catch{/* This navigation hint is independent of the saved content. */}
  return journalContent(saved);
}
/** Delete the document and its embedded history; media can be shared elsewhere. */
export function deleteJournalState(id:string){
  const items=readJournals().filter(item=>item.id!==id);wx.setStorageSync(JOURNAL_KEY,items);
  try{if(wx.getStorageSync(LAST_JOURNAL)===id){if(items.length)wx.setStorageSync(LAST_JOURNAL,items[0].id);else wx.removeStorageSync(LAST_JOURNAL);}}catch{}
}
