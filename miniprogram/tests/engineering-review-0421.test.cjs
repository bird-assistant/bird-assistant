const {test}=require('node:test'),assert=require('node:assert/strict');
const {handleVault}=require('../cloudfunctions/birdPrivateVault/handler.cjs');
const {documentStore}=require('../cloudfunctions/birdPrivateVault/store.cjs');
const notes=require('../.test-build/services/field-notes.js'),places=require('../.test-build/services/saved-places.js');
const m=require('../.test-build/services/journal-model.js');
function storage(extra={}){const map=new Map();global.wx={getStorageSync:k=>structuredClone(map.get(k)??''),setStorageSync:(k,v)=>map.set(k,structuredClone(v)),...extra};return map;}
function page(route){let definition;global.Page=v=>definition=v;const file=require.resolve('../.test-build/'+route+'/index.js');delete require.cache[file];require(file);const p={data:structuredClone(definition.data),setData(v,done){Object.assign(this.data,v);done?.();}};for(const [k,v]of Object.entries(definition))if(k!=='data')p[k]=typeof v==='function'?v.bind(p):structuredClone(v);return p;}
const noteInput=(title,body='A field observation')=>({title,body,tags:[],observationId:'',pinned:false});
const tap=id=>({currentTarget:{dataset:{id}}});
const input=value=>({currentTarget:{dataset:{field:'body'}},detail:{value}});
const sample={id:'lake',name:'湖边',address:'北京',latitude:40,longitude:116.3,createdAt:'2026-11-28T01:00:00Z',updatedAt:'2026-11-28T01:00:00Z'};
const context={APPID:'allowed-test-app',OPENID:'alice'};
function vault(){const records=new Map();let writes=0;const options={context,appId:context.APPID,enabled:true,now:()=>sample.updatedAt,store:{async read(id){return structuredClone(records.get(id)||null);},async compareAndSwap(id,expected,next){if((records.get(id)?.revision||0)!==expected)return false;records.set(id,structuredClone(next));writes++;return true;}}};return {records,options,writes:()=>writes};}
const write=(expectedRevision=0,mutationId='mutation_0001',values=[sample])=>({action:'write',expectedRevision,mutationId,places:values});

