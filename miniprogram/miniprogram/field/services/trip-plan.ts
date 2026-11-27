import {chinesePlace} from '../../services/place-names';
import type {TripBrief} from './trip-advice';

export type TripPoint={latitude:number;longitude:number};
export type TripPark={id?:string;name:string;point:TripPoint;source:string;km:number};
export type TripStop={id?:string;name:string;point:TripPoint;km:number;count:number;latest:string;seasonal:number;park:TripPark|null;birds:{id:string;name:string;record:string;latest:string;count:number}[]};
export type TripReference={id:string;name:string;kind:'area'|'park';point:TripPoint;km:number;precisionLabel:string};
export type TripVisit={destination:string;name:string;why:string;habitats:string[];watchFor:string[];timing:string;uncertainty:string};
export type TripPlan={engine:string;model:string;turn:string;answer:string;focus:string;start:string;end:string;brief?:TripBrief|null;legacyWarning?:string;
  sources:{id:string;label:string;url?:string;record?:string}[];guideCards:{id:string;name:string}[];referenceMap?:TripReference[];visits?:TripVisit[];
  communityCards?:{id:string;record:string;title:string;published:string;observed:string;excerpt:string;basis:string}[];
  weatherCards:{id:string;area:string;available:boolean;source:string;hours:{hour:string;wind:number;temp:number;rain:number|null}[]}[];
  stops:TripStop[];parks:TripPark[];stages:{time:string;action:string}[]};

/** Resolve explicit references only. Never guess an A-number from a card's array position. */
export function presentTrip(raw:TripPlan):TripPlan{
  const names=new Map((raw.sources||[]).map(row=>[row.id,chinesePlace(row.label)]));
  for(const row of raw.referenceMap||[])names.set(row.id,chinesePlace(row.name));
  const text=(value:string)=>value.replace(/\b[AP]\d{1,3}\b/g,id=>names.get(id)||'公开参考区域');
  const brief=raw.brief?{headline:text(raw.brief.headline),reasons:raw.brief.reasons.map(text),watchFor:raw.brief.watchFor.map(text),preparation:raw.brief.preparation.map(text),uncertainty:raw.brief.uncertainty.map(text)}:null;
  return {...raw,answer:text(raw.answer),brief,sources:raw.sources||[],guideCards:raw.guideCards||[],weatherCards:raw.weatherCards||[],
    stages:(raw.stages||[]).map(row=>({...row,action:text(row.action)})),
    stops:(raw.stops||[]).map(row=>({...row,name:chinesePlace(row.name)})),parks:(raw.parks||[]).map(row=>({...row,name:chinesePlace(row.name)})),
    visits:(raw.visits||[]).map(row=>({...row,name:chinesePlace(row.name)})),
    legacyWarning:!raw.referenceMap&&/\b[AP]\d+\b/.test(raw.answer)?'当前服务尚未返回地点对应坐标，已展开参考名称；请查看下方区域卡。更新服务后可直接点选文中的地点。':''};
}
