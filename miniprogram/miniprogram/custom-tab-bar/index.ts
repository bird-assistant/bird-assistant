import { markTabTap, playTabArrival, TABS } from '../services/tabs';

Component({
  data: { hidden: false, selected: 0, pulse: -1, tabs: TABS },
  lifetimes: {
    attached() {
      const pages = getCurrentPages();
      const current = pages[pages.length - 1];
      if (current) {
        const index = TABS.findIndex(tab => tab.route === '/' + current.route);
        this.setData({ selected: Math.max(0, index), hidden: !!current.data.focusedPage });
        playTabArrival(this, index);
      }
    }
  },
  methods: {
    pulseTab(index: number) {
      if (this.data.pulse === index) {
        this.setData({ pulse: -1 }, () => this.setData({ pulse: index }));
      } else {
        this.setData({ pulse: index });
      }
    },
    switchTab(event: WechatMiniprogram.TouchEvent) {
      const index = Number(event.currentTarget.dataset.index);
      if (!TABS[index]) return;
      if (index === this.data.selected) { this.pulseTab(index); return; }
      markTabTap(index);
      wx.switchTab({
        url: TABS[index].route,
        fail: () => {
          markTabTap(undefined);
          wx.showToast({ title: '页面暂时无法打开，请重试', icon: 'none' });
        }
      });
    }
  }
});
