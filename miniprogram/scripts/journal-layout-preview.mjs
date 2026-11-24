// Source-driven composition review, not a WeChat screenshot. Run npm test once to compile the model.
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),require=createRequire(import.meta.url);
const {makeJournal,textLayout,compositionName}=require(resolve(root,'.test-build/services/journal-model.js'));
const {photoCrop}=require(resolve(root,'.test-build/services/crop.js'));
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const images=new Map();
const image=src=>{if(!images.has(src)){const bytes=readFileSync(resolve(root,'miniprogram','.'+src));images.set(src,{id:'asset-'+images.size,data:'data:image/png;base64,'+bytes.toString('base64'),w:bytes.readUInt32BE(16),h:bytes.readUInt32BE(20)});}return '#'+images.get(src).id;};
let body='<rect width="1440" height="1500" fill="#e6ebdf"/><text x="60" y="58" font-size="27" fill="#285b49">羽迹 · 单图与双图构图</text><text x="60" y="92" font-size="16" fill="#5d705c">由排版模型生成 · 示例插画 · 非微信真机截图</text>';
for(let n=1;n<=2;n++)for(let variant=1;variant<=3;variant++){
  const d=makeJournal(Array.from({length:n},(_,i)=>({id:'a'+i,src:'/assets/samples/field-'+i+'.png',selected:true,sample:true,label:i?'枝头一瞥':'湖边停留',notes:''})),'沿着鸟鸣，慢慢走','3:4','nature',variant);
  for(const photo of d.elements.filter(e=>e.type==='photo')){const bytes=readFileSync(resolve(root,'miniprogram','.'+photo.src));photo.iw=bytes.readUInt32BE(16);photo.ih=bytes.readUInt32BE(20);}
  const x=60+(variant-1)*460,y=128+(n-1)*674,scale=.45;
  body+=`<text x="${x}" y="${y}" font-size="20" fill="#285b49">${n} 张 · ${esc(compositionName(d))}</text><g transform="translate(${x},${y+24}) scale(${scale})"><rect width="900" height="1200" fill="${d.background}"/>`;
  for(const e of d.elements){
    if(e.type==='photo'){
      const c=photoCrop(e),id='clip-'+n+'-'+variant+'-'+e.photoNumber;
      body+=`<rect x="${e.x-6}" y="${e.y-6}" width="${e.w+12}" height="${e.h+12}" fill="#fffef9"/><clipPath id="${id}"><rect x="${e.x}" y="${e.y}" width="${e.w}" height="${e.h}"/></clipPath><g clip-path="url(#${id})"><use href="${image(e.src)}" x="${e.x+c.imageX}" y="${e.y+c.imageY}" width="${c.imageW}" height="${c.imageH}"/></g>`;
    }else if(e.type==='text'){
      for(const row of textLayout(e,d).rows)body+=`<text x="${e.x}" y="${e.y+row.y+row.size}" font-size="${row.size}" font-weight="${row.bold?600:400}" fill="${e.color}" font-family="${e.font==='sans'?'Noto Sans CJK SC':'Noto Serif CJK SC'}">${esc(row.text)}</text>`;
    }else if(e.type!=='tape')body+=`<use href="${image('/assets/decorations/'+e.type+'.png')}" x="${e.x}" y="${e.y}" width="${e.w}" height="${e.h}"/>`;
  }
  body+='</g>';
}
const defs=Array.from(images.values()).map(a=>`<symbol id="${a.id}" viewBox="0 0 ${a.w} ${a.h}"><image href="${a.data}" width="${a.w}" height="${a.h}"/></symbol>`).join('');
const out=resolve(root,'docs/design/journal-layouts.svg');mkdirSync(dirname(out),{recursive:true});writeFileSync(out,`<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="1500" viewBox="0 0 1440 1500" font-family="Noto Sans CJK SC"><defs>${defs}</defs>${body}</svg>`);console.log(out);
