// Local source projection for layout review. This does not emulate native WeChat components.
// Run npm test first. Output contains original sample illustrations, never chat screenshots.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {assertWxmlSyntax} from './wxml-syntax.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),require=createRequire(import.meta.url);
const model=require(resolve(root,'.test-build/services/map-presentation.js'));
const guide=require(resolve(root,'.test-build/services/field-guide.js'));
const forum=require(resolve(root,'.test-build/services/forum.js'));
const zoom=require(resolve(root,'.test-build/services/camera-zoom.js'));
const paperGesture=require(resolve(root,'.test-build/services/paper-gesture.js'));
const details=require(resolve(root,'.test-build/services/photo-details.js'));
const metadata=require(resolve(root,'.test-build/services/photo-info.js'));
function defaults(path,component=false){let definition;global[component?'Component':'Page']=v=>definition=v;const file=resolve(root,'.test-build',path+'.js');delete require.cache[require.resolve(file)];require(file);return structuredClone(definition.data);}
global.wx={canIUse:()=>false};
const camera=defaults('pages/identify/index'),feed=defaults('pages/community/index'),profile=defaults('pages/profile/index'),trip=defaults('field/trip/index'),journal=defaults('pages/journal/index');
const initials=require(resolve(root,'.test-build/services/profile-initials.js'));
const advice=require(resolve(root,'.test-build/field/services/trip-advice.js'));
const cacheFix=process.argv.includes('--cache-fix'),followup=process.argv.includes('--followup')||process.argv.includes('--workbench')||cacheFix,workbench=process.argv.includes('--workbench');
const out=resolve(process.env.BIRD_LAYOUT_OUT||resolve(root,'..','..','layout-0415'));mkdirSync(out,{recursive:true});
const read=path=>readFileSync(resolve(root,'miniprogram',path),'utf8');
const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const expr=(value,data)=>{try{return Function('data','with(data){return ('+value+')}')(data);}catch{return undefined;}};
const val=(value,data)=>value.replace(/{{([\s\S]*?)}}/g,(_m,e)=>String(expr(e,data)??''));
function parse(source){
  const root={tag:'block',attrs:{},children:[]},stack=[root];
  for(const match of source.matchAll(/<!--[\s\S]*?-->|<\/?[\w-]+\b(?:[^>"']|"[^"]*"|'[^']*')*>|[^<]+/g)){
    const token=match[0];if(token.startsWith('<!--'))continue;
    if(token.startsWith('</')){stack.pop();continue;}
    if(!token.startsWith('<')){stack.at(-1).children.push(token);continue;}
    const tag=/^<([\w-]+)/.exec(token)[1],attrs={};
    const tail=token.slice(tag.length+1).replace(/\/?\s*>$/,'');
    for(const m of tail.matchAll(/([\w:-]+)(?:="([^"]*)")?/g))attrs[m[1]]=m[2]??'';
    const node={tag,attrs,children:[]};stack.at(-1).children.push(node);if(!token.endsWith('/>'))stack.push(node);
  }return root;
}
const ast=new Map();function template(path){if(!ast.has(path)){const source=read(path+'.wxml');assertWxmlSyntax(source,path+'.wxml');ast.set(path,parse(source));}return ast.get(path);}
function children(nodes,data,context){let html='',taken=false;
  for(const node of nodes){if(typeof node==='string'){html+=escape(val(node,data));continue;}
    const a=node.attrs;
    if('wx:for'in a){const rows=expr(a['wx:for'].slice(2,-2),data)||[];for(let i=0;i<rows.length;i++)html+=children([{...node,attrs:Object.fromEntries(Object.entries(a).filter(([k])=>k!=='wx:for'))}],{...data,[a['wx:for-item']||'item']:rows[i],[a['wx:for-index']||'index']:i},context);taken=false;continue;}
    if('wx:if'in a){taken=!!expr(a['wx:if'].slice(2,-2),data);if(!taken)continue;}
    else if('wx:elif'in a){if(taken)continue;taken=!!expr(a['wx:elif'].slice(2,-2),data);if(!taken)continue;}
    else if('wx:else'in a){if(taken)continue;taken=true;}
    else taken=false;
    html+=render(node,data,context);
  }return html;
}
function render(node,data,context){
  const a=Object.fromEntries(Object.entries(node.attrs).map(([key,v])=>[key,val(v,data)]));
  if(a.slot==='refresher'&&!data.refreshing&&!data.pullProgress)return '';
  if(node.tag==='choice-sheet'||node.tag==='date-calendar'){
    const property=key=>{const raw=node.attrs[key];return raw?.startsWith('{{')?expr(raw.slice(2,-2),data):raw===''?true:raw;};
    if(!property('open'))return '';const path='components/'+node.tag+'/index',state={single:false,min:'',max:'',from:'',to:'',...defaults(path,true)};
    const values=Object.fromEntries(Object.keys(node.attrs).filter(key=>!key.startsWith('bind')).map(key=>[key,property(key)]));
    if(node.tag==='choice-sheet')return children(template(path).children,{...state,...values,bodyHeight:Math.min(Math.max(54,(values.options?.length||0)*54),values.maxBody||324,Math.max(54,context.viewportHeight-180))},context);
    const month=(values.from||values.min||'2026-11-28').slice(0,7)+'-01',calendar=require(resolve(root,'.test-build/services/calendar.js'));
    return children(template(path).children,{...state,...values,month,label:month.slice(0,4)+'年 '+Number(month.slice(5,7))+'月',draftFrom:values.from||'',draftTo:values.to||'',bodyHeight:Math.min(390,Math.max(40,context.viewportHeight-(values.single?210:270))),cells:calendar.calendarCells(month,values.from,values.to,values.min,values.max)},context);
  }
  if(node.tag==='image'&&a.src==='projection:journal'){
    const doc=context.journalDocument||demoJournal,ratio=doc.width/doc.height,height=Math.min(196,((Math.min(context.viewportWidth,620)-10)*.84-42)/ratio),preview=thumbnail.journalThumbnail(doc,height);
    const parts=preview.elements.map(part=>'<div style="position:absolute;overflow:hidden;'+part.style+';color:'+part.color+'">'+(part.type==='photo'?'<img src="'+part.src+'" style="position:absolute;'+part.imageStyle+'">':part.type==='text'?part.rows.map(line=>'<span style="position:absolute;left:0;white-space:pre;'+line.style+'">'+escape(line.text)+'</span>').join(''):part.type==='tape'?'<div style="width:100%;height:100%;background:#b7be90;opacity:.65"></div>':'<img src="'+part.src+'" style="width:100%;height:100%">')+'</div>').join('');
    return '<div class="'+a.class+'" style="display:flex;align-items:center;justify-content:center"><div class="projection-journal-page" style="position:relative;overflow:hidden;flex:none;width:'+preview.width+'px;height:'+preview.height+'px;background:'+preview.background+'">'+(preview.paper?'<img src="'+preview.paper+'" style="position:absolute;width:100%;height:100%">':'')+parts+'</div></div>';
  }
  if(node.tag==='photo-card')return children(template('components/photo-card/index').children,{src:a.src,width:Number(a.width),height:Number(a.height),fileInfo:data.photoInfo,manualInfo:data.manualPhotoInfo,resolution:'3200 × 2400 px',canFlip:!!data.photoInfo,flipped:!!context.photoBack},context);
  if(node.tag==='profile-avatar')return '<wx-profile-avatar class="component-host" style="display:block;flex:none;width:'+(Number(a.size)||64)+'px;height:'+(Number(a.size)||64)+'px">'+children(template('components/profile-avatar/index').children,{name:a.name,size:Number(a.size)||64,initials:initials.profileInitials(a.name),letters:a.avatar==='letter'||a.avatar==='/assets/avatars/letter.png',path:a.avatar.includes('/')?a.avatar:'/assets/avatars/'+a.avatar+'.png'},context)+'</wx-profile-avatar>';
  if(node.tag==='photo-editor')return children(template('components/photo-editor/index').children,{open:true,fields:details.PHOTO_FIELDS,value:data.manualCamera||{}},context);
  if(node.tag==='block')return children(node.children,data,context);
  if(node.tag==='app-header')return children(template('components/app-header/index').children,{headerHeight:88,status:24,right:100,title:a.title||'羽迹',back:('back' in a)&&(a.back===''||a.back==='true')},context);
  if(node.tag==='guide-card'){
    const bird=birds.find(b=>b.id===a['bird-id'])||birds[0],compact='compact'in a,width=context.columnWidth-26,maxH=compact?164:340;
    const sample=readFileSync(resolve(root,'miniprogram','.'+bird.src.replace(/^$/, '/assets/samples/field-0.png'))),ratio=sample.readUInt32BE(16)/sample.readUInt32BE(20),h=Math.min(maxH,width/ratio);
    return children(template('field/guide-card/index').children,{...bird,bird,compact,hideHeading:'hide-heading'in a,loading:false,notice:'',photo:bird.guide.photo,src:bird.guide.photo?bird.src:'',photoLoaded:true,photoFailed:false,photoWidth:h*ratio,photoHeight:h,traits:guide.guideTraits.map(t=>({...t,value:bird.guide.fields.find(f=>f.key===t.key)?.value||'—'}))},context);
  }
  if(node.tag==='species-search')return children(template('components/species-search/index').children,{placeholder:a.placeholder,query:context.search?'鹤':'',matches:context.search?searchBirds:[],listHeight:context.search?Math.min(240,searchBirds.length*54):54,above:false,inlineResults:node.attrs['inline-results']!==undefined},context);
  const tag=({view:'div',text:'span',image:'img','scroll-view':'wx-scroll-view',map:'wx-map',picker:'wx-picker',canvas:'wx-canvas'})[node.tag]||node.tag;
  let attrs='';for(const [key,v]of Object.entries(a)){if(key.startsWith('wx:')||/^(bind|catch)/.test(key)||key.startsWith('data-')||['mode','focus','auto-height','scroll-x','scroll-y'].includes(key))continue;
    if(['disabled','readonly'].includes(key)){if(v==='true')attrs+=' '+key;continue;}if(tag==='img'&&key==='style')continue;if(['input','textarea'].includes(tag)&&key==='value'&&tag==='textarea')continue;
    attrs+=' '+key+'="'+escape(v)+'"';}
  if(tag==='img')return '<img'+attrs+' style="'+escape((a.style||'')+';object-fit:'+(a.mode==='aspectFill'?'cover':'contain'))+'">';
  if(tag==='input')return '<input'+attrs+'>';
  let inside=children(node.children,data,context);if(tag==='textarea')inside=escape(a.value||'');
  if(node.tag==='map')inside='<div class="projection-map-label">示意底图 · 非地图服务截图</div><div class="projection-credit">腾讯地图 · 原生署名区域示意</div>';
  return '<'+tag+attrs+'>'+inside+'</'+tag+'>';
}
const photo={credit:'羽迹 · 项目示例插画',license:'示例素材',sourceUrl:'',licenseUrl:''};
const fields=(values)=>guide.guideTraits.map((t,i)=>({...t,value:values[i]||'—'}));
const birds=[{id:'duck',name:'鸳鸯',english:'Mandarin Duck',scientific:'Aix galericulata',family:'Anatidae',src:'/assets/samples/field-0.png',guide:{photo,fields:fields(['567 g','222.2 mm','33 mm','94.6 mm','森林','水生植物','多种环境']),source:'AVONET · 物种平均值',inferred:false}},
{id:'crane',name:'白鹤',english:'Siberian Crane',scientific:'Leucogeranus leucogeranus',family:'Gruidae',src:'',guide:{photo:null,fields:fields(['5913.4 g','579.2 mm','194.5 mm','198.5 mm','湿地','杂食','地面活动']),source:'AVONET · 物种平均值',inferred:false}}];
const searchBirds=['白鹤','白头鹤','丹顶鹤','灰鹤','沙丘鹤','蓑羽鹤'].map((name,i)=>({id:'s'+i,name,scientific:['Leucogeranus leucogeranus','Grus monacha','Grus japonensis','Grus grus','Antigone canadensis','Anthropoides virgo'][i]}));
const posts=[{id:'p1',publicName:'林间散步',created:'2026-11-25T00:10:00Z',title:'这两只麻雀，你会看哪里来区分？',body:'今天在树下观察了一会儿。头顶和脸颊的颜色似乎不太一样，想听听大家的辨识依据。',image:'/assets/samples/field-1.png',likes:12,replyCount:6,reactions:['like'],speciesId:'sparrow'},
{id:'p2',publicName:'清晨观鸟',created:'2026-11-24T23:15:00Z',title:'湖边的一点观察笔记',body:'早上绕湖走了一圈。想记录鸟儿停留的姿态，也想问问大家平时怎样整理观察笔记？',likes:8,replyCount:3,reactions:[]},
{id:'p3',publicName:'慢慢看鸟',created:'2026-11-24T22:40:00Z',title:'给第一次带望远镜的鸟友',body:'保持距离，安静观察。你有哪些想分享的小经验？',likes:4,replyCount:2,reactions:['bookmark']}].map(forum.forumPost);
const replies=[{id:'r1',publicName:'清晨观鸟',body:'可以先看头顶颜色，再看脸颊上的斑块。只看背影时，我会再等它转过头。',created:'2026-11-25T00:20:00Z'},
{id:'r2',parentId:'r1',replyToName:'清晨观鸟',publicName:'林间散步',body:'谢谢！这样对照更清楚了，我再补一张侧面的照片。',created:'2026-11-25T00:24:00Z'},
{id:'r3',parentId:'r2',replyToName:'林间散步',publicName:'我',body:'这张侧面确实更容易观察脸颊斑块。',status:'pending',created:'2026-11-25T00:26:00Z'}];
const tabs=['首页','手帐','识别','讨论','我的'].map((name,i)=>({name,icon:['home','journal','scan','chat','user'][i],route:String(i)}));
const reset='wx-scroll-view,wx-map,wx-picker,wx-canvas,swiper,swiper-item{display:block}swiper{overflow:hidden}swiper-item{height:100%}html,body{margin:0}body{font-family:"Noto Sans CJK SC","Microsoft YaHei",sans-serif}div{box-sizing:border-box}button{font:inherit;border:0;cursor:default}input,textarea{font:inherit;outline:0}img{box-sizing:border-box}span{box-sizing:border-box}textarea{resize:none} .projection-credit{position:absolute;left:4px;bottom:3px;font-size:10px;background:#ffffffcc;color:#667466}.projection-map-label{position:absolute;top:35%;left:15%;font-size:11px;color:#7c8c73}.native{top:0;bottom:0;left:0;right:0;background:#e9efdf url("/assets/map-preview.png") center/cover} .comparison-scroll{overflow-x:auto}.record-scroll,.results-scroll,.search-scroll{overflow-y:auto}.guide-mark{font-size:13px;line-height:1.8;margin-bottom:12px}.projection-banner{position:fixed;z-index:999;top:2px;left:8px;font-size:9px;color:#7b8974;pointer-events:none}';

const navigation=require(resolve(root,'.test-build/services/tabs.js'));
const nativeSheet=require(resolve(root,'.test-build/services/adaptive-sheets.js'));
const hub=defaults('field/hub/index'),social=defaults('field/social/index'),notebook=defaults('field/notes/index');
const catalogue=require(resolve(root,'.test-build/services/guide-shelf.js'));
const journalModel=require(resolve(root,'.test-build/services/journal-model.js')),thumbnail=require(resolve(root,'.test-build/services/journal-thumbnail.js'));
const demoJournal=journalModel.makeJournal([0,1,2,3].map(i=>({id:'p'+i,src:'/assets/samples/field-'+i+'.png',label:'片段 '+(i+1),notes:'',sample:true,selected:true})), '雪枝与绿影中的两只鸟');demoJournal.elements[1].text='一段留在纸上的观察记录，保留还拿不准的地方。';
const profileSizes=followup?JSON.parse(readFileSync(resolve(root,'docs/testing/device-profiles.json'),'utf8')).profiles.map(p=>[p.width,p.height]):[[320,568],[412,931],[768,1024]];
const followupKinds=['mapIdle','mapFilter','singleSighting','tripSetup','trip','tripControls','libraryFilter','libraryCalendar','journalDeck','journalArmed','journalDelete','journalUp','journalShare','journalShareSquare','journalShareLandscape','forum','forumMine','forumBookmarks','pollOpen','pollSearch','discovery','settings','drafts','inbox','groups','chat','friends','tripHistory','calendarDay','journalUpEarly'];
if(workbench)followupKinds.push('birdLibrary','birdSaved','externalGallery','externalTimeline','noteList','noteEdit','noteTrash','groupSettings','forward','threadedPost','growth');
if(cacheFix)followupKinds.splice(0,followupKinds.length,'journalCreate','journalCreateDates','journalDeck','libraryCalendar','settings','backup','backupReady','backupImport');
for(const [width,height] of profileSizes)for(const kind of (followup?followupKinds:['journalAI','emptyHistory','bookmarks','singleSighting','cameraCapture','trip','import','mapIdle','mapLocating','discovery','forum','drafts','journalDeck','journalArmed','journalDelete','journalShare','profile','settings','places','inbox','groups','chat'])){
 let path,data,tab=false,context={columnWidth:width-38,viewportWidth:width,viewportHeight:height};
 if(['backup','backupReady','backupImport'].includes(kind)){
  path='field/backup/index';data={...defaults(path),rows:[{id:'one',title:'湖边的光，和枝头的鸟',chosen:true},{id:'two',title:'用来检查长标题截断的观察手帐名字与素材',chosen:false}],placeCount:4,selected:1,readyPath:kind==='backupReady'?'projection-only':'',readySize:'4.62 MiB',readyPhotos:3,importInfo:kind==='backupImport'?{places:4,journals:2,photos:3,date:'2026-11-28 08:20',size:'4.62 MiB'}:null};
 }else if(['journalCreate','journalCreateDates'].includes(kind)){
  path='pages/journal/index';data={...journal,view:'picker',headerTitle:'新建手帐',source:'album',unknown:true,from:kind==='journalCreateDates'?'2026-11-01':'',to:kind==='journalCreateDates'?'2026-11-28':'',assets:[],picked:[],chosen:0,assetImageHeight:130};
 }else if(['birdLibrary','birdSaved'].includes(kind)){
  path='field/hub/index';const summaries=birds.map(b=>({...b,family:'示例科别 · 布局测试'}));data={...hub,screen:'library',guideShelf:kind==='birdSaved'?'saved':'catalogue',guideTotal:120,guideHasMore:true,guideGroups:catalogue.guideGroups(summaries),guideSavedIds:['duck'],featured:birds.map(b=>({...b,image:b.src,photo:b.guide.photo}))};
 }else if(['externalGallery','externalTimeline'].includes(kind)){
  path='field/hub/index';const items=[0,1,2,3].map(i=>({id:'external_'+i,title:['湖边的水鸟观察','林缘的一次相遇','灰喜鹊停在枝头','这次观察没有附图'][i],image:i===3?'':'/assets/samples/field-'+i+'.png',placeName:'北京 · 约一公里公开网格',date:i<2?'2026-11-27':'2026-11-26',source:i%2?'Birda · GBIF':'iNaturalist · GBIF'})),explore=catalogue.externalExplore(items,'','',false);data={...hub,screen:'external',items,externalView:kind==='externalGallery'?'gallery':'timeline',externalShown:explore.shown,externalSources:explore.sources,externalDays:explore.days,externalNext:true};
 }else if(['noteList','noteEdit','noteTrash'].includes(kind)){
  path='field/notes/index';const notes=[{id:'note1',title:'湖边的风，比昨天轻一些',body:'一开始没有听见鸟鸣。沿着步道慢慢走，树枝深处才有细细的声响。拿不准的鸟名先留空，下次再看看。',excerpt:'一开始没有听见鸟鸣。沿着步道慢慢走，树枝深处才有细细的声响。',tags:['湖边','想再去'],pinned:true,revision:1,observationId:'local',linked:'湖边观察',when:'2026-11-28 06:20',deletedAt:''},{id:'note2',title:'想记住的辨识线索',body:'先看脸颊，再看头顶。',excerpt:'先看脸颊，再看头顶。',tags:['辨识'],when:'2026-11-27 17:40',deletedAt:''}];data={...notebook,screen:kind==='noteList'?'list':'edit',trash:kind==='noteTrash',count:2,trashCount:1,rows:notes,tags:['湖边','辨识','想再去'],note:{...notes[0],deletedAt:kind==='noteTrash'?'2026-11-28':''},tagText:'湖边，想再去',saved:'已保存在本机',linkedName:'湖边观察'};
 }else if(['groupSettings','forward'].includes(kind)){
  path='field/social/index';const members=[{id:'me',nickname:'林间散步',avatar:'finch',handle:'forest_walk'},{id:'peer',nickname:'清晨观鸟',avatar:'owl',handle:'morning_birds'},{id:'third',nickname:'湖边散步',avatar:'leaf',handle:'lake_walk'}];data={...social,active:true,ready:true,registered:true,self:'me',id:'group',pageTitle:kind==='forward'?'转发给鸟友':'校园观鸟小队',screen:kind==='forward'?'forward':'group',group:{name:'校园观鸟小队',owner:'me',members},settingsOpen:kind==='groupSettings',visibleMembers:members,account:{nickname:'林间散步',handle:'forest_walk'},prefs:{alias:'周末湖边小队',pinned:true,quiet:false},aliasDraft:'周末湖边小队',accepted:members.slice(1),groups:[{id:'group',name:'校园观鸟小队'}],invitees:[{id:'friend',nickname:'雨后听鸟'}],forwardShare:{id:'post_demo',title:'这两只鸟，你会看哪里来区分？'},forwardTarget:{id:'peer',kind:'chat',name:'清晨观鸟'}};
 }else if(kind==='threadedPost'){
  path='field/hub/index';const replies=[{id:'r1',publicName:'清晨观鸟',memberId:'peer',body:'先看看头顶和脸颊的颜色，也留意嘴的形状。',created:'2026-11-27T10:00:00Z'},...Array.from({length:5},(_,i)=>({id:'child'+i,parentId:'r1',publicName:i%2?'湖边散步':'林间散步',replyToName:'清晨观鸟',body:'这个角度的线索很有帮助，下次试着再观察一会儿。',created:'2026-11-27T10:0'+(i+1)+':00Z'}))];data={...hub,screen:'record',id:'post_demo',self:'me',record:{...posts[0],channel:'post',visibility:'public',features:{threadedReplies:true},replies,replyCount:6},replyThreads:forum.forumThreads(replies),body:'可以再看看翅膀上的花纹。',replyTarget:{id:'r1',name:'清晨观鸟'},replyDraftSaved:'未发送文字已保存在本机',photo:''};
 }else if(kind==='growth'){
  path='field/hub/index';data={...hub,screen:'growth',record:{points:29,observations:12,contributions:3,replies:1}};
 }else if(['journalDeck','journalArmed','journalDelete','journalUp','journalShare','journalShareSquare','journalShareLandscape','libraryFilter','libraryCalendar','calendarDay','journalUpEarly'].includes(kind)){
  path='pages/journal/index';tab=true;const rows=[0,1,2].map((i)=>({...demoJournal,id:'sample'+i,title:i?'林间手帐 '+i:demoJournal.title,createdLabel:'2026-11-27',updatedLabel:'2026-11-27 23:42',cover:'',thumbnail:'',revision:'sample'}));
  const ratio=kind==='journalShareSquare'?'1:1':kind==='journalShareLandscape'?'4:3':'3:4',doc=journalModel.makeJournal([0,1,2,3].map(i=>({id:'p'+i,src:'/assets/samples/field-'+i+'.png',label:'片段 '+(i+1),sample:true,selected:true})),demoJournal.title,ratio);context.journalDocument=doc;const previewWidth=Math.min(160,(width-82)*.46,height*.23*(doc.width/doc.height)),previewHeight=previewWidth/(doc.width/doc.height);
  data={...journal,homeHeight:Math.max(0,height-154),homeCompact:height-154<560,homeTiny:height-154<340,resumeRow:rows[1],view:'home',libraryRows:rows,deckIndex:1,deckSlots:rows.map((row,index)=>({...row,index,slot:index-1})),libraryTotal:3,deckThumbnails:{sample0:'projection:journal',sample1:'projection:journal',sample2:'projection:journal'},headerHeight:88,paperCloudHeight:310,paperVisualId:['journalArmed','journalDelete','journalUp','journalUpEarly'].includes(kind)?'sample1':'',paperPhase:['journalArmed','journalDelete','journalUp','journalUpEarly'].includes(kind)?'armed':'',paperArmedId:['journalArmed','journalDelete','journalUp','journalUpEarly'].includes(kind)?'sample1':'',paperDragStyle:kind==='journalDelete'?'transform:translateY(80px) rotate(2deg) scale(.54);opacity:.42':kind==='journalUp'?'transform:translateY(-70px) rotate(-2deg) scale(.56);opacity:1':'',paperFog:kind==='journalUp'?1:kind==='journalUpEarly'?.01:0,paperDragDown:kind==='journalDelete',paperDragUp:kind==='journalUp'||kind==='journalUpEarly',paperDragProgress:kind==='journalUp'?.9:kind==='journalUpEarly'?.2:0,paperDragAction:kind==='journalDelete'?'delete':kind==='journalUp'?'share':'',filterOpen:kind==='libraryFilter',filterTitle:'手帐排序',filterOptions:['最近修改','创建时间'],filterSelected:0,calendarOpen:kind==='libraryCalendar'||kind==='calendarDay',calendarFrom:'2026-11-03',calendarTo:kind==='calendarDay'?'2026-11-03':'2026-11-14',shareOpen:kind.startsWith('journalShare'),shareId:demoJournal.id,shareTitle:demoJournal.title,shareRatio:ratio,sharePreviewWidth:previewWidth,sharePreviewHeight:previewHeight,sharePreview:thumbnail.journalThumbnail(doc,previewHeight)};
 }else if(['mapIdle','mapLocating','mapFilter'].includes(kind)){
  path='components/field-map/index';const panes=model.mapPanes(width,height-88-80);data={...defaults(path,true),...panes,nativeActive:true,headerHeight:88,locating:kind==='mapLocating',filterOpen:kind==='mapFilter',filterTitle:'显示哪些观察',filterOptions:['公开与我的','公开鸟讯','我的标记'],filterSelected:0};tab=true;
 }else if(['discovery','forum','forumMine','forumBookmarks','drafts'].includes(kind)){
  path='pages/community/index';tab=kind!=='drafts';data={...feed,view:kind==='drafts'?'drafts':'feed',moreOpen:kind==='discovery',feedTab:kind==='forumMine'?'mine':kind==='forumBookmarks'?'bookmarks':'all',feedTabIndex:kind==='forumMine'?1:kind==='forumBookmarks'?2:0,remotePosts:posts.map((post,index)=>index?post:{...post,poll:{total:12,result:null,candidates:[]}}),feedHeight:height-88-(kind==='drafts'?0:66),draftDeckHeight:Math.max(66,height-88-(height-88<340?80:138)),draftCompact:height-88<520,draftTiny:height-88<340,draftCount:1,draftRows:[{id:'draft',title:'这只鸟还没认出来，求大家帮忙看看',excerpt:'还不确定是什么鸟，想请鸟友帮忙鉴定。',created:'2026-11-27 09:27',modified:'2026-11-27 23:40',count:2,cover:'/assets/samples/field-0.png'}]};
 }else if(['profile','settings','places'].includes(kind)){
  path='pages/profile/index';tab=true;data={...profile,view:kind,pageTitle:kind==='settings'?'设置与缓存':kind==='places'?'收藏地点':'羽迹',name:'林间散步',communityName:'林间散步',communityAvatar:'/assets/avatars/finch.png',observationCount:23,speciesCount:8,favoriteCount:5,storageKB:736,cacheInfo:{files:14,kilobytes:486,entries:15,protectedFiles:0},writingStatus:'手机写作服务尚未上线，请维护者更新业务服务与写作路由。你的文字和照片仍保留，出行服务可独立使用。',savedPlaces:[{id:'park',name:'上海迪士尼乐园',address:'上海市浦东新区川沙镇',dateLabel:'2026-11-27 23:40'}]};
 }else if(['inbox','groups','chat','friends'].includes(kind)){
  path='field/social/index';data={...social,pageTitle:kind==='inbox'?'私信与通知':kind==='chat'?'林间散步':'观鸟群聊',screen:kind,active:true,ready:true,registered:true,self:'me',id:'peer',account:{nickname:'我',avatar:'owl'},member:{profile:{nickname:'林间散步',avatar:'finch'},canMessage:true},inbox:[{peer:'peer',profile:{nickname:'林间散步',avatar:'finch'},unread:3,body:'明天一起去湖边看看吗？',timeLabel:'2026-11-27 23:40'}],friendTab:'incoming',incoming:[{id:'friend',nickname:'清晨观鸟',handle:'morning_birds',avatar:'finch'},{id:'friend2',nickname:'林间散步',handle:'forest_walk',avatar:'leaf'}],groups:[{id:'group',name:'校园观鸟小队',unread:2}],activity:[{id:'reply',post:'post',nickname:'清晨观鸟',body:'可以先看看头顶和脸颊的颜色。',timeLabel:'2026-11-27 23:35'}],lines:[{id:'one',sender:'peer',body:'明天一起去湖边看看吗？',timeLabel:'23:40'},{id:'two',sender:'me',body:'好，我们先看看天气，再决定出发时间。',timeLabel:'23:41'}],text:'我带望远镜'};
 }else if(kind==='journalAI'||kind==='emptyHistory'){
  path='pages/journal/index';data={...journal,ai:kind==='journalAI',aiHistoryOpen:kind==='emptyHistory',view:'home',doc:{id:'sample',title:'我的手帐'},prompt:'我在湖边观察了一会儿，想写得自然简短，保留自己拿不准的地方。',aiPhotos:[{id:'one',src:'/assets/samples/field-1.png',label:'照片 1（正中）',selected:true}],aiPhotoCount:1,aiTargetLabel:'新增文字框',aiSelectedAvailable:false,error:'手机写作服务尚未上线，原稿仍保留。'};
 }else if(['pollOpen','pollSearch'].includes(kind)){
  path='field/hub/index';context.search=kind==='pollSearch';data={...hub,screen:'record',id:'poll',pollOpen:true,pollSelection:'duck',pollSelectionName:'鸳鸯',record:{...posts[0],id:'poll',channel:'post',visibility:'public',poll:{total:12,mine:'duck',owner:true,result:null,candidates:[{id:'duck',name:'鸳鸯',votes:8},{id:'sparrow',name:'树麻雀',votes:4}]}},recordGallery:[],replyThreads:[]};
 }else if(kind==='bookmarks'){
  path='field/hub/index';data={...hub,screen:'bookmarks',items:[{id:'saved',title:'这两只鸟，你会看哪里来区分？',body:'在湖边观察了一会儿，想听听大家的辨识依据。这里保留对不确定鸟种的描述。',image:'/assets/samples/field-1.png',channel:'post',source:'羽迹社区',date:'2026-11-27'}]};
 }else if(kind==='singleSighting'){
  path='components/field-map/index';const panes=model.mapPanes(width,height-88-80);data={...defaults(path,true),...panes,...model.recordPane(panes.sheetHeight,panes.sheetHeaderHeight,1,false),nativeActive:true,headerHeight:88,listOpen:true,listTotal:1,recordOrder:'recent',selected:[{id:'duck',speciesName:'丑鸭',speciesId:'duck',placeName:'北京',date:'2017-02-20',source:'iNaturalist · GBIF'}]};tab=true;
 }else if(kind==='cameraCapture'){
  path='pages/identify/index';data={...camera,height:height-88-80,demo:true,cameraReady:true,mode:'wait',cameraShort:height<700,captureCard:{id:'photo',path:'/assets/samples/field-1.png',title:'照片已保存',status:'正在识别这张原图 · 可继续拍摄'}};tab=true;
 }else if(kind==='import'){
  path='pages/identify/index';data={...camera,view:'import',importKind:'gallery',assets:[]};
 }else{
  path='field/trip/index';const brief={headline:'先沿湖边步道观察，再走入林缘。',reasons:['距出发地较近，水域和林缘可以连起来走。','留出时间安静观察，避免反复换点。'],watchFor:['留意水面和低枝的活动。','尚未确认鸟种时保留疑问。'],preparation:['带望远镜、保暖外套和水。'],uncertainty:['历史鸟讯只供参考，当天能否遇见仍需现场观察。']};data={...trip,showHistory:kind==='tripHistory',historyRows:[{id:'trip1',question:'周末在北京附近，想找能观察水鸟的地方',place:'当前地图中心 · 北京一带',updated:'2026-11-28 03:20',date:'2026-11-28',conditions:'2小时 · 30公里 · 所有鸟种',excerpt:'先沿湖边步道观察，再走入林缘，留出时间安静观察。',turns:3}],regionLabel:'北京一带',point:{latitude:40,longitude:116.3},place:'当前地图中心',date:'2026-11-27',windowLabel:'2026-11-27 09:00 至 11:00',filterOpen:kind==='tripControls',filterTitle:'出发时间',filterOptions:trip.times,filterSelected:7,sections:advice.adviceSections(brief),answer:kind==='tripSetup'?null:{brief,model:'qwen-plus',referenceMap:[],visits:[],sources:[],communityCards:[],guideCards:[],stops:[],parks:[],stages:[{time:'09:00',action:'沿湖边步道观察水面'},{time:'10:00',action:'进入林缘，留意树枝间的活动'}],weatherCards:[{id:'weather',area:'所选区域',available:true,hours:[{hour:'09:00',temp:3,wind:2,rain:0},{hour:'10:00',temp:5,wind:3,rain:0}]}]}};
 }
 const css=['app.wxss','components/app-header/index.wxss','custom-tab-bar/index.wxss','components/profile-avatar/index.wxss',path+'.wxss','styles/writing-feedback.wxss','components/choice-sheet/index.wxss','components/date-calendar/index.wxss','components/species-search/index.wxss'].map(read).join('\n').replace(/(^|[}\n])\s*page\s*\{/g,'$1body{').replace(/:host/g,'.component-host').replace(/([^{}]+)\{/g,(_m,sel)=>sel.replace(/(?<![.\w-])(view|text|image|scroll-view|map|picker|canvas)(?=[\s:>+~,.#\[]|$)/g,tag=>({view:'div',text:'span',image:'img','scroll-view':'wx-scroll-view',map:'wx-map',picker:'wx-picker',canvas:'wx-canvas'})[tag])+'{').replace(/(-?[0-9.]+)rpx/g,(_m,n)=>Number(n)*width/750+'px');
 const header=path.startsWith('pages/')||['field/social/index','field/notes/index','field/backup/index'].includes(path)?'':children(template('components/app-header/index').children,{headerHeight:88,status:24,right:100,title:kind==='bookmarks'?'我的收藏':['birdLibrary','birdSaved'].includes(kind)?'鸟种资料库':['externalGallery','externalTimeline'].includes(kind)?'外部社区鸟讯':kind==='growth'?'徽章与成长':kind.startsWith('trip')?'观鸟出行顾问':'羽迹',back:!tab},context);
 const body=header+children(template(path).children,data,context)+(tab?children(template('custom-tab-bar/index').children,{tabs,selected:kind.startsWith('journal')?1:kind==='cameraCapture'?2:['discovery','forum','forumMine','forumBookmarks'].includes(kind)?3:['profile','settings','places'].includes(kind)?4:0,hidden:navigation.navigationFocused(data)},context):'');
 const measure=`<script>const fog=${paperGesture.paperCloudOpacity.toString()};const size=${nativeSheet.sheetBodyHeight.toString()};function fit(){const frame=document.querySelector('.journal-deck-frame'),deck=document.querySelector('.journal-deck');if(frame&&deck){const tiny=document.querySelector('.library-tiny'),height=Math.max(66,Math.min(420,Math.floor(frame.getBoundingClientRect().height-62)));deck.style.height=height+'px';const lane=Math.floor(Math.min(innerWidth-16,Math.max(264,Math.min(430,(height*.78+86)/.84))));deck.style.width=lane+'px';for(const cover of frame.querySelectorAll('.deck-cover'))cover.style.height=Math.max(24,Math.min(220,height-(tiny?62:132)))+'px';for(const image of frame.querySelectorAll('.projection-journal-page')){const parent=image.parentElement;image.style.transform='scale('+Math.min(parent.clientWidth/image.offsetWidth,parent.clientHeight/image.offsetHeight)+')';}const card=frame.querySelector('.paper-armed');if(card&&${JSON.stringify(kind)}==='journalDelete'){card.style.transform='none';const rect=card.getBoundingClientRect(),delta=Math.max(0,Math.min(116,innerHeight-124-rect.top-rect.height*.6));card.style.transform='translateY('+delta+'px) rotate(2deg) scale(.54)';card.style.opacity=.8;}if(card&&['journalUp','journalUpEarly'].includes(${JSON.stringify(kind)})){card.style.transform='none';const rect=card.getBoundingClientRect(),boundary=document.querySelector('.library-dates, .library-tools-button')?.getBoundingClientRect().bottom||200,progress=${kind==='journalUp'?.9:.2},origin=rect.top+rect.height*.6,dy=(boundary-36-origin)*progress;card.style.transform='translateY('+dy+'px) rotate(-2deg) scale('+(1-progress*.46)+')';card.style.opacity=1;const cloud=document.querySelector('.paper-cloud');if(cloud){const top=document.querySelector('.library-heading')?.getBoundingClientRect().bottom||88;cloud.style.top=top+'px';cloud.style.height=Math.max(24,boundary-top)+'px';cloud.style.opacity=fog(origin,rect.height,rect.width,boundary-36-origin,progress,boundary);}}}for(const b of document.querySelectorAll('.sheet-measure')){const id=b.getAttribute('data-sheet-id');const h=[...document.querySelectorAll('.sheet-header-fixed')].find(h=>h.getAttribute('data-sheet-id')===id);b.parentElement.style.height=size(b.scrollHeight,h?.getBoundingClientRect().height||72,innerHeight,24,id==='journalShare'?.94:.84,id==='journalShare'?16:56)+'px';}}window.onload=fit;document.fonts.ready.then(fit);</script>`;
 const html='<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+reset+'\n'+css+'\nhtml,body{width:'+width+'px;height:'+height+'px}.sheet-scroll{overflow-y:auto}.projection-banner{display:none}</style><body>'+body+measure+'</body></html>';
 writeFileSync(resolve(out,kind+'-'+width+'x'+height+'.html'),html.replaceAll('"/assets/','"file://'+resolve(root,'miniprogram/assets')+'/').replaceAll('url("/assets/','url("file://'+resolve(root,'miniprogram/assets')+'/'));
}
console.log(out);