test('every native ripple ring sends a positive whole-pixel stroke throughout pan/zoom lifetime',()=>{
 const {mapRippleCircles}=require('../.test-build/services/map-effects.js');for(const zoom of [3,12,20])for(let now=0;now<9000;now+=41){const rings=mapRippleCircles({latitude:40,longitude:116.3,started:0,color:'#477e65'},now,zoom);assert.equal(rings.length,3);for(const r of rings){assert.ok(Number.isInteger(r.strokeWidth)&&r.strokeWidth>=1);assert.ok(Number.isFinite(r.radius)&&r.radius>0);assert.equal(r.latitude,40);assert.equal(r.longitude,116.3);}}
});
test('launch defers original protection and migrates both legacy collections in one complete write',t=>{
 t.mock.timers.enable({apis:['setTimeout']});const files=new Map(),doc=m.makeJournal([],'Legacy');let writes=0,reads=0;const kv=storage({env:{USER_DATA_PATH:'/user'},getFileSystemManager:()=>({accessSync:p=>{if(!files.has(p))throw Error('ENOENT');},statSync:p=>({size:files.get(p).length}),readFileSync:p=>{reads++;return files.get(p);},writeFileSync:(p,v)=>{writes++;files.set(p,v);},mkdirSync(){}})});
 kv.set(m.JOURNAL_KEY,[doc]);kv.set(places.SAVED_PLACES_KEY,{version:1,items:[sample]});let app;global.App=v=>app=v;const file=require.resolve('../.test-build/app.js');delete require.cache[file];require(file);app.onLaunch();assert.equal(writes,0);assert.equal(reads,0);t.mock.timers.tick(0);assert.equal(writes,1);const v=JSON.parse([...files.values()][0]);assert.equal(v.values.journals[0].id,doc.id);assert.equal(v.values.places.items[0].id,sample.id);
});
test('window width and available height choose one or two panes while fold/rotation preserves the active draft',t=>{
 t.mock.timers.enable({apis:['setTimeout']});let width=1024,height=768;storage({getWindowInfo:()=>({windowWidth:width,windowHeight:height})});const p=page('field/notes');p.onLoad();p.create();p.input(input('Keep this draft through folding'));
 assert.equal(p.data.split,true);assert.ok(p.data.detailWidth>=420);p.listScrolled({detail:{scrollTop:220}});const id=p.data.note.id;width=640;p.onResize();assert.equal(p.data.split,false);assert.equal(p.data.screen,'edit');assert.equal(p.data.listScroll,220);assert.equal(p.data.note.id,id);assert.equal(p.data.note.body,'Keep this draft through folding');assert.equal(p.data.dirty,true);
 width=1180;height=420;p.onResize();assert.equal(p.data.split,false);height=820;p.onResize();assert.equal(p.data.split,true);assert.ok(p.data.detailWidth>p.data.listWidth);p.onUnload();
});
test('a failed autosave blocks selecting another note; Back closes an inner picker before clearing note focus',t=>{
 t.mock.timers.enable({apis:['setTimeout']});const kv=storage({getWindowInfo:()=>({windowWidth:1024,windowHeight:768})});notes.saveFieldNote('one',noteInput('One'),0);notes.saveFieldNote('two',noteInput('Two'),0);const p=page('field/notes');p.onLoad();p.open(tap('one'));p.input(input('Newest unsaved words'));global.wx.setStorageSync=()=>{throw Error('full disk');};p.open(tap('two'));assert.equal(p.data.note.id,'one');assert.equal(p.data.note.body,'Newest unsaved words');assert.match(p.data.error,/full disk/);p.setData({linkOpen:true});p.back();assert.equal(p.data.linkOpen,false);assert.equal(p.data.screen,'edit');p.back();assert.equal(p.data.screen,'edit');assert.equal(notes.readFieldNotes().find(n=>n.id==='one').body,'A field observation');
 global.wx.setStorageSync=(k,v)=>kv.set(k,structuredClone(v));p.back();assert.equal(p.data.screen,'list');assert.equal(p.data.note,null);assert.equal(notes.readFieldNotes().find(n=>n.id==='one').body,'Newest unsaved words');p.onUnload();
});
test('note list rendering sends bounded excerpts rather than 300 complete private note bodies',()=>{
 const kv=storage(),now=sample.updatedAt;kv.set(notes.FIELD_NOTES_KEY,{version:1,items:Array.from({length:300},(_,i)=>({id:'note_'+i,...noteInput('Note '+i,'私'.repeat(5000)),createdAt:now,updatedAt:now,deletedAt:'',revision:1}))});const p=page('field/notes');p.onLoad();assert.equal(p.data.rows.length,300);assert.equal('body'in p.data.rows[0],false);assert.equal(p.data.rows[0].excerpt.length,110);assert.ok(Buffer.byteLength(JSON.stringify(p.data.rows))<200000);p.onUnload();
});
test('private cloud storage rejects missing identity/config and isolates two warm-instance WeChat callers',async()=>{
 const v=vault();assert.equal((await handleVault(write(),{...v.options,enabled:false})).error.code,'VAULT_NOT_CONFIGURED');assert.equal((await handleVault(write(),{...v.options,context:{APPID:'other',OPENID:'alice'}})).error.code,'VAULT_IDENTITY');assert.equal(v.writes(),0);
 assert.equal((await handleVault({...write(),OPENID:'bob',owner:'bob'},v.options)).ok,true);const bob=await handleVault({action:'read'},{...v.options,context:{...context,OPENID:'bob'}});assert.equal(bob.data.present,false);assert.equal(bob.data.revision,0);assert.equal((await handleVault({action:'read'},v.options)).data.places[0].name,'湖边');
});
test('cloud revisions reject stale devices and deletion keeps a tombstone against old first-write resurrection',async()=>{
 const v=vault();let result=await handleVault(write(),v.options);assert.equal(result.data.revision,1);result=await handleVault(write(0,'mutation_stale'),v.options);assert.equal(result.error.code,'VAULT_CONFLICT');assert.equal(v.writes(),1);
 result=await handleVault({action:'remove',expectedRevision:1,mutationId:'mutation_remove'},v.options);assert.equal(result.data.present,false);assert.equal(result.data.revision,2);assert.equal((await handleVault(write(0,'mutation_new00'),v.options)).error.code,'VAULT_CONFLICT');assert.equal((await handleVault({action:'read'},v.options)).data.revision,2);
});
test('an uncertain cloud retry is idempotent but reusing its operation id with changed content fails',async()=>{
 const v=vault();await handleVault(write(),v.options);assert.equal((await handleVault(write(),v.options)).data.revision,1);assert.equal(v.writes(),1);assert.equal((await handleVault(write(0,'mutation_0001',[{...sample,name:'Changed'}]),v.options)).error.code,'VAULT_RETRY_CHANGED');assert.equal(v.writes(),1);
});
test('simultaneous cloud writers cannot both replace the same revision',async()=>{
 const v=vault();await handleVault(write(),v.options);const results=await Promise.all([handleVault(write(1,'mutation_from_A'),v.options),handleVault(write(1,'mutation_from_B'),v.options)]);assert.equal(results.filter(r=>r.ok).length,1);assert.equal(results.filter(r=>r.error?.code==='VAULT_CONFLICT').length,1);assert.equal(v.writes(),2);
});
test('invalid coordinates, huge snapshots and unlisted cloud actions never write',async()=>{
 const v=vault();for(const values of [[{...sample,latitude:NaN}],Array.from({length:251},(_,i)=>({...sample,id:'p'+i})),[{...sample,address:'x'.repeat(241)}]])assert.equal((await handleVault(write(0,'mutation_invalid',values),v.options)).error.code,'VAULT_INPUT');assert.equal((await handleVault({action:'constructor'},v.options)).error.code,'VAULT_ACTION');assert.equal(v.writes(),0);
});
test('database adapter treats resolved SDK error objects as failures instead of fake empty/successful backups',async()=>{
 const db={collection:()=>({doc:()=>({get:async()=>({code:'DENIED'})}),add:async()=>({code:'DENIED'}),where:()=>({update:async()=>({code:'DENIED'})})})},store=documentStore(db);
 await assert.rejects(store.read('owner'),/read failed/);await assert.rejects(store.compareAndSwap('owner',0,{}),/not confirmed/);await assert.rejects(store.compareAndSwap('owner',1,{}),/unexpected update/);
});
test('database compare-and-swap uses the owner and expected revision in one conditional write',async()=>{
 let filter,content;const db={collection:()=>({doc:()=>({get:async()=>({data:[]})}),add:async row=>({id:row._id}),where:f=>{filter=f;return {update:async value=>{content=value;return{updated:0};}};}})},store=documentStore(db);
 assert.equal(await store.read('owner'),null);assert.equal(await store.compareAndSwap('owner',0,{revision:1}),true);assert.equal(await store.compareAndSwap('owner',7,{revision:8}),false);assert.deepEqual(filter,{_id:'owner',revision:7});assert.deepEqual(content,{revision:8});
});
test('cloud remains inactive by default; a merged remote copy preserves current coordinates and unrelated originals',async()=>{
 const kv=storage({cloud:{init(){throw Error('disabled feature must not initialize');},callFunction(){throw Error('disabled feature must not call');}}});const client=require('../.test-build/services/cloud-vault.js');await assert.rejects(client.callPrivateVault('read'),/尚未开通/);places.savePlace({name:'Current name',address:'Local',latitude:40,longitude:116.3});kv.set(m.JOURNAL_KEY,[m.makeJournal([],'Untouched journal')]);
 assert.equal(client.mergeCloudPlaces({revision:1,present:true,updatedAt:sample.updatedAt,places:[sample,{...sample,id:'other',latitude:39.2}]}),1);assert.equal(places.readSavedPlaces().find(p=>p.latitude===40).name,'Current name');assert.equal(m.readJournals()[0].title,'Untouched journal');
});
test('a late cloud read after page hide cannot update the page or local bookmarks',async()=>{
 storage();const client=require('../.test-build/services/cloud-vault.js'),original=client.callPrivateVault;let finish;client.callPrivateVault=()=>new Promise(r=>finish=r);const p=page('field/cloud-vault');p.onLoad();p.onShow();p.setData({ready:true});const request=p.read();p.onHide();finish({revision:1,present:true,updatedAt:sample.updatedAt,places:[sample]});await request;assert.equal(p.data.known,false);assert.equal(p.data.working,false);assert.equal(places.readSavedPlaces().length,0);client.callPrivateVault=original;p.onUnload();
});

