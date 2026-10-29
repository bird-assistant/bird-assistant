const config = require('../config/local');
const fixtures = require('../data/mock-observations');
const { request, authHeader } = require('./request');
const { normalizeRecord, filterRecords } = require('../core/observations');

function createObservationService(settings = config, transport = request) {
  let scenario = 'normal';
  const mock = settings.observationProvider === 'mock';
  function setScenario(value) {
    if (mock) scenario = value;
  }
  function baseUrl() {
    if (!/^https:\/\//.test(settings.apiBaseUrl)) throw new Error('尚未配置 HTTPS 业务网关');
    return settings.apiBaseUrl.replace(/\/$/, '');
  }
  async function list(query) {
    if (mock) {
      const currentScenario = scenario;
      await new Promise((resolve) => setTimeout(resolve, 220));
      if (currentScenario === 'error') throw new Error('演示：观测请求失败，可切回正常后重试');
      const records =
        currentScenario === 'empty' ? [] : filterRecords(fixtures.map(normalizeRecord), query);
      const offset = Number(query.cursor || 0);
      return {
        items: records.slice(offset, offset + query.limit),
        nextCursor: offset + query.limit < records.length ? String(offset + query.limit) : '',
        total: records.length,
      };
    }
    const { southwest: sw, northeast: ne } = query.bounds;
    const payload = await transport({
      url: `${baseUrl()}/api/v1/map/observations`,
      header: authHeader(),
      data: {
        minLatitude: sw.latitude,
        minLongitude: sw.longitude,
        maxLatitude: ne.latitude,
        maxLongitude: ne.longitude,
        coordinateSystem: 'GCJ-02',
        scope: query.scope,
        startDate: query.startDate,
        endDate: query.endDate,
        speciesId: query.speciesId,
        cursor: query.cursor,
        limit: query.limit,
      },
    });
    if (
      !payload ||
      !Array.isArray(payload.items) ||
      payload.items.length > query.limit ||
      (payload.nextCursor != null && typeof payload.nextCursor !== 'string') ||
      !Number.isInteger(payload.total) ||
      payload.total < payload.items.length
    ) {
      throw new Error('观测接口响应不符合约定');
    }
    return {
      items: payload.items.map(normalizeRecord),
      nextCursor: payload.nextCursor || '',
      total: payload.total,
    };
  }
  async function detail(id) {
    if (mock) {
      const result = fixtures.find((item) => item.id === id);
      if (!result) throw new Error('记录不存在或已不可用');
      return normalizeRecord(result);
    }
    const payload = await transport({
      url: `${baseUrl()}/api/v1/map/observations/${encodeURIComponent(id)}`,
      header: authHeader(),
    });
    return normalizeRecord(payload);
  }
  return { list, detail, setScenario, isMock: mock };
}
module.exports = { createObservationService };
