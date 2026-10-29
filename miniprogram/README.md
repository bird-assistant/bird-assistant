# 羽迹微信小程序 · 地图模块

对应 [Issue #14：地图界面绘制](https://github.com/bird-assistant/bird-assistant/issues/14)。采用微信原生小程序，实现 P01 首页地图、P02 观察面板、P16 位置确认及 P28 权限/异常状态，沿用 v0.5 原型的浅绿、米白配色。

**当前是待设备验收的实现。** 底图使用微信原生 `<map>`；观测记录默认使用合成数据。腾讯地点搜索和逆地址解析已编写适配代码，但没有 AppID、Key、接口资格和开发者工具时，不能认定真实服务或真机已通过。本模块不提供账号、数据库、发布、上传和 AI 功能。

## 启动

开发检查需要 Node.js 20 或以上。小程序运行时不需要打包这些 npm 开发依赖。

```bash
cd miniprogram
npm ci --ignore-scripts
npm run setup
npm run check
npm test
```

`setup` 只复制缺失的本地配置，不会覆盖已经填写的内容：

- `project.config.json`：从 `project.config.example.json` 复制，填写团队小程序 AppID。
- `app/config/local.js`：从 `local.example.js` 复制，填写客户端地点 Key、数据模式等。

这两个文件及 `project.private.config.json` 已被 Git 忽略。不要把真实 Key、AppSecret、上传私钥、GPU 长期凭证提交到仓库。没有 Node 时，也可以手工复制上述两个文件，然后在微信开发者工具中导入工程。

安装[微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)后，导入 **`miniprogram/` 目录**，不是仓库根目录或 `app/`。默认 `touristappid` 仅用于尝试游客模式，不能替代团队 AppID，也不能用于真机验收。WSL 用户可通过 `wslpath -w "$PWD"` 查看 Windows 路径；若工具无法访问 WSL 路径，应在 Windows 可访问的工作目录中检出同一分支。

## 模式与配置

| 配置 | 默认 | 用途 |
|---|---|---|
| `observationProvider` | `mock` | 合成观测记录；改为 `http` 时调用待实现的统一业务网关 |
| `locationProvider` | `tencent` | 真实腾讯地点服务；`mock` 只用于无 Key 的交互测试 |
| `tencentMapKey` | 空 | 绑定小程序 AppID、限制使用范围的客户端 Key，禁止填写服务端密钥 |
| `apiBaseUrl` | 空 | HTTPS 业务网关；不是现有 FastAPI GPU 地址 |
| `initialView` | 合肥示例区域 | GCJ-02 浏览中心，不代表用户当前位置 |

`locationProvider: 'tencent'` 且未填 Key 时，搜索会显示配置缺失提示；手动浏览和手动选点仍可继续。切换为 `mock` 后，可搜索“演示”“公园”“湖畔”等示例词，页面会标注模拟地点服务。无论哪种数据模式，底图始终是原生地图，不用 SVG 冒充真实底图。

观测为 Mock 时，点击顶部“情景”可切换正常、无记录和请求失败，失败后切回正常再重试。数据来自 `app/data/mock-observations.js`，共 8 条合成记录，覆盖多地点、多日期、不同鸟种、待鉴定、匿名和私人标记。日期围绕 2026-10-29；后续演示请注意“今天/近 7 天”会随真实日期变化，“全部日期”始终可查。

## 开通真实地点能力

1. 由团队统一建立小程序，取得 AppID，将开发成员加入项目。先确认主体类目是否允许调用定位接口。
2. 在[腾讯位置服务控制台](https://lbs.qq.com/dev/console/key/manage)申请合适的客户端 Key，按平台要求启用微信小程序及 WebService 能力、绑定 AppID 并配置限制；不要把服务端签名密钥放进小程序。
3. 在小程序后台配置 `https://apis.map.qq.com` 为 request 合法域名。后续 HTTP 观测接口也需添加业务网关域名。
4. 配置小程序用户隐私保护指引，声明实际使用的位置数据及向腾讯地点服务传输的查询。确认 `getLocation` 的接口权限。工程已声明 `requiredPrivateInfos` 和位置权限用途，并提供隐私授权组件。
5. 在开发者工具和至少一台微信真机执行 [TESTING.md](TESTING.md)。不要通过关闭域名校验后的工具结果推导真机可用。

地图不会在打开页面时主动定位。用户点击“当前位置”后才走隐私/位置授权。拒绝时提供搜索、手动浏览、选点和权限设置入口。地点搜索会发送关键词和当前浏览中心；逆地址解析会发送选点坐标到腾讯。没有 Key 时不会发送地点请求。

官方参考：[地图组件](https://developers.weixin.qq.com/miniprogram/dev/component/map.html)、[定位接口](https://developers.weixin.qq.com/miniprogram/dev/api/location/wx.getLocation.html)、[地点搜索](https://lbs.qq.com/service/webService/webServiceGuide/webServiceSearch)、[逆地址解析](https://lbs.qq.com/service/webService/webServiceGuide/webServiceGcoder)。

## 页面与协作入口

| 路径 | 作用 |
|---|---|
| `app/pages/map/` | 地图、搜索、筛选、聚合、加载分页与会话内视野恢复 |
| `app/components/observation-sheet/` | 地点/聚合观察列表 |
| `app/pages/location-picker/` | 独立位置确认，取消不修改原值 |
| `app/pages/observation/` | 最小只读详情入口，验证记录 ID；后续可替换为团队完整详情页 |
| `app/services/` | 观测、腾讯地点、定位和 HTTP 适配 |
| `app/core/` | 日期、展示 DTO、坐标校验、聚合、请求序号 |

本轮没有复制或修改识别、视觉后端、论坛和收藏模块，也没有为缺失功能放置虚假的可用入口。识别模块接入时共用 `app.json` 和 `app.js`，再统一底部导航，避免另建平行小程序。

日期、鸟种筛选本轮对公开和私人标记同时生效；“我的标记”指当前用户的私人地图标记，公开副本仍在公开集合。以上口径在接真实业务接口前需由产品/后端共同确认。私人记录权限、匿名身份清理和敏感位置脱敏必须由后端实施。

## 接口与选点复用

观测接口为前端预留合同，**当前业务后端尚未实现**，详见 [接口交接](docs/INTEGRATION.md)。CloudBase 或统一网关二选一接入 `createObservationService`，不要并行搭建重复业务后端。

调用选点页时，可传现有 GCJ-02 坐标；未知时不传。页面初始浏览中心不会自动成为确认位置：

```js
wx.navigateTo({
  url: '/pages/location-picker/index',
  events: {
    locationConfirmed(point) {
      // 仅在用户明确确认后更新原表单；point 含坐标系和来源。
      // 使用页面实例的 setData 写入草稿，不在这里自动发布地图。
    },
  },
});
```

地图首页的“确认观察位置”用于演示该交接，结果仅在内存会话中保留。刷新进程会丢失，不显示为云端保存。

## 提交与验收

```bash
npm run check
npm run format:check
npm test
git diff --check
```

CI 使用锁文件安装开发依赖，检查 JavaScript、路由/事件/资源引用，并通过微信团队 `glass-easel` 的 WXML/WXSS 编译器检查模板与样式。自动化测试使用模拟平台 API，**不证明原生底图、真实地点服务、触摸交互、定位和设备兼容性通过**。实际结果及待补录屏清单见 [TESTING.md](TESTING.md)。

按仓库 README 使用任务分支和 PR；未完成真机与外部配置验收时保留 Draft，不关闭 #14，不标 Done。
