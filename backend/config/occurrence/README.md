# 离线时空候选索引

`hefei_gbif.json` 是一个可选示例 profile，覆盖合肥市中心（31.8206, 117.2272）半径 100 km，按月份保存 GBIF 鸟类出现记录与 AviList v2026 学名的交集。它在部署前构建，服务优先使用离线 profile；离线索引不可用、坐标未覆盖或目录匹配不足时，默认会按任意经纬度在后台查询 GBIF 并缓存结果，因此不会把合肥或中国写死为唯一地点。

用途与限制：

- 数据只决定参与 BioCLIP 排名的候选集合，观测次数不作为相似度奖励；
- 没有显式配置 profile 时，服务仍可通过实时 GBIF 坐标查询获取当地候选；实时查询不可用或匹配目录的物种不足时，优先使用可用的国家候选，没有可用国家候选才使用全球 AviList 目录；profile 不是模型权重，也不是完整的物种分布真值；
- 实时查询默认使用坐标周围 100 km、拍摄月前后各一个月；缓存键包含保留三位小数的坐标、月份窗口和半径，坐标结果缓存最多 256 项，生产环境可通过配置调整半径、GBIF facet 分页大小和有效/空结果缓存时间；分页大小不限制物种数，后台任务负责完整月份分页并解析所有 facet 页返回的键；
- 可靠拍摄月份使用前后各一个月的并集，未知拍摄月份使用全年并集；
- 离线或实时集合只有匹配目录的物种数达到 `BIRD_VISION_SPECIES_MIN_LOCAL_CANDIDATES` 才会使用，该阈值默认 2；离线索引不可用、坐标超出覆盖范围或离线匹配不足时先查询 GBIF，仍不可用或不足时优先使用覆盖该坐标的离线 profile 国家，否则使用请求/默认地区对应的国家候选，没有可用国家候选才使用全球候选；
- 会话创建不预取；首次达到物种分类条件且缓存未命中时，只排队一次去重的后台查询，本次分类以 `live_occurrence_lookup_pending` 回退国家/全球候选，后续分类读取完成的缓存并在匹配足够目录物种时使用当地候选；无结果和查询失败分别记录 `live_occurrence_no_candidates`、`live_occurrence_lookup_failed`，失败缓存 30 秒后允许重试；
- 后台查询不占用 GPU 推理槽，也不受 `BIRD_VISION_INFERENCE_TIMEOUT_SECONDS` 限制；最多同时执行 2 个坐标查询，进行中和排队的查询合计最多 8 个。`BIRD_VISION_SPECIES_LIVE_OCCURRENCE_TIMEOUT_SECONDS` 作用于每次 HTTP 尝试，不是整个后台查询；服务关闭时取消尚未开始的查询，进行中的 HTTP 尝试按超时结束，之后不再开始新的查询步骤；
- 启用实时查询时，坐标会编码在按半径生成的查询多边形中，月份作为查询条件发送到 `api.gbif.org`；本服务不持久化坐标，可关闭实时查询以停止该外部传输；
- GBIF 是出现记录而非完整分布真值，存在采样偏差、误鉴定和分类学异名，更新后必须审查差异；
- JSON 内保存生成时间、查询范围、源记录量和匹配统计，文件 SHA-256 会在 `/readyz` 模型详情中公开。

重建命令见 `docs/视觉识别后端/MODELS.md`。数据源接口文档为 [GBIF Occurrence API](https://techdocs.gbif.org/en/openapi/v1/occurrence)。若要以聚合结果之外的方式再发布底层记录，应另行核对各记录许可和 GBIF 引用要求。

大范围网格应使用 GBIF SQL 下载的本地 TSV/ZIP 作为 `build_occurrence_grid.py --occurrence-file` 输入。输入至少包含 `speciesKey`、坐标、`month`、`countryCode` 以及 `scientificName` 或 `acceptedScientificName`；构建器按网格流式聚合，不在构建期间逐格请求 GBIF。矩形网格仍需结合中国行政边界和海域规则人工清理，仓库不内置中国全境索引。
