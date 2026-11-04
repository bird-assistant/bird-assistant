const { project } = require('./coordinates');

function createMarkers(records, scale, selectedKey = '') {
  const groups = new Map();
  records.forEach((record) => {
    const p = project(record.displayLocation, scale);
    // 私人记录单独显示，绝不混入公开聚合数。
    const key =
      record.visibility === 'private'
        ? `private:${record.id}`
        : `public:${Math.floor(p.x / 52)}:${Math.floor(p.y / 52)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  });
  return [...groups.entries()].map(([key, members], index) => {
    const isPrivate = members[0].visibility === 'private';
    const selected = key === selectedKey;
    const longitude = members[0].displayLocation.longitude;
    const latitude =
      members.reduce((sum, item) => sum + item.displayLocation.latitude, 0) / members.length;
    return {
      key,
      members,
      marker: {
        id: index + 1,
        latitude,
        longitude,
        iconPath: isPrivate ? '/assets/marker-private.png' : '/assets/marker-public.png',
        width: selected ? 42 : 34,
        height: selected ? 48 : 40,
        anchor: { x: 0.5, y: 1 },
        callout: {
          content:
            members.length > 1
              ? `${members.length} 条观察`
              : isPrivate
                ? '我的标记'
                : members[0].speciesName,
          display: members.length > 1 || selected ? 'ALWAYS' : 'BYCLICK',
          color: isPrivate ? '#42617b' : '#285c49',
          bgColor: '#fffef9',
          borderRadius: 12,
          padding: 8,
          fontSize: 12,
        },
      },
    };
  });
}

module.exports = { createMarkers };
