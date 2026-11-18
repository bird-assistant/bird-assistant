const {test}=require('node:test');
const assert=require('node:assert/strict');
const map=require('../.test-build/services/map-model.js');
const j=require('../.test-build/services/journal-model.js');
test('zoom changes merge and split public markers without any pan, while private markers stay separate',()=>{
  assert.equal(map.markers(map.mapRecords,390,624,1).length,3);
  const out=map.markers(map.mapRecords,390,624,.4);assert.equal(out.length,2);assert.equal(out.find(m=>!m.private).count,2);
  assert.equal(map.markers(map.mapRecords,390,624,1).length,3);
});
test('recentering puts the location at the exact viewport centre at different zooms and screen ratios',()=>{
  for(const [w,h]of [[390,624],[430,740],[320,512]])for(const z of [.4,1,2.7]){const offset=map.offsetFor(map.currentPoint,w,h,z),point=map.centerAt(offset.x,offset.y,w,h,z);assert.ok(Math.abs(point.x-map.currentPoint.x)<1e-9);assert.ok(Math.abs(point.y-map.currentPoint.y)<1e-9);}
});
test('region selection responds to centre location with hysteresis at the boundary',()=>{assert.equal(map.regionAt({x:73,y:24},'lake'),'wood');assert.equal(map.regionAt({x:35,y:43},'wood'),'lake');assert.equal(map.regionAt({x:54,y:33.5},'lake'),'lake');});
test('one text element contains title and body, wraps taller when narrowed, and truncates at the page boundary',()=>{
  const d=j.makeJournal([], 'Title'),e=j.element('text',{title:'观察感想',text:'等了很久终于见到一只鸟。天气很好。'.repeat(6),x:50,y:250,w:600,fontSize:28});
  const wide=j.textLayout(e,d);e.w=180;const narrow=j.textLayout(e,d);assert.ok(narrow.height>wide.height);assert.equal(e.type,'text');assert.equal(e.title,'观察感想');e.y=d.height-80;const end=j.textLayout(e,d);assert.ok(end.overflow);assert.ok(end.rows.at(-1).text.endsWith('…'));assert.ok(end.height<=80);
});
test('history snapshots restore deletion, text, crop, decoration, order and selection together',()=>{
  const assets=[{id:'a',src:'photo',label:'A',notes:'',sample:false,selected:true}],d=j.makeJournal(assets,'First');const past=[],future=[];
  const photo=d.elements.find(e=>e.type==='photo');photo.zoom=2;photo.cropX=75;const before=j.snapshot(d,photo.id);
  d.elements=d.elements.filter(e=>e.id!==photo.id);d.elements[0].text='changed';d.elements.push(j.element('star'));j.recordHistory(past,future,before,d);
  const restored=past.pop();assert.equal(restored.selected,photo.id);assert.equal(restored.document.elements.find(e=>e.id===photo.id).zoom,2);assert.equal(restored.document.elements.find(e=>e.id===photo.id).cropX,75);assert.equal(restored.document.elements[0].text,'FIELD NOTES / 羽迹');assert.ok(!restored.document.elements.some(e=>e.type==='star'));
  restored.document.elements[0].text='other';assert.notEqual(before.document.elements[0].text,'other');
});
test('focus follows selected elements but clamps to physical canvas edges, and names follow nine regions',()=>{
  const d=j.makeJournal([], 'Title'),e=j.element('photo',{photoNumber:2,x:720,y:1000,w:100,h:100});assert.equal(j.elementLabel(e,d),'照片 2（右下）');assert.equal(j.focusOffset(e,.4,1200,250),230);e.y=0;assert.equal(j.focusOffset(e,.4,1200,250),0);
});
test('journal controller undo/redo restores the complete deleted element and branching clears redo',()=>{
  let definition;global.Page=x=>definition=x;global.wx={getWindowInfo:()=>({windowWidth:390,windowHeight:844,screenHeight:844,statusBarHeight:24,safeArea:{bottom:810}}),nextTick:fn=>fn(),pageScrollTo:()=>{},getMenuButtonBoundingClientRect:()=>({top:30,bottom:62,left:290})};
  const path=require.resolve('../.test-build/pages/journal/index.js');delete require.cache[path];require(path);const p={data:structuredClone(definition.data),setData(v){Object.assign(this.data,v);}};for(const [k,v]of Object.entries(definition))if(k!=='data')p[k]=typeof v==='function'?v.bind(p):structuredClone(v);
  p.onLoad();const d=j.makeJournal([{id:'a',src:'photo',label:'A',notes:'',sample:false,selected:true}],'Test');p.openDocument(d,true);const photo=p.data.doc.elements.find(e=>e.type==='photo');p.setData({selectedId:photo.id});p.refresh();p.remove();assert.ok(!p.data.doc.elements.some(e=>e.id===photo.id));p.undo();assert.deepEqual(p.data.doc.elements.find(e=>e.id===photo.id),photo);assert.equal(p.data.selectedId,photo.id);p.redo();assert.ok(!p.data.doc.elements.some(e=>e.id===photo.id));p.undo();p.addText();assert.equal(p.data.canRedo,false);
});
test('a journal storage failure preserves durable media in the document and undo history, allowing retry',async(t)=>{
  const warnings=[];t.mock.method(console,'warn',(...args)=>warnings.push(args));
  let definition,copies=0,fail=true;const values=new Map(),toasts=[];global.Page=x=>definition=x;
  global.wx={getWindowInfo:()=>({windowWidth:390,windowHeight:844,screenHeight:844,statusBarHeight:24}),getMenuButtonBoundingClientRect:()=>({top:30,bottom:62}),nextTick:fn=>fn(),pageScrollTo:()=>{},getStorageSync:k=>values.get(k),setStorageSync(k,v){if(fail)throw new Error('journal quota');values.set(k,structuredClone(v));},showToast:o=>toasts.push(o),getFileSystemManager:()=>({saveFile:o=>{copies++;o.success({savedFilePath:'wxfile://saved/photo.jpg'});}})};
  const path=require.resolve('../.test-build/pages/journal/index.js');delete require.cache[path];require(path);const p={data:structuredClone(definition.data),setData(v){Object.assign(this.data,v);}};for(const[k,v]of Object.entries(definition))if(k!=='data')p[k]=typeof v==='function'?v.bind(p):structuredClone(v);
  p.onLoad();p.openDocument(j.makeJournal([{id:'a',src:'wxfile://temp/photo.jpg',label:'A',notes:'',sample:false,selected:true}],'Keep me'),true);p.addText();p.save();await new Promise(r=>setImmediate(r));assert.equal(copies,1);assert.equal(toasts.length,0);assert.equal(p.data.busy,false);assert.equal(p._past[0].document.elements.find(e=>e.type==='photo').src,'wxfile://saved/photo.jpg');
  assert.equal(warnings[0][1].message,'journal quota');fail=false;p.save();await new Promise(r=>setImmediate(r));assert.equal(copies,1);assert.equal(values.get(j.JOURNAL_KEY)[0].title,'Keep me');assert.equal(toasts.length,1);p.undo();assert.equal(p.data.doc.elements.find(e=>e.type==='photo').src,'wxfile://saved/photo.jpg');
});
test('releasing a held shutter before native start acknowledgement still stops the recording',()=>{
  let definition,start,stops=0;global.Page=x=>definition=x;const path=require.resolve('../.test-build/pages/identify/index.js');delete require.cache[path];require(path);const p={data:structuredClone(definition.data),setData(v){Object.assign(this.data,v);}};for(const[k,v]of Object.entries(definition))if(k!=='data')p[k]=typeof v==='function'?v.bind(p):structuredClone(v);
  p._camera={startRecord:o=>start=o,stopRecord:()=>{stops++;}};p.setData({cameraReady:true});p._holding=true;p.startVideo();p.shutterEnd();start.success();assert.equal(stops,1);assert.equal(p.data.recording,false);
});
