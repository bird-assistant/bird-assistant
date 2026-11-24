# 羽迹原生微信小程序 · 0.4.1

2026-11-24 · **0.4.1**: [地图首页与图片自由变形](docs/MAP-AND-PHOTO-0.4.1.md). 已同步团队 d59be67；客户端114项通过，合并后端461项通过/51项跳过。真实Qwen、Issue23完整观察卡和真机验收仍待完成。下文保留各版本的历史交接说明，以本段及新版说明为当前状态。

2026-11-24 · **0.4.0**: [手帐恢复、版式与Qwen业务接入](docs/JOURNAL-0.4.0.md) / [English](docs/en/JOURNAL-0.4.0.md). 本轮保留c6571c2的视觉/地图/社区接入；完整Issue23观察卡、真实Qwen部署及媒体/真机验收仍待完成。

当前开发版本 **0.3.0**：[手帐构图/性能/Qwen设置](docs/JOURNAL-0.3.0.md) · [给识别负责人的交接合同](docs/RECOGNITION-HANDOFF.md)。一/双图优先，滑杆局部预览；Qwen客户端与服务端适配已写，真实网关/凭证和真机验收仍待配置。下面0.2.9交接说明保留其基线含义。

[English](docs/en/README.md) · [验证记录](TESTING.md) · [接入与地图协作边界](docs/INTEGRATION-STATUS.md)

五个原生 Tab 包括首页示意地图、识别采集与复核、手帐编辑、讨论和个人页。

**视觉识别** 已接入云端 YOLO 与 BioCLIP。开发者工具可以用 WSL 隧道运行，手机使用项目域名与微信登录。见 [视觉联调说明](docs/VISION.md)。

## 克隆后运行

环境：Node.js 22.18+ 或24；本轮在Linux x86_64、Node 24.22.3、npm 11.9.0核对。开发者工具参考版本Stable 2.02.2608040，模板基础库3.17.1；手机与平台能力仍需实际验收。

1. 克隆团队仓库并进入其中的 **miniprogram工程目录**：`cd miniprogram`。
2. 安装锁定的开发依赖：`npm ci`。
3. 生成本机配置：`npm run setup`。已有配置不会被静默覆盖；没有配置时使用touristappid占位。
4. 运行检查：`npm run verify`。
5. 微信开发者工具导入 **团队仓库/miniprogram/**，即包含package.json和生成的project.config.json的目录。
6. 在工具中选项目管理员提供的有效AppID，并确认自己已被添加为开发者。测试号/游客环境不能代替体验版或真机权限验收。AppSecret不用于前端配置。

注意这里有两层同名目录：外层miniprogram是工程根，内层miniprogram是实际打包根。不要把团队仓库最外层、内层打包根或浏览器原型目录当作本工程的导入目录。脚本输出中的“root”指本小程序工程根。

本机project.config.json、project.private.config.json、node_modules、生成JS、.test-build、.env、gallery与密钥文件不提交。正式AppID可在工具中填写，或按setup脚本要求提供真实wx格式AppID；不要把示例/占位文本原样当作AppID。

## 当前能力

| 模块 | 已有源码 | 仍待接入/验收 |
| --- | --- | --- |
| 首页 | 示意地图拖动/缩放/聚合、搜索、区域和详情面板 | 原生真实地图与地点API、实际定位、公开鸟讯与权限 |
| 识别 | 照片分析、实时框与多目标候选、微信视觉鉴权、原生变焦、按素材复核与私人保存 | 鸟声推理、手机相机验收 |
| 手帐 | 选材/日期筛选、比例布局、文字/图片/背景、裁剪旋转、撤销、本机保存与Canvas导出 | 原生导出验收、跨重启未保存恢复、云端版本、ASR/文案 |
| 讨论 | 示例阅读/互动、本机发帖草稿、写作请求准备 | 真实发布/回复/会话链、时间排序、账号与审核 |
| 我的 | 本机资料/头像裁剪、观察历史、收藏、排除示例的统计 | 微信身份、跨设备同步、稳定分类ID及真实数据检索 |

客户端自动测试覆盖纯逻辑、存储、异常和模拟 wx 控制器。手帐撤销仅保留当前编辑会话，保存卡打开最后一次显式保存的文档。

## 代码入口

- `miniprogram/app.*`：五Tab应用壳；页头和自定义Tab栏位于components和custom-tab-bar。
- `miniprogram/pages/{home,identify,journal,community,profile}/`：各页WXML/WXSS/TypeScript及配置。
- `miniprogram/services/`：本机仓库、媒体持久化、观察情境、地图/变焦、手帐/裁剪/Canvas、数值及识别合同。
- `tests/`、`scripts/`：验证与本机配置准备。
- `project.config.template.json`：跟踪的占位模板；`tsconfig.json`保留旧DevTools能读的选项，现代CLI参数在package.json中指定。
- `docs/SOURCE-CHECKPOINT.json`：源检查点及逐文件Git blob哈希。

0.2.9原生运行代码、测试和锁定依赖按源检查点原样带入；不导入独立私有仓库的Git历史、个人开发日志、截图或其他项目资料。说明、CI、资源校验和本机忽略规则用于团队交接。

## 后续协作

按团队README从最新main建任务分支、PR评阅，不直接改main。#17原生地图仍是独立草稿，工程布局与本检查点不同；在负责人对齐之前，不把两套package.json/页面直接叠加。下一阶段复用已合并的识别服务，并共同确认身份、媒体、未知观察及地图查询合同。详见[接入说明](docs/INTEGRATION-STATUS.md)。
