const {test}=require('node:test');
const assert=require('node:assert/strict');
const sheets=require('../.test-build/services/adaptive-sheets.js');
const {journalThumbnail}=require('../.test-build/services/journal-thumbnail.js');
const model=require('../.test-build/services/journal-model.js');
const writing=require('../.test-build/services/journal-writing.js');
const assets=[{id:'photo',src:'/assets/samples/field-0.png',sample:true,selected:true,label:'Photo',notes:''}];
const options={destination:'new',selectedId:'',placement:1,includeTitle:false,includeCaptions:false,purpose:'观察正文',prompt:'',photoIds:[]};

test('an explicitly requested photo-only journal brief has a natural factual default and user words take priority',()=>{
  const d=model.makeJournal(assets,'Saved name'),id=d.elements.find(e=>e.type==='photo').id;
  for(const destination of ['new','overview']){
    const {input}=writing.journalWritingBrief(d,{...options,destination,photoIds:[id]});
    const request=JSON.parse(input.prompt);assert.match(request.instructions,/可见细节/);assert.match(request.instructions,/不猜鸟名/);assert.equal(input.images.length,1);assert.equal(d.title,'Saved name');
    const specific=writing.journalWritingBrief(d,{...options,destination,photoIds:[id],prompt:'Write one brief caption in English.'});assert.equal(JSON.parse(specific.input.prompt).instructions,'Write one brief caption in English.');
  }
});

test('empty requests without usable material still stop locally, while a selected text can be polished without typing a prompt',()=>{
  const d=model.makeJournal([],'No photos');assert.throws(()=>writing.journalWritingBrief(d,options),/补充写作要求、关联照片/);
  const box=model.element('text',{text:'I saw a small bird, but I do not know its species.'});d.elements.push(box);
  const {input}=writing.journalWritingBrief(d,{...options,destination:'selected',selectedId:box.id});
  const request=JSON.parse(input.prompt);assert.equal(request.existingText.body,box.text);assert.match(request.instructions,/不确定性/);assert.equal(input.images.length,0);
});

test('default instructions do not bypass explicit image limits or missing-image checks',()=>{
  const d=model.makeJournal(assets,'Keep');assert.throws(()=>writing.journalWritingBrief(d,{...options,photoIds:['a','b','c','d','e']}),/每次最多关联/);
  assert.throws(()=>writing.journalWritingBrief(d,{...options,photoIds:['missing']}),/照片选择已变化/);
});

test('sheet height hugs short content and caps long content on small and large viewports',()=>{
  assert.equal(sheets.sheetBodyHeight(120,72,844,24),120);
  assert.equal(sheets.sheetBodyHeight(0,72,844,24),64);
  for(const viewport of [320,568,844,1024]){
    const height=sheets.sheetBodyHeight(4000,88,viewport,24);assert.ok(height>=40);assert.ok(height+88<=viewport-24-56+1);assert.ok(height<4000);
  }
});

test('native sheet measurement grows, shrinks and resizes independently, without recursive bridge updates',()=>{
  let content=140,viewport=844,measurements=0;const patches=[];
  global.wx={nextTick:f=>f(),getWindowInfo:()=>({windowHeight:viewport,statusBarHeight:24}),createSelectorQuery:()=>({in(){return this;},selectAll(){return this;},fields(){return this;},exec(done){measurements++;done([[{height:content,dataset:{sheetId:'history'}},{height:500,dataset:{sheetId:'writing'}}],[{height:72,dataset:{sheetId:'history'}},{height:80,dataset:{sheetId:'writing'}}]]);}})};
  const page={data:{sheetHeights:{}},setData(patch,done){patches.push(patch);Object.assign(this.data,patch);done?.();}};
  sheets.installAdaptiveSheets(page);assert.equal(page.data.sheetHeights.history,140);assert.equal(page.data.sheetHeights.writing,500);assert.equal(measurements,1);
  content=1300;page.setData({records:['many']});assert.ok(page.data.sheetHeights.history<1300);assert.equal(measurements,2);
  content=90;page.setData({records:[]});assert.equal(page.data.sheetHeights.history,90);assert.equal(measurements,3);
  viewport=568;sheets.fitAdaptiveSheets(page);assert.ok(page.data.sheetHeights.writing<500);assert.equal(measurements,4);
  sheets.stopAdaptiveSheets(page);page.setData({closed:true});assert.equal(measurements,4);assert.ok(patches.length<12);
});

