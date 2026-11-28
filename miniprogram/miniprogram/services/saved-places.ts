import {readProtectedData,commitProtectedData} from './protected-local-data';
import {uid} from './journal-model';

export const SAVED_PLACES_KEY='bird-assistant.saved-places.v1';
export interface SavedPlace {id:string;name:string;address:string;latitude:number;longitude:number;createdAt:string;updatedAt:string;}
const validPoint=(value:{latitude:number;longitude:number})=>Number.isFinite(value.latitude)&&Math.abs(value.latitude)<=90&&Number.isFinite(value.longitude)&&Math.abs(value.longitude)<=180;
export function validSavedPlaces(value:any):boolean{return !!value&&!(value.version!==1||!Array.isArray(value.items)||!value.items.every((item:SavedPlace)=>item&&typeof item.id==='string'&&typeof item.name==='string'&&typeof item.address==='string'&&typeof item.createdAt==='string'&&typeof item.updatedAt==='string'&&validPoint(item))||new Set(value.items.map((item:SavedPlace)=>item.id)).size!==value.items.length);}
export function readSavedPlaces():SavedPlace[]{
  const value=readProtectedData('places',validSavedPlaces);
  if(value===''||value==null)return [];
  if(!validSavedPlaces(value))throw new Error('收藏地点暂时无法读取，已有资料未覆盖。');
  return ((value as {items:SavedPlace[]}).items).map(item=>({...item})).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
}
/** chooseLocation returns GCJ-02 coordinates, the same system as the native map. */
export function savePlace(input:Pick<SavedPlace,'name'|'address'|'latitude'|'longitude'>):SavedPlace{
  if(!validPoint(input)||!input.name.trim())throw new Error('请选择有名称的有效地点。');
  const items=readSavedPlaces(),previous=items.find(item=>Math.abs(item.latitude-input.latitude)<.00001&&Math.abs(item.longitude-input.longitude)<.00001),now=new Date().toISOString();
  const place:SavedPlace={...input,name:input.name.trim().slice(0,100),address:input.address.trim().slice(0,240),id:previous?.id||uid(),createdAt:previous?.createdAt||now,updatedAt:now};
  commitProtectedData({places:{version:1,items:[place,...items.filter(item=>item.id!==place.id)]}});return place;
}
export function removeSavedPlace(id:string){const items=readSavedPlaces();commitProtectedData({places:{version:1,items:items.filter(item=>item.id!==id)}});}
