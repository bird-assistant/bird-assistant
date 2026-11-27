import {cleanLocalMetadata,LocalPhotoMetadata} from './photo-metadata';
import {cleanPhotoDetails,PhotoDetails} from './photo-details';
import {key} from './community';

export const POST_IMAGE_LIMIT=9;
export const POST_JOURNAL_LIMIT=3;
export interface PostImage {id:string;path:string;kind:'photo'|'journal';label:string;journalId?:string;manualCamera:PhotoDetails;fileMetadata?:LocalPhotoMetadata;}
export function postImage(path:string,kind:PostImage['kind']='photo',label='照片',journalId?:string):PostImage {
  return {id:key(),path,kind,label:label.slice(0,100),...(journalId?{journalId}:{}),manualCamera:{}};
}
export function checkPostImages(items:PostImage[]) {
  if(items.length>POST_IMAGE_LIMIT)throw new Error('一篇帖子最多添加9张照片或手帐成品。');
  if(items.filter(item=>item.kind==='journal').length>POST_JOURNAL_LIMIT)throw new Error('一篇帖子最多添加3份手帐成品。');
  if(new Set(items.map(item=>item.id)).size!==items.length)throw new Error('素材列表有重复，请重新选择。');
}
export function postGallery(record:any):Array<{image:string;kind:string;label:string;camera?:object;manualCamera?:PhotoDetails}> {
  return Array.isArray(record.gallery)&&record.gallery.length?record.gallery:record.image?[{image:record.image,kind:'photo',label:'照片'}]:[];
}
export function cleanPostImage(item:any):PostImage {
  if(!item||typeof item.id!=='string'||typeof item.path!=='string'||!['photo','journal'].includes(item.kind)||typeof item.label!=='string')throw new Error('帖子草稿无法读取，原有资料未覆盖。');
  return {...item,manualCamera:cleanPhotoDetails(item.manualCamera),fileMetadata:cleanLocalMetadata(item.fileMetadata)};
}
