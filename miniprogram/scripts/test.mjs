import {spawnSync} from 'node:child_process';
import {rmSync,readdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
rmSync(resolve(root,'.test-build'),{recursive:true,force:true});
// Keep modern Node options in the pinned CLI, not DevTools' older config reader.
const compile=spawnSync(process.execPath,[resolve(root,'node_modules/typescript/bin/tsc'),'--noEmit','false','--module','Node16','--moduleResolution','Node16','--outDir','.test-build','--rootDir','miniprogram'],{cwd:root,stdio:'inherit'});
if(compile.status!==0)process.exit(compile.status||1);
const tests=readdirSync(resolve(root,'tests')).filter(name=>name.endsWith('.test.cjs')).map(name=>resolve(root,'tests',name));
const result=spawnSync(process.execPath,['--test',...tests],{cwd:root,stdio:'inherit'});
process.exit(result.status||0);
