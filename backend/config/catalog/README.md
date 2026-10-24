# 鸟类名录数据

运行时主目录是 `avilist_v2026_global.csv`，包含 AviList v2026 的 11,172 个物种级分类单元；其中 10,970 个现生或重新引入物种启用识别。`avilist_v2026_cn.csv` 是按 eBird 中国区域记录映射出的 1,420 个候选物种，供检索、评测和区域分析使用，不能替代中国官方生物物种名录。

全球目录是模型视觉排名的全集。运行时有可靠地点/月度记录时，当地子集拥有严格优先级：当地 Top-1 达到最低相似度后不再由全球候选覆盖；只有当地 Top-1 过低或 GBIF 不可用时采用全球模型。当前区域字段主要覆盖中国，不能当作全球分布数据库；地区和观测次数都不修改模型原始相似度。

## 来源和许可

- 分类学主表：AviList Core Team. 2026. *AviList: The Global Avian Checklist, v2026*，2026-10-20 发布，DOI `10.2173/avilist.v2026`，CC BY 4.0；
- 英文名：AviList v2026；
- 简体中文名和中国区域代码：eBird/Clements taxonomy `zh_SIM` 与 eBird 中国区域物种列表；
- 完整来源 URL、数量和文件 SHA-256 见 `catalog_metadata.json`。

中文名为空表示上游本地化表没有对应中文展示名，API 会继续返回英文名和学名，不会自行翻译或伪造名称。

## 重新生成

有 eBird API Key 时：

```bash
cd backend
EBIRD_API_KEY=... python scripts/build_species_catalog.py \
  --taxon-version v2026 --released 2026-10-20 \
  --citation 'AviList Core Team. 2026. AviList v2026' \
  --doi 10.2173/avilist.v2026
```

离线重建：

```bash
python scripts/build_species_catalog.py \
  --taxon-version v2026 \
  --avilist /path/to/avilist-2026.json \
  --ebird-taxonomy /path/to/ebird-zh_SIM.json \
  --ebird-region /path/to/ebird-CN-species.json
```

升级目录时必须提交两个 CSV、`catalog_metadata.json`、映射差异说明和固定评测集结果，不得只替换 CSV。
