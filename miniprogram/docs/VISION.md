# 小程序视觉识别与连接方式

0.4.7候选 · 2026-11-26 · [English](en/VISION.md) · [验收队列](BACKLOG.md)

用户当前0.4.6测试版本保持不变。本说明对应独立评阅候选；0.4.6模拟器默认本机联调的历史行为不由文档修改自动改变。

## 正常使用：公共HTTPS

0.4.7候选的手机和DevTools默认都使用 `https://api.auroraliu.cn:8080`，通过正常微信身份取得短期凭证。用户不需要WSL、GPU SSH别名或个人终端持续运行。实际GPU服务仍由部署维护者常驻运行；客户端切到公网不能修复服务端502。

在现有工程完整编译，或用手机Preview进行验收。公网request/socket域名按[现行部署说明](https://github.com/bird-assistant/bird-assistant/blob/main/backend/deploy/course/README.md)配置，实际HTTPS/WSS请求使用8080。保留原AppID和本机资料。

先在Windows PowerShell检查状态与响应：

```powershell
curl.exe --noproxy "*" --max-time 15 -i "https://api.auroraliu.cn:8080/api/v1/vision/readyz"
```

HTTP200且模型ready后再测试识别。Caddy502是视觉上游连接故障，需维护者检查；空响应也必须保留HTTP状态。2026-11-26用户已确认公网502，不能继续引用前一天午间的ready快照作当前证明。该GET不上传照片、不做推理。

- 照片：识别→相册/文件→选择照片→仅照片→开始识别；每份结果独立。也可在素材复核直接点“上传并分析照片”。识别不确定时保留原图/草稿，结果须人工复核。
- 实时：相机就绪后展开画面线索，点开启；可保留本帧或用高清快门分析。暂停/后台/离页结束会话，等候模式降低频率。
- 历史照片：时间/地点未知保持未知；可以主动读取原片信息并确认使用，不套用当前定位或天气。
- 声音/视频：当前音频provider未接入，组合模式上传前明确提示；视频目前私人保留，不宣称已完成推理。

## 可选开发模式：本机SSH桥

仅对已有正确SSH配置、需要直接联调GPU的开发者使用。普通验收不要求设置此模式。`bird-gpu-new` 是本机SSH配置别名，不是可猜测的公共DNS；缺少别名/认证时先联系部署维护者，不能照抄另一台机器的凭据。

以下命令均在含package.json的小程序工程根执行（团队仓库的miniprogram目录，或私人客户端仓库根）。WSL终端运行并保持开启：

```bash
python3 scripts/vision-dev.py
```

脚本在本机18000转发GPU8000，本机18001提供短期凭证。仅在SSH进程存活且18000就绪后输出“已启动”；失败明确报错并退出。该桥只绑定127.0.0.1。

在DevTools Console显式启用本机模式，然后重新编译：

```javascript
wx.setStorageSync('bird-assistant.vision.devtools-local.v1', true)
```

本机HTTP测试需要DevTools“详情→本地设置→不校验合法域名…”；这不是正式发布的域名配置。回到正常公网模式：

```javascript
wx.removeStorageSync('bird-assistant.vision.devtools-local.v1')
```

随后重新编译。此选择只在DevTools生效，手机忽略该标志；合法的HTTPS visionOrigin显式配置仍优先。

`node scripts/vision-smoke.cjs <测试鸟图.jpg>` 明确使用本机桥，需先启动桥，且会执行真实推理；它不是普通用户操作，也不能用mock结果宣称实际识别通过。启动器的独立无网络回归可运行：

```bash
python3 -m unittest discover -s tests -p test_vision_dev.py -v
```

## 服务端排查与恢复验收

按实际活动Caddy上游决定检查直连或旧机过渡路径，先查课程机18000/readyz和GPU8000/readyz、vision/campus-tunnel监督进程及错误日志。网页/admin/是社区审核工具，不提供这些进程控制。切换配置前验证/备份，沿用团队既有回滚流程，不盲跑历史部署覆盖路由或数据库。

恢复后要求公网readyz200，并在手机Wi-Fi/移动数据、关闭个人WSL后测试实际照片与实时；同时检查GPU实例重启后的服务恢复。模型ready、源码测试和照片正确识别是三类独立证据。
