const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadPage, loadComponent, deferred, tick } = require('./helpers.cjs');
const { normalizeRecord } = require('../app/core/observations');
const { LatestRequest } = require('../app/core/latest');
const fixtures = require('../app/data/mock-observations');
const records = fixtures.map(normalizeRecord);

function mapPage(list, wx = {}) {
  return loadPage(
    'map',
    {
      '../../services/observations': {
        createObservationService: () => ({ list, setScenario() {}, isMock: true }),
      },
      '../../services/location': {
        createLocationService: () => ({ search: async () => [] }),
        locate: async () => ({ latitude: 31.8, longitude: 117.2 }),
      },
    },
    wx,
  );
}
test('地图旧请求成功和失败都不能覆盖新筛选结果', async () => {
  const calls = [];
  const { page } = mapPage((query) => {
    const task = deferred();
    calls.push({ task, query });
    return task.promise;
  });
  page.onLoad();
  page.filterChanged({ currentTarget: { dataset: { field: 'scopeIndex' } }, detail: { value: 2 } });
  assert.equal(calls[1].query.scope, 'mine');
  calls[1].task.resolve({ items: [records[5]], total: 1, nextCursor: '' });
  await tick();
  calls[0].task.reject(new Error('旧请求失败'));
  await tick();
  assert.equal(page.records[0].id, 'demo-private-01');
  assert.equal(page.data.error, '');
  page.loadRecords();
  page.loadRecords();
  calls[3].task.resolve({ items: [records[0]], total: 1, nextCursor: '' });
  await tick();
  calls[2].task.resolve({ items: [records[1]], total: 1, nextCursor: '' });
  await tick();
  assert.equal(page.records[0].id, 'demo-public-01');
});
test('拖动防抖期间立即拒绝旧响应，离开页面也不再写状态', async () => {
  const task = deferred();
  const { page } = mapPage(() => task.promise);
  page.onLoad();
  page.onRegionChange({ type: 'end', detail: { causedBy: 'gesture' } });
  task.resolve({ items: [records[0]], total: 1, nextCursor: '' });
  await tick();
  assert.equal(page.records.length, 0);
  page.onHide();
  const another = deferred();
  page.observations.list = () => another.promise;
  page.loadRecords();
  page.onUnload();
  another.resolve({ items: [records[0]], total: 1, nextCursor: '' });
  await tick();
  assert.equal(page.records.length, 0);
});
test('分页去重、聚合点击列表排序、详情 ID 与返回状态保留', async () => {
  let navigation;
  const { page, app } = mapPage(
    async (query) =>
      query.cursor
        ? { items: [records[1], records[2]], total: 3, nextCursor: '' }
        : { items: [records[0], records[1]], total: 3, nextCursor: 'page-2' },
    {
      navigateTo: (options) => {
        navigation = options;
      },
    },
  );
  page.onLoad();
  await tick();
  await page.loadRecords(true);
  assert.equal(page.data.loadedCount, 3);
  const group = page.groups.find((item) => item.members.length === 3);
  assert.ok(group);
  page.onMarkerTap({ detail: { markerId: group.marker.id } });
  assert.equal(page.data.sheetRecords[0].id, 'demo-public-01');
  assert.equal(page.data.sheetRecords[2].id, 'demo-public-03');
  page.openObservation({ detail: { id: 'id/带空格 ?' } });
  assert.ok(navigation.url.endsWith('id=' + encodeURIComponent('id/带空格 ?')));
  page.onHide();
  assert.equal(app.globalData.mapView.data.scopeIndex, 0);
  assert.equal(app.globalData.mapView.data.scale, page.data.scale);
  assert.equal(app.globalData.mapView.records.length, 3);
});
test('旧搜索结果、清空后的结果和旧定位都不会覆盖新状态', async () => {
  const { page } = mapPage(async () => ({ items: [], total: 0, nextCursor: '' }));
  page.onLoad();
  await tick();
  const old = deferred(),
    recent = deferred();
  let index = 0;
  page.locations.search = () => [old, recent][index++].promise;
  page.keywordChanged({ detail: { value: '湖泊' } });
  const first = page.search();
  page.keywordChanged({ detail: { value: '公园' } });
  const second = page.search();
  recent.resolve([{ id: 'new', title: '新地点' }]);
  await second;
  old.resolve([{ id: 'old', title: '旧地点' }]);
  await first;
  assert.equal(page.data.searchResults[0].id, 'new');
  const afterClear = deferred();
  page.locations.search = () => afterClear.promise;
  const third = page.search();
  page.clearSearch();
  afterClear.resolve([{ id: 'stale' }]);
  await third;
  assert.equal(page.data.searchResults.length, 0);
  assert.equal(page.data.searchStatus, 'idle');
});
test('视野旧回调不覆盖新视野；面板尺寸变化不会关闭面板', async () => {
  const { page } = mapPage(async () => ({ items: [], total: 0, nextCursor: '' }));
  page.onLoad();
  await tick();
  const callbacks = [];
  page.map = Object.fromEntries(
    ['getCenterLocation', 'getScale', 'getRegion'].map((name) => [
      name,
      (options) => callbacks.push({ name, options }),
    ]),
  );
  page.refreshViewport();
  page.refreshViewport();
  const answer = (batch, latitude) => {
    batch.find((x) => x.name === 'getCenterLocation').options.success({ latitude, longitude: 117 });
    batch.find((x) => x.name === 'getScale').options.success({ scale: 14 });
    batch
      .find((x) => x.name === 'getRegion')
      .options.success({
        southwest: { latitude: latitude - 0.1, longitude: 116.9 },
        northeast: { latitude: latitude + 0.1, longitude: 117.1 },
      });
  };
  answer(callbacks.slice(3), 32);
  await tick();
  answer(callbacks.slice(0, 3), 31);
  await tick();
  assert.equal(page.data.latitude, 32);
  page.setData({ sheetOpen: true });
  page.onRegionChange({ type: 'end', detail: { causedBy: 'update' } });
  assert.equal(page.data.sheetOpen, true);
  assert.equal(page.regionTimer, undefined);
});

