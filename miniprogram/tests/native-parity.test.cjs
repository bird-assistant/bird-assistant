const {test}=require('node:test');
const assert=require('node:assert/strict');
const model=require('../.test-build/services/map-model.js');
const journal=require('../.test-build/services/journal-model.js');
const canvas=require('../.test-build/services/canvas.js');
const motion=require('../.test-build/services/map-motion.js');
function page(name,width=390,height=844,extra={}){
  let definition;const bar={},scroll=[];
  global.wx={canIUse:()=>false,createCameraContext:()=>({}),getWindowInfo:()=>({windowWidth:width,windowHeight:height,screenHeight:height,statusBarHeight:24,safeArea:{bottom:height-34}}),getMenuButtonBoundingClientRect:()=>({top:30,bottom:62,left:width-100}),getStorageSync:()=>'',nextTick:fn=>fn(),pageScrollTo:o=>scroll.push(o),...extra};
  global.Page=x=>definition=x;const path=require.resolve('../.test-build/pages/'+name+'/index.js');delete require.cache[path];require(path);
  const p={data:structuredClone(definition.data),setData(v){Object.assign(this.data,v);},getTabBar:()=>({setData:v=>Object.assign(bar,v)})};
  for(const[k,v]of Object.entries(definition))if(k!=='data')p[k]=typeof v==='function'?v.bind(p):structuredClone(v);
  p.onLoad?.();return {p,bar,scroll};
}
const tap=id=>({currentTarget:{dataset:{id}}});
test('font sizing uses integers for live adjustment, typed input, legacy values and related title size',()=>{
  const {p}=page('journal');p.openDocument(journal.makeJournal([], 'Font'),false);const e=p.data.doc.elements.find(e=>e.title);p.select(tap(e.id));
  const change=value=>({currentTarget:{dataset:{key:'fontSize'}},detail:{value}});
  p.adjust(change(25.78));assert.equal(p.data.selected.fontSize,26);assert.ok(Number.isInteger(p.data.selected.titleSize));
  assert.equal(p.numberInput(change('27.5')),'26');assert.equal(p.data.selected.fontSize,26);p.numberInput(change('31'));p.numberCommit(change('31'));assert.equal(p.data.selected.fontSize,31);assert.ok(Number.isInteger(p.data.selected.titleSize));
  e.fontSize=23.68;e.titleSize=47.36;journal.fit(p.data.doc);assert.equal(e.fontSize,24);assert.equal(e.titleSize,47);
});
test('all 1–6 photo compositions fit every ratio and style without image or caption collisions',()=>{
  const overlaps=(a,b)=>a.x<b.x+b.w-.02&&b.x<a.x+a.w-.02&&a.y<b.y+b.h-.02&&b.y<a.y+a.h-.02;
  for(const ratio of ['3:4','1:1','4:3'])for(const style of ['nature','magazine','minimal'])for(const variant of [1,2])for(let n=1;n<=6;n++){
    const assets=Array.from({length:n},(_,i)=>({id:'a'+i,src:'photo',selected:true,label:'图注'+i,notes:'完整观察备注'.repeat(20),sample:true}));
    const d=journal.makeJournal(assets,'沿着鸟鸣，慢慢走',ratio,style,variant,true),photos=d.elements.filter(e=>e.type==='photo');
    const boxes=photos.map(e=>{const c=Math.cos(e.rotation*Math.PI/180),s=Math.sin(e.rotation*Math.PI/180),w=Math.abs(e.w*c)+Math.abs(e.h*s),h=Math.abs(e.h*c)+Math.abs(e.w*s);return {x:e.x+(e.w-w)/2,y:e.y+(e.h-h)/2,w,h};});
    for(const b of boxes)assert.ok(b.x>=0&&b.y>=0&&b.x+b.w<=d.width&&b.y+b.h<=d.height,ratio+style+n);
    for(let i=0;i<boxes.length;i++)for(let k=i+1;k<boxes.length;k++)assert.equal(overlaps(boxes[i],boxes[k]),false,ratio+style+n+' image collision');
    for(const e of d.elements.filter(e=>e.photoId)){assert.ok(e.y+e.h<=d.height);assert.match(e.text,/完整观察备注/);assert.ok(journal.textLayout(e,d).rows.length<=2);for(const b of boxes)assert.equal(overlaps(e,b),false,ratio+style+n+' caption collision');}
  }
});
test('changing page ratio reflows linked photos and captions while preserving content, crop and undo',()=>{
  let option=1;const {p}=page('journal',390,844,{showActionSheet:o=>o.success({tapIndex:option})});p.sample();p.generate();const photo=p.data.doc.elements.find(e=>e.type==='photo');photo.zoom=2.25;photo.cropX=73.5;const before=structuredClone(p.data.doc);
  for(const choice of [1,2]){option=choice;p.layoutRatio();const changed=p.data.doc.elements.find(e=>e.id===photo.id);assert.equal(changed.zoom,2.25);assert.equal(changed.cropX,73.5);for(const e of p.data.doc.elements.filter(e=>e.photoId)){const image=p.data.doc.elements.find(a=>a.id===e.photoId);assert.equal(e.x,image.x);assert.equal(e.w,image.w);assert.ok(e.y>=image.y+image.h);assert.ok(e.y+e.h<=p.data.doc.height);}p.undo();assert.deepEqual(p.data.doc,before);}
});
test('background selection is separate from elements and paper-color changes undo without deletion',()=>{
  const {p}=page('journal');p.sample();p.generate();p.select(tap(p.data.doc.elements[1].id));const count=p.data.doc.elements.length,history=p._past.length,color=p.data.doc.background;
  p.background();assert.equal(p.data.selected,null);assert.equal(p.data.selectedName,'背景');assert.equal(p.data.backgroundSelected,true);assert.equal(p._past.length,history);p.remove();assert.equal(p.data.doc.elements.length,count);
  p.backgroundColor({currentTarget:{dataset:{color:'#ffffff'}}});assert.equal(p.data.doc.background,'#ffffff');assert.equal(p._past.length,history+1);p.undo();assert.equal(p.data.doc.background,color);p.select(tap(p.data.doc.elements[0].id));assert.equal(p.data.backgroundSelected,false);
});
test('map dragging recovers across idle flights, cancelled touches, page return and pinch release',t=>{
  let now=1000;t.mock.method(Date,'now',()=>now);const {p}=page('home'),touch=(x,y=250)=>({touches:[{clientX:x,clientY:y}]});
  p.marker(tap('wood-a'));now+=10000;p.stopFlight();p.closeSheet();
  for(let i=0;i<16;i++){p.touchStart(touch(150));const x=p.data.x;p.touchMove(touch(150+(i%2?-20:20)));assert.notEqual(p.data.x,x);if(i%3===0){p.onHide();p.onShow();}else if(i%3===1)p.touchCancel();else p.resetGesture();assert.equal(p._gesture,null);}
  p.touchMove(touch(180));const x=p.data.x;p.touchMove(touch(210));assert.notEqual(p.data.x,x);p.touchCancel();
  p.touchStart({touches:[{clientX:100,clientY:200},{clientX:180,clientY:200}]});p.touchEnd(touch(180,200));const before=p.data.x;p.touchMove(touch(200,200));assert.notEqual(p.data.x,before);p.touchEnd();p.marker(tap('lake-a'));assert.equal(p.data.sheet,true);p.closeSheet();
  p.touchStart(touch(200));p.touchEnd();p.marker(tap('lake-a'));assert.equal(p.data.sheet,true);p.onUnload();
});
test('home touch ownership leaves controls, search and all sheet exits outside the drag surface',()=>{
  const fs=require('node:fs'),source=fs.readFileSync('miniprogram/pages/home/index.wxml','utf8'),nodes=[],stack=[];
  // Parse opening tags with quoted expressions intact, then inspect their ancestors.
  for(const match of source.matchAll(/<\/?[\w-]+(?:"[^"]*"|'[^']*'|[^'">])*>/g)){
    const tag=match[0];if(tag.startsWith('</')){stack.pop();continue;}
    const attrs=Object.fromEntries([...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map(m=>[m[1],m[2]]));
    const node={tag:tag.match(/^<([\w-]+)/)[1],attrs,parents:[...stack]};nodes.push(node);
    if(!tag.endsWith('/>'))stack.push(node);
  }
  assert.equal(stack.length,0);
  const touchKeys=a=>Object.keys(a).filter(k=>/^(bind|catch)(:)?touch/.test(k));
  const surfaces=nodes.filter(n=>touchKeys(n.attrs).length);assert.equal(surfaces.length,1);assert.equal(surfaces[0].attrs.class,'map-gesture');
  const actions=nodes.filter(n=>['button','input','picker','scroll-view','app-header'].includes(n.tag)||n.attrs.catchtap==='closeSheet');assert.ok(actions.length>=17);
  for(const action of actions)for(const ancestor of [action,...action.parents])assert.equal(touchKeys(ancestor.attrs).length,0,action.tag+' must not be trapped by '+ancestor.attrs.class);
  const exits=nodes.filter(n=>n.attrs.bindtap==='closeSheet'||n.attrs.catchtap==='closeSheet');assert.equal(exits.length,2);
  assert.ok(nodes.some(n=>n.tag==='app-header'&&n.attrs.bindback==='back'));
  assert.ok(nodes.some(n=>n.tag==='button'&&n.attrs.bindtap==='searchAction'));
  const css=fs.readFileSync('miniprogram/pages/home/index.wxss','utf8'),surfaceRules=[...css.matchAll(/\.map-gesture\s*\{([^}]*)}/g)].map(m=>m[1]).join(';');
  assert.match(surfaceRules,/pointer-events\s*:\s*auto/);assert.doesNotMatch(surfaceRules,/pointer-events\s*:\s*none/);
  assert.equal(JSON.parse(fs.readFileSync('miniprogram/pages/home/index.json')).disableScroll,undefined);
});
test('search cancellation, record back, sheet exits and the next map action remain usable in sequence',()=>{
  let keyboard=0;const {p,bar}=page('home',390,844,{hideKeyboard:()=>keyboard++,showToast:()=>{},showModal:o=>o.success({confirm:false})});
  const touch=x=>({touches:[{clientX:x,clientY:250}]});
  try{
    p.searchFocus();p.searchAction();assert.equal(p.data.searchOpen,false);assert.equal(keyboard,1);
    p.searchAction();p.touchStart(touch(180));p.touchEnd();assert.equal(p.data.searchOpen,false);
    p.searchFocus();p.back();assert.equal(p.data.searchOpen,false);
    p.searchFocus();p.choosePlace(tap('lake'));assert.equal(p.data.searchOpen,false);assert.equal(p.data.sheet,true);assert.equal(bar.hidden,true);
    p.openRecord(tap(p.data.sheetRecords[0].id));assert.ok(p.data.detail);p.back();assert.equal(p.data.detail,null);assert.equal(p.data.sheet,true);
    p.activity({currentTarget:{dataset:{kind:'saved'}}});p.back();assert.equal(p.data.sheet,false);assert.equal(bar.hidden,false);assert.equal(p.data.mapMoving,false);
    for(let i=0;i<8;i++){
      p.touchStart(touch(100));p.touchMove(touch(120));p.touchEnd();p.marker(tap(i%2?'wood-a':'lake-a'));assert.equal(p.data.sheet,true);
      p.closeSheet();assert.equal(p.data.detail,null);assert.equal(bar.hidden,false);
      const zoom=p.data.zoom;p.zoom({currentTarget:{dataset:{delta:zoom>2?-.2:.2}}});assert.notEqual(p.data.zoom,zoom);
      p.openSummary();assert.equal(p.data.sheet,true);p.closeSheet();p.onHide();p.onShow();
    }
    p.marker(tap('mine-a'));assert.equal(p.data.detail.id,'mine-a');p.closeSheet();p.locate();p.touchStart(touch(140));assert.equal(p.data.mapMoving,false);
  }finally{p.onUnload();}
});
test('searching a place and tapping each public marker recenters it and opens its own record sheet',()=>{
  const {p,bar}=page('home');p.choosePlace(tap('grove'));
  assert.equal(p.data.regionName,'松林休憩点');assert.equal(p.data.sheet,true);assert.equal(bar.hidden,true);
  const screen=point=>({x:p.data.viewportW/2+p.data.x+(point.x/100-.5)*p.data.worldW*p.data.zoom,y:p.data.height/2+p.data.y+(point.y/100-.5)*p.data.worldH*p.data.zoom});
  let pin=screen(model.places.find(p=>p.id==='grove'));assert.equal(pin.x,195);assert.ok(Math.abs(pin.y-motion.placeAnchor(844-68,p.data.sheetHeight))<.02);p.closeSheet();assert.equal(bar.hidden,false);
  for(const id of ['lake-a','wood-a']){p.marker(tap(id));assert.equal(p.data.sheet,true);assert.equal(p.data.sheetRecords[0].id,id);const r=model.mapRecords.find(r=>r.id===id);pin=screen(r);assert.equal(pin.x,195);assert.ok(Math.abs(pin.y-motion.placeAnchor(844-68,p.data.sheetHeight))<.02);p.closeSheet();}
  p.marker(tap('mine-a'));assert.equal(p.data.detail.id,'mine-a');
});
test('extreme map drags cannot reveal an uncovered edge at either zoom limit and different screen sizes',()=>{
  for(const [w,h]of [[320,700],[390,844],[430,932]])for(const zoom of [.4,3])for(const sign of [-1,1]){
    const {p}=page('home',w,h);p.setData({zoom,x:sign*100000,y:sign*100000});p.boundMap();
    const left=w/2+p.data.x-1.5*p.data.worldW*zoom,right=w/2+p.data.x+1.5*p.data.worldW*zoom;
    const top=p.data.height/2+p.data.y-1.5*p.data.worldH*zoom,bottom=p.data.height/2+p.data.y+1.5*p.data.worldH*zoom;
    assert.ok(left<=0&&right>=w&&top<=0&&bottom>=p.data.height);
  }
});
test('journal subpages reclaim navigation space; editor stage and controls fit without page overlap',()=>{
  for(const [w,h]of [[320,700],[390,844],[430,932]]){
    const {p,bar}=page('journal',w,h);p.sample();assert.equal(bar.hidden,true);assert.equal(p.data.focusedPage,true);
    p.openDocument(journal.makeJournal([], 'Test'),false);
    for(const top of [0,80,1000]){p.onEditorScroll({detail:{scrollTop:top}});assert.ok(p.data.controlsHeight>=130);assert.ok(Math.abs(p.data.controlsHeight+p.data.stageHeight+p.data.editorChromeHeight-p.data.editorHeight)<.02);}
    assert.equal(p.data.editorHeight,h-68);p.back();assert.equal(bar.hidden,false);
  }
});
test('opening the composer resets retained feed scroll and returning restores main navigation',()=>{
  const {p,bar,scroll}=page('community');p.compose();assert.equal(bar.hidden,true);assert.deepEqual(scroll.at(-1),{scrollTop:0,duration:0});p.back();assert.equal(bar.hidden,false);assert.equal(p.data.view,'feed');
});
test('Canvas packaged image paths stay rooted; a decoded image failure rejects instead of hanging',async t=>{
  t.mock.method(console,'warn',()=>{});assert.equal(canvas.canvasImagePath('assets/samples/field-0.png'),'/assets/samples/field-0.png');assert.equal(canvas.canvasImagePath('./assets/a.png'),'/assets/a.png');assert.equal(canvas.canvasImagePath('wxfile://saved/a.png'),'wxfile://saved/a.png');
  await assert.rejects(canvas.loadCanvasImage({createImage(){return {set src(v){this.onerror(new Error('missing'));}};}},'/assets/missing.png'),/素材暂时无法读取/);
  await assert.rejects(canvas.deadline(new Promise(()=>{}),'timed out',5),/timed out/);
});
test('failed journal export always releases loading, keeps the editable document and permits successful retry',async t=>{
  t.mock.method(console,'warn',()=>{});let broken=true,exported=0,previewed=0,source='';
  const context=new Proxy({}, {get:()=>()=>{},set:()=>true});const node={getContext:()=>context,createImage:()=>({width:600,height:400,set src(v){source=v;queueMicrotask(()=>broken?this.onerror(new Error('bad')):this.onload());}})};
  const {p}=page('journal',390,844,{createSelectorQuery:()=>{const q={in:()=>q,select:()=>q,fields:()=>q,exec:fn=>fn([{node}])};return q;},canvasToTempFilePath:o=>{assert.equal(o.canvas,node);exported++;o.success({tempFilePath:'wxfile://export.png'});},previewImage:()=>previewed++});
  p.openDocument(journal.makeJournal([{id:'a',src:'assets/samples/field-0.png',selected:true,label:'A',notes:'',sample:true}],'Keep'),true);p.data.doc.paper='plain';const before=structuredClone(p.data.doc);
  await p.export();assert.equal(p.data.exporting,false);assert.equal(exported,0);assert.ok(p.data.error);assert.deepEqual(p.data.doc,before);assert.equal(source,'/assets/samples/field-0.png');
  broken=false;await p.export();assert.equal(p.data.exporting,false);assert.equal(exported,1);assert.equal(previewed,1);assert.equal(p.data.exportPath,'wxfile://export.png');assert.deepEqual(p.data.doc,before);
});
test('journal date filtering preserves selected material, reordering survives setup, and clear is explicit',()=>{
  const {p}=page('journal');p.sample();p.date({currentTarget:{dataset:{key:'from'}},detail:{value:'2026-10-22'}});assert.equal(p.data.assets.length,0);assert.equal(p.data.chosen,4);p.clearDates();assert.equal(p.data.assets.length,4);
  const first=p.data.picked[0].id;p.reorder({currentTarget:{dataset:{id:first,delta:1}}});assert.equal(p.data.picked[1].id,first);p.next();p.notes();p.generate();assert.equal(p.data.doc.elements.find(e=>e.type==='photo').src,'/assets/samples/field-1.png');assert.ok(p.data.doc.elements.some(e=>e.type==='text'&&e.text.includes('示例插画')));p.clearSelection();assert.equal(p.data.chosen,0);
});
test('composition changes keep captions with photos and undo restores both; resize changes both photo dimensions',()=>{
  const {p}=page('journal',390,844,{showModal:o=>o.success({confirm:true})});p.sample();p.generate();const photo=p.data.doc.elements.find(e=>e.type==='photo'),caption=p.data.doc.elements.find(e=>e.photoId===photo.id),oldX=photo.x;
  p.rearrange();assert.equal(photo.x,caption.x);assert.notEqual(photo.x,oldX);p.undo();assert.equal(p.data.doc.elements.find(e=>e.id===photo.id).x,oldX);
  const before=structuredClone(p.data.doc.elements.find(e=>e.id===photo.id));p.dragStart({currentTarget:{dataset:{id:photo.id,resize:'yes'}},touches:[{clientX:50,clientY:50}]});p.dragMove({touches:[{clientX:70,clientY:80}]});p.dragEnd();const resized=p.data.doc.elements.find(e=>e.id===photo.id);assert.ok(resized.w>before.w&&resized.h>before.h);p.undo();assert.deepEqual(p.data.doc.elements.find(e=>e.id===photo.id),before);
});
test('AI writing brief includes only explicitly checked photos and sends no network request',()=>{
  const {p}=page('journal');p.sample();p.generate();p.openAi();for(const image of p.data.aiPhotos.slice(1))p.aiPhoto(tap(image.id));p.prepareAi();assert.match(p.data.bundleSummary,/1 张关联图片/);assert.match(p.data.error,/补充写作要求/);
});
test('a failed autosave retains the current journal instead of replacing it',async()=>{
  const {p}=page('journal',390,844,{setStorageSync:()=>{throw Error('quota');}});p.sample();p.generate();const id=p.data.doc.id;p.setData({view:'home'});p.newJournal();await new Promise(resolve=>setImmediate(resolve));assert.equal(p.data.doc.id,id);assert.equal(p.data.view,'home');assert.match(p.data.error,/自动保存未完成/);p.onUnload();
});
test('canvas and layer selection identify the same element without changing the journal or undo history',()=>{
  const {p}=page('journal');p.sample();p.generate();const photo=p.data.doc.elements.find(e=>e.type==='photo');
  const before=structuredClone(p.data.doc);p.select(tap(photo.id));assert.equal(p.data.selectedName,journal.elementLabel(photo,p.data.doc));
  p.openLayers();assert.equal(p.data.layersOpen,true);p.back();assert.equal(p.data.layersOpen,false);assert.equal(p.data.view,'editor');
  const text=p.data.doc.elements.find(e=>e.type==='text');p.openLayers();p.select(tap(text.id));assert.equal(p.data.layersOpen,false);assert.equal(p.data.selected.id,text.id);assert.equal(p.data.selectedName,journal.elementLabel(text,p.data.doc));assert.deepEqual(p.data.doc,before);assert.equal(p._past.length,0);
  p.remove();assert.equal(p.data.selectedName,'');assert.ok(!p.data.labels.some(e=>e.id===text.id));p.undo();assert.equal(p.data.selectedName,journal.elementLabel(p.data.selected,p.data.doc));assert.deepEqual(p.data.doc,before);
});
test('autosaved text survives navigation and a fresh page resumes the last opened journal',async()=>{
  const storage=new Map(),extra={getStorageSync:k=>structuredClone(storage.get(k)||''),setStorageSync:(k,v)=>storage.set(k,structuredClone(v)),showToast:()=>{}};
  const {p}=page('journal',390,844,extra);p.sample();p.generate();await p.save();const id=p.data.doc.id,text=p.data.doc.elements.find(e=>e.type==='text');p.select(tap(text.id));
  p.text({currentTarget:{dataset:{key:'text'}},detail:{value:'Automatically durable observation'}});p.back();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(p.data.view,'home');assert.equal(p.data.dirty,false);assert.ok(p._past.length>0);assert.equal(storage.get(journal.JOURNAL_KEY).length,1);
  const fresh=page('journal',390,844,extra).p;fresh.onShow();assert.equal(fresh.data.doc.id,id);fresh.resume();assert.equal(fresh.data.doc.elements.find(e=>e.id===text.id).text,'Automatically durable observation');assert.equal(fresh._past.length,0);assert.equal(fresh.data.dirty,false);
  p.onUnload();fresh.onUnload();
});
test('background touch dismisses search and keyboard while marker targets are outside the gesture catcher',()=>{
  let hides=0;const {p}=page('home',390,844,{hideKeyboard:()=>hides++});p.searchFocus();assert.equal(p.data.searchOpen,true);p.touchStart({touches:[{clientX:180,clientY:300}]});p.touchEnd();assert.equal(p.data.searchOpen,false);assert.equal(p.data.searchFocused,false);assert.equal(hides,1);
  p.searchFocus();p.marker(tap('wood-a'));assert.equal(p.data.searchOpen,false);assert.equal(p.data.sheet,true);assert.equal(p.data.sheetRecords[0].id,'wood-a');const pin=p.data.screenMarkers.find(m=>m.id==='wood-a');assert.equal(pin.screenX,195);assert.ok(Math.abs(pin.screenY-motion.placeAnchor(844-68,p.data.sheetHeight))<.02);
  const markup=require('node:fs').readFileSync(require('node:path').join(__dirname,'../miniprogram/pages/home/index.wxml'),'utf8'),stack=[];let found=false;
  for(const match of markup.matchAll(/<(\/?)([\w-]+)\b(?:[^>"']|"[^"]*"|'[^']*')*>/g)){const [tag,closing,name]=match;if(closing){stack.pop();continue;}if(/class="map-pin\b/.test(tag)){found=true;assert.ok(!stack.some(t=>/class="map-gesture"/.test(t)),'marker must receive its own taps');}if(!tag.endsWith('/>'))stack.push(tag);}
  assert.equal(found,true);
});
test('slider changing previews rounded dimensions immediately and a complete drag is one undo transaction',()=>{
  const {p}=page('journal');p.sample();p.generate();const photo=p.data.doc.elements.find(e=>e.type==='photo'),original=photo.w;p.select(tap(photo.id));const past=p._past.length;
  const event=value=>({currentTarget:{dataset:{key:'w',control:'slider'}},detail:{value}});
  for(const value of [180.12345,250.99999,333.456]){p.previewAdjust(event(value));assert.equal(p.data.selected.w,Number(value.toFixed(2)));assert.equal(p._past.length,past);}
  p.adjust(event(333.456));assert.equal(p._past.length,past+1);p.undo();assert.equal(p.data.selected.w,original);p.redo();assert.equal(p.data.selected.w,333.46);
});
test('pixel drafts accept integers, rotations retain precision, and reset is undoable for every element type',()=>{
  const {p}=page('journal');p.sample();p.generate();const photo=p.data.doc.elements.find(e=>e.type==='photo');p.select(tap(photo.id));
  const input=(key,value)=>({currentTarget:{dataset:{key}},detail:{value}});
  assert.equal(p.numberInput(input('w','104')),'104');assert.equal(p.data.selected.w,104);assert.equal(p.numberInput(input('w','104.93')),'104');p.numberCommit(input('w','104'));assert.equal(p.data.pixels.w,104);p.lockRatio({currentTarget:{dataset:{id:'free'}}});
  p.numberInput(input('w','9999'));p.numberCommit(input('w','9999'));assert.equal(p.data.selected.w,p.data.maxWidth);
  for(const type of ['photo','text','leaf']){const e=p.data.doc.elements.find(e=>e.type===type);p.select(tap(e.id));p.numberInput(input('rotation','-22.35'));p.numberCommit(input('rotation','-22.35'));assert.equal(p.data.selected.rotation,-22.35);p.resetRotation();assert.equal(p.data.selected.rotation,0);p.undo();assert.equal(p.data.selected.rotation,-22.35);}
});
test('dragging and resizing keep editable geometry within two decimals and controls scrolling never reallocates the stage',()=>{
  const {p}=page('journal');p.sample();p.generate();const photo=p.data.doc.elements.find(e=>e.type==='photo');p.select(tap(photo.id));const panes=[p.data.stageHeight,p.data.controlsHeight];
  p.dragStart({currentTarget:{dataset:{id:photo.id}},touches:[{clientX:40,clientY:30}]});p.dragMove({touches:[{clientX:45.732144,clientY:34.938753}]});p.dragEnd();
  for(const e of p.data.doc.elements)for(const key of ['x','y','w','h','rotation','fontSize','zoom','cropX','cropY'])assert.ok(Math.abs(e[key]*100-Math.round(e[key]*100))<1e-7,key);
  p.onEditorScroll({detail:{scrollTop:300}});assert.deepEqual([p.data.stageHeight,p.data.controlsHeight],panes);
});
test('crop preview is temporary, apply records one change, cancel restores the original and undo restores crop',()=>{
  const {p}=page('journal');p.sample();p.generate();const photo=p.data.doc.elements.find(e=>e.type==='photo');p.select(tap(photo.id));const before=structuredClone(p.data.doc),past=p._past.length;
  const crop=(key,value)=>({currentTarget:{dataset:{key}},detail:{value}});
  p.openCrop();p.previewCrop(crop('zoom',2));p.previewCrop(crop('cropX',0));p.previewCrop(crop('cropY',100));p.flushPendingPreview();assert.deepEqual(p.data.doc,before);assert.ok(p.data.cropPreview.canPanX&&p.data.cropPreview.canPanY);assert.equal(p.data.renderElements.find(e=>e.id===photo.id).imageX,0);p.cancelCrop();assert.deepEqual(p.data.doc,before);
  p.openCrop();p.previewCrop(crop('zoom',2.34789));p.previewCrop(crop('cropX',81.229));p.applyCrop();assert.equal(p.data.selected.zoom,2.35);assert.equal(p.data.selected.cropX,81.23);assert.equal(p._past.length,past+1);p.undo();assert.deepEqual(p.data.doc,before);
});
test('shared crop geometry moves the sampled source, stays in bounds and scales the preview without changing the crop',()=>{
  const {photoCrop}=require('../.test-build/services/crop.js');
  for(const [iw,ih]of [[600,450],[400,1200],[100,100]])for(const zoom of [1,1.75,3]){
    const photo={w:432,h:348,iw,ih,zoom,cropX:0,cropY:0},left=photoCrop(photo),right=photoCrop({...photo,cropX:100,cropY:100}),small=photoCrop({...photo,cropX:100,cropY:100},.3);
    assert.ok(left.sourceX>=0&&left.sourceY>=0);assert.ok(right.sourceX+right.sourceW<=iw+1e-8&&right.sourceY+right.sourceH<=ih+1e-8);assert.equal(right.sourceX,small.sourceX);assert.ok(Math.abs(right.imageX*.3-small.imageX)<1e-8);if(zoom>1)assert.ok(right.sourceX>left.sourceX&&right.sourceY>left.sourceY);
  }
});
test('confirmed photo crop exports the same sampled rectangle as the editor preview',async()=>{
  const calls=[],context=new Proxy({}, {get:(_,key)=>key==='drawImage'?(...args)=>calls.push(args):()=>{},set:()=>true});
  const node={getContext:()=>context,createImage:()=>({width:600,height:400,set src(v){queueMicrotask(()=>this.onload());}})};
  const {p}=page('journal',390,844,{createSelectorQuery:()=>{const q={in:()=>q,select:()=>q,fields:()=>q,exec:fn=>fn([{node}])};return q;},canvasToTempFilePath:o=>o.success({tempFilePath:'wxfile://crop.png'}),previewImage:()=>{}});
  p.openDocument(journal.makeJournal([{id:'crop',src:'/assets/samples/field-0.png',selected:true,label:'Crop',notes:'',sample:true}],'Crop'),true);
  const photo=p.data.doc.elements.find(e=>e.type==='photo');Object.assign(photo,{iw:600,ih:400});p.select(tap(photo.id));p.openCrop();
  for(const [key,value]of Object.entries({zoom:2.25,cropX:81.23,cropY:12.34}))p.previewCrop({currentTarget:{dataset:{key}},detail:{value}});p.applyCrop();
  p.data.doc.paper='plain';const preview=p.data.renderElements.find(e=>e.id===photo.id);await p.export();const pixels=calls.find(args=>args.length===9);assert.ok(pixels);assert.deepEqual(pixels.slice(1,5),[preview.sourceX,preview.sourceY,preview.sourceW,preview.sourceH]);assert.equal(p.data.exportPath,'wxfile://crop.png');assert.equal(p.data.error,'');
});
test('arbitrary avatar rotations remain covered and reset returns the preview to zero',()=>{
  const {avatarCrop}=require('../.test-build/services/crop.js');
  for(const angle of [-180,-22.35,0,47.12,90]){const b=avatarCrop(600,400,1.23,angle,10000,-10000),c=Math.cos(angle*Math.PI/180),s=Math.sin(angle*Math.PI/180);for(const x of [-110,110])for(const y of [-110,110]){const dx=x-b.cropX,dy=y-b.cropY;assert.ok(Math.abs(c*dx+s*dy)<=b.cropDisplayW/2+1e-7);assert.ok(Math.abs(-s*dx+c*dy)<=b.cropDisplayH/2+1e-7);}}
  const {p}=page('profile');p.setData({cropWidth:600,cropHeight:400,cropRotation:47.12,cropZoom:1.23});p.fitCrop();p.resetCropRotation();assert.equal(p.data.cropRotation,0);p.cropZoom({detail:{value:2.34789}});assert.equal(p.data.cropZoom,2.35);
});
test('camera zoom previews tenths immediately, coalesces requests and respects the actual native result',()=>{
  const requests=[];const {p}=page('identify',390,844,{createCameraContext:()=>({setZoom:o=>requests.push(o)})});p.cameraReady({detail:{maxZoom:5}});p.setZoom(2.3456);assert.equal(p.data.zoom,2.3);assert.equal(p.data.zoomText,'2.3');p.setZoom(3.4567);assert.equal(p.data.zoom,3.5);assert.equal(requests.length,1);
  requests[0].success({zoom:2.3});assert.equal(p.data.zoom,3.5);assert.equal(requests.length,2);assert.equal(requests[1].zoom,3.5);requests[1].success({zoom:3.4});assert.equal(p.data.zoom,3.4);assert.equal(p.data.zoomText,'3.4');
});
test('every exposed slider has a live changing binding and numeric draft parsing enforces the same precision',()=>{
  const {numberDraft,parseNumberDraft}=require('../.test-build/services/numbers.js'),fs=require('node:fs'),path=require('node:path');
  for(const name of ['journal','profile','identify']){const markup=fs.readFileSync(path.join(__dirname,'../miniprogram/pages',name,'index.wxml'),'utf8');for(const [slider]of markup.matchAll(/<slider\b(?:[^>"']|"[^"]*"|'[^']*')*>/g))assert.match(slider,/bindchanging="[^"]+"/);}
  assert.equal(numberDraft('1.234','1.23'),'1.23');assert.equal(parseNumberDraft('-22.35'),-22.35);assert.equal(parseNumberDraft('-'),null);assert.equal(parseNumberDraft('Infinity'),null);
});
test('map flight takes 500ms with a decreasing speed and places points above the sheet',()=>{
  const from={x:0,y:0,zoom:1},to={x:400,y:-300,zoom:2};
  assert.deepEqual(motion.flightFrame(from,to,0),from);assert.deepEqual(motion.flightFrame(from,to,500),to);
  const steps=[0,125,250,375,500].map(t=>motion.flightFrame(from,to,t).x),distances=steps.slice(1).map((x,i)=>x-steps[i]);
  assert.ok(distances.every((x,i)=>x>0&&(!i||x<distances[i-1])));
  for(const [w,h]of [[320,700],[390,844],[430,932]]){const {p}=page('home',w,h);p.marker(tap('lake-a'));const pin=p.data.screenMarkers.find(m=>m.id==='lake-a'),anchor=motion.placeAnchor(h-68,p.data.sheetHeight);assert.ok(Math.abs(pin.screenY-anchor)<.02);assert.ok(pin.screenY>120&&pin.screenY<h-68-p.data.sheetHeight);p.onUnload();}
});
test('interrupting a map flight freezes its visible position and cancels deferred updates',t=>{
  let now=1000;t.mock.method(Date,'now',()=>now);const {p}=page('home');p.marker(tap('wood-a'));const flight=structuredClone(p._flight);assert.equal(p.data.mapMoving,true);
  now+=250;p.touchStart({touches:[{clientX:80,clientY:200}]});assert.equal(p.data.mapMoving,false);assert.deepEqual({x:p.data.x,y:p.data.y,zoom:p.data.zoom},motion.flightFrame(flight.from,flight.to,250));assert.equal(p._flightTimer,null);assert.equal(p._gesture.offsetX,p.data.x);p.touchCancel();
  const queued=[],other=page('home',390,844,{nextTick:fn=>queued.push(fn)}).p;other.marker(tap('lake-a'));const initial=other.data.x;now+=80;other.onHide();const stopped=other.data.x;assert.equal(stopped,initial);queued.forEach(fn=>fn());assert.equal(other._flight,null);assert.equal(other._flightTimer,null);assert.equal(other.data.x,stopped);assert.equal(other.data.mapMoving,false);
});
test('avatar cancellation preserves the draft, selection succeeds, and late callbacks are ignored',()=>{
  const {p}=page('profile');p.edit();p.changeName({detail:{value:'New name'}});const before=structuredClone(p.data);p.avatarError({detail:{errMsg:'chooseAvatar:fail cancel'}});assert.deepEqual(p.data,before);
  p.chooseAvatar({detail:{}});assert.deepEqual(p.data,before);p.chooseAvatar({detail:{avatarUrl:'wxfile://new-avatar.png'}});assert.equal(p.data.draftAvatar,'wxfile://new-avatar.png');assert.equal(p.data.avatarPersisted,false);assert.equal(p.data.draftName,'New name');
  p.avatarError({detail:{errMsg:'chooseAvatar:fail unavailable'}});assert.match(p.data.error,/可重试/);assert.equal(p.data.draftAvatar,'wxfile://new-avatar.png');p.cancel();p.chooseAvatar({detail:{avatarUrl:'wxfile://late.png'}});assert.notEqual(p.data.draftAvatar,'wxfile://late.png');
});
test('runtime syntax guard catches both forms that can introduce the missing DevTools SWC helper',async()=>{
  const {assertRuntimeSyntax}=await import('../scripts/runtime-syntax.mjs');
  for(const source of ['const [low,high]=bounds[key];','[a,b]=[b,a];','function f([x,y]) {}'])assert.throws(()=>assertRuntimeSyntax(source),/array destructuring/);
  assert.doesNotThrow(()=>assertRuntimeSyntax('const range=bounds[key],value=clamp(raw,range[0],range[1]); const list=[a,b];'));
});
test('camera capabilities determine shortcuts and a finite one-decimal range, without model names',()=>{
  const z=require('../.test-build/services/camera-zoom.js');
  for(const invalid of [undefined,'bad',NaN,Infinity,-4,0,1e308])assert.equal(z.cameraZoomMax(invalid),1);
  assert.equal(z.cameraZoomMax('4.99'),4.9);assert.equal(z.cameraZoom(4.99,4.99),4.9);assert.equal(z.cameraZoom(.5,100),1);assert.equal(z.cameraZoom(1000,100),100);
  assert.deepEqual(z.zoomShortcuts(1).map(s=>s.value),[1]);assert.deepEqual(z.zoomShortcuts(1.89).map(s=>s.value),[1,1.8]);assert.deepEqual(z.zoomShortcuts(2.9).map(s=>s.value),[1,2]);assert.deepEqual(z.zoomShortcuts(100).map(s=>s.value),[1,2,3,5,10]);
  for(const max of [1,1.8,3,5,10,100])for(const value of [1,1.3,2,5,10,100]){const zoom=z.cameraZoom(value,max),ticks=z.zoomTicks(zoom,max,366);assert.ok(ticks.length<60);assert.ok(ticks.every(t=>Number.isFinite(t.offset)&&Math.abs(t.offset)<=195));assert.equal(new Set(ticks.map(t=>t.id)).size,ticks.length);}
  assert.equal(z.zoomFromDrag(1,-z.ZOOM_OCTAVE_PX,100),2);assert.equal(z.zoomFromDrag(2,z.ZOOM_OCTAVE_PX,100),1);assert.equal(z.zoomFromDrag(1,-100000,100),100);
});
test('camera ruler drags and fine buttons preview in tenths; its readout has no text input',()=>{
  const {p}=page('identify');p.demo();p.zoomStart({touches:[{clientX:200}]});p.zoomMove({touches:[{clientX:56}]});assert.equal(p.data.zoom,2);assert.equal(p.data.zoomText,'2.0');p.zoomEnd();p.zoomNudge({currentTarget:{dataset:{delta:.1}}});assert.equal(p.data.zoom,2.1);assert.equal(p.data.zoomText,'2.1');
  const fs=require('node:fs'),path=require('node:path'),markup=fs.readFileSync(path.join(__dirname,'../miniprogram/pages/identify/index.wxml'),'utf8'),control=markup.slice(markup.indexOf('class="zoom-control'),markup.indexOf('class="clue-panel'));
  assert.doesNotMatch(control,/<input\b/);assert.match(control,/catchtouchmove="zoomMove"/);assert.match(control,/class="zoom-centre"/);
});
test('failed camera zoom rolls back to the last confirmed value and an old session cannot change a new camera',()=>{
  const requests=[];const {p}=page('identify',390,844,{createCameraContext:()=>({setZoom:o=>requests.push(o)})});p.cameraReady({detail:{maxZoom:5}});p.setZoom(2);p.setZoom(3);requests[0].fail();assert.equal(p.data.zoom,3);assert.equal(requests.length,2);requests[1].fail();assert.equal(p.data.zoom,1);assert.match(p.data.error,/恢复上次/);
  p.setZoom(4);const old=requests[2];p.cameraReady({detail:{maxZoom:2}});assert.equal(p.data.zoom,2);old.success({zoom:4});assert.equal(p.data.zoom,2);assert.equal(p._zoomInFlight,true);requests[3].success({zoom:1.9});assert.equal(p.data.zoom,1.9);
  p.setZoom(2);const leaving=requests[4];p.onHide();leaving.success({zoom:2});assert.equal(p.data.zoom,2);assert.equal(p.data.zoomEnabled,false);assert.equal(p._zoomInFlight,false);assert.equal(p._zoomPending,null);
});
test('forum writing preparation keeps the draft unchanged and associates only an explicitly selected photo',()=>{
  const {p}=page('community',390,844,{request:()=>{throw new Error('Must not send data before a backend is configured');}});p.compose();p.setData({title:'Unknown bird',body:'I saw it by the water.',image:'/assets/samples/field-0.png'});p.openWriting();p.writingInstructions({detail:{value:'Keep the question; do not invent a species.'}});p.prepareWriting();assert.equal(p._writingBrief.images.length,0);assert.equal(p.data.title,'Unknown bird');assert.equal(p.data.body,'I saw it by the water.');
  p.writingImage();p.prepareWriting();assert.equal(p._writingBrief.images.length,1);assert.match(p.data.writingSummary,/1 张照片/);p.back();assert.equal(p.data.view,'compose');assert.equal(p.data.writingOpen,false);assert.ok(p.data.writingInstructions);p.change({currentTarget:{dataset:{key:'body'}},detail:{value:'Updated observation'}});assert.equal(p._writingBrief,null);assert.equal(p.data.writingSummary,'');
});
test('forum writing validation rejects empty or impossible polish requests and draft settings survive saving',async()=>{
  const brief=require('../.test-build/services/post-writing.js'),base={title:'',body:'',instructions:'',purpose:1,image:'',includeImage:false};assert.throws(()=>brief.postWritingBrief(base),/先写一点/);assert.throws(()=>brief.postWritingBrief({...base,instructions:'polish',purpose:0}),/已有标题或正文/);
  let saved;const {p}=page('community',390,844,{setStorageSync:(key,value)=>{if(key==='bird-assistant.post-draft.v1')saved=value;},showToast:()=>{}});p.compose();p.setData({title:'Title',body:'Draft',writingInstructions:'Natural wording',writingPurpose:2});p.saveDraft();await Promise.resolve();assert.equal(saved.body,'Draft');assert.equal(saved.writing.instructions,'Natural wording');assert.equal(p.data.busy,false);
  const restored=page('community',390,844,{getStorageSync:()=>saved}).p;restored.loadDraft();assert.equal(restored.data.writingPurpose,2);assert.equal(restored.data.writingInstructions,'Natural wording');
  const legacy=page('community',390,844,{getStorageSync:()=>({title:'Old title',body:'Old draft',image:''})}).p;legacy.loadDraft();assert.equal(legacy.data.body,'Old draft');assert.equal(legacy.data.writingInstructions,'');assert.equal(legacy.data.writingPurpose,1);
});