test('pending sheet measurement cannot patch an unloaded page',()=>{
  const queue=[],patches=[];global.wx={nextTick:f=>queue.push(f),createSelectorQuery:()=>{throw Error('must not query an unloaded page');}};
  const page={data:{},setData(p,done){patches.push(p);done?.();}};sheets.installAdaptiveSheets(page);sheets.stopAdaptiveSheets(page);queue.forEach(f=>f());assert.deepEqual(patches,[]);
});

test('closed sheets do not add selector-query work to normal editor or feed updates',()=>{
  let visible=false,queries=0;global.wx={nextTick:f=>f(),getWindowInfo:()=>({windowHeight:844,statusBarHeight:24}),createSelectorQuery:()=>({in(){queries++;return this;},selectAll(){return this;},fields(){return this;},exec(done){done([[],[]]);}})};
  const page={data:{},setData(p,done){Object.assign(this.data,p);done?.();}};sheets.installAdaptiveSheets(page,()=>visible);page.setData({drag:1});assert.equal(queries,0);
  visible=true;page.setData({open:true});assert.equal(queries,1);visible=false;page.setData({open:false});assert.equal(queries,1);sheets.stopAdaptiveSheets(page);
});

test('a result arriving during native measurement is measured again instead of keeping the earlier empty height',()=>{
  const callbacks=[];global.wx={nextTick:f=>f(),getWindowInfo:()=>({windowHeight:844,statusBarHeight:24}),createSelectorQuery:()=>({in(){return this;},selectAll(){return this;},fields(){return this;},exec(done){callbacks.push(done);}})};
  const page={data:{sheetHeights:{}},setData(p,done){Object.assign(this.data,p);done?.();}};sheets.installAdaptiveSheets(page);page.setData({answer:'New long answer'});
  callbacks.shift()([[{height:100,dataset:{sheetId:'writing'}}],[{height:72,dataset:{sheetId:'writing'}}]]);assert.equal(callbacks.length,1);
  callbacks.shift()([[{height:400,dataset:{sheetId:'writing'}}],[{height:72,dataset:{sheetId:'writing'}}]]);assert.equal(page.data.sheetHeights.writing,400);assert.equal(callbacks.length,0);sheets.stopAdaptiveSheets(page);
});

test('journal thumbnails represent the composed page, including text, decorations and changed arrangement, without editing history',()=>{
  for(const ratio of ['3:4','1:1','4:3']){
    const d=model.makeJournal(assets,'Saved journal',ratio),photo=d.elements.find(e=>e.type==='photo');
    d.elements.push(model.element('text',{text:'Unique journal body',title:'Visible heading',x:40,y:50,w:400,fontSize:24,rotation:5}));
    d.elements.push(model.element('leaf',{x:70,y:80,w:60,h:60}));
    d.editHistory={version:1,past:[model.snapshot(d,'')],future:[],selected:''};const before=JSON.stringify(d);
    const thumbnail=journalThumbnail(d);assert.equal(JSON.stringify(d),before);assert.ok(Math.abs(thumbnail.width/thumbnail.height-d.width/d.height)<1e-10);assert.equal(thumbnail.elements.length,d.elements.length);
    assert.ok(thumbnail.elements.flatMap(e=>e.rows).some(row=>row.text.includes('Unique journal body')));assert.ok(thumbnail.elements.some(e=>e.src==='/assets/decorations/leaf.png'));assert.equal(thumbnail.editHistory,undefined);
    const old=thumbnail.elements.find(e=>e.id===photo.id).style;photo.x+=20;assert.notEqual(journalThumbnail(d).elements.find(e=>e.id===photo.id).style,old);
  }
});
