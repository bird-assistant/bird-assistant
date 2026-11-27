# 本轮验证 / Verification

2026-11-25 · 当前0.4.6：客户端176通过；[本轮验收顺序与边界](docs/ACCEPTANCE-0.4.6.md)。只读ready不等于实际识别通过，新业务排序/出行仍待部署。

2026-11-25 · **当前0.4.5**：[原生交互与照片手帐](docs/NATIVE-AND-QWEN-0.4.5.md) / [English](docs/en/NATIVE-AND-QWEN-0.4.5.md)。按最新反馈修复关闭图标、抽屉透明底条与搜索边界；首次点击使用稳定 marker ID 并立即打开记录。照片翻面显示参数，交流集中在原讨论，来源地名中文化，导入可见卡片与独立识别、姓名头像，以及 Qwen 出行要点卡与照片生成手帐入口已实现。客户端162通过；本地后端468通过/55跳过，85.36%，Ruff通过。实际识别及发帖/回复为P0待验收；音频网络provider、真实照片Qwen、后端部署与个人页验收未被单元测试替代。下文旧检查点均为历史记录。

2026-11-25 · **0.4.3（历史）**：[地图、论坛与相机交互](docs/NATIVE-INTERACTION-0.4.3.md) / [English](docs/en/NATIVE-INTERACTION-0.4.3.md)。单记录圆点到近景才转针；缩放连续刷新、加载中可点标记；较小的浮动列表拖动时收缩并随视野更新，底部渐隐并保留原生署名。论坛加入飞鸟刷新、自有更多工具面板和拍摄信息卡；识别恢复半透明线索页签、上下滑动开合刻度与3.5倍快捷点，保留实际模型链。`npm run verify`140通过。手帐稳定后继续迭代；Qwen、真实发帖/回复与个人页评阅留到后续。后端与依赖未改，真机/SDK问题仍待验收。以下旧检查点保留历史含义。

2026-11-25 · **0.4.2**: [地图记忆、动态搜索与论坛回复](docs/FORUM-AND-SEARCH-0.4.2.md) / [English](docs/en/FORUM-AND-SEARCH-0.4.2.md)。客户端132通过；本地后端469通过/51跳过、覆盖率86.60%。原生设备、共享服务部署与真实Qwen仍待验收。以下旧版说明保留历史含义。

2026-11-24 · **0.4.1**: [地图首页与图片自由变形](docs/MAP-AND-PHOTO-0.4.1.md). 已同步团队 d59be67；客户端114项通过，合并后端461项通过/51项跳过。真实Qwen、Issue23完整观察卡和真机验收仍待完成。下文保留各版本的历史交接说明，以本段及新版说明为当前状态。

2026-11-24 · **0.4.0**: [手帐恢复、版式与Qwen业务接入](docs/JOURNAL-0.4.0.md) / [English](docs/en/JOURNAL-0.4.0.md). 本轮保留c6571c2的视觉/地图/社区接入；完整Issue23观察卡、真实Qwen部署及媒体/真机验收仍待完成。

2026-11-24续：Windows原输出102通过/0失败，但含未清理计时器/不完整wx模拟导致的诊断。现测试页卸载并等待保存完成；失败注入用例捕获/断言预期日志，生产日志保留。本工作区verify102通过且无operation-failed诊断，未据此宣称Windows修订版或原生验收。

以下为历史验证记录。

日期：2026-11-18（Asia/Shanghai）；客户端版本0.2.9。

## 已执行

环境：Linux 6.18.57 x86_64；Node.js 24.22.3；npm 11.9.0；TypeScript 6.0.3；微信API类型5.2.3。

| 检查 | 本轮结果 | 证据边界 |
| --- | --- | --- |
| 导出完整性 | 112个源文件（含46个PNG）逐文件Git blob哈希核对 | 原生运行源/测试/锁定依赖保持源检查点字节；忽略规则另加gallery |
| 资源 | 46个PNG解码/完整性检查，并人工查看资源总览 | 所有资源均为图标/示例插画，不是本轮原生布局或相机测试 |
| 依赖 | npm ci --ignore-scripts成功 | 只有锁定的TypeScript和微信类型开发依赖 |
| 本机配置 | npm run setup成功 | 生成touristappid模板；真实项目配置未提交 |
| 源码/结构 | npm run check通过 | 路由、配置、资源存在、事件处理器、标签平衡及运行时语法 |
| 类型 | npm run typecheck通过 | 使用固定CLI的Node16选项；旧DevTools读取的配置保持兼容 |
| 自动测试 | npm test：73通过、0失败、0跳过 | 纯函数、存储/媒体失败路径、模拟wx控制器、合同测试；不是设备E2E/识别准确率 |
| 发布内容检查 | 无本机配置、环境文件、依赖目录或生成JS；资源和源文件哈希核对 | 测试中的AppID形状值为固定合成夹具，不是项目身份 |

完整入口为 `npm run verify`；本轮直接使用真实恢复的资源文件运行，没有图片存在性替代器。npm提示的新版本/代理配置警告不是测试失败。

## 待验证

本环境未运行微信开发者工具或手机，不宣称本轮微信编译、相机/麦克风、选择器、真实文件跨重启、Canvas、安全区、合法域名、登录、云端和模型已经验收。请按照[接入说明](docs/INTEGRATION-STATUS.md)进行人工走查并附设备、系统/微信/DevTools版本、提交号和实际结果。

新增加的GitHub Actions检查仅覆盖客户端；提交后是否运行成功以PR显示为准。已有后端workflow不在本PR内修复；工作流未启动或平台账户问题不能推断为代码错误。

## English

The exported checkpoint passes source checks, type checking and all 73 automated tests on Node 24.22.3/Linux. All 46 packaged PNGs were restored and validated, and source hashes were checked. npm run verify used the actual files. Tests mainly use pure functions and mocked wx controllers; no native WeChat/phone, live service or model-accuracy acceptance is claimed. Follow the integration checklist and record device/version/commit evidence before marking the client ready.
