# 0.3.0 手帐构图、低负载预览与Qwen接口

2026-11-20 · [识别负责人交接](RECOGNITION-HANDOFF.md) · [English](en/JOURNAL-0.3.0.md)

## 这一批的结果

单图：留白主图/方寸肖像/横幅札记。双图：并置/上下叙事/错落（方形与横版以非对称双栏代替狭窄上下叠图）。三四图沿用组页，次优先；最多六图保留。切构图不再只做单图无明显变化的镜像。纸张比例改后退出局部聚焦、展示全页；标题/正文、裁剪参数、素材ID与原图保持，构图和比例变化可撤销。更换风格有独立入口。

`docs/design/journal-layouts.svg`是模型驱动的六例排版预览，使用插画并明确标记非微信截图。`npm test`编译后运行`node scripts/journal-layout-preview.mjs`重建；用实际PNG尺寸计算裁剪。

## 滑杆为何改

旧路径每次changing：fit整份文档、重算全部文字/图片、发送doc/renderElements/labels/面板布局等完整状态。新路径只在逻辑层修改当前元素，用40ms latest-value队列发送当前渲染元素和数值；释放时保留最终值，完整操作只入一次撤销历史。裁剪保持临时草稿，取消/切页清理未发送预览；普通拖动复用同一队列。文档/图层/布局不随每个滑杆事件整批穿过桥接。

这针对可复现的桥接负载根因；100事件突发负载测试不能替代手机FPS、拖动延迟和低端机体验。默认样例仍有较多元素，真实机型需复测。

同一4图文档、100次changing加最终释放的Node负载代理：旧版305次setData/1,197,056序列化字节，新版3次/12,690字节，最终宽度均200.79、撤销均1步。这是突发事件代理，不是自然手势速度或真机FPS。复现：先npm test，再node scripts/benchmark-journal.cjs；默认从Git读取团队d587b32源码，也可传旧版TS路径。实际耗时会影响合并次数，数值以本轮环境为准。

## Qwen选择与设计边界

服务端默认候选`qwen3-vl-plus`，关闭思考并请求JSON Object。模型名可由服务端环境配置；须在账户地域核实可用性。此版本没有调用真实模型、开通环境或花费额度；未设置API Key/入口时不会发请求。

Qwen接收用户勾选的图像副本与文字要求，返回短标题/正文和有限的style/variant。它不输出可执行代码、任意画布坐标、图片地址或新鸟图；本地模型生成可继续编辑、可撤销的手帐。建议先预览，分“仅应用文字”和“文字+建议构图”；原文字/图片在应用前不变。关闭、改要求、改图片会取消当前请求；文档已修改时阻止旧建议覆盖。

语音输入保留原录音，转写尚未接入；不会把录音当作VL图片发送。AI文案不是鸟种鉴定或知识库，提示要求不编造鸟名、数量、天气、地点和经历，用户仍须核对。

## 可装配的两端

1. 客户端`services/journal-ai.ts`：版本化请求/响应校验、取消和显式安装端口。
2. 客户端`services/journal-gateway.ts`：团队HTTPS请求适配。`prepareJournalPhotos(page,input)`通过独立隐藏Canvas将最多4张所选照片缩至最长1024px、重绘JPEG，单图最多1MB；不把本机路径/原始EXIF直接发给网关。失败可退出，临时副本回收，原图不改。
3. 服务端`server/journal-qwen.mjs`：依赖Node原生fetch的可测试provider，发往阿里云北京地域接口，不依赖OpenAI SDK或OpenAI服务。只接受内嵌限额JPEG/PNG，拒绝远端图片URL；输入/输出校验、20秒上游超时、64KB响应上限、无自动重试、安全错误。

**部署仍待完成**：此Node模块不是微信云函数部署包，也不能直接import进现有Python FastAPI。可由Node云函数/网关包装；若复用Python业务网关，应按同一JSON合同提供Python适配，不能为了接一个文件就并列建立第二套身份/数据库。这里选择Qwen API与固定合同，未擅自决定团队生产宿主。

服务端工厂强制传入`authenticate(context)`和`consumeQuota(userId)`；无认证/逐用户额度不能创建handler。宿主必须先限制HTTP请求体（约6MB内）再解析，并提供会话验证、逐用户速率/额度、并发和隐私策略。不要把客户端传来的userId当身份，不要直接把本函数暴露成匿名付费推理代理。

## 开通时配置什么

- 在服务端设置`DASHSCOPE_API_KEY`（控制台私密环境变量），`DASHSCOPE_BASE_URL`（账户对应的北京地域`.../compatible-mode/v1`），可选`JOURNAL_QWEN_MODEL`。
- 实现团队`POST /api/v1/journal/suggestions`：用业务会话验证用户，再调用provider并返回JSON；错误形状`{error:{code}}`，HTTP状态与错误对应。
- 输入v1：requestId、prompt、purpose、maxChars、images数组（id/label/dataUrl）。响应v1：同requestId、title、body、design（style为nature/magazine/minimal；variant为1/2/3）。正文上限20–600字符，由客户端请求限制；无几何/脚本/URL。
- 页面负责人在页面onLoad或集成bootstrap显式安装`journalGatewayTransport({endpoint,session,prepare:input=>prepareJournalPhotos(page,input)})`。endpoint是团队HTTPS地址，session取得短期用户令牌；不能把百炼Key传给session。卸载页面时解除该页面的transport绑定。现在未安装任何真实入口。
- 微信后台配置request域名/应用权限；在服务端确认网络、额度、所选模型及地域。请求前UI显示发送范围。日志不记录原图、base64、提示词或秘密。

## 验证和真机待办

自动检查包括单/双图三比例三构图、长标题边界、保留裁剪与ID、100次滑杆突发的部分更新/一次撤销、取消不串页、AI预览/应用/撤销/旧结果、识别插槽以及Qwen假上游的授权/额度/媒体/输出/错误/超时。服务端测试使用合成图签名与假的fetch，不宣称实际Qwen效果。

用户DevTools/真机仍须检查：
- 选1张、2张真实照片，逐个切纸张比例/构图/风格；选元素后再改比例应回到全页，撤销能还原。
- 持续拖尺寸/文字/旋转/裁剪，观察数值与画面同步、最终值准确，撤销只有一步，控制区无跳动；记录设备/微信/基础库和录屏。
- 导出与预览一致，原图/草稿还在；拒绝保存、低存储与图片读失败可重试。
- 网关部署后再做真实Qwen图片+文字调用、授权失败、额度不足、超时、取消和私密字段检查；手机性能和模型文案不在本轮假上游测试结论内。

来源：[Qwen视觉理解](https://help.aliyun.com/zh/model-studio/vision)、[结构化输出](https://help.aliyun.com/zh/model-studio/qwen-structured-output)。JSON格式不保证事实正确；参考模板选择不等于Canva API，也不承诺外部平台自动发布。
