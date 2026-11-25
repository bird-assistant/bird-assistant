import {api,community} from './community';
import {businessOrigin} from './vision-network';
import type {TripPlan,TripPoint} from './trip-plan';

export type TripConditions={point:TripPoint|null;place:string;date:string;hour:number;hours:number;radius:number;species:string;speciesLabel:string};
export type TripConversation={id:string;updated:string;conditions:TripConditions;turns:{question:string;plan:TripPlan;saved:string}[]};
function storageKey(owner:string){return 'bird-assistant.trip-history.v1.'+encodeURIComponent(owner);}
export async function tripHistoryOwner(){const me=await api(community+'/me');if(typeof me?.id!=='string'||!me.id)throw new Error('未取得当前账号，咨询记录未读取。');return businessOrigin()+'|'+me.id;}
function validConversation(row:TripConversation){
  const c=row?.conditions;
  return typeof row?.id==='string'&&!!row.id&&Number.isFinite(Date.parse(row.updated))&&!!c&&typeof c.place==='string'&&typeof c.date==='string'&&typeof c.species==='string'&&typeof c.speciesLabel==='string'&&Number.isInteger(c.hour)&&c.hour>=0&&c.hour<=23&&[1,2,3,4].includes(c.hours)&&[10,30,80].includes(c.radius)&&!!c.point&&Number.isFinite(c.point.latitude)&&Math.abs(c.point.latitude)<=90&&Number.isFinite(c.point.longitude)&&Math.abs(c.point.longitude)<=180&&Array.isArray(row.turns)&&row.turns.length>=1&&row.turns.length<=6&&row.turns.every(turn=>typeof turn?.question==='string'&&Number.isFinite(Date.parse(turn.saved))&&typeof turn.plan?.answer==='string'&&typeof turn.plan.turn==='string'&&typeof turn.plan.start==='string'&&typeof turn.plan.end==='string');
}
export function readTripHistory(owner:string):TripConversation[]{
  const stored=wx.getStorageSync(storageKey(owner));if(stored===''||stored==null)return [];
  if(stored.version!==1||!Array.isArray(stored.items)||stored.items.length>20||!stored.items.every(validConversation))throw new Error('本机咨询记录无法读取，已有内容未覆盖。');
  return JSON.parse(JSON.stringify(stored.items));
}
export function saveTripHistory(owner:string,row:TripConversation){
  const items=readTripHistory(owner).filter(item=>item.id!==row.id);
  wx.setStorageSync(storageKey(owner),{version:1,items:[{...row,turns:row.turns.slice(-6)},...items].slice(0,20)});
}
