import { TABS } from '../services/tabs';

Component({
  data: { hidden: false, selected: 0, tabs: TABS },
  lifetimes: {
    attached() {
      const pages = getCurrentPages();
      const current = pages[pages.length - 1];
      if (current) {
        const index = TABS.findIndex(tab => tab.route === '/' + current.route);
        this.setData({ selected: Math.max(0, index), hidden: !!current.data.focusedPage });
      }
    }
  },
  methods: {
    switchTab(event: WechatMiniprogram.TouchEvent) {
      const index = Number(event.currentTarget.dataset.index);
      if (!TABS[index] || index === this.data.selected) return;
      wx.switchTab({
        url: TABS[index].route,
        success: () => this.setData({ selected: index }),
        fail: () => wx.showToast({ title: '页面暂时无法打开，请重试', icon: 'none' })
      });
    }
  }
});
