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

## 辨认资料和参考照片

`avonet_traits.json` 使用 Tobias et al. (2022) 的 AVONET 补充数据 1，第 7 版。构建脚本核对原工作簿校验和，通过 eBird 工作表中的 `Avibase.ID2` 精确匹配当前启用鸟种，共 10,050 种。体重单位为克，翼长、嘴峰长和尾长单位为毫米。界面翻译生境、食性与活动方式，显示物种平均值，并标明上游推定值。数据以 CC BY 4.0 发布。[AVONET 数据与许可](https://doi.org/10.6084/m9.figshare.16586228.v7)

`guide_photos.json` 保存每张参考照片的作者、原图页面和许可链接。来源为 GBIF 收录的 iNaturalist Research-grade Observations。选图时核对学名、媒体类型与每张照片的许可，仅采用 CC BY 4.0 或 CC0 1.0。`guide_images/` 存放转正、缩放并转为 JPEG 的副本。照片由社区观察提供，四种常见鸟另附可溯源的 RSPB 辨认提示。[iNaturalist 数据集](https://www.gbif.org/dataset/50c9509d-22c7-4a22-a47d-8c48425ef4a7)

从 `backend` 目录重建参考资料和补充常见鸟种配图：

```bash
curl -fL https://ndownloader.figshare.com/files/34480856 -o /tmp/avonet-v7.xlsx
python scripts/build_field_guide.py /tmp/avonet-v7.xlsx
PYTHONPATH=src python scripts/seed_guide_photos.py
```
