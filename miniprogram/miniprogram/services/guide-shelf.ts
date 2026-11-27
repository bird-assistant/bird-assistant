export const GUIDE_SHELF_KEY='bird-assistant.guide-shelf.v1';
export interface GuideSummary {id:string;name:string;english:string;scientific:string;family:string;}
type Shelf={version:1;saved:GuideSummary[];recent:GuideSummary[]};
export function guideSummary(value:any):GuideSummary {return {id:String(value.id||''),name:String(value.name||''),english:String(value.english||''),scientific:String(value.scientific||''),family:String(value.family||'')};}
function valid(value:any):value is GuideSummary{return value&&['id','name','english','scientific','family'].every(k=>typeof value[k]==='string'&&value[k].length<=200)&&!!value.id;}
export function readGuideShelf():Shelf {
  const v=wx.getStorageSync(GUIDE_SHELF_KEY);if(v===''||v==null)return {version:1,saved:[],recent:[]};
  if(v.version!==1||!Array.isArray(v.saved)||!Array.isArray(v.recent)||v.saved.length>120||v.recent.length>30
    ||![v.saved,v.recent].every(list=>list.every(valid)&&new Set(list.map((b:GuideSummary)=>b.id)).size===list.length))throw new Error('本机图鉴书签无法读取，原内容未覆盖。');
  return {version:1,saved:v.saved.map((b:GuideSummary)=>({...b})),recent:v.recent.map((b:GuideSummary)=>({...b}))};
}
export function rememberGuide(value:GuideSummary){const v=readGuideShelf();if(!valid(value))return;v.recent=[{...value},...v.recent.filter(b=>b.id!==value.id)].slice(0,30);wx.setStorageSync(GUIDE_SHELF_KEY,v);}
export function bookmarkGuide(value:GuideSummary){const v=readGuideShelf();if(!valid(value))throw new Error('鸟种资料不完整。');
  const active=!v.saved.some(b=>b.id===value.id);if(active&&v.saved.length>=120)throw new Error('图鉴书签已达120份，请先整理。');
  v.saved=active?[{...value},...v.saved]:v.saved.filter(b=>b.id!==value.id);wx.setStorageSync(GUIDE_SHELF_KEY,v);return active;
}
export function guideGroups(items:GuideSummary[],query=''){
  const q=query.trim().toLocaleLowerCase(),groups=new Map<string,GuideSummary[]>();
  for(const item of items){if(q&&![item.name,item.english,item.scientific,item.family].join(' ').toLocaleLowerCase().includes(q))continue;
    const family=item.family||'未注明科';if(!groups.has(family))groups.set(family,[]);groups.get(family)!.push(item);}
  return Array.from(groups,(entry)=>({family:entry[0],items:entry[1]}));
}
export function externalExplore(items:any[],source:string,query:string,photos:boolean){
  const q=query.trim().toLocaleLowerCase(),sources=new Map<string,number>();
  for(const item of items){const name=String(item.source||'未注明来源');sources.set(name,(sources.get(name)||0)+1);}
  const shown=items.filter(item=>(!source||String(item.source||'未注明来源')===source)&&(!photos||!!item.image)
    &&(!q||[item.title,item.speciesName,item.placeName,item.place,item.source].join(' ').toLocaleLowerCase().includes(q)))
    .map(item=>({...item,dayLabel:/^\d{4}-\d{2}-\d{2}$/.test(item.date||'')?item.date:'观察日期未知'}));
  const days=new Map<string,any[]>();for(const item of shown){if(!days.has(item.dayLabel))days.set(item.dayLabel,[]);days.get(item.dayLabel)!.push(item);}
  return {shown,sources:Array.from(sources,(entry)=>({name:entry[0],count:entry[1]})),days:Array.from(days,(entry)=>({day:entry[0],items:entry[1]}))};
}
