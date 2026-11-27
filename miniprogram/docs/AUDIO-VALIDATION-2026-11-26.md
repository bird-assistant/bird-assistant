# 真实BirdNET本地验证，2026-11-26

[English](en/AUDIO-VALIDATION-2026-11-26.md) · [本轮开发](SPRINT-2026-11-26.md) · [机器证据](https://github.com/NoctisBaguette/bird-assistant/blob/fix/forum-media-drafts-0.4.7/backend/validation/audio-2026-11-26.json)

这是**本地CPU小样本行为验证**，不是准确率基准、真机验收或公网恢复证据。没有部署服务、调用付费Qwen/ASR、使用真实账号/后台口令或公开私人素材。用户安装的0.4.6保持不变。

## 测了什么

使用既有预研的5份鸟声来源：欧乌鸫、大山雀、蓝山雀、杜鹃和苍头燕雀；控制为人声、城市交通和本地生成的粉红噪声。每份取前10秒，生成MP3 44.1kHz、ADTS-AAC 16kHz、PCM-WAV 48kHz、M4A-AAC 44.1kHz四个单声道版本，另加2秒MP3。**40个案例只有8份独立来源**；粉红噪声不是真实风声，不能代替野外噪声测试。

| 范围 | 实测结果 |
| --- | --- |
| 10秒鸟声：5来源×4格式 | 20/20产生候选，预期鸟种均排首位 |
| 2秒鸟声：5来源 | 3份预期鸟种排首位；欧乌鸫、大山雀返回未知，无错误确认 |
| 负例：3来源×5变体 | 15/15未产生鸟候选 |
| 实际签名会话、原字节multipart、进程内ASGI | 40/40正常请求200；23候选、17未知 |
| 非法文件 | 8/8状态码和错误码符合合同 |

8种错误是空文件、损坏MP3、无法识别音频、非音频文件、扩展名/内容不符、过短、过长、超过10MiB。验证走真实FFmpeg、BirdNET权重、目录映射和移动会话校验；会话由本地测试签名生成、禁止匿名访问，未进行真实微信登录。`in-process ASGI`**未经过公网HTTP/TLS、Caddy、业务端微信签发或原生录音器**。

直接服务评估的处理时间p50为256.892ms、p95为331.831ms；最终multipart运行的平均服务处理时间253.820ms。均为该CPU环境的观测值，不是手机延迟或容量承诺。

## 固定资产与策略

- BirdNET_GLOBAL_6K_V2.4 FP32，6522标签；上游固定到`joeweiss/birdnetlib@c2ea5f8c4ac8e68c0f659c1253b930b8545272ff`。
- 模型SHA-256：`55f3e4055b1a13bfa9a2452731d0d34f6a02d6b775a334362665892794165e4c`。
- 标签SHA-256：`b50b77b7c3dfe40cd637e8cccdca0173a0a4ddee8867b830ff3c1a566f477f16`。
- Python3.12.14、ai-edge-litert2.4.0、NumPy2.3.5、服务FFmpeg7.1.5；XNNPACK CPU。准备转码还使用imageio-ffmpeg0.8.1。
- 保持默认策略：分数0.5、跨窗确认2、3秒窗/1.5秒步进；短录音按已有可用窗口规则处理。没有据此小样本调参；模型分数不称正确率。

机器证据保留原始来源URL/哈希、40条逐例预期和结果、实际multipart结果及8条错误；不包含会话凭据、模型权重或第三方音频。来源授权/署名沿用[预研NOTICE](https://github.com/NoctisBaguette/bird-assistant/blob/fix/forum-media-drafts-0.4.7/鸟类识别预研/NOTICE.md)，本轮学术本地验证不扩大模型或录音的商用许可。

## 如何复核

在backend环境安装现有audio额外依赖，按机器证据下载并校验固定权重/标签，使用既有预研素材获取脚本并保留授权；不把模型/录音提交Git。为`BIRD_AUDIO_MODEL_PATH`、`BIRD_AUDIO_LABELS_PATH`和两个SHA-256配置实际文件。随后运行：

```bash
python scripts/prepare_audio_samples.py --source /path/to/known-audio --output results/audio-samples
python scripts/evaluate_audio.py --manifest results/audio-samples/manifest.json --output results/audio-eval
python scripts/smoke_audio_service.py --manifest results/audio-samples/manifest.json --output results/audio-smoke --token-env BIRD_TEST_SESSION
```

`BIRD_TEST_SESSION`是已授权的短期测试会话环境变量，不把值放入命令、报告或Git；省略base-url走本进程，指定HTTPS地址才测试该地址。工具现在遇到非200就绪、失败/无有效状态的正常样本或空清单会返回失败，不能只凭错误样本通过就报绿。合成噪声的生成说明/哈希在证据中，重新生成或更换FFmpeg可能改变字节/时间；比较时先确认来源和变体。

## 接下来仍需验收

维护者部署真实音频进程、模型/共享签名和Caddy后，先在校内Wi-Fi、校外Wi-Fi和移动数据检查公共就绪，再从真机上传实录MP3/WAV/AAC/M4A与负例。加入本地常见鸟、多声源、远距离、风声/设备噪声、静音、人声及短片段；按独立原始录音划分评估集，记录未知率和误报。视觉502仍需独立恢复；国内人声ASR仍默认关闭、未做真实质量验收。
