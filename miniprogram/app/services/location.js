const config = require('../config/local');
const { request } = require('./request');
const { validPoint } = require('../core/coordinates');

function createLocationService(settings = config, transport = request) {
  const isMock = settings.locationProvider === 'mock';
  function requireKey() {
    if (!settings.tencentMapKey) throw new Error('地点搜索尚未配置，仍可拖动地图或手动选点');
  }
  async function search(keyword, center) {
    if (!keyword.trim()) return [];
    if (!validPoint(center)) throw new Error('地图中心无效，请重试');
    if (isMock) {
      return ['演示公园', '演示湖畔', '合肥演示区域']
        .filter((title) => title.includes(keyword.trim()))
        .map((title, i) => ({
          id: `demo-poi-${i}`,
          title,
          address: '模拟地点服务，非真实搜索',
          latitude: center.latitude + i * 0.005,
          longitude: center.longitude + i * 0.005,
        }));
    }
    requireKey();
    const data = await transport({
      url: 'https://apis.map.qq.com/ws/place/v1/search',
      data: {
        key: settings.tencentMapKey,
        keyword: keyword.trim(),
        boundary: `nearby(${center.latitude},${center.longitude},10000,1)`,
        page_size: 10,
        page_index: 1,
      },
    });
    if (data.status !== 0 || !Array.isArray(data.data))
      throw new Error('地点搜索不可用，请检查 Key、额度和接口配置');
    return data.data
      .map((poi) => ({
        id: String(poi.id),
        title: poi.title,
        address: poi.address,
        latitude: poi.location.lat,
        longitude: poi.location.lng,
      }))
      .filter(validPoint);
  }
  async function reverse(point) {
    if (!validPoint(point)) throw new Error('所选位置无效');
    if (isMock) return '演示位置（模拟地址）';
    requireKey();
    const data = await transport({
      url: 'https://apis.map.qq.com/ws/geocoder/v1/',
      data: {
        key: settings.tencentMapKey,
        location: `${point.latitude},${point.longitude}`,
        get_poi: 0,
      },
    });
    if (data.status !== 0 || !data.result) throw new Error('地址解析暂不可用，仍可确认所选坐标');
    return data.result.address || '所选位置';
  }
  return { search, reverse, isMock };
}

function locate() {
  // 只在明确点击后申请权限；页面加载不请求定位。
  return new Promise((resolve, reject) => {
    const getLocation = () =>
      wx.getLocation({
        type: 'gcj02',
        success(result) {
          validPoint(result) ? resolve(result) : reject(new Error('定位结果无效，请手动选点'));
        },
        fail() {
          reject(new Error('定位未获授权或暂不可用，可继续搜索、拖动地图；也可到设置检查权限'));
        },
      });
    if (wx.requirePrivacyAuthorize) {
      wx.requirePrivacyAuthorize({
        success: getLocation,
        fail() {
          reject(new Error('尚未同意位置相关隐私授权，可继续手动浏览和选点'));
        },
      });
    } else getLocation();
  });
}
module.exports = { createLocationService, locate };
