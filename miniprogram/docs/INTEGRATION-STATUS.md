# 当前候选0.4.20：日期与缓存资料保护

新建手帐、首页与筛选统一横排日期按钮；实心绿色地图收藏改白边。收藏地点／手帐迁移到校验的本机用户文件保护副本，应用内清理仅清衍生缓存；新增「我的 → 本机备份与恢复」，包含当前和撤销历史中的原照片，恢复时合并、冲突留副本。

**微信清除全部小程序数据仍可能删除本机文件，必须先另存完整备份到微信之外。** 不能恢复之前没有备份且已经被全部清除的资料。[操作、边界与复测](CACHE-SAFETY-0.4.20.md)。458项通过，24 WXML／26 WXSS编译；30屏幕 × 8状态 = 240布局投影通过。原生Compile、文件选择／分享与真机恢复待验。

用户选择继续暂停服务器／CloudBase工作；原48项及R01–R104保留，新增R105–R108。0.4.18冻结体验版与团队PR #30不混入本轮。下面旧版本为历史；[私人英文当前计划](https://github.com/NoctisBaguette/bird-assistant-miniprogram/blob/main/docs/NEXT-STEPS.md)持续更新。

---

# 接入状态与地图协作边界 / Integration status

2026-11-26 · **当前：0.4.8已反馈，0.4.9修复候选**。见[导入校验、素材边框、翻面及固定页头](IMPORT-AND-SHEETS-0.4.9.md)。本地客户端257通过；U01由用户确认通过，R13重开。团队[issue25](https://github.com/bird-assistant/bird-assistant/issues/25)已补实际POST404证据；仍需维护者部署/复核写作路由。没有部署或代发模型请求。以下版本状态与计数均为历史检查点。

2026-11-26 · **当前：0.4.7已真机反馈，0.4.8修复候选**。见[逐项处理与复测](PHONE-FEEDBACK-0.4.8.md)。手帐public suggestions404而trip-plan405；共享Qwen配置与业务部署分别处理。客户端243通过；本地后端515通过/51跳过、87.46%。本轮未部署或调用收费模型；以下旧版安装/服务状态仅作历史。

2026-11-26 · 用户现已同意切换最新版；[更新步骤与当前执行计划](NEXT-STEPS.md)取代此前“暂不更新0.4.6”的安排。最后确认的安装仍为0.4.6，0.4.7待用户更新/verify/编译后确认；先本地UI/草稿，再按各服务就绪状态分别验收。

2026-11-26 · **追加评阅候选**：[本轮完整变化与验收](SPRINT-2026-11-26.md) / [English](en/SPRINT-2026-11-26.md)。本机白名单EXIF、公开图片保存、音频实际网络接入/移动会话、关联公开鸟讯的社区经验检索、手帐/论坛国内ASR预览确认及录音/回听生命周期已进源码。客户端229通过，后端本地507/51、87.41%，Ruff通过；锁环境CI另查。07:17:56北京时间只读结果仍视觉502、音频404，新地点排序未生效。ASR默认关闭；真实BirdNET本地CPU小样本和签名会话ASGI上传见[验证报告](AUDIO-VALIDATION-2026-11-26.md)，不能替代真机/公网。没有部署、付费Qwen/ASR调用或更新当前0.4.6。以下旧记录保留历史含义，不把历史“未接入”或“ready”当作当前事实。

2026-11-26 · **当前验收基线仍为0.4.6**：[完整用户待办与状态](BACKLOG.md)。用户确认注册、进入相机、导入04鸟图；实际模型结果被共享视觉接口Caddy502阻断，名录200/观察401仍响应。0.4.7布局/连接候选在独立评阅分支，尚未更新用户测试版本或部署。历史ready快照不代表当前就绪，Qwen、社区、个人页与适配仍按清单继续。

2026-11-25 · **当前0.4.6**：[地点建议、导入多选与验收](ACCEPTANCE-0.4.6.md) / [English](en/ACCEPTANCE-0.4.6.md)。修复抽屉标题基线、动态三行搜索、独立赞收藏、深层对比和照片翻面提示；导入多选逐份分析、音频原文件名、按账号本机咨询记录及命名地图地点/生境建议。客户端176通过，视觉公网只读ready；距离排序和新出行响应仍需部署本轮业务服务。实际识别与发帖回复为P0待验收，先微信登录冒烟，再识别、社区、Qwen照片手帐、个人页/适配，最后整体动效。下文旧版记录保留历史含义。

2026-11-25 · **0.4.5（历史）**：[原生交互与照片手帐](NATIVE-AND-QWEN-0.4.5.md) / [English](en/NATIVE-AND-QWEN-0.4.5.md)。按最新反馈修复关闭图标、抽屉透明底条与搜索边界；首次点击使用稳定 marker ID 并立即打开记录。照片翻面显示参数，交流集中在原讨论，来源地名中文化，导入可见卡片与独立识别、姓名头像，以及 Qwen 出行要点卡与照片生成手帐入口已实现。客户端162通过；本地后端468通过/55跳过，85.36%，Ruff通过。实际识别及发帖/回复为P0待验收；音频网络provider、真实照片Qwen、后端部署与个人页验收未被单元测试替代。下文旧检查点均为历史记录。

2026-11-25 · **0.4.4（历史）**：[导航、聚合与摄影交互修复](NATIVE-INTERACTION-0.4.4.md) / [English](en/NATIVE-INTERACTION-0.4.4.md)。0.4.3未通过用户原生验收。本轮修复十层导航栈耗尽、使用缩放事件视野并增加屏幕距离聚合；抽屉到底栏、上渐隐并说明收录排序；自定义下拉飞鸟、摄影参数手填与旧接口兼容、地图副本关系/位置精度说明及相机双模块收放。客户端153通过；后端本地467通过/55跳过、85.36%。原生设备、SDK鉴权与业务部署仍需验收，Qwen与后续云端/适配继续排后。以下旧检查点保留历史含义。

2026-11-25 · **0.4.2**: [地图记忆、动态搜索与论坛回复](FORUM-AND-SEARCH-0.4.2.md) / [English](en/FORUM-AND-SEARCH-0.4.2.md)。客户端132通过；本地后端469通过/51跳过、覆盖率86.60%。原生设备、共享服务部署与真实Qwen仍待验收。以下旧版说明保留历史含义。

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
