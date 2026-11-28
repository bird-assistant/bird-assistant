import {faultSummary} from './diagnostics';
/** Some DevTools bridges return a rejected promise even when a callback is supplied. */
export function previewMedia(urls:string[],current=urls[0],onFailure?:()=>void){
  if(!urls.length||!current)return;let settled=false;
  const fail=(error:unknown)=>{if(settled)return;settled=true;if(/cancel/i.test(String((error as {errMsg?:string})?.errMsg||'')))return;faultSummary('image-preview',error??new Error('native preview returned null'));if(onFailure)onFailure();else wx.showToast?.({title:'图片预览未打开，原内容仍保留',icon:'none'});};
  try{const result=wx.previewImage({urls,current,success:()=>{settled=true;},fail}) as unknown as {catch?:(handler:(error:unknown)=>void)=>unknown}|undefined;if(result&&typeof result.catch==='function')result.catch(fail);}catch(error){fail(error);}
}
