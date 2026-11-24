import {businessOrigin} from './vision-network';
import {api} from './community';

export type GuidePhoto={credit:string;license:string;sourceUrl:string;licenseUrl:string};
export type GuideBird={id:string;name:string;english:string;scientific:string;family:string;guide:{
  fields:{key:string;label:string;value:string}[];photo:GuidePhoto|null;mark?:string;markUrl?:string;
  inferred:boolean;source:string;sourceUrl:string}};

export function speciesPath(id:string){return '/api/v1/species/'+encodeURIComponent(id);}
export function picture(id:string){return businessOrigin()+speciesPath(id)+'/photo';}
const cards=new Map<string,{until:number;job:Promise<GuideBird>}>();
export function rememberFieldCard(bird:GuideBird){const id=businessOrigin()+':'+bird.id;cards.set(id,{until:Date.now()+300000,job:Promise.resolve(bird)});while(cards.size>32)cards.delete(cards.keys().next().value!);}
export function fieldCard(id:string):Promise<GuideBird>{
  const key=businessOrigin()+':'+id,cached=cards.get(key);if(cached&&cached.until>Date.now())return cached.job;
  const entry={until:Date.now()+300000,job:Promise.resolve(null as unknown as GuideBird)};
  entry.job=api(speciesPath(id)+'/guide').catch(error=>{if(cards.get(key)===entry)cards.delete(key);throw error;});cards.set(key,entry);
  while(cards.size>32)cards.delete(cards.keys().next().value!);return entry.job;
}
export const guideTraits=[{key:'mass',label:'体重'},{key:'wing',label:'翼长'},{key:'bill',label:'嘴峰长'},{key:'tail',label:'尾长'},{key:'habitat',label:'生境'},{key:'diet',label:'食性'},{key:'lifestyle',label:'活动方式'}];
export function comparisonWidth(width:number,count:number){const available=Math.max(0,Math.min(960,width)-32);return count<=1?Math.min(420,available):Math.max(156,(available-(count-1)*12)/count);}

export type SubjectPhoto = {src:string;box:{x1:number;y1:number;x2:number;y2:number}};
export function compareBirds(ids:string[], select?:(id:string)=>void, subject?:SubjectPhoto){
  const unique=Array.from(new Set(ids)).filter(Boolean).slice(0,3);
  wx.navigateTo({url:'/field/compare/index?ids='+unique.map(encodeURIComponent).join(',')+'&select='+(select?'1':'0'),
    success:result=>{if(subject)result.eventChannel.emit('subject',subject);},
    events:{choose:(event:{id:string})=>{if(select && unique.includes(event.id))select(event.id);}}});
}
