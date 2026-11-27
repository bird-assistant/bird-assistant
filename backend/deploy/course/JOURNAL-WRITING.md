# 手帐Qwen：路由、共享配置与部署验收

2026-11-27。客户端0.4.14候选；本页是部署交接，未执行生产更新。基于团队已合并PR26后的main，仅移入经测试的writing/config改动，保留团队视觉等其他后端。16:55:40北京时间只读GET再次确认：手帐suggestions与capabilities均404，出行GET405，视觉readyz502。

## 两个独立问题

11:21:45北京时间只读GET：公网 /api/v1/map/trip-plan 返回405，而 /api/v1/journal/suggestions 返回404。出行路由存在，当前公开入口没有提供手帐路由。共享API账号不会把新的FastAPI路由部署到运行进程。维护者需核对活动反向代理上游、实际业务checkout/镜像及writing router版本。

源码另有配置割裂：出行读TRIP_API_KEY/TRIP_WORKSPACE，手帐读QWEN_API_KEY/QWEN_BASE_URL。0.4.8在BusinessSettings补共享回退：缺少QWEN key时复用TRIP key，反向亦然；有TRIP_WORKSPACE且未显式设置QWEN_BASE_URL时复用其北京workspace端点。明确配置的写作覆盖保留。全部环境变量均带 BIRD_BUSINESS_ 前缀。

## 维护者最小步骤

1. 部署当前完整业务源码到活动业务服务；保留数据库、媒体、微信身份/签名配置与现有进程管理。按实际部署入口重启后核对运行commit。不要依靠用户Windows上的个人SSH隧道替代共享服务。
2. 在服务端原有安全配置保留 BIRD_BUSINESS_TRIP_API_KEY、BIRD_BUSINESS_TRIP_WORKSPACE；需要独立覆盖时才设置 BIRD_BUSINESS_QWEN_API_KEY、BIRD_BUSINESS_QWEN_BASE_URL。不能把密钥放入小程序、截图或Git。BIRD_BUSINESS_QWEN_TEXT_MODEL 默认qwen-plus；BIRD_BUSINESS_QWEN_MODEL 默认qwen3-vl-plus。同账号仍需对应模型权限。
3. 无凭据GET手帐suggestions应405；capabilities应401而非404。再用普通用户正常短会话GET /api/v1/journal/capabilities，要求200/no-store/configured=true与预期textModel/imageModel。capabilities不调用模型、不输出key。
4. 在小程序登录本人账号，实际发送一次本人原文、一次主动选图写作。确认先预览再应用，取消保留草稿；文字和视觉模型分开验。收费模型请求由实际测试者/维护者在自己的服务权限下执行，本轮未代执行。
5. 校内Wi-Fi、校外Wi-Fi、移动数据分别复验。视觉GPU502与BirdNET音频404是另两个服务的问题，不阻挡独立写作联调。

## 错误阶段

| 现象 | 排查 |
| --- | --- |
| IMAGE_PREPARATION | 本地画布或照片读取；尚未发送请求，原文/照片保留。 |
| 业务404 | 活动业务版本/反向代理路由，不能当作用户GPS或VPN问题。 |
| 业务401 | 正常微信短会话刷新，不用后台管理员密码代替移动token。 |
| NOT_CONFIGURED | 活动进程实际加载的共享配置是否存在，不打印其值。 |
| PROVIDER_AUTH / MODEL_UNAVAILABLE | 同地区/workspace、模型授权与模型ID。 |
| PROVIDER_INPUT | 检查模型支持与请求参数，保留requestId，不将供应商私密错误直接回传。 |
| RATE_LIMITED / TIMEOUT | 用户/全局配额或上游状态；保留原稿，不自动无限重试。 |

请求使用非思考模式、JSON Object且系统提示包含JSON；Qwen-Plus和Qwen3-VL-Plus官方文档支持该结构化输出模式。服务端继续校验字段/长度/照片边界。静态契约检查不等于真实账号调用成功。

依据（2026-11-26查阅）：https://www.alibabacloud.com/help/en/model-studio/qwen-structured-output 。豆包独立研究见 miniprogram/docs/PHONE-FEEDBACK-0.4.8.md；未用更换模型掩盖当前缺失路由。
