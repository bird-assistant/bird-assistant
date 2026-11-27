// Storage/bridge-work proxy only. This does not measure native animation FPS.
// Run npm test first; the baseline is the team 0.4.13 upload, not a moving branch.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..'),model=require('../.test-build/services/journal-model.js');
const storage=require('../.test-build/services/journal-storage.js'),shelf=require('../.test-build/services/journal-shelf.js');
let values=new Map();
global.wx={getStorageSync:key=>structuredClone(values.get(key)??''),setStorageSync:(key,value)=>values.set(key,structuredClone(value)),removeStorageSync:key=>values.delete(key)};
for(let i=0;i<18;i++){
 const doc=model.makeJournal(Array.from({length:6},(_,j)=>({id:'photo'+j,src:'/assets/samples/field-'+j%4+'.png',label:'观察 '+j,notes:'',sample:true,selected:true})),'手帐 '+i);
 for(let j=0;j<8;j++)doc.elements.push(model.element('text',{text:'湖边和林缘的观察记录，保留现场的不确定信息。'.repeat(10),x:60,y:100+j*90,w:760,h:80}));
 const before=model.snapshot(doc,'');doc.elements.at(-1).text='修改后的观察记录';
 storage.saveJournalState(doc,storage.editorHistory([before],[]));
}
for(const row of shelf.readJournalShelf())shelf.saveJournalThumbnail(row.id,row.revision,'/cached/'+row.id+'.png');
const fixture=structuredClone(values),sourceBytes=Buffer.byteLength(JSON.stringify(values.get(model.JOURNAL_KEY)));
function run(source){
 values=structuredClone(fixture);let definition,sourceReads=0,sourceReadBytes=0,calls=0,bytes=0;
 global.wx={getStorageSync(key){const value=values.get(key)??'';if(key===model.JOURNAL_KEY){sourceReads++;sourceReadBytes+=Buffer.byteLength(JSON.stringify(value));}return structuredClone(value);},
  setStorageSync:(key,value)=>values.set(key,structuredClone(value)),removeStorageSync:key=>values.delete(key),nextTick:f=>f(),pageScrollTo(){},
  getWindowInfo:()=>({windowWidth:412,windowHeight:931,screenHeight:931,statusBarHeight:36,safeArea:{bottom:910}}),getMenuButtonBoundingClientRect:()=>({top:42,bottom:74,left:290})};
 global.Page=d=>definition=d;
 const file=path.join(root,'.test-build/pages/journal/index.js'),m=new Module(file,module);m.filename=file;m.paths=Module._nodeModulePaths(path.dirname(file));
 m._compile(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,file);
 const p={data:structuredClone(definition.data),getTabBar:()=>({setData(){}}),setData(patch,done){calls++;bytes+=Buffer.byteLength(JSON.stringify(patch));Object.assign(this.data,patch);done?.();}};
 for(const[k,v]of Object.entries(definition))if(k!=='data')p[k]=typeof v==='function'?v.bind(p):structuredClone(v);
 p.onLoad();calls=bytes=0;p.onShow();
 const home={fullLibraryReads:sourceReads,fullLibraryBytes:sourceReadBytes,setDataCalls:calls,serializedBridgeBytes:bytes};
 calls=bytes=sourceReads=sourceReadBytes=0;
 for(let i=1;i<=100;i++)p.deckChange({detail:{current:i%18}});
 const swipes={fullLibraryReads:sourceReads,setDataCalls:calls,serializedBridgeBytes:bytes};p.onUnload();
 return {home,swipes};
}
const baseline=cp.execFileSync('git',['show','36c3e34212dc57bed6d041255352c06800cdc109:miniprogram/miniprogram/pages/journal/index.ts'],{cwd:root,encoding:'utf8'});
console.log(JSON.stringify({scenario:'Warm shelf; 18 six-photo journals with eight extra text boxes and bounded edit history; open home then 100 deck changes',sourceBytes,
 baseline:run(baseline),updated:run(fs.readFileSync(path.join(root,'miniprogram/pages/journal/index.ts'),'utf8')),limits:'Node storage/bridge proxy; excludes first migration, thumbnail creation, native decoding and animation FPS.'},null,2));
