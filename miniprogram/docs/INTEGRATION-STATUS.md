# 接入状态与地图协作边界 / Integration status

2026-11-24 · **0.4.1**: [地图首页与图片自由变形](MAP-AND-PHOTO-0.4.1.md). 已同步团队 d59be67；客户端114项通过，合并后端461项通过/51项跳过。真实Qwen、Issue23完整观察卡和真机验收仍待完成。下文保留各版本的历史交接说明，以本段及新版说明为当前状态。

2026-11-24 · **0.4.0**: [手帐恢复、版式与Qwen业务接入](JOURNAL-0.4.0.md) / [English](en/JOURNAL-0.4.0.md). 本轮保留c6571c2的视觉/地图/社区接入；完整Issue23观察卡、真实Qwen部署及媒体/真机验收仍待完成。

2026-11-23 更新。照片和实时取景均已接入云端 GPU 服务，微信短期凭证、候选复核和按素材保存已实现。联调入口与真机配置见 [视觉联调说明](VISION.md)。下文保留 2026-11-18 的交接记录。

本PR是当前原生源码交接，不是完整联调完成声明，不自动关闭 #12/#14/#20。后端文件和已有模型/业务接口不修改。

## 可以直接评阅/运行的部分

- 五Tab、共用页头/Tab栏、明确的示例状态。
- 图片、视频、音频采集/导入的原生调用与素材复核/保存状态机。
- 本机资料、观察、收藏、手帐和帖子草稿，存储失败时保留可恢复输入的路径。
- 示例地图交互、手帐模型/裁剪/导出、相机变焦和按素材独立的手动观察情境。
- 照片/录完音频的合同解析/可取消协调器及对应测试；尚未安装网络transport。

## 已有后端如何对接

团队#18音频、#19照片/业务服务已合并。现客户端Analyse仍明确显示尚未接入；不配置URL/长期服务密钥，不发推理请求。后续必须共同确定：

1. 公网HTTPS/WSS入口、模型就绪和错误合同。
2. 微信会话→内部用户ID→短期凭证；服务端对象所有权检查。不能用所有用户共享的长期API Key替代用户隔离。
3. 原始媒体保存、上传副本、私人观察的引用与分阶段成功状态。
4. 待鉴定、手动标签、无分析ID、未知日期/地点的业务保存合同；当前业务接口要求分析ID+物种，observed_at缺省服务器当前时间，不能直接用于未知历史照片。
5. 同分析同物种重试去重与多目标/多素材的观察身份；不把聚合或视觉track_id当稳定观察ID。
6. 公开鸟讯/附近查询、坐标系和脱敏的展示字段；私人观察CRUD不等于地图列表合同。
7. 社区发布、地图副本、私人原件和手帐成品的独立权限/更新/撤回语义。

未知信息默认保持未知；模型候选、用户选择和社区建议应分开。图像/声音结果不默认融合，不把匹配分数写成“正确率”。

## 与原生地图PR #17的关系

#17仍是Draft：[原生地图实现](https://github.com/bird-assistant/bird-assistant/pull/17)，对应#14。已有地点适配、选点、观察面板和拟议查询合同应继续利用；本次不改其分支、不宣布它被替代或已经验收。

| 布局 | 本检查点 | #17 |
| --- | --- | --- |
| 工程根 | miniprogram/ | miniprogram/ |
| 运行根 | miniprogram/miniprogram/ | miniprogram/app/ |
| 页面 | TypeScript五Tab，home为示意地图 | JavaScript原生map/location-picker/observation |
| 配置 | project.config.template.json生成本机配置 | project.config.example.json与独立package配置 |
| 服务 | 本地模型/持久化，识别网络未接 | 腾讯地点适配与待确认的HTTP观察查询 |

两PR在工程README和package/lock等文件会重叠；即使Git能合并，也不表示可以直接保留两份App入口。组内应先确定规范运行根，再迁移地图服务、组件、选点/详情路由及测试，把地图接入现有Home，并处理导航/生命周期/数据合同。不要通过覆盖package.json或当前Home来“解决”整合。

SRS使用高德边界、#14选择腾讯；试点资料也有合肥与北京差异，需负责人对齐后更新样本。这里只记录冲突，不单方面改提供方或团队范围。

## 真实平台仍需验收

- 从干净克隆生成配置、DevTools编译、五页及不同屏幕/字号。
- 真实照片、录像、录音、选择器取消、权限拒绝、切后台和变焦能力。
- 本机文件保存后重启、空间不足、保存/导出失败与重试。
- 真实候选或unknown、取消/超时/乱序响应、跨用户隔离、服务不可用仍可私人保存。
- 地图真实搜索/定位/拖动/过滤/返回和敏感公开字段。
- 手帐原生Canvas输出与编辑预览一致。

## English handoff summary

The client source is usable for local review but live uploads, identity, original-media/cloud persistence, real map services, public posting and writing/ASR remain disconnected. Team photo/audio services are available in source; reachability and phone acceptance are separate. Unknown/manual records and old-photo capture context cannot be forced into the current analysis/species-required business contract.

PR #17 and this snapshot share a project directory but use different app roots, language/layout and package configuration. Preserve the map work and agree one canonical root, then migrate modules and routes with tests. This handoff does not edit another contributor's branch, merge their work, close related issues, or change the backend.
