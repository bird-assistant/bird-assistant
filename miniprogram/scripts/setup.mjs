import {readFileSync,writeFileSync,existsSync,renameSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export function prepareConfig(template,current,appid){
  if(appid!==undefined&&!/^(touristappid|wx[0-9a-f]{16})$/.test(appid))throw new Error('AppID must be touristappid or a real wx… AppID.');
  const config=current?structuredClone(current):structuredClone(template);
  if(appid!==undefined)config.appid=appid;
  return config;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),args=process.argv.slice(2);
  if(args.length&&!(args.length===2&&args[0]==='--appid'))throw new Error('Usage: npm run setup -- [--appid wx…]');
  const path=resolve(root,'project.config.json'),existing=existsSync(path)?JSON.parse(readFileSync(path,'utf8')):null;
  const template=JSON.parse(readFileSync(resolve(root,'project.config.template.json'),'utf8'));
  const config=prepareConfig(template,existing,args[1]);
  if(!existing||args[1]!==undefined){
    const temporary=path+'.tmp';writeFileSync(temporary,JSON.stringify(config,null,2)+'\n');renameSync(temporary,path);
    process.stdout.write('Local project.config.json prepared. Import this repository root into DevTools.\n');
  }else process.stdout.write('Existing local project.config.json preserved.\n');
  if(config.appid==='touristappid')process.stdout.write('Tourist mode: local development only. Register Bird Assistant before device/cloud/experience acceptance.\n');
}
