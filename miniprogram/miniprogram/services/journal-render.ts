import {photoCrop} from './crop';
import {loadCanvasImage} from './canvas';
import {JournalDocument,textLayout} from './journal-model';
import {paperSource} from './journal-paper';

/** The editor and forum snapshots use the same rendering path. */
export async function renderJournal(canvas:WechatMiniprogram.Canvas,d:JournalDocument){
  const ctx=canvas.getContext('2d');
ctx.fillStyle=d.background;ctx.fillRect(0,0,d.width,d.height);
      const texture=paperSource(d.paper);if(texture){const image=await loadCanvasImage(canvas,texture);ctx.drawImage(image,0,0,d.width,d.height,0,0,d.width,d.height);}
      for(const e of d.elements){
        ctx.save();ctx.translate(e.x+e.w/2,e.y+e.h/2);ctx.rotate(e.rotation*Math.PI/180);
        if(e.type==='photo'){
          const image=await loadCanvasImage(canvas,e.src),crop=photoCrop({...e,iw:image.width,ih:image.height});
          ctx.fillStyle='#fffef9';ctx.fillRect(-e.w/2-6,-e.h/2-6,e.w+12,e.h+12);
          ctx.drawImage(image,crop.sourceX,crop.sourceY,crop.sourceW,crop.sourceH,-e.w/2,-e.h/2,e.w,e.h);
        }else if(e.type==='text'){
          ctx.fillStyle=e.color;ctx.textBaseline='top';
          for(const row of textLayout(e,d).rows){ctx.font=(row.bold?'600 ':'400 ')+row.size+'px '+(e.font==='sans'?'sans-serif':e.font==='hand'?'KaiTi,serif':'serif');ctx.fillText(row.text,-e.w/2,-e.h/2+row.y);}
        }else if(e.type==='tape'){ctx.fillStyle=e.color;ctx.globalAlpha=.65;ctx.fillRect(-e.w/2,-e.h/2,e.w,e.h);}
        else {const image=await loadCanvasImage(canvas,'/assets/decorations/'+e.type+'.png');ctx.drawImage(image,-e.w/2,-e.h/2,e.w,e.h);}
        ctx.restore();
      }
}
