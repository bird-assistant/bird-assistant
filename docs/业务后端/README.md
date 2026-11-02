# 业务后端：观察记录持久化

issue #13 指出的两个外部依赖之一。音频与照片识别服务都是**无状态**的：它们不保存录音、图片，
也不写业务库。用户在小程序里确认候选之后，由前端（或网关）写入本服务。

```text
[小程序] --确认候选--> [网关] --> [bird-business] --SQLite--> observations
                                     ^
[bird-audio] / [bird-vision] --------┘ 只提供 analysis_id 与候选
```

## 1. 范围

| 做 | 不做 |
|---|---|
| 保存用户确认的观察记录（物种、分析来源、时间、位置、备注） | 保存原始音频/图片 |
| 按凭证隔离、幂等写入（同一分析同一物种重试不重复） | 用户体系、鉴权中心（由网关/后续业务系统负责） |
| 分页查询、单条查询、删除 | 地图聚合、统计报表（后续在业务侧实现） |

## 2. 运行

```bash
cd backend
python -m pip install -e '.[test]'
BIRD_BUSINESS_DATABASE_PATH=runtime/observations.sqlite3 bird-business --port 8200
```

| 变量 | 默认 | 说明 |
|---|---|---|
| `BIRD_BUSINESS_DATABASE_PATH` | `runtime/observations.sqlite3` | SQLite 文件；`:memory:` 仅测试 |
| `BIRD_BUSINESS_DEFAULT_PAGE_SIZE` | 20 | 默认分页 |
| `BIRD_BUSINESS_MAX_PAGE_SIZE` | 100 | 分页上限（超过返回 `INVALID_PAGE_SIZE`） |
| `BIRD_BUSINESS_MAX_NOTE_LENGTH` | 2000 | 备注长度（超过返回 `NOTE_TOO_LONG`） |
| `BIRD_BUSINESS_API_KEYS` / `ALLOW_ANONYMOUS` | 空 / `true` | 生产必须关闭匿名并配置密钥 |

SQLite 以 WAL 模式打开，单进程使用（`--workers` 只能为 1）。需要多副本时把
`db.py` 的存储换成外部数据库即可，接口与业务层不变。

## 3. 接口

### `POST /api/v1/observations`

```json
{
  "source": "audio",
  "source_analysis_id": "aud_9c1f0d1b6f5f4b2e9d1a2f0a3c4b5d6e",
  "species_id": "avibase-88BB4F2A",
  "scientific_name": "Turdus merula",
  "common_name_zh": "乌鸫",
  "common_name_en": "Eurasian Blackbird",
  "score": 0.975,
  "score_type": "birdnet_confidence",
  "observed_at": "2026-10-27T11:58:12Z",
  "latitude": 31.8206,
  "longitude": 117.2272,
  "note": "校园梧桐树上",
  "client_reference": "wx-demo-1"
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `source` | 是 | `audio` / `photo` |
| `source_analysis_id` | 是 | 音频或照片分析返回的 `analysis_id` |
| `species_id` / `scientific_name` | 是 | 候选里的目录 ID 与学名（未映射时前端应先让用户选择物种） |
| `common_name_zh` / `common_name_en` | 否 | 便于展示与导出 |
| `score` / `score_type` | 否 | 记录当时的模型分数及类型，不参与判断 |
| `observed_at` | 否 | 缺省为服务器当前时间；带时区 |
| `latitude` / `longitude` | 否 | 必须成对出现 |
| `region_code` | 否 | ISO 3166-1 alpha-2 |
| `note` | 否 | 长度受 `MAX_NOTE_LENGTH` 限制 |
| `client_reference` | 否 | 前端自己的 id |

响应 `201`：

```json
{
  "observation_id": "obs_1f2e...",
  "created_at": "2026-10-27T12:00:00+00:00",
  "observed_at": "2026-10-27T11:58:12+00:00",
  "source": "audio",
  "source_analysis_id": "aud_9c1f...",
  "species_id": "avibase-88BB4F2A",
  "scientific_name": "Turdus merula",
  "common_name_zh": "乌鸫",
  "common_name_en": "Eurasian Blackbird",
  "score": 0.975,
  "score_type": "birdnet_confidence",
  "latitude": 31.8206,
  "longitude": 117.2272,
  "region_code": "CN",
  "note": "校园梧桐树上",
  "client_reference": "wx-demo-1"
}
```

同一凭证下 `(source_analysis_id, species_id)` 重复提交返回 `200` 与**已存在**的记录，便于弱网重试。

### `GET /api/v1/observations`

查询参数：`limit`（≤ `MAX_PAGE_SIZE`）、`offset`、`source`。只返回当前凭证自己的记录，
按创建时间倒序。

```json
{"total": 1, "offset": 0, "limit": 20, "items": [{"observation_id": "obs_...", "...": "..."}]}
```

### `GET /api/v1/observations/{observation_id}`

不存在或属于其它凭证 → `404 OBSERVATION_NOT_FOUND`（不泄露存在性）。

### `DELETE /api/v1/observations/{observation_id}`

删除自己的记录，成功 `204`。

### 运维端点

`/healthz`、`/readyz`（返回数据库路径与记录数）、`/metrics`。

## 4. 错误码

| 码 | HTTP | 触发 |
|---|---:|---|
| `VALIDATION_ERROR` | 422 | 字段缺失/越界、经纬度不成对 |
| `INVALID_PAGE_SIZE` | 422 | `limit` 超过服务上限 |
| `NOTE_TOO_LONG` | 422 | 备注超长 |
| `OBSERVATION_NOT_FOUND` | 404 | 不存在或不属于当前凭证 |
| `AUTH_REQUIRED` / `AUTH_INVALID` | 401 | 缺少/错误凭证 |
| `INTERNAL_ERROR` | 500 | 未预期异常 |

## 5. 测试

```bash
cd backend
pytest tests/test_business.py
```

覆盖：幂等写入、分页与来源过滤、按凭证隔离、删除、字段校验、鉴权、就绪检查。
