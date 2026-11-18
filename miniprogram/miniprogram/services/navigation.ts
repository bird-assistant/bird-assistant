import { NavigationPage, syncNavigation } from './tabs';

export function resetPageScroll(page: NavigationPage): void {
  syncNavigation(page);
  wx.nextTick(()=>wx.pageScrollTo({scrollTop:0,duration:0}));
}
