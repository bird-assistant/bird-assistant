# 地图接口交接 · Issue #14

本文件描述前端已预留的接口合同，供业务后端评审，不表示服务已经存在。现有 `backend/` 是 GPU 视觉服务，不负责这里的观测查询、用户权限和媒体。

## 观测列表

`GET {apiBaseUrl}/api/v1/map/observations`

| 参数 | 含义 |
|---|---|
| `minLatitude/minLongitude/maxLatitude/maxLongitude` | 原生地图可见区域的西南/东北角；经度最小值大于最大值时表示跨日期变更线 |
| `coordinateSystem` | 固定 `GCJ-02`，范围查询也按此解释 |
| `scope` | `all` 公开与本人私人标记、`public` 公开、`mine` 本人私人标记 |
| `startDate/endDate` | 上海时区的观察日期边界，`YYYY-MM-DD`，含首尾；空字符串表示不限 |
| `speciesId` | 空表示全部，`__unknown__` 表示待鉴定，其他为稳定物种 ID |
| `cursor/limit` | 不透明分页游标，首屏为空；每页 60 条 |

响应：

```json
{
  "items": [
    {
      "id": "observation-public-copy-id",
      "speciesId": "avibase-id-from-catalog",
      "speciesName": "白鹭",
      "observedAt": "2026-10-29T08:40:00+08:00",
      "displayLocation": { "latitude": 31.8206, "longitude": 117.2272 },
      "coordinateSystem": "GCJ-02",
      "sourceCoordinateSystem": "WGS84",
      "placeName": "展示地点",
      "visibility": "public",
      "anonymous": true,
      "publicName": "",
      "mediaType": "photo",
      "thumbnailUrl": "",
      "source": "来源及允许公开的引用",
      "updatedAt": "2026-10-29T10:00:00+08:00",
      "locationNote": "公开位置已由服务端按策略处理"
    }
  ],
  "nextCursor": "",
  "total": 1
}
```

`observedAt` 必须带时区；未知时为空，不用上传时间替代。`speciesId` 未知时为空。`mediaType` 为 `photo/audio/none`；无预览时按媒体类型显示占位，不伪造图片或录音。`total` 是当前查询对调用者可见的观察记录总数，`nextCursor` 为空表示结束。

客户端按需分页，最多持有 300 条当前视野记录，更多记录要求放大或筛选；聚合数字只统计**已加载**的公开记录，面板注明已加载，不将它当作完整区域总数。重新查询会清空旧视野记录；重复游标停止继续加载。后端应提供稳定分页以避免记录在分页期间遗漏。

请求使用 `Authorization: Bearer <用户短期凭证>`，由未来登录模块写入 `getApp().globalData.accessToken`。客户端不提交自称的 ownerId，不存长期服务凭证。`all/mine` 的授权必须由服务端判断；匿名公开记录的响应不得包含内部用户标识。API 适配层会投影到展示字段，但这不能补救服务端已经泄露的数据。

WGS84 原始位置应在受控后端保留来源并转换为展示 GCJ-02。前端拒绝未经转换的 WGS84 展示数据，不自行推回敏感精确位置。`displayLocation` 已脱敏时，不得另行返回精确原坐标。

HTTP 401 提示重新登录；403 提示无权限；其他失败提供重试。现阶段未实现登录页面，因此接网关前需与登录负责人约定失效跳转。

## 详情入口

`GET {apiBaseUrl}/api/v1/map/observations/{encodeURIComponent(id)}`，返回单条同形展示记录，服务端逐条鉴权。记录 ID 是允许查看的观察/公开副本 ID，不是临时聚合 ID。不存在、已撤回或无权限的私人对象应按统一权限策略响应。

当前跳转到 `/pages/observation/index?id=...`。详情负责人提供正式页面后，只需替换地图 `openObservation` 的路由，并保持该 ID 合同。

## 选点事件

`/pages/location-picker/index?latitude=...&longitude=...` 的参数仅接受已有 GCJ-02 坐标；未知时完全省略。确认时通过 EventChannel 发出：

```json
{
  "latitude": 31.8206,
  "longitude": 117.2272,
  "coordinateSystem": "GCJ-02",
  "source": "manual",
  "label": "所选位置的展示地址"
}
```

`source` 为 `existing/manual/current`。取消和返回不发事件。初始地图加载不是选点；拖动中禁用确认，地址解析失败仍可确认坐标。定位不会修改历史照片，调用者必须自行决定是否更新表单。该事件不执行记录创建、发布或上传。

## 待团队确认

- 日期与鸟种是否同时筛选私人标记；本轮暂定同时生效。
- “我的标记”是否需要包含本人公开副本；本轮仅私人标记。
- 最终网关路径、游标格式、错误响应及详情正式路由。
- 最终名录搜索接口；本轮 Mock 提供固定鸟种，HTTP 模式保留已见鸟种和待鉴定选项。
- AppID、客户端 Key、定位资格、隐私指引及真机联调时间。
