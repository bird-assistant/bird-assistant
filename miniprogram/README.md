# 羽迹原生微信小程序 · 0.4.15候选

R64：修复识别页变焦绑定编译错误；新增严格WXML验证及微信WCC／WCSC门禁，20份WXML／22份WXSS编译通过。此前360项绿色测试未能发现此回归。先npm ci再verify，仍需原生DevTools完整Compile。

[本轮交互与我的页修订](docs/INTERACTION-0.4.15.md) · [English](docs/en/README.md) · [下一步](docs/NEXT-STEPS.md)

基于团队最新main a6a3f88，保留PR27及队友的投票／采纳、鸟种选单、原图网关、懂鸟兜底、帧恢复与底栏动效。手帐改为原卡1秒长按、阻尼上下划、仅3卡挂载与自定义整页分享；修复定位／按钮／发现面板，开发我的分组、真实地点收藏、预览缓存保护清理和手机写作检查，完善私信群聊呈现及迟到回执保护。

在含package.json的外层miniprogram目录运行 `npm ci`、`npm run setup`、`npm run verify`，然后在现有DevTools工程完整Compile。setup保留已有AppID；新clone需开发者配置有效AppID。保留本机手帐、历史、草稿及原图。原Windows写作助手终端保持，手机使用线上HTTPS。

客户端**368通过，0失败／跳过**。66组源码布局投影无稳定帧溢出／面板越界；不是原生编译或FPS证据，仍需原生Compile和两台手机验收。本轮未部署、合并团队PR或上传体验版。最新只读线上检查：视觉200 ready、地点排序契约已更新；写作404／404、音频404。手机Qwen仍需维护者更新活动服务／代理，见修订交接。原生鉴权网络／null异常仍未定位。

代码在内层miniprogram/，验证和复现工具在tests/与scripts/。新证据见docs/INTERACTION-0.4.15.evidence.json；历史验收保留在原文档。团队交接用中文，英文工作说明及原48项／R系列均保留。
