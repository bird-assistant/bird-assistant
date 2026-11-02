# 音频服务样本验证（真实模型）

- 生成时间：2026-10-27T11:57:55.344881+00:00
- 引擎：ai-edge-litert（BirdNET_GLOBAL_6K_V2.4）
- 模型 SHA-256：`55f3e4055b1a13bfa9a2452731d0d34f6a02d6b775a334362665892794165e4c`
- 标签 SHA-256：`b50b77b7c3dfe40cd637e8cccdca0173a0a4ddee8867b830ff3c1a566f477f16`
- 阈值策略：min_score=0.5，最少跨窗确认=2，窗口=3.0s / 步进=1.5s

> 样本量很小，且以预研素材为主（补充的“手机格式”是同一素材的转码，不是真机录音）。下表用于验证流程与错误处理，不能作为整体准确率结论。

## 1. 汇总

| 指标 | 值 |
|---|---:|
| 鸟声样本数 | 20 |
| top-1 命中 | 18 / 20 |
| 期望物种出现在候选中 | 18 / 20 |
| 负样本数 | 12 |
| 负样本误报（state=candidate） | 0 / 12 |
| 返回 unknown 的比例 | 44% |
| 端到端耗时 p50 / p95 | 166.695 / 219.224 ms |
| 解码耗时 p50 / p95 | 48.175 / 91.704 ms |
| 单窗推理 p50 / p95 | 18.935 / 23.733 ms |

## 2. 逐样本结果

| 样本 | 格式 | 期望 | 状态 | top-1 | 分数 | rank | 耗时 ms |
|---|---|---|---|---|---:|---:|---:|
| A1_mp3_44k_mono | mp3 | Turdus merula | candidate | Turdus merula | 0.865 | 1 | 254 |
| A1_aac_16k_mono | aac | Turdus merula | candidate | Turdus merula | 0.957 | 1 | 205 |
| A1_wav_48k_mono | wav | Turdus merula | candidate | Turdus merula | 0.879 | 1 | 163 |
| A1_mp3_44k_mono_short | mp3 (2 s) | Turdus merula | unknown | — | — | — | 60 |
| A2_mp3_44k_mono | mp3 | Parus major | candidate | Parus major | 0.975 | 1 | 168 |
| A2_aac_16k_mono | aac | Parus major | candidate | Parus major | 0.982 | 1 | 186 |
| A2_wav_48k_mono | wav | Parus major | candidate | Parus major | 0.977 | 1 | 219 |
| A2_mp3_44k_mono_short | mp3 (2 s) | Parus major | unknown | — | — | — | 79 |
| A3_mp3_44k_mono | mp3 | Cyanistes caeruleus | candidate | Cyanistes caeruleus | 0.998 | 1 | 168 |
| A3_aac_16k_mono | aac | Cyanistes caeruleus | candidate | Cyanistes caeruleus | 0.947 | 1 | 165 |
| A3_wav_48k_mono | wav | Cyanistes caeruleus | candidate | Cyanistes caeruleus | 0.997 | 1 | 164 |
| A3_mp3_44k_mono_short | mp3 (2 s) | Cyanistes caeruleus | candidate | Cyanistes caeruleus | 0.963 | 1 | 60 |
| A4_mp3_44k_mono | mp3 | Cuculus canorus | candidate | Cuculus canorus | 0.994 | 1 | 167 |
| A4_aac_16k_mono | aac | Cuculus canorus | candidate | Cuculus canorus | 0.999 | 1 | 176 |
| A4_wav_48k_mono | wav | Cuculus canorus | candidate | Cuculus canorus | 0.993 | 1 | 173 |
| A4_mp3_44k_mono_short | mp3 (2 s) | Cuculus canorus | candidate | Cuculus canorus | 0.963 | 1 | 66 |
| A5_mp3_44k_mono | mp3 | Fringilla coelebs | candidate | Fringilla coelebs | 0.971 | 1 | 296 |
| A5_aac_16k_mono | aac | Fringilla coelebs | candidate | Fringilla coelebs | 0.960 | 1 | 161 |
| A5_wav_48k_mono | wav | Fringilla coelebs | candidate | Fringilla coelebs | 0.956 | 1 | 193 |
| A5_mp3_44k_mono_short | mp3 (2 s) | Fringilla coelebs | candidate | Fringilla coelebs | 0.757 | 1 | 103 |
| N1_mp3_44k_mono | mp3 | （无鸟） | unknown | — | — | — | 180 |
| N1_aac_16k_mono | aac | （无鸟） | unknown | — | — | — | 182 |
| N1_wav_48k_mono | wav | （无鸟） | unknown | — | — | — | 190 |
| N1_mp3_44k_mono_short | mp3 (2 s) | （无鸟） | unknown | — | — | — | 66 |
| N2_mp3_44k_mono | mp3 | （无鸟） | unknown | — | — | — | 163 |
| N2_aac_16k_mono | aac | （无鸟） | unknown | — | — | — | 170 |
| N2_wav_48k_mono | wav | （无鸟） | unknown | — | — | — | 166 |
| N2_mp3_44k_mono_short | mp3 (2 s) | （无鸟） | unknown | — | — | — | 59 |
| N3_mp3_44k_mono | mp3 | （无鸟） | unknown | — | — | — | 164 |
| N3_aac_16k_mono | aac | （无鸟） | unknown | — | — | — | 162 |
| N3_wav_48k_mono | wav | （无鸟） | unknown | — | — | — | 166 |
| N3_mp3_44k_mono_short | mp3 (2 s) | （无鸟） | unknown | — | — | — | 58 |

## 3. 阈值/跨窗策略扫描

| min_score | 最少确认窗 | 鸟声 top-1 | 负样本误报 | unknown |
|---:|---:|---:|---:|---:|
| 0.25 | 1 | 18/20 | 2/12 | 12 |
| 0.25 | 2 | 18/20 | 0/12 | 14 |
| 0.25 | 3 | 15/20 | 0/12 | 17 |
| 0.5 | 1 | 18/20 | 1/12 | 13 |
| 0.5 | 2 | 18/20 | 0/12 | 14 |
| 0.5 | 3 | 15/20 | 0/12 | 17 |
| 0.7 | 1 | 18/20 | 0/12 | 14 |
| 0.7 | 2 | 18/20 | 0/12 | 14 |
| 0.7 | 3 | 14/20 | 0/12 | 18 |

## 4. 说明与限制

- `state=candidate` 只表示“达到当前阈值且满足跨窗确认”，不是识别正确率。
- 扫描表用同一批窗口分数离线重算，因此可与上表的逐样本结果对照。
- 真机录音（不同麦克风、风噪、远距离）仍需前端按 `docs/音频识别后端/API.md` 的`wx.uploadFile` 示例补测；本仓库不包含真机音频。