test('the shared header recomputes capsule clearance and status height after window rotation',()=>{
 let width=1024,left=920,status=24;storage({getWindowInfo:()=>({windowWidth:width,windowHeight:768,statusBarHeight:status,screenHeight:768}),getMenuButtonBoundingClientRect:()=>({left,top:status+6,bottom:status+38})});
 let definition;global.Component=v=>definition=v;const file=require.resolve('../.test-build/components/app-header/index.js');delete require.cache[file];require(file);const c={data:structuredClone(definition.data),setData(v){Object.assign(this.data,v);},...definition.methods};definition.lifetimes.attached.call(c);assert.equal(c.data.right,114);
 width=768;left=650;status=28;definition.pageLifetimes.resize.call(c);assert.equal(c.data.right,128);assert.equal(c.data.status,28);assert.ok(c.data.headerHeight>=72);
});

test('desktop zero status bars and absent capsules retain a visible title instead of reserving the whole window',()=>{
 const {headerMetrics,layout}=require('../.test-build/services/layout.js');assert.deepEqual(headerMetrics(1024,0,{left:0,top:0,bottom:0}),{status:0,headerHeight:44,right:16});assert.deepEqual(headerMetrics(1024,0,null),{status:0,headerHeight:44,right:16});
 storage({getWindowInfo:()=>({windowWidth:1024,windowHeight:768,screenHeight:768,statusBarHeight:0}),getMenuButtonBoundingClientRect:()=>{throw Error('no capsule');}});assert.equal(layout(true).headerHeight,44);assert.equal(layout(true).height,724);
});

test('unsaved-note unload protection stays enabled after storage failure and clears after a successful retry',t=>{
 t.mock.timers.enable({apis:['setTimeout']});const calls=[],kv=storage({enableAlertBeforeUnload(){calls.push('enable');},disableAlertBeforeUnload(){calls.push('disable');}});const p=page('field/notes');p.onLoad();p.create();p.input(input('One'));p.input(input('Two'));assert.deepEqual(calls,['enable']);
 global.wx.setStorageSync=()=>{throw Error('quota');};assert.equal(p.flush(),false);assert.deepEqual(calls,['enable']);global.wx.setStorageSync=(k,v)=>kv.set(k,structuredClone(v));assert.equal(p.flush(),true);assert.deepEqual(calls,['enable','disable']);p.onUnload();
});
