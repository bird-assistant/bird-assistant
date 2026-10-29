// 复制为 local.js（npm run setup），只在本地填写，不提交真实 Key。
module.exports = {
  observationProvider: 'mock', // mock 或 http；真实业务接口尚未实现
  locationProvider: 'tencent', // tencent 或 mock；mock 仅用于交互测试
  tencentMapKey: '', // 仅填写绑定小程序 AppID、受限的客户端 Key；禁止服务端密钥
  apiBaseUrl: '', // 统一业务网关 HTTPS 地址，不是 GPU 服务
  // 默认浏览合肥；这不是用户当前位置。
  initialView: { latitude: 31.8206, longitude: 117.2272, scale: 12 },
};
