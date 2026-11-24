// Synthetic bridge-payload proxy, NOT phone FPS. Run npm test first.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..'),model=require('../.test-build/services/journal-model.js');
const doc=model.makeJournal(Array.from({length:4},(_,i)=>({id:'a'+i,src:'/assets/samples/field-'+i+'.png',label:'观察 '+i,notes:'',selected:true,sample:true})),'沿着鸟鸣，慢慢走');
function run(source){
  let definition;global.wx={getWindowInfo:()=>({windowWidth:390,windowHeight:844,screenHeight:844,statusBarHeight:24,safeArea:{bottom:810}}),getMenuButtonBoundingClientRect:()=>({top:30,bottom:62,left:290}),nextTick:f=>f(),pageScrollTo:()=>{}};global.Page=d=>definition=d;
  const file=path.join(root,'.test-build/pages/journal/index.js'),m=new Module(file,module);m.filename=file;m.paths=Module._nodeModulePaths(path.dirname(file));m._compile(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,file);
  let calls=0,bytes=0;const p={data:structuredClone(definition.data),setData(patch){calls++;bytes+=Buffer.byteLength(JSON.stringify(patch));Object.assign(this.data,patch);},getTabBar:()=>({setData(){}})};
  for(const[k,v]of Object.entries(definition))if(k!=='data')p[k]=typeof v==='function'?v.bind(p):structuredClone(v);
  p.onLoad();p.openDocument(structuredClone(doc),false);p.select({currentTarget:{dataset:{id:p.data.doc.elements.find(e=>e.type==='photo').id}}});calls=bytes=0;
  const event=v=>({currentTarget:{dataset:{key:'w',control:'slider'}},detail:{value:v}});
  for(let i=0;i<100;i++)p.previewAdjust(event(180+i*.21));p.adjust(event(200.79));p.onUnload?.();
  return {setDataCalls:calls,serializedBytes:bytes,finalWidth:p.data.selected.w,undoSteps:p._past.length};
}
const baseline=process.argv[2]?fs.readFileSync(path.resolve(process.argv[2]),'utf8'):cp.execFileSync('git',['show','d587b32c9a6155aef11924c2e4a6f7cb87a02e86:miniprogram/miniprogram/pages/journal/index.ts'],{cwd:root,encoding:'utf8'});
console.log(JSON.stringify({scenario:'100 changing events + final release; 4-photo document; Node bridge-payload proxy only',baseline:run(baseline),updated:run(fs.readFileSync(path.join(root,'miniprogram/pages/journal/index.ts'),'utf8'))},null,2));
