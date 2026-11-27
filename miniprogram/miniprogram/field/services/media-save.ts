import {businessOrigin} from '../../services/vision-network';

/** Only public, server-redacted publication images. Never expose an upload or private file URL. */
export function publishedPhotoUrl(value:string):string {
  const origin=businessOrigin(),path=value.startsWith(origin)?value.slice(origin.length):value;
  if(!/^\/api\/v1\/community\/publications\/[a-zA-Z0-9_-]{1,128}\/(?:photo|photos\/[0-8])$/.test(path))throw new Error('这张图片暂不提供保存，请从公开帖子重新打开。');
  return origin+path;
}
export function downloadPublishedPhoto(value:string):Promise<string> {
  const url=publishedPhotoUrl(value);
  return new Promise((resolve,reject)=>wx.downloadFile({url,timeout:30000,success:result=>{
    if(result.statusCode===404||result.statusCode===403){reject(new Error('图片已撤回或暂不可见，未保存到相册。'));return;}
    if(result.statusCode!==200||!result.tempFilePath){reject(new Error('图片下载未完成，请稍后重试。'));return;}
    resolve(result.tempFilePath);
  },fail:()=>reject(new Error('图片下载未完成，请检查网络后重试。'))}));
}
export async function savePublishedPhoto(value:string):Promise<void> {
  const filePath=await downloadPublishedPhoto(value);
  try{
    await new Promise<void>((resolve,reject)=>wx.saveImageToPhotosAlbum({filePath,success:()=>resolve(),fail:error=>{
      reject(new Error(/auth deny|authorize|permission|授权|拒绝/i.test(error.errMsg)?'尚未允许保存照片，可在微信设置中开启相册权限后重试。':'相册保存未完成，图片仍可查看。'));
    }}));
  }finally{
    // The downloaded temporary copy is owned by this action; originals and draft files are untouched.
    try{wx.getFileSystemManager().unlink({filePath,success:()=>{},fail:()=>{}});}catch{}
  }
}
