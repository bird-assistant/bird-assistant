const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createObservationService } = require('../app/services/observations');
const { createLocationService, locate } = require('../app/services/location');
const { request } = require('../app/services/request');
const fixtures = require('../app/data/mock-observations');
global.getApp = () => ({ globalData: { accessToken: 'short-lived-test-token' } });
const query = {
  bounds: {
    southwest: { latitude: 31.7, longitude: 117.1 },
    northeast: { latitude: 31.9, longitude: 117.3 },
  },
  scope: 'public',
  speciesId: '',
  startDate: '',
  endDate: '',
  cursor: '',
  limit: 2,
};

test('Mock 分页在范围筛选后执行，错误和空态可重复验证', async () => {
  const service = createObservationService({ observationProvider: 'mock' });
  const first = await service.list(query);
  const second = await service.list({ ...query, cursor: first.nextCursor });
  assert.equal(first.total, 6);
  assert.equal(first.items.length, 2);
  assert.equal(new Set([...first.items, ...second.items].map((r) => r.id)).size, 4);
  service.setScenario('empty');
  assert.equal((await service.list(query)).total, 0);
  service.setScenario('error');
  await assert.rejects(service.list(query), /演示/);
});
test('业务适配传递视野、分页及短期凭证，约定接口不调用 GPU', async () => {
  let called;
  const service = createObservationService(
    { observationProvider: 'http', apiBaseUrl: 'https://example.test/' },
    async (options) => {
      called = options;
      return { items: [fixtures[0]], total: 1, nextCursor: '' };
    },
  );
  const result = await service.list(query);
  assert.equal(called.url, 'https://example.test/api/v1/map/observations');
  assert.equal(called.data.minLatitude, 31.7);
  assert.equal(called.data.scope, 'public');
  assert.equal(called.data.limit, 2);
  assert.equal(called.header.Authorization, 'Bearer short-lived-test-token');
  assert.equal(result.items[0].id, fixtures[0].id);
});
test('异常接口契约、过量分页和未配置网关明确报错', async () => {
  const service = createObservationService(
    { observationProvider: 'http', apiBaseUrl: 'https://example.test' },
    async () => ({ items: fixtures, total: 8 }),
  );
  await assert.rejects(service.list(query), /约定/);
  await assert.rejects(
    createObservationService({ observationProvider: 'http', apiBaseUrl: '' }).list(query),
    /业务网关/,
  );
});
test('未配置地点 Key 不伪造搜索成功，仍允许手动选点', async () => {
  let requests = 0;
  const service = createLocationService(
    { locationProvider: 'tencent', tencentMapKey: '' },
    async () => {
      requests += 1;
    },
  );
  await assert.rejects(service.search('公园', { latitude: 31.8, longitude: 117.2 }), /仍可拖动/);
  assert.equal(requests, 0);
});
test('腾讯搜索与逆解析参数和坐标响应正确，Key 不暴露到错误', async () => {
  const calls = [];
  const service = createLocationService(
    { locationProvider: 'tencent', tencentMapKey: 'test-client-key' },
    async (options) => {
      calls.push(options);
      return options.url.includes('geocoder')
        ? { status: 0, result: { address: '测试地址' } }
        : {
            status: 0,
            data: [{ id: 1, title: '公园', address: '合肥', location: { lat: 31.8, lng: 117.2 } }],
          };
    },
  );
  const result = await service.search('公园', { latitude: 31.8, longitude: 117.2 });
  assert.equal(result[0].latitude, 31.8);
  assert.equal(calls[0].data.boundary, 'nearby(31.8,117.2,10000,1)');
  assert.equal(await service.reverse(result[0]), '测试地址');
  const broken = createLocationService(
    { locationProvider: 'tencent', tencentMapKey: 'test-client-key' },
    async () => ({ status: 120 }),
  );
  await assert.rejects(
    broken.search('公园', result[0]),
    (error) => !error.message.includes('test-client-key'),
  );
});
test('隐私授权拒绝不调用定位；主动定位使用 gcj02', async () => {
  let locationCalls = 0;
  global.wx = {
    requirePrivacyAuthorize: ({ fail }) => fail(),
    getLocation: () => {
      locationCalls += 1;
    },
  };
  await assert.rejects(locate(), /隐私/);
  assert.equal(locationCalls, 0);
  global.wx = {
    getLocation(options) {
      assert.equal(options.type, 'gcj02');
      options.success({ latitude: 31.8, longitude: 117.2 });
    },
  };
  assert.equal((await locate()).longitude, 117.2);
  global.wx = { getLocation: ({ fail }) => fail() };
  await assert.rejects(locate(), /拖动地图/);
});
test('网络错误不回显含敏感配置的底层错误，HTTP 权限错误独立显示', async () => {
  global.wx = { request: ({ fail }) => fail({ errMsg: 'key=hidden' }) };
  await assert.rejects(
    request({ url: 'https://example.test' }),
    (error) => !error.message.includes('hidden'),
  );
  global.wx = { request: ({ success }) => success({ statusCode: 403 }) };
  await assert.rejects(request({ url: 'https://example.test' }), /权限/);
});
