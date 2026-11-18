/** Canvas 2D uses decoded images, never page-relative draw commands. */
export function canvasImagePath(path:string):string {
  return /^(?:\.\/)?assets\//.test(path) ? '/'+path.replace(/^\.\//,'') : path;
}

export function deadline<T>(operation:Promise<T>,message:string,milliseconds=12000):Promise<T> {
  return new Promise<T>((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error(message)),milliseconds);
    operation.then(value=>{clearTimeout(timer);resolve(value);},error=>{clearTimeout(timer);reject(error);});
  });
}

export function getCanvas(page:WechatMiniprogram.Page.TrivialInstance|WechatMiniprogram.Component.TrivialInstance,selector:string,width:number,height:number):Promise<WechatMiniprogram.Canvas> {
  return deadline(new Promise<WechatMiniprogram.Canvas>((resolve,reject)=>{
    wx.createSelectorQuery().in(page).select(selector).fields({node:true,size:true}).exec(results=>{
      const canvas=(results[0] as {node?:WechatMiniprogram.Canvas}|undefined)?.node;
      if(!canvas){reject(new Error('画布还未准备好，请重试；当前内容仍保留。'));return;}
      canvas.width=width;canvas.height=height;resolve(canvas);
    });
  }),'画布初始化超时，请重试。');
}

export function loadCanvasImage(canvas:WechatMiniprogram.Canvas,source:string):Promise<WechatMiniprogram.Image> {
  return deadline(new Promise<WechatMiniprogram.Image>((resolve,reject)=>{
    const image=canvas.createImage();
    image.onload=()=>resolve(image);
    image.onerror=error=>{console.warn('[Bird Assistant] canvas image failed',source,error);reject(new Error('有一张素材暂时无法读取，导出未完成；手帐与文字仍保留。'));};
    image.src=canvasImagePath(source);
  }),'图片读取超时，导出未完成；手帐仍保留。');
}

export function exportCanvas(canvas:WechatMiniprogram.Canvas):Promise<string> {
  return deadline(new Promise<string>((resolve,reject)=>wx.canvasToTempFilePath({
    canvas,width:canvas.width,height:canvas.height,destWidth:canvas.width,destHeight:canvas.height,fileType:'png',
    success:r=>resolve(r.tempFilePath),fail:error=>{console.warn('[Bird Assistant] canvas export failed',error);reject(new Error('成品图导出未完成，请重试；当前手帐仍保留。'));}
  })),'成品图导出超时，请重试；当前手帐仍保留。');
}
