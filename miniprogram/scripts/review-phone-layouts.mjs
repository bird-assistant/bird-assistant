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
function defaults(path,component=false){let definition;global[component?'Component':'Page']=v=>definition=v;const file=resolve(root,'.test-build',path+'.js');delete require.cache[require.resolve(file)];require(file);return structuredClone(definition.data);}
global.wx={canIUse:()=>false};
const camera=defaults('pages/identify/index'),feed=defaults('pages/community/index'),profile=defaults('pages/profile/index'),trip=defaults('field/trip/index'),journal=defaults('pages/journal/index');
const initials=require(resolve(root,'.test-build/services/profile-initials.js'));
const advice=require(resolve(root,'.test-build/field/services/trip-advice.js'));
const out=resolve(process.env.BIRD_LAYOUT_OUT||resolve(root,'..','..','layout-0414'));mkdirSync(out,{recursive:true});
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
const reset='wx-scroll-view,wx-map,wx-picker,wx-canvas{display:block}html,body{margin:0}body{font-family:"Noto Sans CJK SC","Microsoft YaHei",sans-serif}div{box-sizing:border-box}button{font:inherit;border:0;cursor:default}input,textarea{font:inherit;outline:0}img{box-sizing:border-box}span{box-sizing:border-box}textarea{resize:none} .projection-credit{position:absolute;left:4px;bottom:3px;font-size:10px;background:#ffffffcc;color:#667466}.projection-map-label{position:absolute;top:35%;left:15%;font-size:11px;color:#7c8c73}.native{top:0;bottom:0;left:0;right:0;background:#e9efdf url("/assets/map-preview.png") center/cover} .comparison-scroll{overflow-x:auto}.record-scroll,.results-scroll,.search-scroll{overflow-y:auto}.guide-mark{font-size:13px;line-height:1.8;margin-bottom:12px}.projection-banner{position:fixed;z-index:999;top:2px;left:8px;font-size:9px;color:#7b8974;pointer-events:none}';

