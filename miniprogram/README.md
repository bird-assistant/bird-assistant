# 当前：0.4.20上传基线与独立0.4.21评审候选

本轮修复地图涟漪整数线宽、启动同步读取、随手记过大列表载荷；新增窗口感知的笔记双栏、滚动／草稿／返回规则，修正页头旋转与零状态栏／无胶囊场景。独立CloudBase收藏副本源码已补齐，SDK审计0告警；并不依赖队友业务服务器，但尚待真实环境ID／类型、绑定与合法部署权限。

[工程评审与控制台分类](ENGINEERING-REVIEW-0.4.21.md) · [窗口／返回设计](WORKSPACE-NAVIGATION-0.4.21.md) · [CloudBase开通与边界](CLOUDBASE-VAULT-0.4.21.md)。475项客户端测试、25 WXML／27 WXSS编译，另4项离线SDK检查；38窗口×18状态=684投影，另152窗格专项。原生Compile、键盘／折叠、地图鉴权／passive错误及云端双账号权限仍待验。

用户计划上传的0.4.20已冻结为release/experience-0.4.20，未代确认上传；原fix候选运行时保持0.4.20。本轮是新feat/engineering-review-0.4.21分支，未改团队PR#30／业务服务器、未部署／付费。保留原48项与R01–R108，新增R109–R116；私人英文计划持续在GitHub docs/NEXT-STEPS.md。

---

# 羽迹微信小程序 ·0.4.20日期与资料保护候选

[本轮修复、备份操作与复测](docs/CACHE-SAFETY-0.4.20.md) · [English](docs/en/CACHE-SAFETY-0.4.20.md) · [当前英文工作计划](https://github.com/NoctisBaguette/bird-assistant-miniprogram/blob/main/docs/NEXT-STEPS.md)

日期控件统一水平排版，实心绿色地图收藏改白边；收藏／手帐使用校验保护文件，新增含原照片及撤销历史的备份／合并恢复。**全微信数据清除仍需先把备份另存到微信之外；应用内清理不会删除原件。**

458客户端测试通过，24 WXML／26 WXSS编译，240源码布局投影通过；原生Compile／文件交接与真机恢复待验。用户选择继续暂停服务器工作。0.4.18冻结体验版与团队PR#30保持不变；本轮未代上传。原48项与R01–R104保留，新增R105–R108。

---

# 羽迹微信小程序 ·0.4.19社区与随手记候选

已上传0.4.18保留冻结分支，团队PR #30已进入审查；本分支是待原生验收的下一轮候选。

[本轮内容／复测](docs/COMMUNITY-WORKBENCH-0.4.19.md) · [社交与媒体设计](docs/SOCIAL-CLIENT-0.4.19.md) · [可操作的离线设计预览](docs/design/social-controls-0419.html) · [原0.4.18交接](docs/EXPERIENCE-0.4.18-HANDOFF.md)

新增本机随手记、按账号隔离的私信／回复草稿与安全重试、鸟友号／群抽屉、公开帖转发确认、资料库书签与翻页、外部鸟讯图卡／日期、公开图鉴照片缓存及真实成长展示；手帐标题下方祥云鸟影，长按去常驻绿边。

客户端446通过；23 WXML／25 WXSS编译。原生触摸／权限／帧率和双账号联调仍待验收。保留AppID、私有配置、本机数据和Windows助手环境。按最后指示，服务端、凭据、部署与CloudBase保持未变；原48项与R01–R90保留，新增R91–R104。

[English](docs/en/COMMUNITY-WORKBENCH-0.4.19.md) · [当前计划](docs/NEXT-STEPS.md)
