const { validPoint, inBounds } = require('./coordinates');

function shanghaiDate(value) {
  const milliseconds = new Date(value).getTime();
  return Number.isFinite(milliseconds)
    ? new Date(milliseconds + 8 * 3600000).toISOString().slice(0, 10)
    : '';
}

function dateWindow(period, now = Date.now()) {
  const days = { today: 1, week: 7, month: 30 }[period];
  if (!days) return { startDate: '', endDate: '' };
  const endDate = shanghaiDate(now);
  const startDate = new Date(Date.parse(`${endDate}T00:00:00+08:00`) - (days - 1) * 86400000);
  return { startDate: shanghaiDate(startDate), endDate };
}

function normalizeRecord(raw) {
  if (
    !raw ||
    typeof raw.id !== 'string' ||
    !raw.id ||
    raw.coordinateSystem !== 'GCJ-02' ||
    !validPoint(raw.displayLocation) ||
    !['public', 'private'].includes(raw.visibility)
  ) {
    throw new Error('观测数据格式或展示坐标系不正确，请联系接口负责人');
  }
  // 展示 DTO 使用白名单。公开匿名内容不接收 ownerId 等内部身份字段；
  // 后端必须独立执行所有权校验和敏感位置脱敏，前端不能替代它。
  const observedAt = typeof raw.observedAt === 'string' ? raw.observedAt : '';
  if (
    observedAt &&
    (!/(Z|[+-]\d{2}:\d{2})$/.test(observedAt) || !Number.isFinite(Date.parse(observedAt)))
  ) {
    throw new Error('观察时间必须为带时区的时间或未知');
  }
  return {
    id: raw.id,
    speciesId: typeof raw.speciesId === 'string' ? raw.speciesId : '',
    speciesName:
      typeof raw.speciesName === 'string' && raw.speciesName ? raw.speciesName : '待鉴定',
    observedAt,
    observedLabel: observedAt
      ? `${shanghaiDate(observedAt)} ${new Date(Date.parse(observedAt) + 8 * 3600000).toISOString().slice(11, 16)}`
      : '观察时间未知',
    displayLocation: { ...raw.displayLocation },
    coordinateSystem: 'GCJ-02',
    sourceCoordinateSystem: raw.sourceCoordinateSystem || 'GCJ-02',
    placeName: typeof raw.placeName === 'string' ? raw.placeName : '观察地点',
    visibility: raw.visibility,
    anonymous: raw.anonymous === true,
    publicName:
      raw.visibility === 'private'
        ? '仅自己可见'
        : raw.anonymous
          ? '匿名鸟友'
          : raw.publicName || '鸟友',
    mediaType: ['photo', 'audio', 'none'].includes(raw.mediaType) ? raw.mediaType : 'none',
    mediaLabel: { photo: '照片', audio: '录音', none: '无素材' }[raw.mediaType] || '无素材',
    thumbnailUrl:
      typeof raw.thumbnailUrl === 'string' && /^https:\/\//.test(raw.thumbnailUrl)
        ? raw.thumbnailUrl
        : '',
    source: typeof raw.source === 'string' ? raw.source : '来源未提供',
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
    locationNote: raw.locationNote || '仅展示接口提供的位置',
  };
}

function filterRecords(records, query) {
  return records
    .filter((record) => {
      const date = shanghaiDate(record.observedAt);
      return (
        inBounds(record.displayLocation, query.bounds) &&
        (query.scope !== 'public' || record.visibility === 'public') &&
        (query.scope !== 'mine' || record.visibility === 'private') &&
        (!query.speciesId ||
          (query.speciesId === '__unknown__'
            ? !record.speciesId
            : record.speciesId === query.speciesId)) &&
        (!query.startDate || (date && date >= query.startDate)) &&
        (!query.endDate || (date && date <= query.endDate))
      );
    })
    .sort((a, b) => (Date.parse(b.observedAt) || 0) - (Date.parse(a.observedAt) || 0));
}

function newestFirst(records) {
  return [...records].sort(
    (a, b) => (Date.parse(b.observedAt) || 0) - (Date.parse(a.observedAt) || 0),
  );
}

module.exports = { normalizeRecord, filterRecords, newestFirst, dateWindow, shanghaiDate };
