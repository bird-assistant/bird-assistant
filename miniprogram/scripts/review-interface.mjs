// Local source projection for layout review. This does not emulate native WeChat components.
// Run npm test first. Output contains original sample illustrations, never chat screenshots.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),require=createRequire(import.meta.url);
const model=require(resolve(root,'.test-build/services/map-presentation.js'));
const guide=require(resolve(root,'.test-build/services/field-guide.js'));
const forum=require(resolve(root,'.test-build/services/forum.js'));
const zoom=require(resolve(root,'.test-build/services/camera-zoom.js'));
const details=require(resolve(root,'.test-build/services/photo-details.js'));
const metadata=require(resolve(root,'.test-build/services/photo-info.js'));
function defaults(path,component=false){let definition;global[component?'Component':'Page']=v=>definition=v;require(resolve(root,'.test-build',path+'.js'));return structuredClone(definition.data);}
global.wx={canIUse:()=>false};
const camera=defaults('pages/identify/index'),feed=defaults('pages/community/index'),profile=defaults('pages/profile/index'),trip=defaults('field/trip/index'),journal=defaults('pages/journal/index');
const initials=require(resolve(root,'.test-build/services/profile-initials.js'));
const advice=require(resolve(root,'.test-build/field/services/trip-advice.js'));
const out=resolve(root,'docs/design/interface-0.4.6');mkdirSync(out,{recursive:true});
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
const ast=new Map();function template(path){if(!ast.has(path))ast.set(path,parse(read(path+'.wxml')));return ast.get(path);}
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
  if(node.tag==='photo-card')return children(template('components/photo-card/index').children,{src:a.src,width:Number(a.width),height:Number(a.height),fileInfo:data.photoInfo,manualInfo:data.manualPhotoInfo,resolution:'3200 × 2400 px',canFlip:!!data.photoInfo,flipped:!!context.photoBack},context);
  if(node.tag==='profile-avatar')return children(template('components/profile-avatar/index').children,{name:a.name,size:Number(a.size)||64,initials:initials.profileInitials(a.name),letters:a.avatar==='letter'||a.avatar==='/assets/avatars/letter.png',path:a.avatar.includes('/')?a.avatar:'/assets/avatars/'+a.avatar+'.png'},context);
  if(node.tag==='photo-editor')return children(template('components/photo-editor/index').children,{open:true,fields:details.PHOTO_FIELDS,value:data.manualCamera||{}},context);
  if(node.tag==='block')return children(node.children,data,context);
  if(node.tag==='app-header')return children(template('components/app-header/index').children,{headerHeight:88,status:24,right:100,title:a.title||'羽迹',back:a.back==='true'},context);
  if(node.tag==='guide-card'){
    const bird=birds.find(b=>b.id===a['bird-id'])||birds[0],compact='compact'in a,width=context.columnWidth-26,maxH=compact?164:340;
    const sample=readFileSync(resolve(root,'miniprogram','.'+bird.src.replace(/^$/, '/assets/samples/field-0.png'))),ratio=sample.readUInt32BE(16)/sample.readUInt32BE(20),h=Math.min(maxH,width/ratio);
    return children(template('field/guide-card/index').children,{...bird,bird,compact,hideHeading:'hide-heading'in a,loading:false,notice:'',photo:bird.guide.photo,src:bird.guide.photo?bird.src:'',photoLoaded:true,photoFailed:false,photoWidth:h*ratio,photoHeight:h,traits:guide.guideTraits.map(t=>({...t,value:bird.guide.fields.find(f=>f.key===t.key)?.value||'—'}))},context);
  }
  if(node.tag==='species-search')return children(template('components/species-search/index').children,{placeholder:a.placeholder,query:context.search?'鹤':'',matches:context.search?searchBirds:[],listHeight:220,above:false},context);
  const tag=({view:'div',text:'span',image:'img','scroll-view':'div',map:'div',picker:'div',canvas:'div'})[node.tag]||node.tag;
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
const reset='html,body{margin:0}body{font-family:"Noto Sans CJK SC","Microsoft YaHei",sans-serif}div{box-sizing:border-box}button{font:inherit;border:0;cursor:default}input,textarea{font:inherit;outline:0}img{box-sizing:border-box}span{box-sizing:border-box}textarea{resize:none} .projection-credit{position:absolute;left:4px;bottom:3px;font-size:10px;background:#ffffffcc;color:#667466}.projection-map-label{position:absolute;top:35%;left:15%;font-size:11px;color:#7c8c73}.native{top:0;bottom:0;left:0;right:0;background:#e9efdf url("/assets/map-preview.png") center/cover} .comparison-scroll{overflow-x:auto}.record-scroll,.results-scroll,.search-scroll{overflow-y:auto}.guide-mark{font-size:13px;line-height:1.8;margin-bottom:12px}.projection-banner{position:fixed;z-index:999;top:2px;left:8px;font-size:9px;color:#7b8974;pointer-events:none}';
for(const width of [320,390,768])for(const kind of ['camera','cameraZoom','cameraClues','map','mapMoving','search','searchSingle','menu','photo','photoBack','feed','refresh','compose','import','profile','trip','tripHistory','journal']){
  let path,data,context={columnWidth:guide.comparisonWidth(width,2),search:kind==='search',photoBack:kind==='photoBack'},tab=false;
  if(kind.startsWith('camera')){path='pages/identify/index';data={...camera,height:676,demo:true,cameraReady:true,zoomEnabled:true,maxZoom:5,clueCollapsed:kind==='camera',expanded:kind==='cameraClues',clueHeight:46,zoom:3.5,zoomText:'3.5',zoomOpen:kind==='cameraZoom',zoomProfile:'pura70proplus',zoomShortcuts:zoom.zoomShortcuts(5,'pura70proplus'),zoomTicks:zoom.zoomTicks(3.5,5,width-24),zoomRange:'示例变焦 1.0–5.0×'};tab=true;}
  else if(['feed','menu','refresh','compose'].includes(kind)){path='pages/community/index';data={...feed,feedHeight:676,view:kind==='compose'?'compose':'feed',image:kind==='compose'?'/assets/samples/field-1.png':'',title:'一张清晨的鸟儿',body:'想记录这次发现。',manualCamera:{device:'Sony α7 IV',lens:'FE 200–600mm',iso:'800',exposure:'1/2000 s',focusMode:'AF-C'},refreshing:kind==='refresh',pullProgress:kind==='refresh'?1:0,remotePosts:posts,moreOpen:kind==='menu',feedLoading:kind==='feed'};tab=true;}
  else if(kind==='import'){path='pages/identify/index';data={...camera,view:'import',importMode:'media',batchProgress:'已完成 2 / 2 · 点击卡片旁的查看 / 复核',assets:[{id:'e1',kind:'photo',selected:true,name:'照片 1',status:'候选待复核',path:'/assets/samples/field-1.png'},{id:'e2',kind:'photo',selected:true,name:'照片 2',status:'已分析 · 查看结果',path:'/assets/samples/field-0.png'},{id:'a1',kind:'audio',selected:true,name:'清晨林间鸟鸣-录音文件.wav',sizeLabel:'384 KB',status:'未识别'}]};}
  else if(kind==='profile'){path='pages/profile/index';data={...profile,view:'edit',edit:true,draftAvatar:'/assets/avatars/letter.png',draftName:'林间拾羽'};}
  else if(kind==='journal'){path='pages/journal/index';data={...journal,view:'setup',chosen:2,assets:[{id:'1',selected:true,src:'/assets/samples/field-0.png'},{id:'2',selected:true,src:'/assets/samples/field-1.png'}]};}
  else if(kind==='tripHistory'){path='field/trip/index';data={...trip,showHistory:true,historyRows:[{id:'c1',question:'明天在公园看什么鸟？',place:'地图选点附近',updated:'2026-11-25 12:00'},{id:'c2',question:'如果下午有风，该怎么调整？',place:'地图选点附近',updated:'2026-11-25 12:15'}]};}
  else if(kind==='trip'){path='field/trip/index';const brief={headline:'上午先到湖畔步道，留一个小时安静观察。',reasons:['距出发地较近，水域与林缘可以连起来走。'],watchFor:['鸳鸯：留意岸边与水面的活动。'],preparation:['带望远镜与保暖外套。'],uncertainty:['这是历史鸟讯，今天是否遇见仍需现场观察。']};data={...trip,point:{latitude:40,longitude:116.3},place:'当前地图中心',date:'2026-11-25',asked:'这个时段去哪里观鸟？',windowLabel:'2026-11-25 11:00 至 13:00',answer:{brief,model:'qwen-plus',stages:[{time:'11:00',action:'沿湖边步道观察水面。'},{time:'12:00',action:'转入林缘，留意枝间活动。'}],sources:[{id:'A1',label:'湖畔公开鸟讯'}],weatherCards:[],guideCards:[],parks:[],stops:[]},sections:advice.adviceSections(brief)};}
  else if(kind==='photo'||kind==='photoBack'){path='field/hub/index';data={screen:'record',id:'p1',record:{...posts[0],channel:'post',date:'2026-11-24',placeName:'湖边步道',visibility:'public',replyCount:0,replies:[],bookmarked:false},photoFailed:false,photo:'/assets/samples/field-1.png',photoWidth:Math.min(260,width-50),photoHeight:240,photoInfo:metadata.photoInfo({device:'Pura 70 Pro+',focal:'6.9',aperture:'1.6',exposure:'0.00125',iso:'100'}),replyThreads:[],body:'',replyTarget:null,selectedSpecies:'',replySuggestOpen:false};}
  else if(kind==='compare'){path='field/compare/index';data={ids:birds.map(b=>b.id),candidates:[],subject:null,notice:'',columnWidth:context.columnWidth};}
  else if(kind==='thread'){path='field/hub/index';data={screen:'record',id:'p1',record:{...posts[0],channel:'post',visibility:'public',replies,bookmarked:false},replyThreads:forum.forumThreads(replies),body:'',replyTarget:null,selectedSpecies:'',photo:'',replySuggestOpen:false};}
  else if(kind==='places'){path='field/hub/index';data={screen:'species',id:'duck',record:birds[0],tab:'places',placeCount:52,recordCount:113,places:Array.from({length:7},(_,i)=>({id:'place'+i,placeName:['Beijing · 湖边步道','Fujian','Beijing · 校园绿地'][i%3],recordCount:1+i,date:'2026-11-'+(24-i)}))};}
  else{path='components/field-map/index';data={nativeActive:true,...model.mapPanes(width,844-88-80),headerHeight:88,mapMoving:kind==='mapMoving',sheetCollapsed:kind==='mapMoving',recordsLoading:kind==='mapMoving',listOpen:true,listTotal:28,listTitle:'本区域观察',recordOrder:'recent',searchHeight:kind==='searchSingle'?44:132,matches:kind==='searchSingle'?[{id:'duck',name:'鸳鸯',scientific:'Aix galericulata'}]:kind==='search'?[{id:'duck',name:'鸳鸯',scientific:'Aix galericulata'},{id:'tit',name:'黄腹山雀',scientific:'Periparus venustulus'},{id:'magpie',name:'灰喜鹊',scientific:'Cyanopica cyanus'}]:[],keyword:kind==='search'?'鸳鸯':'',selected:posts.map((p,i)=>({id:p.id,speciesName:['灰喜鹊','喜鹊','鸳鸯'][i],speciesId:'duck',source:'iNaturalist · GBIF',placeName:'北京',date:'2026-11-24'})),markers:[],scopes:['公开与我的'],periods:['所有日期'],origins:['全部来源'],scope:0,period:0,origin:0};tab=true;}
  const styles=['app.wxss','components/app-header/index.wxss','custom-tab-bar/index.wxss',path+'.wxss','components/photo-editor/index.wxss','components/photo-card/index.wxss','components/profile-avatar/index.wxss','field/guide-card/index.wxss','components/species-search/index.wxss'].map(read).join('\n').replace(/(^|[}\n])\s*page\s*\{/g,'$1body{').replace(/:host/g,'.component-host').replace(/([^{}]+)\{/g,(_m,selector)=>selector.replace(/(?<![.\w-])(view|text|image|scroll-view|map|picker|canvas)(?=[\s:>+~,.#\[]|$)/g,tag=>({view:'div',text:'span',image:'img','scroll-view':'div',map:'div',picker:'div',canvas:'div'})[tag])+'{');
  const header=path.startsWith('pages/')?'':children(template('components/app-header/index').children,{headerHeight:88,status:24,right:100,back:kind!=='map',title:(['thread','photo','photoBack'].includes(kind))?'帖子详情':['map','mapMoving','search','searchSingle'].includes(kind)?'羽迹':kind==='trip'?'观鸟出行顾问':kind==='places'?'鸟种资料':'鸟种对比'},context);
  const body=header+children(template(path).children,data,context)+(tab?children(template('custom-tab-bar/index').children,{tabs,selected:(['feed','menu','refresh','compose'].includes(kind))?3:kind.startsWith('camera')?2:0,hidden:false},context):'');
  writeFileSync(resolve(out,kind+'-'+width+'.html'),'<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>0.4.6 源码布局投影 · '+kind+'</title><style>'+reset+'\n'+styles+'</style><body><div class="projection-banner">源码布局投影 · 示例内容 · 非微信截图</div>'+body+'</body></html>');
}
console.log(out);
