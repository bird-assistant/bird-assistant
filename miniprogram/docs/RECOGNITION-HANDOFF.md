# 给识别模块负责人的交接约定

2026-11-20 · contract `bird-recognition/1` · 对应 #12/#20。这是新增模块接缝，不表示真实识别已经接入。已有接口解析与fixtures继续使用，不另造第二份后台协议。

## 分工与最小交付

周厚霖维护DevTools工程、五Tab、相机/导入和复核页面、手帐。刘同学可在独立Git工作副本开发/测试服务适配，不必同时操作同一个DevTools目录。

如果交付的是后端服务而非小程序适配器，请提供同一HTTP合同、版本和真实响应样例，由页面负责人封装Transport；不要求把Python模型搬进小程序。

建议交付路径（相对于团队仓库）：

- `miniprogram/miniprogram/integrations/recognition-liu.ts`：导出 `RecognitionProvider`，保持UI无关。
- `miniprogram/tests/recognition-liu.test.cjs`：正常、unknown、失败、取消/晚到回调；命令行可跑。
- 脱敏真实响应样例与README：接口/模型/名录版本、限制、鉴权方式、环境配置、已测平台及未完成项。

请从团队当前main建功能分支，保留依赖锁和现有解析层；不要交整套覆盖工程，不直接改app、journal或其他Tab。需要改变识别页面时先给状态/事件接口或独立组件，再由页面负责人装配；不是禁止并行开发，而是避免共同修改同一入口。

## 安装点与输入

客户端唯一注册点：`miniprogram/services/recognition-provider.ts`。它不读URL、不初始化相机、不登录、不写观察、不自动发网络请求。安装时交给 `installRecognitionProvider`：

- `contract: 'bird-recognition/1'`
- `kinds: ['photo']`（实际支持音频后才加audio）
- `createTransport(): RecognitionTransport`

页面负责人显式调用 `recognizeWithProvider({kind:'photo', filePath, reference, sample:false})`。`reference`是本次素材/尝试的唯一引用，不能拿临时数组下标当身份。返回 `{result: Promise<RecognitionResult>, cancel()}`；页面负责保存当前素材ID/请求代号，切素材、返回、取消或卸载后不应用旧结果。

底层 `RecognitionTransport.upload(request, success, fail)` 返回 `{abort()}`。已有 `recognition.ts`负责multipart字段选择、响应解析、安全错误、取消后只结算一次及忽略晚到回调。适配器负责HTTPS、原生超时、业务会话、上传域名和真实底层abort，不重新实现解析或UI。

## 已有协议不得随意改名

| 输入/响应 | 约定 |
| --- | --- |
| 单张照片 | `POST /api/v1/vision/analyses`，multipart字段 `image` |
| 完成的音频（可选） | `POST /api/v1/audio/analyses`，字段 `audio` + `client_reference` |
| HTTP 200 | `analysis_id/state/candidates/subjects/model/policy`，按现有parser/fixtures |
| candidate / unknown | unknown是有效推理结果，不能伪装网络失败或强行选第一项 |
| 多鸟目标 | 保留独立subject、bbox和候选；不把同种目标压成一条 |
| 模型分数 | 保留score与score_type，展示不是“正确率”；用户选择另存 |
| 错误 | HTTP状态 + `{error:{code,request_id}}`；不把调试详情/服务密钥显示给用户 |
| 凭证 | 小程序只用用户会话/短期凭证；不提交或打包GPU长期Key |

现有测试样例：`tests/fixtures/recognition.json`；运行 `npm ci`、`npm run setup`、`npm run verify`。不能靠只有接口成功或mock通过宣称手机全流程已验收。

## 接入验收

用实际照片验证候选、unknown、无鸟/多目标；再测取消后回调、快速换素材、重复点击、超时/401/429/503、重试不重复写记录。失败/无候选/取消不删除原图与笔记。提交实际设备、系统/微信/基础库、模型/名录/提交、接口版本和录屏。

本合同只覆盖单张照片/录完音频。实时视觉仍遵循现有会话/WebSocket合同，后续作为单独能力交付；不把MP4直接交图片接口，不借此次接缝取消SRS实时P0。保存、用户身份、原件、地图公开与社区发布仍由各自业务合同负责。

## English summary

The UI owner maintains the DevTools shell and capture/review pages. Deliver a UI-independent `RecognitionProvider` with contract `bird-recognition/1`, explicit supported kinds and a factory for the existing `RecognitionTransport`. Reuse the parser, upload contracts and fixtures; supply tests and sanitized real examples instead of a replacement app. Installation is explicit, unconfigured by default and starts no networking. Cancellation, stale request ownership, original preservation, candidate/unknown semantics, per-subject results and score meaning are required. Photos are this handoff's minimum; audio/live are separate capabilities. Client user sessions must not contain permanent GPU credentials. Phone/model acceptance requires real evidence.
