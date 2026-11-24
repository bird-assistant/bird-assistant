import {businessOrigin} from './vision-network';
import {api} from './community';

export type GuidePhoto={credit:string;license:string;sourceUrl:string;licenseUrl:string};
export type GuideBird={id:string;name:string;english:string;scientific:string;family:string;guide:{
  fields:{key:string;label:string;value:string}[];photo:GuidePhoto|null;mark?:string;markUrl?:string;
  inferred:boolean;source:string;sourceUrl:string}};

export function speciesPath(id:string){return '/api/v1/species/'+encodeURIComponent(id);}
export function picture(id:string){return businessOrigin()+speciesPath(id)+'/photo';}
export function fieldCard(id:string):Promise<GuideBird>{return api(speciesPath(id)+'/guide');}
export type SubjectPhoto = {src:string;box:{x1:number;y1:number;x2:number;y2:number}};
export function compareBirds(ids:string[], select?:(id:string)=>void, subject?:SubjectPhoto){
  const unique=Array.from(new Set(ids)).filter(Boolean).slice(0,3);
  wx.navigateTo({url:'/field/compare/index?ids='+unique.map(encodeURIComponent).join(',')+'&select='+(select?'1':'0'),
    success:result=>{if(subject)result.eventChannel.emit('subject',subject);},
    events:{choose:(event:{id:string})=>{if(select && unique.includes(event.id))select(event.id);}}});
}