const nativeSheet=require(resolve(root,'.test-build/services/adaptive-sheets.js'));
const hub=defaults('field/hub/index');
for(const [width,height] of [[320,568],[412,931],[768,1024]])for(const kind of ['journalAI','emptyHistory','bookmarks','singleSighting','cameraCapture','trip','import']){
 let path,data,tab=false,context={columnWidth:width-38};
 if(kind==='journalAI'||kind==='emptyHistory'){
  path='pages/journal/index';data={...journal,ai:kind==='journalAI',aiHistoryOpen:kind==='emptyHistory',view:'home',doc:{id:'sample',title:'我的手帐'},prompt:'我在湖边观察了一会儿，想写得自然简短，保留自己拿不准的地方。',aiPhotos:[{id:'one',src:'/assets/samples/field-1.png',label:'照片 1（正中）',selected:true}],aiPhotoCount:1,aiTargetLabel:'新增文字框',aiSelectedAvailable:false,error:'手机写作服务尚未上线，原稿仍保留。'};
 }else if(kind==='bookmarks'){
  path='field/hub/index';data={...hub,screen:'bookmarks',items:[{id:'saved',title:'这两只鸟，你会看哪里来区分？',body:'在湖边观察了一会儿，想听听大家的辨识依据。这里保留对不确定鸟种的描述。',image:'/assets/samples/field-1.png',channel:'post',source:'羽迹社区',date:'2026-11-27'}]};
 }else if(kind==='singleSighting'){
  path='components/field-map/index';const panes=model.mapPanes(width,height-88-80);data={...defaults(path,true),...panes,...model.recordPane(panes.sheetHeight,panes.sheetHeaderHeight,1,false),nativeActive:true,headerHeight:88,listOpen:true,listTotal:1,recordOrder:'recent',selected:[{id:'duck',speciesName:'丑鸭',speciesId:'duck',placeName:'北京',date:'2017-02-20',source:'iNaturalist · GBIF'}]};tab=true;
 }else if(kind==='cameraCapture'){
  path='pages/identify/index';data={...camera,height:height-88-80,demo:true,cameraReady:true,mode:'wait',cameraShort:height<700,captureCard:{id:'photo',path:'/assets/samples/field-1.png',title:'照片已保存',status:'正在识别这张原图 · 可继续拍摄'}};tab=true;
 }else if(kind==='import'){
  path='pages/identify/index';data={...camera,view:'import',importKind:'gallery',assets:[]};
 }else{
  path='field/trip/index';const brief={headline:'先沿湖边步道观察，再走入林缘。',reasons:['距出发地较近，水域和林缘可以连起来走。','留出时间安静观察，避免反复换点。'],watchFor:['留意水面和低枝的活动。','尚未确认鸟种时保留疑问。'],preparation:['带望远镜、保暖外套和水。'],uncertainty:['历史鸟讯只供参考，当天能否遇见仍需现场观察。']};data={...trip,point:{latitude:40,longitude:116.3},place:'当前地图中心',date:'2026-11-27',windowLabel:'2026-11-27 09:00 至 11:00',sections:advice.adviceSections(brief),answer:{brief,model:'qwen-plus',referenceMap:[],visits:[],sources:[],communityCards:[],guideCards:[],stops:[],parks:[],stages:[{time:'09:00',action:'沿湖边步道观察水面'},{time:'10:00',action:'进入林缘，留意树枝间的活动'}],weatherCards:[{id:'weather',area:'所选区域',available:true,hours:[{hour:'09:00',temp:3,wind:2,rain:0},{hour:'10:00',temp:5,wind:3,rain:0}]}]}};
 }
 const css=['app.wxss','components/app-header/index.wxss','custom-tab-bar/index.wxss',path+'.wxss','styles/writing-feedback.wxss'].map(read).join('\n').replace(/(^|[}\n])\s*page\s*\{/g,'$1body{').replace(/:host/g,'.component-host').replace(/([^{}]+)\{/g,(_m,sel)=>sel.replace(/(?<![.\w-])(view|text|image|scroll-view|map|picker|canvas)(?=[\s:>+~,.#\[]|$)/g,tag=>({view:'div',text:'span',image:'img','scroll-view':'wx-scroll-view',map:'wx-map',picker:'wx-picker',canvas:'wx-canvas'})[tag])+'{').replace(/(-?[0-9.]+)rpx/g,(_m,n)=>Number(n)*width/750+'px');
 const header=path.startsWith('pages/')?'':children(template('components/app-header/index').children,{headerHeight:88,status:24,right:100,title:kind==='bookmarks'?'我的收藏':kind==='trip'?'观鸟出行顾问':'羽迹',back:!tab},context);
 const body=header+children(template(path).children,data,context)+(tab?children(template('custom-tab-bar/index').children,{tabs,selected:kind==='cameraCapture'?2:0,hidden:false},context):'');
 const measure=`<script>const size=${nativeSheet.sheetBodyHeight.toString()};function fit(){for(const b of document.querySelectorAll('.sheet-measure')){const id=b.getAttribute('data-sheet-id');const h=[...document.querySelectorAll('.sheet-header-fixed')].find(h=>h.getAttribute('data-sheet-id')===id);b.parentElement.style.height=size(b.scrollHeight,h?.getBoundingClientRect().height||72,innerHeight,24)+'px';}document.body.dataset.bounds=JSON.stringify([...document.querySelectorAll('.sheet-frame,.sheet-scroll,.saved-card,.capture-row,.live-bottom,.record-sheet')].map(e=>({class:e.className,x:e.getBoundingClientRect().x,y:e.getBoundingClientRect().y,w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height})));}window.onload=fit;document.fonts.ready.then(fit);</script>`;
 const html='<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+reset+'\n'+css+'\nhtml,body{width:'+width+'px;height:'+height+'px}.sheet-scroll{overflow-y:auto}.projection-banner{display:none}</style><body>'+body+measure+'</body></html>';
 writeFileSync(resolve(out,kind+'-'+width+'x'+height+'.html'),html.replaceAll('"/assets/','"file://'+resolve(root,'miniprogram/assets')+'/').replaceAll('url("/assets/','url("file://'+resolve(root,'miniprogram/assets')+'/'));
}
console.log(out);
