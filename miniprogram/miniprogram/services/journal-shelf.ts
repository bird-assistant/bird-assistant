import {JournalDocument,journalContent,readJournals,validJournal,uid} from './journal-model';

export const JOURNAL_SHELF_KEY='bird-assistant.journal.shelf.v1';
const previewKey=(id:string)=>'bird-assistant.journal.preview.v1.'+id;
export interface ShelfRow {id:string;title:string;ratio:string;createdAt?:string;updatedAt:string;cover:string;thumbnail:string;revision:string;}
type Shelf={version:1;rows:ShelfRow[]};
const metadata=(d:JournalDocument):ShelfRow=>({id:d.id,title:d.title,ratio:d.ratio,createdAt:d.createdAt,updatedAt:d.updatedAt,
  cover:d.elements.find(e=>e.type==='photo')?.src||'',thumbnail:'',revision:uid()});

/** A disposable index, separate from the atomic document + Undo/Redo source. */
export function readJournalShelf():ShelfRow[]{
  const value=wx.getStorageSync(JOURNAL_SHELF_KEY) as Shelf;
  if(value?.version===1&&Array.isArray(value.rows)&&value.rows.every(row=>typeof row.id==='string'&&typeof row.title==='string'&&typeof row.updatedAt==='string'&&typeof row.thumbnail==='string'))return value.rows;
  // One migration pass for older installations; never rewrite or evict their journals.
  const documents=readJournals(),rows=documents.map(metadata);
  try{for(const d of documents)wx.setStorageSync(previewKey(d.id),journalContent(d));wx.setStorageSync(JOURNAL_SHELF_KEY,{version:1,rows});}catch{/* A full cache must never hide the editable originals. */}
  return rows;
}
export function updateJournalShelf(document:JournalDocument){
  try{
    const rows=readJournalShelf(),next=metadata(document);
    wx.setStorageSync(previewKey(document.id),journalContent(document));
    wx.setStorageSync(JOURNAL_SHELF_KEY,{version:1,rows:[next,...rows.filter(row=>row.id!==document.id)]});
    discardThumbnail(rows.find(row=>row.id===document.id)?.thumbnail||'');
  }catch{try{wx.removeStorageSync(JOURNAL_SHELF_KEY);}catch{/* Source content is already safely saved. */}}
}
export function removeJournalShelf(id:string){
  try{const rows=readJournalShelf();wx.setStorageSync(JOURNAL_SHELF_KEY,{version:1,rows:rows.filter(row=>row.id!==id)});wx.removeStorageSync(previewKey(id));discardThumbnail(rows.find(row=>row.id===id)?.thumbnail||'');}catch{try{wx.removeStorageSync(JOURNAL_SHELF_KEY);}catch{}}
}
export function readJournalPreview(id:string):JournalDocument|null{
  const value=wx.getStorageSync(previewKey(id));return validJournal(value)?value as JournalDocument:null;
}
export function saveJournalThumbnail(id:string,revision:string,path:string){
  const rows=readJournalShelf(),row=rows.find(item=>item.id===id);if(!row||row.revision!==revision)return false;
  wx.setStorageSync(JOURNAL_SHELF_KEY,{version:1,rows:rows.map(item=>item.id===id?{...item,thumbnail:path}:item)});return true;
}
export function discardThumbnail(path:string){
  const prefix=wx.env?.USER_DATA_PATH+'/journal-previews/';
  if(path&&path.startsWith(prefix)&&!path.slice(prefix.length).includes('/'))try{wx.getFileSystemManager().unlink({filePath:path,fail:()=>{}});}catch{}
}
export async function persistJournalThumbnail(temporary:string,id:string,revision:string){
  const fs=wx.getFileSystemManager(),folder=wx.env.USER_DATA_PATH+'/journal-previews';
  try{fs.accessSync(folder);}catch{fs.mkdirSync(folder,true);}
  const path=folder+'/'+encodeURIComponent(id).slice(0,80)+'-'+revision+'.png';
  await new Promise<void>((resolve,reject)=>fs.saveFile({tempFilePath:temporary,filePath:path,success:()=>resolve(),fail:reject}));return path;
}

/** Decode small disposable derivatives for the shelf; editable photo sources never change. */
export async function prepareThumbnailDocument(source:JournalDocument){
  const document=journalContent(source),temporary:string[]=[];
  try{for(const image of document.elements.filter(e=>e.type==='photo'&&!e.src.startsWith('/assets/'))){
    if(typeof wx.compressImage!=='function')continue;
    const info=await wx.getImageInfo({src:image.src}),scale=Math.min(1,640/Math.max(info.width,info.height));if(scale===1)continue;
    const result=await wx.compressImage({src:image.src,quality:80,compressedWidth:Math.max(1,Math.round(info.width*scale)),compressedHeight:Math.max(1,Math.round(info.height*scale))});
    if(result.tempFilePath!==image.src){temporary.push(result.tempFilePath);image.src=result.tempFilePath;}
  }}catch(error){for(const path of temporary)try{wx.getFileSystemManager().unlink({filePath:path,fail:()=>{}});}catch{}throw error;}
  return {document,release(){for(const path of temporary)try{wx.getFileSystemManager().unlink({filePath:path,fail:()=>{}});}catch{}}};
}
