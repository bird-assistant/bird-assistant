export const TABS = [
  { route: '/pages/home/index', name: '首页', icon: 'home' },
  { route: '/pages/journal/index', name: '手帐', icon: 'journal' },
  { route: '/pages/identify/index', name: '识别', icon: 'scan' },
  { route: '/pages/community/index', name: '讨论', icon: 'chat' },
  { route: '/pages/profile/index', name: '我的', icon: 'user' }
];

export interface NavigationPage {
  data: { view?: string; sheet?: boolean };
  getTabBar?: () => WechatMiniprogram.Component.TrivialInstance;
  setData: (data: Record<string, unknown>) => void;
}

export function syncNavigation(page: NavigationPage): void {
  const focused = !!page.data.sheet || !!page.data.view && !['home','live','feed','profile'].includes(page.data.view);
  page.getTabBar?.()?.setData({ hidden: focused });
  page.setData({ focusedPage: focused });
}

export function selectTab(page: NavigationPage, selected: number): void {
  page.getTabBar?.()?.setData({ selected });
  syncNavigation(page);
}
