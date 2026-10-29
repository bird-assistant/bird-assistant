# 模型、标签与分数语义

## 1. BirdNET v2.4

| 项 | 值 |
|---|---|
| 模型 | BirdNET Global 6K v2.4（FP32 TFLite，49.3 MB） |
| 来源 | <https://github.com/kahst/BirdNET-Analyzer> / birdnetlib 权重镜像 |
| 许可 | **CC BY-NC-SA 4.0**（非商业；课程与研究可用，商业化需替换或授权） |
| 输入 | 固定 `1 × 144000` float32（48 kHz × 3 s），不支持动态窗长 |
| 输出 | 6522 维 logits → sigmoid → 每个标签 0–1 的模型分数 |
| 运行时 | `ai-edge-litert`（XNNPACK，CPU，4 线程） |
| 摘要 | model `55f3e405…4c`，labels `b50b77b7…16` |

加载方式沿用预研结论：直接 `Interpreter(model_content=...)`，不导入 `birdnetlib`（Windows +
Python 3.13 下其依赖链需要已移除的 `audioop`，且解释器对非 ASCII 路径敏感）。

启动时做四件事，任一失败即拒绝服务：

1. 读取标签文件并解析；
2. 校验模型/标签 SHA-256（生产配置了期望值时必须一致）；
3. 加载 TFLite 并核对输入形状 `[1, 144000]`、dtype `float32`、输出维度 == 标签数；
4. 用静音窗预热一次，确认解释器可执行。

## 2. 标签集

`BirdNET_GLOBAL_6K_V2.4_Labels.txt` 每行 `学名_英文名`：

```text
Turdus merula_Eurasian Blackbird
...
Human vocal_Human vocal
Dog_Dog
Engine_Engine
Environmental_Environmental
Fireworks_Fireworks
Gun_Gun
Noise_Noise
Siren_Siren
```

| 类别 | 数量 |
|---|---:|
| 全部标签 | 6,522 |
| 鸟类 | 6,514 |
| 非鸟类（8 类） | 8 |

非鸟类过滤规则：`学名 ∈ {Dog, Engine, Environmental, Fireworks, Gun, Human vocal, Noise, Siren}`
**或**学名不是拉丁双名（`^[A-Z][a-z]+ [a-z][a-z-]*$`）即判定为非鸟类。第二条让未来模型版本新增的
噪声类别自动被排除，而不会混进候选。非鸟类分数不进入候选，但会在
`diagnostics.non_bird_top` 中暴露（`Human vocal` 高说明录到的是人声）。

## 3. 物种目录对齐

项目目录是 AviList v2026 全球 11,172 种（`backend/config/catalog/avilist_v2026_global.csv`）。
BirdNET 使用 eBird/Clements 命名，两者并非一一对应，因此按优先级匹配：

1. **学名精确匹配**（大小写不敏感）→ 直接取 `species_id`、中英文名；
2. **英文名唯一匹配** → 取该条目，`match="common_name"`；
3. **不匹配** → 保留 BirdNET 原始学名/英文名，`species_id=null`、`mapped=false`。

当前对齐结果（v2.4 × AviList v2026）：

| 结果 | 数量 | 占比 |
|---|---:|---:|
| 学名精确匹配 | 6,121 | 93.9% |
| 英文名唯一匹配 | 205 | 3.1% |
| 未映射 | 188 | 2.9% |

未映射是**预期行为**：AviList 与 Clements 存在拆分/合并差异，硬猜会造成错误物种。前端应能展示
“未收录（保留原始学名）”，并允许用户手动搜索目录后修正。

## 4. 分数语义

- `score_type` 取值：`birdnet_confidence`（真实模型）或 `mock`（开发用确定性引擎）。
- 单个候选的 `score` 是**该标签在所有窗口中的最大 sigmoid 输出**；`aggregation=max_window_score`。
- 这是模型的判别分数，**不是校准后的正确率**，也不代表“这只鸟有 97% 的概率是乌鸫”。
  低分不代表一定错、高分也不保证正确（预研中 0.5 s 片段曾以 0.92 分误判为另一物种）。
- 排序使用 `(score, confirming_windows, label_index)`，先分数后证据量。
- `confirming_windows` 是达到阈值的窗口数；阈值与确认窗数写进每个响应的 `policy` 字段，
  前端不需要硬编码。

## 5. 阈值策略（含样本检查结论）

| 参数 | 默认 | 依据 |
|---|---:|---|
| `min_score` | 0.50 | 预研：0.25 有车流/风噪误报；0.5 在 12 个负样本上 0 误报 |
| 最少确认窗 | 2 | 预研“三窗中两窗”；本次样本 0.25+1 窗即出现 2 个误报，0.5+2 窗为 0 |
| 短录音确认窗 | 1 | 只有 1 个窗口时无法跨窗，用 `notes` 明确告知 |
| `min_margin` | 0（关闭） | 样本不足以校准；保留开关，待更多数据再定 |
| 最低时长 | 1.0 s | 预研 1 s 5/5、0.5 s 3/5 且“错得自信” |

扫描结果（32 样本，同一批窗口离线重算，详见 [VALIDATION.md](VALIDATION.md)）：

| min_score | 确认窗 | 鸟声 top-1 | 负样本误报 |
|---:|---:|---:|---:|
| 0.25 | 1 | 18/20 | 2/12 |
| 0.50 | 1 | 18/20 | 1/12 |
| 0.50 | 2 | 18/20 | **0/12** |
| 0.70 | 2 | 18/20 | 0/12 |

## 6. mock 引擎

`BIRD_AUDIO_ENGINE_BACKEND=mock` 用于前端联调与 CI：分数由窗口 RMS 决定（静音 → 0，
响 → 接近 0.99），标签取真实标签文件（缺失时用内置 7 条小词表）。响应带
`notes=["mock_engine"]` 且 `score_type="mock"`，不会被误认为真实结果。

## 7. 已知限制

1. 样本以干净的 xeno-canto 素材为主，**真实校园/手机录音仍需补测**（本仓库没有真机音频）。
2. 未启用 geo filter：按经纬度裁剪候选可显著降低车流这类误报，但需要地理数据支持，本期未做。
3. 未做 VAD：整段录音都送模型，静音段会被判成低分 `unknown`，代价是多花推理时间。
4. 多鸟混鸣时只返回排序候选，不做声源分离。
5. 8 个非鸟类类别之外的噪声（雨声、昆虫、蛙类）仍可能产生高分候选，需要样本持续回归。
6. 中文名来自目录的 eBird zh_SIM 富化，覆盖 1,857 种；其余物种 `common_name_zh=null`。