function picker(reverse = async () => '测试地址') {
  const events = [];
  let back = 0;
  const loaded = loadPage(
    'location-picker',
    {
      '../../services/location': {
        createLocationService: () => ({ reverse }),
        locate: async () => ({ latitude: 31.9, longitude: 117.3 }),
      },
    },
    {
      navigateBack: () => {
        back += 1;
      },
      openSetting() {},
    },
  );
  loaded.page.getOpenerEventChannel = () => ({
    emit: (name, value) => events.push({ name, value }),
  });
  return { ...loaded, events, back: () => back };
}
test('选点默认未知；初始化和取消不回传，只有明确确认才提交', async () => {
  const { page, events, back } = picker();
  page.onLoad({});
  assert.equal(page.data.candidate, null);
  page.onRegionChange({ type: 'end', detail: { causedBy: 'update' } });
  page.confirm();
  assert.equal(events.length, 0);
  page.onMapTap({ detail: { latitude: 31.8, longitude: 117.2 } });
  await tick();
  page.cancel();
  assert.equal(events.length, 0);
  assert.equal(back(), 1);
  page.confirm();
  assert.equal(events.length, 1);
  assert.equal(events[0].name, 'locationConfirmed');
  assert.equal(events[0].value.coordinateSystem, 'GCJ-02');
  assert.equal(events[0].value.source, 'manual');
});
test('逆解析失败仍能确认坐标，旧逆解析结果不会覆盖新选点', async () => {
  const old = deferred();
  let index = 0;
  const { page, events } = picker(() =>
    index++ ? Promise.reject(new Error('地址服务不可用')) : old.promise,
  );
  page.onLoad({ latitude: '31.8', longitude: '117.2' });
  page.onMapTap({ detail: { latitude: 32, longitude: 118 } });
  await tick();
  old.resolve('过期地址');
  await tick();
  assert.equal(page.data.address, '已选坐标 · 地址暂不可用');
  page.confirm();
  assert.equal(events[0].value.latitude, 32);
});
test('拖动开始即禁用旧选点确认；定位失败不丢原位置', async () => {
  const { page, events } = picker();
  page.onLoad({ latitude: '31.8', longitude: '117.2' });
  page.onRegionChange({ type: 'begin', detail: { causedBy: 'gesture' } });
  page.confirm();
  assert.equal(events.length, 0);
  assert.equal(page.data.candidate, null);
  page.onUnload();
  const failure = loadPage('location-picker', {
    '../../services/location': {
      createLocationService: () => ({ reverse: async () => '原地址' }),
      locate: async () => {
        throw new Error('拒绝定位');
      },
    },
  }).page;
  failure.onLoad({ latitude: '31.8', longitude: '117.2' });
  await failure.locate();
  assert.equal(failure.data.candidate.latitude, 31.8);
  assert.match(failure.data.error, /拒绝/);
});
test('定位请求晚于手工选点返回时保留手工位置', async () => {
  const location = deferred();
  const { page } = loadPage('location-picker', {
    '../../services/location': {
      createLocationService: () => ({ reverse: async () => '地址' }),
      locate: () => location.promise,
    },
  });
  page.onLoad({});
  const pending = page.locate();
  page.onMapTap({ detail: { latitude: 32, longitude: 118 } });
  location.resolve({ latitude: 31, longitude: 117 });
  await pending;
  assert.equal(page.data.candidate.latitude, 32);
  assert.equal(page.data.locating, false);
});
test('请求序号使失败和卸载回调同时失效', () => {
  const latest = new LatestRequest();
  const old = latest.begin();
  const newer = latest.begin();
  assert.equal(latest.isCurrent(old), false);
  assert.equal(latest.isCurrent(newer), true);
  latest.invalidate();
  assert.equal(latest.isCurrent(newer), false);
});

