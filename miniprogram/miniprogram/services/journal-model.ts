import { clamp } from './map-model';
import { round2, floor2 } from './numbers';
export interface JournalElement { id:string;type:string;x:number;y:number;w:number;h:number;rotation:number;color:string;title:string;text:string;fontSize:number;font:string;src:string;photoNumber:number;photoId?:string;titleSize?:number;maxLines?:number;zoom:number;cropX:number;cropY:number;persisted:boolean;iw:number;ih:number; }
export interface JournalDocument { version:1;id:string;title:string;ratio:string;style:string;width:number;height:number;background:string;variant:number;elements:JournalElement[];updatedAt:string;period?:string; }
export interface JournalAsset {id:string;src:string;label:string;notes:string;sample:boolean;selected:boolean;persisted?:boolean;source?:string;date?:string;}
export interface Snapshot { document:JournalDocument;selected:string; }
export const copy=<T>(value:T):T=>JSON.parse(JSON.stringify(value)) as T;
export const uid=()=>Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8);
export function element(type:string,values:Partial<JournalElement>={}):JournalElement {return {id:uid(),type,x:80,y:260,w:300,h:200,rotation:0,color:'#285b49',title:'',text:'',fontSize:24,font:'serif',src:'',photoNumber:0,zoom:1,cropX:50,cropY:50,persisted:false,iw:600,ih:450,...values};}
export function textLines(value:string,width:number,size:number) {const rows:string[]=[];for(const p of String(value).split('\n')){let line='',used=0;for(const c of p){const n=/[\u2e80-\uffff]/.test(c)?size:size*.56;if(line&&used+n>width){rows.push(line);line='';used=0;}line+=c;used+=n;}rows.push(line);}return rows;}
export function textLayout(e:JournalElement,d:JournalDocument) {
  const rows:Array<{text:string;size:number;bold:boolean;y:number}>=[];let y=0;
  for(const part of [{text:e.title,size:e.titleSize||Math.round(e.fontSize*1.3),bold:true},{text:e.text,size:e.fontSize,bold:false}]){
    if(!part.text)continue;if(rows.length)y+=e.fontSize*.25;
    for(const text of textLines(part.text,e.w,part.size)){rows.push({text,size:part.size,bold:part.bold,y});y+=part.size*1.4;}
  }
  const h=Math.max(e.fontSize*1.4,y),available=Math.max(1,d.height-e.y),visible=rows.filter(r=>r.y+r.size*1.4<=available).slice(0,e.maxLines||rows.length);
  const overflow=visible.length<rows.length;
  if(overflow&&visible.length){const r=visible[visible.length-1];r.text=r.text.replace(/.$/u,'')+'…';}
  return {rows:visible,height:Math.min(h,available,e.maxLines&&visible.length?visible[visible.length-1].y+visible[visible.length-1].size*1.4:Infinity),overflow};
}
export function fit(d:JournalDocument) {
  for(const e of d.elements){
    for(const key of ['x','y','w','h','rotation','fontSize','titleSize','zoom','cropX','cropY'] as const){
      const value=e[key];if(typeof value==='number')e[key]=round2(value);
    }
    e.fontSize=Math.round(clamp(e.fontSize,12,64));if(e.titleSize)e.titleSize=Math.max(1,Math.round(e.titleSize));
    e.x=clamp(e.x,0,Math.max(0,d.width-50));
    e.y=clamp(e.y,0,Math.max(0,d.height-1));
    e.w=round2(clamp(e.w,Math.min(50,d.width-e.x),floor2(d.width-e.x)));
    if(e.type==='text')e.h=round2(textLayout(e,d).height);
  }
  return d;
}
export function elementLabel(e:JournalElement,d:JournalDocument) {
  const col=clamp(Math.floor((e.x+e.w/2)/d.width*3),0,2),row=clamp(Math.floor((e.y+e.h/2)/d.height*3),0,2);
  if(e.type==='photo')return '照片 '+e.photoNumber+'（'+[['左上','上中','右上'],['左中','正中','右中'],['左下','下中','右下']][row][col]+'）';
  if(e.type==='text'){const t=e.title||e.text||'空文本框';return Array.from(t).slice(0,18).join('')+(Array.from(t).length>18?'…':'');}
  return ({leaf:'叶子',flower:'小花',star:'星星',feather:'羽毛',stamp:'邮戳',tape:'纸胶带'} as Record<string,string>)[e.type]||'装饰';
}
export function makeJournal(assets:JournalAsset[],title:string,ratio='3:4',style='nature',variant=1,includeNotes=false):JournalDocument {
  const width=900,height=ratio==='1:1'?900:ratio==='4:3'?675:1200;
  const d:JournalDocument={version:1,id:uid(),title:title||'沿着鸟鸣，慢慢走',ratio,style,width,height,background:style==='minimal'?'#fffef9':style==='magazine'?'#eee8da':'#f5efdf',variant,elements:[],updatedAt:new Date().toISOString()};
  d.elements.push(element('text',{x:72,y:height*.055,w:756,fontSize:19,font:'sans',text:'FIELD NOTES / 羽迹',color:'#7a876c'}),element('text',{x:72,y:height*.105,w:756,fontSize:23,titleSize:46,maxLines:3,title:d.title,text:'把每一次发现，留在纸上。'}));
  assets.forEach((a,i)=>{
    const photo=element('photo',{src:a.src,persisted:!!a.persisted||a.sample,photoNumber:i+1,rotation:style==='nature'?(i%2?3:-3):0});d.elements.push(photo);
    d.elements.push(element('text',{photoId:photo.id,maxLines:2,text:a.label+(includeNotes&&a.notes?'\n'+a.notes:''),fontSize:24,font:'hand',color:'#52654e'}));
  });
  if(style==='nature')d.elements.push(element('leaf',{x:745,y:height*.04,w:75,h:75,color:'#839771',rotation:12}));
  if(style==='magazine')d.elements.push(element('tape',{x:610,y:height*.23,w:180,h:32,color:'#b7be90',rotation:6}));
  return reflowJournalPhotos(d);
}

