# CloudBase准备与部署 · 0.4.17

本轮完成未启用的`cloudfunctions/birdGateway`源码、独立锁文件和说明；客户端仍走现有HTTPS业务，没有云环境ID、云函数部署、数据库迁移或付费调用。社区业务继续管理账号、权限、鸟友、消息和投票。[完整操作合同（English）](en/CLOUDBASE-0.4.17.md)。

| 动作 | 固定上游 | 启用状态 |
| --- | --- | --- |
| writingCapabilities | GET /api/v1/journal/capabilities | 准备；线上仍404 |
| writingSuggestions | POST /api/v1/journal/suggestions | 服务端默认关闭 |
| socialInbox | GET /api/v1/community/inbox | 准备只读 |
| socialFriends | GET /api/v1/community/friends | 准备只读 |
| socialGroups | GET /api/v1/community/groups | 准备只读 |

SDK锁为`wx-server-sdk4.0.2`。逐次取得可信微信上下文，核对服务端配置AppID及OPENID，同时要求原业务Bearer；不从事件伪造用户、不自动创建另一套云账号／消息表。上游固定，不接受任意URL、方法、跳转或代理供应商密钥。业务权限／审核／限流仍执行。输入／响应2MiB，读12秒／写60秒，无自动重试；响应限额在读取后检查，部署层也应保留内存／上游边界。

## 维护者预发布步骤

1. 选择团队已有、关联真实AppID的预发布环境。保留原AppID、私有配置及现有函数规则；如本地工程根匹配，只在相应配置增加`cloudfunctionRoot: "cloudfunctions/"`。
2. 用支持全局fetch的Node22或24普通云函数运行时；以当前环境官方可选版本为准。函数目录独立运行`npm ci --ignore-scripts`，上传／部署`birdGateway`，入口`index.main`。初始内存256MiB，写作开启时超时至少65秒，预发布实测内存及冷启动。
3. 配置`BIRD_GATEWAY_APP_ID`。`BIRD_GATEWAY_ENABLE_WRITING`保持缺省／false；供应商密钥仍留原服务端配置，无需给该网关新密钥。
4. 只允许真实小程序SDK调用；不要给此身份处理器增加HTTP／定时／数据库触发器。官方实例复用文档提示混合调用时`getWXContext`可能残留；未来HTTP入口须另行设计。
5. 合并`security-rules.example.json`中该函数规则，不能整份覆盖既有环境。示例默认拒绝适合独立新环境；非匿名规则需在实际SDK环境验证，不兼容时调整预发布策略，不开放匿名绕过。
6. 真实SDK预发布核验：AppID／OPENID／业务会话、非白名单动作、双账号冷／热调用、上游401／404／超时／过大响应。控制台事件不等于SDK身份验收。先只读，线上写作路由存在后再明确开启生成验证。
7. 验收后才可接客户端`wx.cloud.init`和`callFunction`。每次请求只选一种传输，不在写作超时后自动回落重发；保留原文／照片，忽略账号切换后的迟到结果。

回退：客户端继续原HTTPS，关闭写作标志与该函数调用，保留上一个函数／规则版本；没有数据迁移，不删除集合。本轮纯处理器测试不证明真实SDK权限、网络、部署或计费。CloudBase不能修复业务404／405，仍须部署活动业务及代理。

[官方运行时](https://docs.cloudbase.net/en/cloud-function/runtime-support) · [访问控制](https://docs.cloudbase.net/cloud-function/security-rules) · [实例复用](https://docs.cloudbase.net/cloud-function/instance)，2026-11-28核验。