test('地图拖动后，迟到的定位结果不能把视野拉回去', async () => {
  const location = deferred();
  const { page } = loadPage('map', {
    '../../services/observations': {
      createObservationService: () => ({
        list: async () => ({ items: [], total: 0, nextCursor: '' }),
        setScenario() {},
        isMock: true,
      }),
    },
    '../../services/location': {
      createLocationService: () => ({ search: async () => [] }),
      locate: () => location.promise,
    },
  });
  page.onLoad();
  const original = page.data.latitude;
  const pending = page.locate();
  page.onRegionChange({ type: 'begin', detail: { causedBy: 'gesture' } });
  location.resolve({ latitude: 40, longitude: 116 });
  await pending;
  assert.equal(page.data.latitude, original);
  assert.equal(page.data.locationBusy, false);
  page.onUnload();
});

test('隐私提示只在用户同意或拒绝后完成授权，不自动同意', () => {
  let listener;
  const results = [];
  const { component, definition } = loadComponent('privacy-dialog', {
    onNeedPrivacyAuthorization(callback) {
      listener = callback;
    },
    getPrivacySetting({ success }) {
      success({ privacyContractName: '羽迹隐私保护指引' });
    },
  });
  definition.lifetimes.attached.call(component);
  listener((decision) => results.push(decision));
  assert.equal(results.length, 0);
  assert.equal(component.data.visible, true);
  assert.equal(component.data.contractName, '羽迹隐私保护指引');
  component.disagree();
  assert.equal(results[0].event, 'disagree');
  listener((decision) => results.push(decision));
  component.agree();
  assert.equal(results[1].event, 'agree');
  assert.equal(results[1].buttonId, 'location-privacy-agree');
  assert.equal(component.data.visible, false);
});

test('隐私指引未配置时提示错误，隐藏页面不弹出新授权', () => {
  let listener;
  const { component, definition } = loadComponent('privacy-dialog', {
    onNeedPrivacyAuthorization(callback) {
      listener = callback;
    },
    openPrivacyContract({ fail }) {
      fail();
    },
  });
  definition.lifetimes.attached.call(component);
  component.openContract();
  assert.match(component.data.error, /未配置/);
  definition.pageLifetimes.hide.call(component);
  listener(() => {});
  assert.equal(component.data.visible, false);
});
