const config = require('../../config/local');
const { validPoint } = require('../../core/coordinates');
const { LatestRequest } = require('../../core/latest');
const { createLocationService, locate } = require('../../services/location');

Page({
  data: {
    latitude: config.initialView.latitude,
    longitude: config.initialView.longitude,
    scale: 14,
    candidate: null,
    address: '请拖动地图、点击地点或主动使用当前位置',
    error: '',
    locating: false,
    resolving: false,
    showLocation: false,
    mockLocations: config.locationProvider === 'mock',
  },
  onLoad(options) {
    this.addressRequest = new LatestRequest();
    this.locationRequest = new LatestRequest();
    this.selectionRequest = new LatestRequest();
    this.locations = createLocationService();
    const original = { latitude: Number(options.latitude), longitude: Number(options.longitude) };
    if (validPoint(original)) {
      this.setData({
        ...original,
        candidate: { ...original, coordinateSystem: 'GCJ-02', source: 'existing' },
      });
      this.lookupAddress(original);
    }
  },
  onReady() {
    this.map = wx.createMapContext('location-map', this);
  },
  onHide() {
    this.cancelPending();
  },
  onUnload() {
    this.cancelPending();
  },
  cancelPending() {
    this.addressRequest.invalidate();
    this.locationRequest.invalidate();
    this.selectionRequest.invalidate();
    clearTimeout(this.regionTimer);
  },
  setCandidate(point, source) {
    if (!validPoint(point)) return;
    this.setData({
      latitude: point.latitude,
      longitude: point.longitude,
      locating: false,
      candidate: {
        latitude: Number(point.latitude.toFixed(6)),
        longitude: Number(point.longitude.toFixed(6)),
        coordinateSystem: 'GCJ-02',
        source,
      },
      error: '',
    });
    this.lookupAddress(point);
  },
  async lookupAddress(point) {
    const sequence = this.addressRequest.begin();
    this.setData({ resolving: true, address: '正在解析地址…' });
    try {
      const address = await this.locations.reverse(point);
      if (this.addressRequest.isCurrent(sequence)) this.setData({ address, resolving: false });
    } catch (error) {
      if (this.addressRequest.isCurrent(sequence))
        this.setData({
          address: '已选坐标 · 地址暂不可用',
          resolving: false,
          error: error.message,
        });
    }
  },
  onRegionChange(event) {
    const detail = event.detail || {};
    // 地图初始化/程序移动不视为用户选择，避免历史照片自动套用默认位置。
    if ((event.causedBy || detail.causedBy) !== 'gesture') return;
    this.selectionRequest.invalidate();
    this.locationRequest.invalidate();
    this.addressRequest.invalidate();
    clearTimeout(this.regionTimer);
    this.setData({
      candidate: null,
      locating: false,
      address: '松开地图后确认选点',
      resolving: false,
    });
    if (event.type !== 'end' && detail.type !== 'end') return;
    const sequence = this.selectionRequest.begin();
    this.regionTimer = setTimeout(() => {
      this.map.getCenterLocation({
        success: (point) => {
          if (this.selectionRequest.isCurrent(sequence)) this.setCandidate(point, 'manual');
        },
        fail: () => {
          if (this.selectionRequest.isCurrent(sequence))
            this.setData({ error: '无法读取选点，请点击地图重试' });
        },
      });
    }, 160);
  },
  onMapTap(event) {
    clearTimeout(this.regionTimer);
    this.selectionRequest.invalidate();
    this.locationRequest.invalidate();
    this.setCandidate(event.detail, 'manual');
  },
  async locate() {
    if (this.data.locating) return;
    const sequence = this.locationRequest.begin();
    this.setData({ locating: true, error: '' });
    try {
      const point = await locate();
      if (!this.locationRequest.isCurrent(sequence)) return;
      this.setData({ showLocation: true });
      this.setCandidate(point, 'current');
    } catch (error) {
      if (this.locationRequest.isCurrent(sequence)) this.setData({ error: error.message });
    } finally {
      if (this.locationRequest.isCurrent(sequence)) this.setData({ locating: false });
    }
  },
  openSettings() {
    wx.openSetting({});
  },
  confirm() {
    if (!validPoint(this.data.candidate) || this.data.locating) return;
    // 只有这一个入口发送值；返回键、取消、失败都不发送。
    const channel = this.getOpenerEventChannel();
    if (channel && channel.emit)
      channel.emit('locationConfirmed', {
        ...this.data.candidate,
        label: this.data.resolving ? '所选坐标' : this.data.address,
      });
    wx.navigateBack();
  },
  cancel() {
    wx.navigateBack();
  },
});
