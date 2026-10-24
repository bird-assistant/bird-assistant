# 模型、鸟种目录与验收规则

## 1. 当前正式选型

| 环节 | 默认实现 | 作用 | 不能代表什么 |
|---|---|---|---|
| 鸟体检测 | YOLO11n，COCO `bird` 类 | 找到鸟的位置 | 不能证明具体鸟种 |
| 轨迹关联 | 每会话独立 ByteTrack | 减少框闪烁、复用鸟种候选 | 无 ReID，不能保证严重遮挡后的个体身份 |
| 候选范围 | 全球 AviList 目录；离线 GBIF 地点/月度索引优先，任意坐标实时 GBIF 兜底 | 在有可靠外部范围数据时缩小候选 | 出现记录不等于绝对不存在，网络失败时回退国家/全球目录 |
| 物种候选 | BioCLIP 2 + AviList v2026 | 在本次候选空间内排序并拒绝弱结果 | 分数不是正确概率 |
| 用户记录 | 业务后端人工选择 | 保存用户确认 | 不自动变成专家复核数据 |

预研中的 ResNet50/EfficientNet ImageNet-59 只验证过“裁剪后可以进入分类器”的链路，词表不包含目标鸟种，因此生产服务不再使用。

## 2. BioCLIP 2

BioCLIP 2 是面向生物图像的 ViT-L/14 模型，可按物种名称进行零样本分类。官方模型卡给出的 OpenCLIP 加载方式是：

```python
open_clip.create_model_and_transforms("hf-hub:imageomics/bioclip-2")
```

来源：

