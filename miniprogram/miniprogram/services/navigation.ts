import { NavigationPage, syncNavigation } from './tabs';

type Destination=WechatMiniprogram.NavigateToOption;
type StackPage={route?:string;options?:Record<string,string|undefined>;data?:Record<string,unknown>};
function identity(url:string){
  const parts=url.replace(/^\//,'').split('?'),params=new Map<string,string>();
  for(const part of (parts[1]||'').split('&')){if(!part)continue;const at=part.indexOf('=');params.set(decodeURIComponent(at<0?part:part.slice(0,at)),decodeURIComponent(at<0?'':part.slice(at+1)));}
  return parts[0]+'?'+Array.from(params).sort((a,b)=>a[0].localeCompare(b[0])).map(pair=>encodeURIComponent(pair[0])+'='+encodeURIComponent(pair[1]||'')).join('&');
}
function pageIdentity(page:StackPage){return identity('/'+page.route+'?'+Object.entries(page.options||{}).map(pair=>encodeURIComponent(pair[0])+'='+encodeURIComponent(pair[1]||'')).join('&'));}
function replaceable(page:StackPage|undefined){
  // Editors, pickers, replies and in-progress operations retain their back stack.
  if(page?.route==='field/social/index')return !page.data?.editing&&!page.data?.working&&!page.data?.text&&!page.data?.groupName&&['friends','member','inbox','chat','groups','group','blocked'].includes(String(page.data?.screen||page.options?.screen));
  return page?.route==='field/hub/index'&&['record','species','library','external','feed','mine','bookmarks','observations','growth'].includes(String(page.data?.screen||page.options?.screen))&&!page.data?.body;
}

/** Reuse read-only destinations and bound related-detail chains below WeChat's ten-page limit. */
export function navigate(options:Destination):void{
  const pages:StackPage[]=typeof getCurrentPages==='function'?getCurrentPages():[],target=identity(options.url),top=pages[pages.length-1];
  const fail:NonNullable<Destination['fail']>=error=>{options.fail?.(error);wx.showToast?.({title:'页面未能打开，请返回一页后重试',icon:'none'});};
  // Event-channel pickers always get a fresh page and a fresh channel.
  if(!options.events&&!options.success){
    for(let i=pages.length-1;i>=0;i--){if(pageIdentity(pages[i])!==target)continue;if(i===pages.length-1)return;if(!pages.slice(i+1).every(replaceable))break;wx.navigateBack({delta:pages.length-1-i,fail});return;}
  }
  if(pages.length>=9&&replaceable(top)&&!options.events&&!options.success){
    wx.redirectTo({url:options.url,fail});return;
  }
  wx.navigateTo({...options,fail});
}

export function resetPageScroll(page: NavigationPage): void {
  syncNavigation(page);
  wx.nextTick(()=>wx.pageScrollTo({scrollTop:0,duration:0}));
}
