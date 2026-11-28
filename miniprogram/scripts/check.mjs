import {readFileSync,existsSync,readdirSync,statSync} from 'node:fs';
import {resolve,dirname,join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertRuntimeSyntax} from './runtime-syntax.mjs';
import {assertWxmlSyntax} from './wxml-syntax.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const json=path=>JSON.parse(readFileSync(resolve(root,path),'utf8'));
const assert=(condition,message)=>{if(!condition)throw new Error(message);};
const app=json('miniprogram/app.json'),template=json('project.config.template.json');
assert(template.miniprogramRoot==='miniprogram/','One canonical miniprogram root is required.');
assert(template.appid==='touristappid','The tracked template must not contain another project AppID.');
assert(template.setting.useCompilerPlugins.includes('typescript'),'DevTools TypeScript compilation is required.');
assert(app.pages.length===5&&app.tabBar.custom,'Expected the five-tab native shell.');
assert(new Set(app.pages).size===5,'Duplicate page routes.');
assert(app.tabBar.list.length===5,'Expected five declared tab routes.');
for(const entry of app.tabBar.list){
  assert(app.pages.includes(entry.pagePath),'Tab route is not a page: '+entry.pagePath);
  for(const key of ['iconPath','selectedIconPath'])assert(existsSync(resolve(root,'miniprogram',entry[key])),'Missing tab asset: '+entry[key]);
}
const subpages=(app.subpackages||app.subPackages||[]).flatMap(group=>group.pages.map(page=>group.root+'/'+page));
const templates=files(resolve(root,'miniprogram')).filter(path=>path.endsWith('.wxml')).map(path=>relative(resolve(root,'miniprogram'),path).replace(/\\/g,'/').slice(0,-5));
for(const route of new Set([...app.pages,...subpages,...templates])){
  const base=resolve(root,'miniprogram',route);
  for(const ext of ['ts','json','wxml','wxss'])assert(existsSync(base+'.'+ext),'Missing '+route+'.'+ext);
  JSON.parse(readFileSync(base+'.json','utf8'));
  const source=readFileSync(base+'.ts','utf8'),markup=readFileSync(base+'.wxml','utf8');
  assertWxmlSyntax(markup,route+'.wxml');
  const handlers=[...markup.matchAll(/\b(?:bind|catch)(?::)?[\w-]+="([A-Za-z_$][\w$]*)"/g)].map(m=>m[1]);
  for(const name of handlers)assert(new RegExp('\\b'+name+'\\s*\\(').test(source),'Missing handler '+name+' in '+route);
  for(const [,asset] of markup.matchAll(/src="(\/assets\/[^"{}]+)"/g))assert(existsSync(resolve(root,'miniprogram','.'+asset)),'Missing image: '+asset);
}
for(const component of ['custom-tab-bar/index','components/app-header/index']){
  const stylesheet=readFileSync(resolve(root,'miniprogram',component+'.wxss'),'utf8');
  const blocks=[];
  for(const match of stylesheet.matchAll(/([^{}]*)[{}]/g)){
    if(match[0].endsWith('}')){blocks.pop();continue;}
    const selector=match[1].trim();
    const atRule=/^@(media\b|keyframes\s)/.test(selector);
    const valid=blocks.at(-1)==='keyframes'
      ? selector.split(',').every(part=>/^(?:from|to|\d+(?:\.\d+)?%)$/.test(part.trim()))
      : atRule||selector.split(',').every(part=>part.trim().startsWith('.'));
    assert(valid,'Component styles must use class selectors: '+component+' '+selector);
    blocks.push(selector.startsWith('@keyframes ')?'keyframes':'rule');
  }
}
function files(path){return readdirSync(path).flatMap(name=>{const full=join(path,name);return statSync(full).isDirectory()?files(full):[full];});}
for(const path of files(resolve(root,'miniprogram'))){
  if(!path.endsWith('.ts'))continue;
  const source=readFileSync(path,'utf8');
  assertRuntimeSyntax(source,path);
  assert(!/wx\.cloud\.(?:init|callFunction|database)/.test(source),'Unconfigured cloud call in '+path);
  assert(!/wx[0-9a-f]{16}|cloud1-[0-9a-z]+/.test(source),'Unrelated project identity in runtime source.');
}
if(existsSync(resolve(root,'project.config.json'))){
  const local=json('project.config.json');assert(local.miniprogramRoot==='miniprogram/','Local config points at a different root.');
  assert(existsSync(resolve(root,local.miniprogramRoot,'app.json')),'Local config cannot resolve app.json.');
}
process.stdout.write('PASS: routes, config, assets, handlers, strict WXML attributes/expressions/tag balance and service boundaries. DevTools compilation still required.\n');
