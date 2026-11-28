import {JournalDocument,JournalElement,journalContent,element,fit,journalFingerprint,reflowJournalPhotos,textLayout} from './journal-model';
import {JournalAiInput,JournalAiSuggestion} from './journal-ai';

export type WritingDestination='new'|'selected'|'overview';
export interface JournalWritingContext {
  docId:string;before:string;target:string;destination:WritingDestination;placement:number;
  includeTitle:boolean;includeCaptions:boolean;photoIds:string[];purpose:string;
}
export interface JournalWritingOptions {
  destination:WritingDestination;selectedId:string;placement:number;includeTitle:boolean;includeCaptions:boolean;
  purpose:string;prompt:string;photoIds:string[];
}
export function journalHeading(d:JournalDocument){
  return d.elements.find(e=>e.id===d.headingId&&e.type==='text')||d.elements.find(e=>e.type==='text'&&!e.photoId&&!e.flowPosition&&!!e.title);
}
export function journalWritingBrief(d:JournalDocument,o:JournalWritingOptions):{input:JournalAiInput;context:JournalWritingContext} {
  if(o.photoIds.length>4)throw new Error('已选择 '+o.photoIds.length+' 张照片，每次最多关联 4 张。请取消多余照片后再生成。');
  const selected=d.elements.find(e=>e.id===o.selectedId&&e.type==='text');
  if(o.destination==='selected'&&!selected)throw new Error('请先选择要改写的文本框，或改为新增文字框。');
  const target=o.destination==='selected'?selected:o.destination==='overview'?journalHeading(d):undefined;
  const photos=o.photoIds.map(id=>d.elements.find(e=>e.id===id&&e.type==='photo'));
  if(photos.some(p=>!p)||new Set(o.photoIds).size!==o.photoIds.length)throw new Error('照片选择已变化，请重新选择。');
  const instructions=o.prompt.trim()||(photos.length?'根据所选照片写一小段自然、简短的观鸟记录，只描述可见细节。不猜鸟名、时间、地点、天气、心情或经历，不用诗句或比喻。':o.destination==='selected'&&(selected?.title.trim()||selected?.text.trim())?'把所选文字整理得自然、简洁，保留原意、事实与不确定性。':'');
  if(!instructions)throw new Error('请补充写作要求、关联照片，或选择已有文字，再生成建议。');
  let maxChars=o.purpose==='照片手帐'?120:o.destination==='new'?(d.elements.filter(e=>e.type==='photo').length>=3?120:240):o.destination==='overview'?160:Math.max(80,Math.min(400,Math.floor((target!.w*Math.max(target!.h,d.height-target!.y))/(24*24*1.4))));
  const context:JournalWritingContext={docId:d.id,before:journalFingerprint(d),target:target?.id||'',destination:o.destination,placement:o.placement,includeTitle:o.includeTitle,includeCaptions:o.includeCaptions,photoIds:[...o.photoIds],purpose:o.purpose};
  // Supply the model with bounded choices and a layout-derived writing budget.
  // It can choose a style/variant; it cannot invent image paths or edit geometry.
  const layoutPlan={ratio:d.ratio,photos:photos.map(p=>({id:p!.id,shape:p!.iw>p!.ih?'landscape':p!.iw<p!.ih?'portrait':'square'})),captionMaxChars:20,
    titleMaxChars:40,keepSavedName:true,keepOriginalPhotos:true,allowedStyles:['nature','magazine','minimal'],allowedVariants:d.elements.filter(e=>e.type==='photo').length<=2?[1,2,3]:[1,2]};
  let low=20,high=maxChars,best=0;
  while(low<=high){const count=Math.floor((low+high)/2);try{applyJournalWriting(d,context,{version:1,requestId:'fit-check',title:'题'.repeat(40),body:'字'.repeat(count),design:{style:'nature',variant:1},captions:o.includeCaptions?photos.map(p=>({id:p!.id,text:'字'.repeat(20)})):[]});best=count;low=count+1;}catch{high=count-1;}}
  if(!best)throw new Error('这一页暂时放不下建议文字，请调整照片或选择其他应用位置后再生成。');
  maxChars=Math.min(maxChars,best);
  const prompt=JSON.stringify({instructions,contentPurpose:o.purpose,layoutPlan,
    destination:o.destination==='selected'?'改写所选文本框':o.destination==='overview'?'更新页首概述':'新增独立文字框',
    existingText:target?{title:target.title,body:target.text}:null,
    selectedNotes:photos.map(p=>({id:p!.id,text:d.elements.filter(e=>e.photoId===p!.id).map(e=>e.text).join('\n')})),
    rules:['保留已有事实与不确定性，不补写未知经历。','建议标题用于页面文字，不修改手帐名称。','按用户要求决定重点、语气与信息密度；未提供的事实保持未知。','用布局字数预算写完整短句，逐图说明各不超过20字；概述与图注避免重复。','默认自然日常的中文，不用诗化表达。']});
  if(prompt.length>2000)throw new Error('原文与写作要求合计过长，请缩短要求或所选文本后再试。');
  const input:JournalAiInput={version:1,requestId:'journal-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8),prompt,purpose:o.purpose,maxChars,
    images:photos.map(p=>({id:p!.id,path:p!.src,label:'照片 '+p!.photoNumber}))};
  return {input,context};
}
export function writingDestinationLabel(context:Pick<JournalWritingContext,'destination'|'placement'>){
  if(context.destination==='selected')return '仅更新所选文本框';
  if(context.destination==='overview')return '更新页首概述 · 手帐名称不变';
  return '新增文字框 · '+['照片区上方','照片区下方','自由放置','照片区左侧','照片区右侧'][context.placement];
}
/** Apply to a copy: a stale/invalid plan cannot partially overwrite a document. */
export function applyJournalWriting(document:JournalDocument,context:JournalWritingContext,suggestion:JournalAiSuggestion,design=false){
  if(context.docId!==document.id||context.before!==journalFingerprint(document))throw new Error('手帐已修改，请重新生成建议，当前内容未覆盖。');
  if(!suggestion.body.trim()||Array.from(suggestion.body).length>600||Array.from(suggestion.title).length>40)throw new Error('请保留有效的建议正文；标题最多40字，正文最多600字。');
  const d=journalContent(document);let target:JournalElement|undefined;
  if(context.destination==='selected'){
    target=d.elements.find(e=>e.id===context.target&&e.type==='text');
    if(!target)throw new Error('原文本框已变化，当前内容未覆盖。');
  }else if(context.destination==='overview'){
    target=journalHeading(d);
    if(!target){target=element('text',{x:72,y:d.height*.105,w:756,fontSize:23,titleSize:40});d.elements.push(target);d.headingId=target.id;}
  }else{
    target=element('text',{x:72,y:d.height*.45,w:756,fontSize:22,font:'sans',maxLines:0,
      ...(context.placement===0?{flowPosition:'before-photos' as const}:context.placement===1?{flowPosition:'after-photos' as const}:context.placement===3?{flowPosition:'left-of-photos' as const}:context.placement===4?{flowPosition:'right-of-photos' as const}:{})});d.elements.push(target);
  }
  target.text=suggestion.body;target.maxLines=0;if(context.includeTitle)target.title=suggestion.title;
  if(context.includeCaptions){
    for(const caption of suggestion.captions||[]){
      if(!context.photoIds.includes(caption.id)||!d.elements.some(e=>e.id===caption.id&&e.type==='photo'))continue;
      let box=d.elements.find(e=>e.type==='text'&&e.photoId===caption.id);
      if(!box){box=element('text',{photoId:caption.id,fontSize:20,font:'sans'});d.elements.push(box);}
      box.text=caption.text;box.title='';box.maxLines=0;box.fontSize=d.elements.filter(e=>e.type==='photo').length>=5?18:20;
    }
  }
  if(design){d.style=suggestion.design.style;d.variant=suggestion.design.variant;d.background=d.style==='minimal'?'#ffffff':d.style==='magazine'?'#eee8da':'#f5efdf';}
  const reflow=design||target.flowPosition||target.photoId||context.destination==='overview'||context.includeCaptions;
  if(reflow)reflowJournalPhotos(d);else fit(d);
  // A suggestion never renames the saved journal or changes its source image bytes.
  d.title=document.title;
  const affected=d.elements.filter(e=>e.id===target!.id||e.flowPosition||(context.includeCaptions&&context.photoIds.includes(e.photoId||'')));
  const photos=d.elements.filter(e=>e.type==='photo'),overlap=(a:JournalElement,b:JournalElement)=>a.x<b.x+b.w&&b.x<a.x+a.w&&a.y<b.y+b.h&&b.y<a.y+a.h;
  if(affected.some(e=>textLayout(e,d).overflow)||photos.some(e=>e.y+e.h>d.height+.01)||
    (reflow&&affected.some(e=>(e.flowPosition||e.photoId||e.id===d.headingId)&&photos.some(photo=>overlap(e,photo)))))throw new Error('这一页的文字空间不足，请缩短正文或调整照片后再应用。');
  return {document:d,targetId:target.id};
}
