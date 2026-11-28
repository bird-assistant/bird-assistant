const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtempSync,mkdirSync,writeFileSync,rmSync}=require('node:fs');
const {join,resolve}=require('node:path');
const {tmpdir}=require('node:os');
const compiler=import('../scripts/compile-templates.mjs');

test('bundled WeChat WCC rejects the reported corruption and compiles the repaired fixture without credentials or upload',async()=>{
  const {compileWxml,compileTemplates}=await compiler;
  const temporary=mkdtempSync(join(tmpdir(),'bird-wxml-')),root=join(temporary,'project with spaces');mkdirSync(root);
  try{
    writeFileSync(join(root,'page.json'),'{}');
    writeFileSync(join(root,'page.wxml'),'<button disabled="{{!zoomEnabled || zoom hover-class="press-feedback" hover-start-time="0">= maxZoom}}"><image/></button>');
    assert.throws(()=>compileWxml(root,['page.wxml']),/WeChat wcc rejected templates/);
    writeFileSync(join(root,'page.wxml'),'<button disabled="{{!zoomEnabled || zoom >= maxZoom}}" hover-class="press-feedback"><image/></button>');
    assert.doesNotThrow(()=>compileWxml(root,['page.wxml']));
    assert.throws(()=>compileWxml(root,[]),/No WXML files/);
    writeFileSync(join(root,'page.wxss'),'@import "missing.wxss";');
    assert.throws(()=>compileTemplates(root),/WeChat wcsc rejected templates/);
    writeFileSync(join(root,'page.wxss'),'.page { color: #285b49; }');
    assert.doesNotThrow(()=>compileTemplates(root));
  }finally{rmSync(temporary,{recursive:true,force:true});}
});
test('bundled WeChat WCC and WCSC compile every current WXML and WXSS source',async()=>{
  const {compileTemplates}=await compiler;
  const result=compileTemplates(resolve('miniprogram'));assert.ok(result.wxml>0&&result.wxss>0);
});
