const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeRecord,
  filterRecords,
  dateWindow,
  shanghaiDate,
  newestFirst,
} = require('../app/core/observations');
const { createMarkers } = require('../app/core/clusters');
const { inBounds } = require('../app/core/coordinates');
const fixtures = require('../app/data/mock-observations');
const records = fixtures.map(normalizeRecord);
const bounds = {
  southwest: { latitude: 31.7, longitude: 117.1 },
  northeast: { latitude: 31.9, longitude: 117.3 },
};
const query = { bounds, scope: 'all', speciesId: '', startDate: '', endDate: '' };

test('筛选以实际观察时间、上海日期为准，同时适用于私人记录', () => {
  const dates = dateWindow('today', Date.parse('2026-10-28T17:00:00Z'));
  assert.deepEqual(dates, { startDate: '2026-10-29', endDate: '2026-10-29' });
  const result = filterRecords(records, { ...query, ...dates });
  assert.deepEqual(
    result.map((item) => item.id),
    ['demo-public-01', 'demo-private-01'],
  );
  assert.deepEqual(
    filterRecords(records, { ...query, ...dates, scope: 'mine' }).map((item) => item.id),
    ['demo-private-01'],
  );
  assert.equal(shanghaiDate('2026-10-28T16:30:00Z'), '2026-10-29');
  assert.deepEqual(dateWindow('week', Date.parse('2026-10-29T00:00:00Z')), {
    startDate: '2026-10-23',
    endDate: '2026-10-29',
  });
});
test('范围、鸟种与未知鸟筛选组合，未知时间不冒充今天', () => {
  assert.equal(filterRecords(records, { ...query, scope: 'public' }).length, 6);
  assert.equal(filterRecords(records, { ...query, scope: 'mine' }).length, 2);
  assert.equal(filterRecords(records, { ...query, speciesId: '__unknown__' }).length, 2);
  assert.equal(
    filterRecords(records, { ...query, scope: 'mine', speciesId: 'demo-egret' }).length,
    0,
  );
  assert.equal(
    filterRecords(records, {
      ...query,
      bounds: {
        southwest: { latitude: 0, longitude: 0 },
        northeast: { latitude: 1, longitude: 1 },
      },
    }).length,
    0,
  );
  assert.equal(newestFirst(records).at(-1).observedAt, '');
});
test('坐标必须为展示 GCJ-02，保留来源标识但丢弃内部身份和原始位置', () => {
  const raw = { ...fixtures[1], coordinateSystem: 'WGS84' };
  assert.throws(() => normalizeRecord(raw), /坐标系/);
  assert.throws(() =>
    normalizeRecord({ ...fixtures[0], displayLocation: { latitude: 91, longitude: 117 } }),
  );
  assert.throws(
    () => normalizeRecord({ ...fixtures[0], observedAt: '2026-10-29T08:00:00' }),
    /时区/,
  );
  const safe = normalizeRecord({
    ...fixtures[1],
    ownerId: 'internal',
    userId: 'secret',
    originalLocation: { latitude: 31, longitude: 117 },
    sourceCoordinateSystem: 'WGS84',
  });
  assert.equal(safe.publicName, '匿名鸟友');
  assert.equal(safe.sourceCoordinateSystem, 'WGS84');
  assert.equal('ownerId' in safe, false);
  assert.equal('userId' in safe, false);
  assert.equal('originalLocation' in safe, false);
});
test('聚合仅合并公开记录，计数保留每条观察且私人不会混入', () => {
  const groups = createMarkers(records, 12);
  const cluster = groups.find((item) => item.members.some((r) => r.id === 'demo-public-01'));
  assert.ok(cluster.members.length >= 3);
  assert.equal(cluster.marker.callout.content, `${cluster.members.length} 条观察`);
  assert.equal(groups.filter((item) => item.key.startsWith('private:')).length, 2);
  assert.equal(groups.flatMap((item) => item.members).length, records.length);
  assert.equal(new Set(groups.map((item) => item.marker.id)).size, groups.length);
  const selected = createMarkers(records, 12, cluster.key).find((item) => item.key === cluster.key);
  assert.equal(selected.marker.width, 42);
});
test('视野可跨日期变更线，边界不依赖浏览器时区', () => {
  const crossing = {
    southwest: { latitude: -5, longitude: 170 },
    northeast: { latitude: 5, longitude: -170 },
  };
  assert.ok(inBounds({ latitude: 0, longitude: 179 }, crossing));
  assert.ok(inBounds({ latitude: 0, longitude: -179 }, crossing));
  assert.equal(inBounds({ latitude: 0, longitude: 0 }, crossing), false);
});
