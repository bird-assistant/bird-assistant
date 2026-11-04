const config = require('../../config/local');
const { boundsAround, validPoint } = require('../../core/coordinates');
const { createMarkers } = require('../../core/clusters');
const { dateWindow, newestFirst } = require('../../core/observations');
const { LatestRequest } = require('../../core/latest');
const { createObservationService } = require('../../services/observations');
const { createLocationService, locate } = require('../../services/location');

const scopes = [
  { label: '公开与我的', value: 'all' },
  { label: '公开鸟讯', value: 'public' },
  { label: '我的标记', value: 'mine' },
];
const periods = [
  { label: '全部日期', value: 'all' },
  { label: '今天', value: 'today' },
  { label: '近 7 天', value: 'week' },
  { label: '近 30 天', value: 'month' },
];

Page({
  data: {
    latitude: config.initialView.latitude,
    longitude: config.initialView.longitude,
    scale: config.initialView.scale,
    scopes,
    periods,
    scopeIndex: 0,
    periodIndex: 0,
    species: [
      { label: '全部鸟种', value: '' },
      { label: '待鉴定', value: '__unknown__' },
    ],
    speciesIndex: 0,
    keyword: '',
    searchResults: [],
    searchStatus: 'idle',
    searchError: '',
    markers: [],
    loading: false,
    error: '',
    notice: '',
    loadedCount: 0,
    total: 0,
    nextCursor: '',
    sheetOpen: false,
    sheetRecords: [],
    sheetTitle: '',
    isMock: config.observationProvider === 'mock',
    mockLocations: config.locationProvider === 'mock',
    scenarioLabel: '正常',
    locationBusy: false,
    showLocation: false,
    confirmedLocation: null,
  },
  onLoad() {
    this.observations = createObservationService();
    this.locations = createLocationService();
    this.listRequest = new LatestRequest();
    this.searchRequest = new LatestRequest();
    this.viewportRequest = new LatestRequest();
    this.locationRequest = new LatestRequest();
    this.records = [];
    this.groups = [];
    this.bounds = boundsAround(config.initialView);
    const saved = getApp().globalData.mapView;
    if (saved) {
      this.setData(saved.data);
      this.records = saved.records;
      this.bounds = saved.bounds;
      this.selectedKey = saved.selectedKey;
      this.observations.setScenario(saved.scenario);
      this.scenario = saved.scenario;
      this.renderMarkers();
    } else this.loadRecords(false);
  },
  onReady() {
    this.map = wx.createMapContext('bird-map', this);
    this.refreshViewport();
  },
  onHide() {
    this.saveView();
    this.invalidateRequests();
    this.setData({
      loading: false,
      locationBusy: false,
      searchStatus: this.data.searchStatus === 'loading' ? 'idle' : this.data.searchStatus,
    });
  },
  onShow() {
    if (this.wasHidden && this.map) this.refreshViewport();
    this.wasHidden = false;
  },
  onUnload() {
    this.saveView();
    this.invalidateRequests();
  },
  invalidateRequests() {
    this.wasHidden = true;
    clearTimeout(this.regionTimer);
    this.listRequest.invalidate();
    this.searchRequest.invalidate();
    this.viewportRequest.invalidate();
    this.locationRequest.invalidate();
  },
  saveView() {
    const {
      latitude,
      longitude,
      scale,
      scopeIndex,
      periodIndex,
      speciesIndex,
      species,
      total,
      nextCursor,
      scenarioLabel,
      confirmedLocation,
      sheetOpen,
      sheetRecords,
      sheetTitle,
      notice,
    } = this.data;
    getApp().globalData.mapView = {
      data: {
        latitude,
        longitude,
        scale,
        scopeIndex,
        periodIndex,
        speciesIndex,
        species,
        total,
        nextCursor,
        scenarioLabel,
        confirmedLocation,
        sheetOpen,
        sheetRecords,
        sheetTitle,
        notice,
        loadedCount: this.records.length,
      },
      records: this.records,
      bounds: this.bounds,
      selectedKey: this.selectedKey,
      scenario: this.scenario || 'normal',
    };
  },
  query(cursor = '') {
    return {
      bounds: this.bounds,
      scope: scopes[this.data.scopeIndex].value,
      ...dateWindow(periods[this.data.periodIndex].value),
      speciesId: this.data.species[this.data.speciesIndex].value,
      cursor,
      limit: 60,
    };
  },
  async loadRecords(append = false) {
    if (append && (this.data.loading || !this.data.nextCursor)) return;
    const sequence = this.listRequest.begin();
    const query = this.query(append ? this.data.nextCursor : '');
    this.setData({ loading: true, error: '' });
    if (!append) {
      this.records = [];
      this.groups = [];
      this.selectedKey = '';
      this.setData({ markers: [], loadedCount: 0, total: 0, nextCursor: '', sheetOpen: false });
    }
    try {
      const result = await this.observations.list(query);
      if (!this.listRequest.isCurrent(sequence)) return;
      this.records = [
        ...new Map([...this.records, ...result.items].map((item) => [item.id, item])).values(),
      ];
      // Mock 列表有稳定的全部筛选选项；正式接口使用 speciesId 或未来名录搜索替换。
      const known = new Map(this.data.species.map((item) => [item.value, item.label]));
      this.records.forEach((record) => {
        if (record.speciesId) known.set(record.speciesId, record.speciesName);
      });
      if (this.observations.isMock) {
        known.set('demo-egret', '白鹭');
        known.set('demo-sparrow', '树麻雀');
        known.set('demo-blackbird', '乌鸫');
      }
      const repeatedCursor = result.nextCursor && result.nextCursor === query.cursor;
      this.setData({
        loading: false,
        total: result.total,
        loadedCount: this.records.length,
        nextCursor: repeatedCursor || this.records.length >= 300 ? '' : result.nextCursor,
        species: [...known].map(([value, label]) => ({ value, label })),
        notice: repeatedCursor
          ? '分页游标未推进，请重新查询'
          : this.records.length >= 300 && result.nextCursor
            ? '当前已加载 300 条，请放大地图或缩小筛选范围'
            : this.data.notice,
      });
      this.renderMarkers();
      this.saveView();
    } catch (error) {
      if (this.listRequest.isCurrent(sequence))
        this.setData({ loading: false, error: error.message });
    }
  },
  retry() {
    this.loadRecords(false);
  },
  loadMore() {
    this.loadRecords(true);
  },
  renderMarkers() {
    this.groups = createMarkers(this.records, this.data.scale, this.selectedKey);
    this.setData({ markers: this.groups.map((group) => group.marker) });
  },
  onRegionChange(event) {
    const detail = event.detail || {};
    if ((event.causedBy || detail.causedBy) === 'gesture') {
      this.locationRequest.invalidate();
      this.searchRequest.invalidate();
      this.setData({ locationBusy: false, searchStatus: 'idle', searchResults: [] });
    }
    if (event.type !== 'end' && detail.type !== 'end') return;
    // 展开面板会改变原生地图高度；布局更新不能把刚打开的面板关闭。
    if (this.data.sheetOpen && (event.causedBy || detail.causedBy) !== 'gesture') return;
    clearTimeout(this.regionTimer);
    // 立即使旧响应失效，不能等防抖计时结束才失效。
    this.listRequest.invalidate();
    this.viewportRequest.invalidate();
    this.regionTimer = setTimeout(() => this.refreshViewport(), 180);
  },
  refreshViewport() {
    if (!this.map) return;
    const sequence = this.viewportRequest.begin();
    const invoke = (method) =>
      new Promise((resolve, reject) => this.map[method]({ success: resolve, fail: reject }));
    Promise.all([invoke('getCenterLocation'), invoke('getScale'), invoke('getRegion')])
      .then(([center, zoom, bounds]) => {
        if (!this.viewportRequest.isCurrent(sequence)) return;
        if (!validPoint(center) || !bounds.southwest || !bounds.northeast)
          throw new Error('视野不可用');
        // 不回写原生地图中心，以免 setData 引起 regionchange 循环。
        this.data.latitude = center.latitude;
        this.data.longitude = center.longitude;
        this.data.scale = zoom.scale;
        this.bounds = bounds;
        this.loadRecords(false);
      })
      .catch(() => {
        if (this.viewportRequest.isCurrent(sequence)) {
          this.setData({ notice: '暂时无法读取地图视野，按当前中心附近查询，可重试' });
          this.bounds = boundsAround(this.data);
          this.loadRecords(false);
        }
      });
  },
  filterChanged(event) {
    const field = event.currentTarget.dataset.field;
    if (!['scopeIndex', 'periodIndex', 'speciesIndex'].includes(field)) return;
    this.viewportRequest.invalidate();
    clearTimeout(this.regionTimer);
    this.setData({ [field]: Number(event.detail.value) });
    this.loadRecords(false);
  },
  onMarkerTap(event) {
    const group = this.groups.find((item) => item.marker.id === Number(event.detail.markerId));
    if (!group) return;
    this.selectedKey = group.key;
    this.renderMarkers();
    const records = newestFirst(group.members);
    this.setData({
      sheetOpen: true,
      sheetRecords: records,
      sheetTitle: records.length > 1 ? '附近的公开观察' : records[0].placeName,
    });
  },
  closeSheet() {
    this.setData({ sheetOpen: false });
    this.selectedKey = '';
    this.renderMarkers();
  },
  openObservation(event) {
    const id = event.detail.id;
    wx.navigateTo({ url: `/pages/observation/index?id=${encodeURIComponent(id)}` });
  },
  keywordChanged(event) {
    this.searchRequest.invalidate();
    this.setData({
      keyword: event.detail.value,
      searchStatus: 'idle',
      searchResults: [],
      searchError: '',
    });
  },
  async search() {
    const keyword = this.data.keyword.trim();
    if (!keyword) return;
    const sequence = this.searchRequest.begin();
    this.setData({ searchStatus: 'loading', searchError: '', searchResults: [] });
    try {
      const searchResults = await this.locations.search(keyword, this.data);
      if (this.searchRequest.isCurrent(sequence))
        this.setData({ searchResults, searchStatus: searchResults.length ? 'ready' : 'empty' });
    } catch (error) {
      if (this.searchRequest.isCurrent(sequence))
        this.setData({ searchStatus: 'error', searchError: error.message });
    }
  },
  clearSearch() {
    this.searchRequest.invalidate();
    this.setData({ keyword: '', searchStatus: 'idle', searchResults: [], searchError: '' });
  },
  choosePlace(event) {
    const place = this.data.searchResults[Number(event.currentTarget.dataset.index)];
    if (!place) return;
    this.searchRequest.invalidate();
    this.locationRequest.invalidate();
    this.setData({
      latitude: place.latitude,
      longitude: place.longitude,
      scale: 15,
      searchStatus: 'idle',
      searchResults: [],
      notice: `已浏览：${place.title}`,
      sheetOpen: false,
      locationBusy: false,
    });
    this.bounds = boundsAround(this.data);
    this.loadRecords(false);
  },
  async locate() {
    if (this.data.locationBusy) return;
    const sequence = this.locationRequest.begin();
    this.setData({ locationBusy: true });
    try {
      const point = await locate();
      if (!this.locationRequest.isCurrent(sequence)) return;
      this.setData({
        latitude: point.latitude,
        longitude: point.longitude,
        scale: 15,
        showLocation: true,
        notice: '已移动到当前位置；不会自动修改任何观察记录',
      });
      this.bounds = boundsAround(this.data);
      this.loadRecords(false);
    } catch (error) {
      if (this.locationRequest.isCurrent(sequence)) this.setData({ notice: error.message });
    } finally {
      if (this.locationRequest.isCurrent(sequence)) this.setData({ locationBusy: false });
    }
  },
  openSettings() {
    wx.openSetting({});
  },
  zoom(event) {
    this.setData({
      sheetOpen: false,
      scale: Math.min(19, Math.max(3, this.data.scale + Number(event.currentTarget.dataset.delta))),
    });
    this.renderMarkers();
  },
  chooseLocation() {
    const original = this.data.confirmedLocation;
    const query = original ? `?latitude=${original.latitude}&longitude=${original.longitude}` : '';
    wx.navigateTo({
      url: `/pages/location-picker/index${query}`,
      events: {
        locationConfirmed: (point) => this.setData({ confirmedLocation: point }),
      },
    });
  },
  demoScenario() {
    if (!this.observations.isMock) return;
    wx.showActionSheet({
      itemList: ['正常数据', '无观察记录', '请求失败'],
      success: (result) => {
        const scenario = ['normal', 'empty', 'error'][result.tapIndex];
        this.scenario = scenario;
        this.observations.setScenario(scenario);
        this.setData({ scenarioLabel: ['正常', '空记录', '请求失败'][result.tapIndex] });
        this.loadRecords(false);
      },
    });
  },
});