- [BioCLIP 2 官方模型卡](https://huggingface.co/imageomics/bioclip-2)
- [BioCLIP 2 官方仓库](https://github.com/Imageomics/bioclip-2)

模型卡许可为 MIT，但项目仍需要分别核对：检测模型、物种目录、训练/评测图片和用户素材的许可。

CUDA 默认使用 FP16 autocast；CPU 强制使用 FP32。全量物种文本特征以实际权重指纹、解析后的 Hugging Face commit、特征维度、目录 SHA-256、提示模板版本和精度作为缓存键。读取缓存时会校验元数据、矩阵形状、有限值和单位范数；不兼容或损坏的缓存会重新生成。

## 3. 已纳入仓库的完整鸟种目录

当前目录不是 6 种示例，而是以下两个有版本的数据文件：

| 文件 | 数量 | 用途 |
|---|---:|---|
| `backend/config/catalog/avilist_v2026_global.csv` | 11,172 种 | 运行时完整候选空间；10,970 个现生或重新引入物种启用 |
| `backend/config/catalog/avilist_v2026_cn.csv` | 1,420 种 | eBird 中国区域记录映射，用于检索、评测和范围分析 |

分类学主表为 2026-10-20 发布的 AviList v2026。英文名来自 AviList；简体中文名和中国区域标记来自 eBird/Clements `zh_SIM` 与 eBird 中国区域物种列表。全球表中有 1,857 个中文名，中国子集中有 1,411 个中文名。中文名缺失时保留为空，由前端回退英文名或学名，系统不会自行编造中文名。

`CN` 等区域标记不再是排序加分。坐标存在时，系统首先使用离线索引或实时 GBIF 查询；只有坐标查询失败或当地匹配候选不足时，才形成国家级候选集合。国家优先取覆盖该坐标的离线 profile 国家，否则取请求/部署默认地区；没有可用国家候选时才回退全球 10,970 个启用物种。当前仓库的区域映射主要覆盖中国，不能把它当成全球分布数据库。响应中的 `candidate_scope` 和 `fallback_reason` 会记录实际范围，避免静默改变识别语义。

来源、许可、生成时间和 SHA-256 在 `backend/config/catalog/catalog_metadata.json` 中；构建规则在 `backend/scripts/build_species_catalog.py` 中。AviList 分类学数据为 CC BY 4.0。中国子集是 occurrence-derived 候选集合，不冒充中国官方法定名录。

## 4. 目录字段和稳定标识

CSV 必填字段：

```text
species_id,scientific_name
```

完整目录字段：

```text
common_name_zh,common_name_en,order,family,ebird_code,avibase_id,
region_codes,extinction_status,iucn_status,taxon_source,taxon_version,license,enabled
```

约束：

- `species_id` 使用 AviList 提供的稳定 Avibase ID，不使用展示名称作主键；
- `scientific_name` 唯一；
- 中文名、英文名是可更新别名；
- 保存目录版本、来源、发布日期和映射规则；
- 分类模型升级不能静默改写历史用户选择；
- 已灭绝或可能灭绝物种仍保留在完整名录中，但 `enabled=false`，不进入实时候选；
- 目录升级必须提交来源、文件哈希、物种增删映射和固定评测集结果。

重新生成：

```bash
cd backend
EBIRD_API_KEY=... python scripts/build_species_catalog.py \
  --taxon-version v2027 --released <YYYY-MM-DD> \
  --citation '<verified release citation>' \
  --doi <verified-doi> \
  --output-dir config/catalog/releases/v2027
```

构建器只发布到一个尚不存在的版本目录：所有 CSV 与元数据先在同文件系统临时目录完成并计算哈希，再通过一次目录重命名同时可见。它不会覆盖正在运行的名录；审核和评测新目录后，再修改部署配置切换版本。

## 5. 时空候选、排序与未知鸟拒识

### 离线时空候选

`backend/config/occurrence/hefei_gbif.json` 是合肥中心 100 km 的 GBIF 出现记录聚合示例，不是 BioCLIP 的地域知识。它只有在通过 `BIRD_VISION_SPECIES_OCCURRENCE_PATH` 显式配置后才会作为离线缓存加载；没有离线覆盖时，默认服务按任意坐标实时查询 GBIF。对有可靠拍摄时间的帧，使用拍摄月前后各一个月的物种并集；时间精度为 `unknown` 时查询该地点全年物种并集。观测次数仅随候选返回用于审计，不参与相似度或排序。

重新构建合肥索引：

```bash
cd backend
python scripts/build_occurrence_profile.py \
  --site-id hefei-cn-100km --name '合肥及周边 100 km' --country-code CN \
  --latitude 31.8206 --longitude 117.2272 --radius-km 100 \
  --catalog config/catalog/avilist_v2026_global.csv \
  --output config/occurrence/hefei_gbif.json
```

构建产物记录查询圆、每月原始记录数、GBIF 键与 AviList 的匹配数量、生成时间和来源。数据通过 [GBIF Occurrence API](https://techdocs.gbif.org/en/openapi/v1/occurrence) 的搜索分面生成。GBIF 是 presence-only 数据且存在空间、季节和观察者偏差，因此该索引只用于候选范围，不是物种分布真值。

运行时支持任意经纬度：BioCLIP 分类前先查已配置的离线索引；离线索引不可用、没有覆盖或匹配目录的物种少于 `BIRD_VISION_SPECIES_MIN_LOCAL_CANDIDATES` 时，再查实时 GBIF 缓存。该最小值默认是 2，也同样适用于实时结果。会话创建不预取；首次达到分类条件且缓存未命中时，服务排队执行去重的后台查询并立即回退覆盖该坐标的离线 profile 国家，否则回退请求/部署默认地区对应的国家候选；没有可用国家候选才使用全球目录。后续分类在查询完成且匹配足够物种后使用当地候选，因此同一会话的候选范围可能从国家/全球变为当地。所有候选查询都不改变 BioCLIP 相似度分数。

后台任务拥有月份窗口内的完整 facet 分页和所有返回物种键的名称解析。`BIRD_VISION_SPECIES_LIVE_OCCURRENCE_FACET_LIMIT` 默认 100，只是每页大小，不会把名称解析截断为 100 个；坐标缓存键使用保留三位小数的经纬度、月份窗口和半径，最多保存 256 项，名称缓存跨坐标查询共享。有效和空结果使用配置的 TTL，错误缓存 30 秒后允许重试；响应以 `live_occurrence_lookup_pending`、`live_occurrence_no_candidates` 和 `live_occurrence_lookup_failed` 区分后台准备、空结果和失败。

查询圆使用逆时针 WKT 外环；跨越日期变更线或包含极点时拆成多个合法多边形，通过重复的 GBIF `geometry` 参数查询并集，避免经度环绕导致无效几何或重复累计边界记录。

实时 GBIF 使用独立工作池，最多并发 2 个坐标查询，进行中和排队的查询合计最多 8 个；它不占用 GPU 推理槽，也不受 `BIRD_VISION_INFERENCE_TIMEOUT_SECONDS` 限制。`BIRD_VISION_SPECIES_LIVE_OCCURRENCE_TIMEOUT_SECONDS` 是每次 HTTP 尝试的超时，不是整个后台查询的总时限。服务关闭时取消排队任务，进行中的 HTTP 尝试按超时结束，并在关闭后阻止新的分页或名称请求。启用实时查询时，坐标会编码在按半径生成的查询多边形中，月份作为查询条件发送到 `api.gbif.org`；本服务不持久化坐标，可通过关闭实时查询停止该外部传输。

中国全境或大范围网格不要逐格调用 Search API。应先通过需要 GBIF 账号的 [SQL occurrence download](https://techdocs.gbif.org/en/data-use/api-sql-downloads) 获取本地 TSV/ZIP，至少包含 `speciesKey`、`decimalLatitude`、`decimalLongitude`、`month`、`countryCode` 和 `scientificName`（或 `acceptedScientificName`）：

```sql
SELECT specieskey, decimallatitude, decimallongitude, month, countrycode,
       scientificname, acceptedscientificname
FROM occurrence
WHERE classkey = 212
  AND hascoordinate = TRUE
  AND occurrencestatus = 'PRESENT'
  AND countrycode = 'CN'
  AND decimallatitude IS NOT NULL
  AND decimallongitude IS NOT NULL
  AND month IS NOT NULL
```

GBIF SQL exposes these field names in lowercase; the local builder accepts the equivalent
camelCase or snake_case header spellings when reading the downloaded TSV.

使用本地下载按网格和月份流式聚合，构建器不会在该模式下调用 GBIF：

```bash
python scripts/build_occurrence_grid.py \
  --country-code CN --name '中国网格' \
  --min-latitude 18 --max-latitude 54 \
  --min-longitude 73 --max-longitude 135 \
  --cell-size-degrees 1 \
  --occurrence-file /path/to/gbif-sql.tsv.zip \
  --catalog config/catalog/avilist_v2026_global.csv \
  --output config/occurrence/china_gbif.json
```

上述矩形是数据筛选范围，不是中国行政边界；发布前必须使用边界/海域规则清理网格，检查 GBIF 到 AviList 的名称匹配和月度异常，并保存 SQL 下载的 DOI、查询文本、下载时间及许可引用。构建器只提供矩形网格聚合，不会替代这些审核。

### `detection_score`

检测模型对“这个框是 bird”的原始分数。它没有在本项目本地数据上校准，前端只能显示为“模型分数”。

### `similarity`

BioCLIP 归一化图像特征与物种文本特征的原始余弦相似度，用于拒识阈值。它仍不是正确率。

### `relative_similarity`

BioCLIP 图像特征与目录中文本特征的相似度，经本次实际候选集合内 softmax 排序。它受候选目录大小和组成影响：地点、月份或目录变化都会改变 `relative_similarity`，所以 API 同时返回 `candidate_count` 和 `candidate_scope`。

地区、月份、出现次数都不会改变原始余弦相似度，也没有 `CN +0.015` 或其他隐藏奖励。

返回具体候选前同时要求：

- Top-1 原始 `similarity >= BIRD_VISION_SPECIES_MIN_SIMILARITY`；
- 实际候选集合中 Top-1 与 Top-2 的原始相似度间隔 `margin >= BIRD_VISION_SPECIES_MIN_MARGIN`。

任一条件不满足时 `state=unknown`，仍可附带候选供人工参考，但前端不得把第一名显示成已经识别成功。仓库默认阈值 `0.20/0.01` 是保守工程起点，不是已经校准出的通用真理；云 GPU 上必须用项目固定集调参并记录版本。

禁止文案：

```text
识别准确率 87%
87% 确定是白鹭
```

允许文案：

```text
候选：白鹭
模型相对分数：0.87
请结合体型、羽色、地点和鸣声确认
```

只有使用独立本地测试集做过校准后，才可以另外提供“经验证概率”，并明确模型版本、目录和适用地区。

## 6. GPU 验收数据集

至少准备：

- 30～50 种项目目标地区常见鸟；
- 每种至少 20 张不与训练来源重复的图片；
- 近距、远距、逆光、遮挡、运动模糊、幼鸟、雌雄差异；
- 多鸟画面；
- 空画面、树枝、树叶、果实、飞机等负样本；
- 素材来源和许可记录。

必须人工标注鸟框和物种。原预研的强模型伪真值只能用于工程比较，不能作为最终准确率真值。

评测清单中的 `expected_species_id` 使用目录内 Avibase ID；开放集负样本写成 `__unknown__`：

```csv
image_path,expected_species_id,region_code
crops/little-egret-001.jpg,avibase-F2858F9F,CN
crops/non-bird-001.jpg,__unknown__,CN
```

运行：

```bash
cd backend
python scripts/evaluate_species.py eval/manifest.csv --output results/species-eval.json
```

报告包括 Top-1、Top-3、接受且正确率、未知拒识率和未知错误接受率，并保存每张图片的原始候选，便于回归定位。

完整图片序列还必须经过检测、跟踪、裁剪和分类全链路评测：

```bash
python scripts/evaluate_pipeline.py eval/frames.json \
  --require-gpu --realtime --batch-size 8 \
  --output results/pipeline-eval.json
```

`frames.json` 为按回放顺序排列的数组，逐帧提供 `sequence_id`、`frame_id`、`timestamp_ms`、`image_path` 和人工标注的 `objects`。空画面使用 `objects=[]`，未知鸟使用 `expected_species_id=__unknown__`。

## 7. 发布门槛

下面是产品验收目标，不是当前已取得结果：

| 指标 | 建议门槛 |
|---|---:|
| 鸟体检测 Precision | ≥ 0.85 |
| 鸟体检测 Recall（短边 ≥64px） | ≥ 0.85 |
| 非鸟误触发率 | ≤ 5% |
| 目标物种 Top-1 | ≥ 70% |
| 目标物种 Top-3 | ≥ 85% |
| 未知物种错误接受率 | ≤ 5% |
| 单路检测 P95 | ≤ 300ms |
| 首个鸟框端到端 P95 | ≤ 1s |
| 首个物种候选端到端 P95 | ≤ 3s |

如果达不到物种指标，产品应继续显示“发现鸟”与候选复核，而不是降低阈值强行输出具体鸟名。

## 8. 模型升级流程

1. 固定评测集和目录版本；
2. 记录旧模型指标；
3. 新模型离线评测；
4. 比较总体与每物种指标，检查长尾退化；
5. 用影子流量验证延迟和显存；
6. 发布新 revision；
7. 保留旧权重用于回滚；
8. 不改写历史原始模型输出。

## 9. 许可

- 当前预研 YOLO11/Ultralytics 采用 AGPL-3.0；闭源或商业发布前必须完成许可决策，或替换为合适许可的检测器；
- BioCLIP 2 官方模型卡标注 MIT；
- AviList v2026 分类学数据采用 CC BY 4.0，发布目录时保留署名和版本；
- 鸟类图片、鸟种描述、中文名录和用户素材各有独立版权/授权条件；
- 模型代码开源不代表训练数据、百科文字和图片自动可以商用。
