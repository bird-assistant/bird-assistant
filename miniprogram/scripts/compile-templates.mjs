import {chmodSync,readFileSync,readdirSync} from 'node:fs';
import {dirname,join,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';

const require=createRequire(import.meta.url);
const compilerRoot=dirname(require.resolve('miniprogram-compiler/package.json'));
const platform={win32:'windows',linux:'linux',darwin:'mac'}[process.platform];
const files=directory=>readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(join(directory,entry.name)):[join(directory,entry.name)]);
function run(tool,args,root){
  if(!platform)throw new Error('No bundled WeChat template compiler for '+process.platform);
  const binary=join(compilerRoot,'bin',platform,tool+(process.platform==='win32'?'.exe':''));
  if(process.platform!=='win32')chmodSync(binary,0o755);
  const result=spawnSync(binary,args,{cwd:root,encoding:'utf8',timeout:30000,maxBuffer:16*1024*1024});
  if(result.error)throw new Error('WeChat '+tool+' could not run: '+result.error.message);
  if(result.status!==0)throw new Error('WeChat '+tool+' rejected templates:\n'+(result.stderr||result.stdout).slice(0,12000));
  if(!result.stdout.trim())throw new Error('WeChat '+tool+' returned no compiled output');
}
export function compileWxml(root,list,wxs=[]){
  if(!list.length)throw new Error('No WXML files supplied to the compiler');
  // Pass the complete real file list; the upstream wrapper misresolves absolute
  // WeChat component paths as paths relative to each page's directory.
  const definitions=[];let count=0;
  for(const path of list){
    let config;try{config=JSON.parse(readFileSync(join(root,path.slice(0,-5)+'.json'),'utf8'));}catch{continue;}
    if(config.usingComponents){const names=Object.keys(config.usingComponents);definitions.push(path,String(names.length),...names);count++;}
  }
  run('wcc',['-d','-cc',[String(count),...definitions].join(' '),...list,...wxs,'-gn','$gwx'],root);
}
export function compileTemplates(root){
  const all=files(root).map(path=>relative(root,path).replace(/\\/g,'/')).sort();
  const wxml=all.filter(path=>path.endsWith('.wxml')),wxss=all.filter(path=>path.endsWith('.wxss'));
  compileWxml(root,wxml,all.filter(path=>path.endsWith('.wxs')));
  run('wcsc',['-js','-pc',String(wxss.length),...wxss],root);
  return {wxml:wxml.length,wxss:wxss.length};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const root=resolve(dirname(fileURLToPath(import.meta.url)),'../miniprogram');
  const result=compileTemplates(root);
  console.log(`PASS: bundled WeChat WCC compiled ${result.wxml} WXML files; WCSC compiled ${result.wxss} WXSS files. Full DevTools Compile/device acceptance remains separate.`);
}