/** Reflow the photo region for both page ratio and photo count; keep content and crop edits. */
export function reflowJournalPhotos(d:JournalDocument) {
  const photos=d.elements.filter(e=>e.type==='photo'),n=photos.length;
  const headers=d.elements.filter(e=>e.type==='text'&&!e.photoId).slice(0,2);
  const top=Math.max(d.height*.26,...headers.map(e=>e.y+textLayout(e,d).height+36)),bottom=d.height-48;
  if(n===1||n===2){
    const variant=((d.variant-1)%3+3)%3+1,caption=32+24*1.4*2,available=bottom-top;
    const inset=d.style==='minimal'?90:72;
    const place=(photo:JournalElement,x:number,y:number,w:number,h:number)=>{
      Object.assign(photo,{x,y,w,h,rotation:0});
      for(const text of d.elements.filter(e=>e.photoId===photo.id))Object.assign(text,{x,y:y+h+32,w,maxLines:2});
    };
    if(n===1){
      const maxW=d.width-inset*2,h=Math.max(65,Math.min(available-caption,maxW*(variant===1?.80:variant===2?1:.54)));
      const w=variant===2?Math.min(maxW,h*1.05):variant===3?maxW*.82:maxW;
      place(photos[0],(d.width-w)/2,top,w,h);
    }else if(variant===2&&d.height>d.width){
      const cell=(available-32)/2,h=Math.max(65,cell-caption),w=Math.min(d.width-inset*2,h*2.35);
      photos.forEach((p,i)=>place(p,(d.width-w)/2,top+i*(cell+32),w,h));
    }else{
      const gap=44,w=(d.width-inset*2-gap)/2,h=Math.max(65,Math.min(available-caption-(variant===3?52:0),w*(d.height>d.width?1.18:.82)));
      if(variant===2){
        const first=(d.width-inset*2-gap)*.58,second=d.width-inset*2-gap-first;
        place(photos[0],inset,top,first,h);
        place(photos[1],inset+first+gap,top+30,second,Math.max(65,h-30));
      }else photos.forEach((p,i)=>place(p,inset+i*(w+gap),top+(variant===3&&i===1?52:0),w,h*(variant===3&&i===1?.82:1)));
    }
    return fit(d);
  }
  const cols=n===1?1:d.width>d.height&&n>=3?3:2,rows=Math.ceil(n/cols),gapX=36,gapY=38,caption=32+24*1.4*2;
  const cellW=(d.width-144-gapX*(cols-1))/cols,cellH=(bottom-top-gapY*Math.max(0,rows-1))/Math.max(1,rows);
  photos.forEach((photo,i)=>{
    let w=cellW,h=Math.max(65,Math.min(cellH-caption,cellW*.78));
    if(n===1)w=Math.min(cellW,h*1.45);
    const row=Math.floor(i/cols),inRow=Math.min(cols,n-row*cols),rowWidth=inRow*cellW+(inRow-1)*gapX;
    let x=(d.width-rowWidth)/2+(i%cols)*(cellW+gapX)+(cellW-w)/2,y=top+row*(cellH+gapY);
    if(n===4&&d.ratio==='3:4'&&d.style!=='minimal'&&top<d.height*.28){
      const slot=[[.08,.25,.48,.29],[.65,.31,.27,.18],[.12,.65,.32,.20],[.53,.64,.38,.25]][i];x=d.width*slot[0];y=d.height*slot[1];w=d.width*slot[2];h=d.height*slot[3];
    }
    if(d.variant%2===0&&n>1)x=d.width-x-w;
    Object.assign(photo,{x,y,w,h});
    for(const text of d.elements.filter(e=>e.photoId===photo.id))Object.assign(text,{x,y:y+h+32,w,maxLines:2});
  });
  return fit(d);
}
export function compositionName(d:JournalDocument) {
  const n=d.elements.filter(e=>e.type==='photo').length,index=((d.variant-1)%3+3)%3;
  return (n===1?['留白主图','方寸肖像','横幅札记']:n===2?['并置双图','上下叙事','错落对话']:['照片组页','镜像组页','照片组页'])[index];
}
export function changeJournalRatio(d:JournalDocument,ratio:string) {
  if(!['3:4','1:1','4:3'].includes(ratio))return false;
  const height=ratio==='1:1'?900:ratio==='4:3'?675:1200,sy=height/d.height;
  for(const e of d.elements)if(e.type!=='photo'&&!e.photoId){e.y*=sy;if(e.type!=='text')e.h*=sy;}
  d.height=height;d.ratio=ratio;reflowJournalPhotos(d);return true;
}
export function snapshot(document:JournalDocument,selected:string):Snapshot {return {document:copy(document),selected};}
export function recordHistory(past:Snapshot[],future:Snapshot[],before:Snapshot,document:JournalDocument) {if(JSON.stringify(before.document)===JSON.stringify(document))return false;past.push(copy(before));if(past.length>50)past.shift();future.splice(0);return true;}
export function focusOffset(e:JournalElement|undefined,scale:number,documentHeight:number,viewport:number) {return e?clamp((e.y+e.h/2)*scale-viewport/2,0,Math.max(0,documentHeight*scale-viewport)):0;}
export const JOURNAL_KEY='bird-assistant.journals.v1';
export function readJournals():JournalDocument[] {const value:unknown=wx.getStorageSync(JOURNAL_KEY);if(value===''||value==null)return [];if(!Array.isArray(value)||!value.every(d=>d&&d.version===1&&typeof d.id==='string'&&Array.isArray(d.elements)))throw new Error('手帐资料无法读取，已有草稿未覆盖。');return copy(value as JournalDocument[]);}
