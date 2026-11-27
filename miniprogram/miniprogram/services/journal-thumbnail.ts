import {JournalDocument,textLayout} from './journal-model';
import {photoCrop} from './crop';
import {paperSource} from './journal-paper';

/** A render-only projection: no document history, source notes or editor state. */
export function journalThumbnail(document:JournalDocument,height=196){
  const scale=height/document.height;
  return {id:document.id,width:document.width*scale,height,background:document.background,paper:paperSource(document.paper),
    elements:document.elements.map(e=>{
      const crop=photoCrop(e,scale);
      return {id:e.id,type:e.type,src:e.type==='photo'?e.src:e.type==='text'||e.type==='tape'?'':'/assets/decorations/'+e.type+'.png',color:e.color,font:e.font,
        style:`left:${e.x*scale}px;top:${e.y*scale}px;width:${e.w*scale}px;height:${e.h*scale}px;transform:rotate(${e.rotation}deg)`,
        imageStyle:`left:${crop.imageX}px;top:${crop.imageY}px;width:${crop.imageW}px;height:${crop.imageH}px`,
        rows:e.type==='text'?textLayout(e,document).rows.map(r=>({text:r.text,style:`top:${r.y*scale}px;font-size:${r.size*scale}px;font-weight:${r.bold?600:400}`})):[]};
    })};
}
