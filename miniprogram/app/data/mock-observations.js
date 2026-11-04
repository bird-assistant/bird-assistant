// 手工合成的联调数据，不代表真实鸟讯。坐标为 GCJ-02 展示点。
const source = '羽迹 #14 合成演示数据（非真实观测）';
function record(id, speciesId, speciesName, latitude, longitude, observedAt, extra = {}) {
  return {
    id,
    speciesId,
    speciesName,
    displayLocation: { latitude, longitude },
    coordinateSystem: 'GCJ-02',
    sourceCoordinateSystem: 'GCJ-02',
    observedAt,
    placeName: '合肥 · 演示观察区域',
    visibility: 'public',
    anonymous: false,
    publicName: '示例鸟友',
    mediaType: 'photo',
    thumbnailUrl: '',
    updatedAt: '2026-10-29T10:00:00+08:00',
    source,
    locationNote: '演示展示坐标，不代表真实鸟类出现位置',
    ...extra,
  };
}
module.exports = [
  record('demo-public-01', 'demo-egret', '白鹭', 31.8206, 117.2272, '2026-10-29T08:40:00+08:00'),
  record(
    'demo-public-02',
    'demo-sparrow',
    '树麻雀',
    31.8208,
    117.2275,
    '2026-10-28T16:20:00+08:00',
    { anonymous: true, publicName: '' },
  ),
  record('demo-public-03', '', '', 31.8205, 117.2273, '2026-10-27T07:15:00+08:00', {
    mediaType: 'audio',
  }),
  record('demo-public-04', 'demo-egret', '白鹭', 31.838, 117.263, '2026-10-23T10:00:00+08:00', {
    placeName: '演示 · 湖畔',
  }),
  record('demo-public-05', 'demo-blackbird', '乌鸫', 31.794, 117.208, '2026-10-03T06:30:00+08:00', {
    placeName: '演示 · 林地',
    mediaType: 'none',
  }),
  record(
    'demo-private-01',
    'demo-sparrow',
    '树麻雀',
    31.824,
    117.231,
    '2026-10-29T07:00:00+08:00',
    { visibility: 'private' },
  ),
  record('demo-private-02', '', '', 31.813, 117.216, '', {
    visibility: 'private',
    mediaType: 'audio',
  }),
  record('demo-public-06', 'demo-blackbird', '乌鸫', 31.847, 117.204, '', {
    placeName: '演示 · 公园',
    anonymous: true,
  }),
];
