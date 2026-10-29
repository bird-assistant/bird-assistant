function validPoint(point) {
  return (
    point &&
    Number.isFinite(point.latitude) &&
    Number.isFinite(point.longitude) &&
    Math.abs(point.latitude) <= 90 &&
    Math.abs(point.longitude) <= 180
  );
}

function inBounds(point, bounds) {
  if (!validPoint(point) || !bounds) return false;
  const { southwest: sw, northeast: ne } = bounds;
  const longitudeInRange =
    sw.longitude <= ne.longitude
      ? point.longitude >= sw.longitude && point.longitude <= ne.longitude
      : point.longitude >= sw.longitude || point.longitude <= ne.longitude;
  return point.latitude >= sw.latitude && point.latitude <= ne.latitude && longitudeInRange;
}

function boundsAround(view) {
  // 仅用于原生 MapContext 就绪前的首屏请求；就绪后使用真实视野。
  const span = 180 / 2 ** (view.scale - 2);
  const wrap = (value) => ((value + 540) % 360) - 180;
  return {
    southwest: {
      latitude: Math.max(-90, view.latitude - span),
      longitude: wrap(view.longitude - span),
    },
    northeast: {
      latitude: Math.min(90, view.latitude + span),
      longitude: wrap(view.longitude + span),
    },
  };
}

function project(point, scale) {
  const size = 256 * 2 ** scale;
  const sin = Math.sin((Math.min(85, Math.max(-85, point.latitude)) * Math.PI) / 180);
  return {
    x: ((point.longitude + 180) / 360) * size,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size,
  };
}

module.exports = { validPoint, inBounds, boundsAround, project };
