const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync,readdirSync}=require('node:fs');
const {join}=require('node:path');
const parser=import('../scripts/wxml-syntax.mjs');

test('the exact reported zoom-button corruption fails instead of passing structural verification',async()=>{
  const {assertWxmlSyntax}=await parser;
  const broken='<button disabled="{{!zoomEnabled || zoom  hover-class="press-feedback" hover-start-time="0" hover-stay-time="70">= (demo ? 5 : maxZoom)}}" aria-label="放大 0.1 倍"><image/></button>';
  assert.throws(()=>assertWxmlSyntax(broken,'pages/identify/index.wxml'),/identify\/index.wxml:1:.*Unclosed WXML binding/);
});
test('valid greater-than and less-than comparisons inside quoted attributes are not treated as tag boundaries',async()=>{
  const {assertWxmlSyntax}=await parser;
  assert.doesNotThrow(()=>assertWxmlSyntax('<button disabled="{{!zoomEnabled || zoom >= (demo ? 5 : maxZoom)}}" hover-class="press-feedback"/><view wx:if="{{a < b && c > 0}}"/>'));
});
test('malformed or unconsumed attribute text is rejected with a file and source position',async()=>{
  const {assertWxmlSyntax}=await parser;
  for(const source of ['<button a="one"b="two"/>','<button ="x"/>','<button a=one/>','<button a="one" ?/>','<button a="one" a="two"/>','<button a="one>'])assert.throws(()=>assertWxmlSyntax(source,'fixture.wxml'),/fixture.wxml:1:/);
});
test('boolean attributes, comments, single quotes, entities and quoted object braces remain valid',async()=>{
  const {assertWxmlSyntax}=await parser;
  assert.doesNotThrow(()=>assertWxmlSyntax('<!-- <broken -->\n<view wx:else><scroll-view scroll-y><text data-value=\'{{{value: "}"}}}\'>{{a &gt; 0 ? "{" : "}"}}</text></scroll-view></view>'));
});
test('unclosed and invalid expressions, comments and tag structures are rejected',async()=>{
  const {assertWxmlSyntax}=await parser;
  for(const source of ['<view a="{{a + }}"/>','<view a="{{a"/>','<view>{{}}</view>','<view>{{a + }}</view>','<!-- open','<view><text/></button>','<view>'])assert.throws(()=>assertWxmlSyntax(source));
});
test('all checked-in templates parse completely and the repaired zoom button has the correct limit expression',async()=>{
  const {assertWxmlSyntax}=await parser;
  const walk=path=>readdirSync(path,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(join(path,entry.name)):[join(path,entry.name)]);
  for(const path of walk('miniprogram').filter(path=>path.endsWith('.wxml')))assert.doesNotThrow(()=>assertWxmlSyntax(readFileSync(path,'utf8'),path));
  const source=readFileSync('miniprogram/pages/identify/index.wxml','utf8');assert.match(source,/data-delta="0\.1"[^>]*disabled="{{!zoomEnabled \|\| zoom >= \(demo \? 5 : maxZoom\)}}"/);
});
