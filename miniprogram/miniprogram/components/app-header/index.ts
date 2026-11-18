import { layout } from '../../services/layout';
Component({
  properties: { title: { type: String, value: '羽迹' }, back: { type: Boolean, value: false } },
  data: { headerHeight: 88, status: 24, right: 100 },
  lifetimes: { attached() { const info = wx.getWindowInfo(), capsule = wx.getMenuButtonBoundingClientRect(); this.setData({ headerHeight: layout().headerHeight, status: info.statusBarHeight || 24, right: info.windowWidth - capsule.left + 10 }); } },
  methods: { goBack() { this.triggerEvent('back'); } }
});
