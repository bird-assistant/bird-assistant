const { createObservationService } = require('../../services/observations');
const { LatestRequest } = require('../../core/latest');
Page({
  data: { record: null, loading: false, error: '', isMock: true },
  onLoad(options) {
    this.requests = new LatestRequest();
    this.service = createObservationService();
    this.id = options.id || '';
    this.setData({ isMock: this.service.isMock });
    this.load();
  },
  onUnload() {
    this.requests.invalidate();
  },
  async load() {
    const sequence = this.requests.begin();
    this.setData({ loading: true, error: '' });
    try {
      const record = await this.service.detail(this.id);
      if (this.requests.isCurrent(sequence)) this.setData({ record, loading: false });
    } catch (error) {
      if (this.requests.isCurrent(sequence)) this.setData({ error: error.message, loading: false });
    }
  },
  imageError() {
    this.setData({ 'record.thumbnailUrl': '' });
  },
  back() {
    wx.navigateBack();
  },
});
