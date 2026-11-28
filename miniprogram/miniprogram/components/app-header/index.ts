import { headerMetrics } from '../../services/layout';
Component({
  properties: { title: { type: String, value: '羽迹' }, back: { type: Boolean, value: false } },
  data: { headerHeight: 88, status: 24, right: 100 },
  lifetimes: { attached() { this.resizeHeader(); } },
  pageLifetimes:{resize(){this.resizeHeader();}},
  methods: { resizeHeader(){const info=wx.getWindowInfo();let capsule=null;try{capsule=wx.getMenuButtonBoundingClientRect();}catch{}this.setData(headerMetrics(info.windowWidth,info.statusBarHeight,capsule));},goBack() { this.triggerEvent('back'); } }
});
