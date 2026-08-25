# 03 · 服务层详解（app/services/）

服务层是项目核心，负责数据源调用、缓存、聚合与算法计算。分三类：
- **基础数据源**：`cache.py`、`light_pollution.py`、`open_meteo.py`、`cma.py`
- **算法/聚合**：`stargazing.py`、`ensemble.py`、`typhoon.py`、`elevation.py`
- **组合服务**：`air_quality.py`

---

## 1. 缓存模块（cache.py）

文件级 TTL 缓存，支持 **stale-while-revalidate**（上游失败时返回过期数据）。

| 函数 | 说明 |
|:---|:---|
| `get_cache(key, ttl)` | 返回 `(data, stale)`。不存在→`(None, False)`；未过期→`(data, False)`；已过期→`(data, True)` |
| `set_cache(key, data)` | 写入 `cache/{key}.json`，内容 `{"ts": 时间戳, "data": ...}` |
| `_cache_path(key)` | 将 `/ : 空格` 替换为 `_`，生成安全文件名 |

**使用范式**（数据源客户端统一采用）：

```python
cached, stale = cache.get_cache(key, TTL)
if cached is not None and not stale:
    return cached                    # 命中且未过期
try:
    raw = await _fetch_json(url)     # 请求上游
    result = normalize(raw)
    cache.set_cache(key, result)     # 写缓存
    return result
except Exception:
    if cached is not None:           # 上游失败→返回过期缓存（stale）
        cached["_stale"] = True
        return cached
    raise                            # 无缓存则抛出
```

---

## 2. CMA 客户端（cma.py）

`CMA_BASE="https://weather.cma.cn/api"`，覆盖实况、预警、7 天预报、逐小时。

> **关键点**：CMA 服务器拒绝无浏览器特征的请求（返回 403），因此请求必须携带伪造的浏览器 `User-Agent`、
> `Accept` 与 `Referer`。

| 函数 | 端点 | 返回数据 |
|:---|:---|:---|
| `get_now(station_id)` | `/api/now/{id}` | location / now / alarm / last_update |
| `get_weather(station_id)` | `/api/weather/{id}` | daily 列表 + last_update |
| `get_hourly(station_id, date)` | `/api/hourly/{id}` | 按日期分组的逐时列表；可按 date 过滤 |

通用 HTTP 工具 `_fetch_json(url)` 创建带浏览器头部的 `httpx.AsyncClient`。
三个函数均自带缓存与 stale-while-revalidate 逻辑。

---

## 3. Open-Meteo 客户端（open_meteo.py）

统一封装 Open-Meteo 的 **ECMWF / GFS / 通用预报 / 历史归档** 接口。所有请求免费、无需密钥。

**变量集合**：
- `HOURLY_VARS`：温度、湿度、露点、体感、降水、天气码、气压(地面/海平)、三层云量
  （`cloud_cover_low/mid/high`）、风/阵风、能见度，以及 v2.2 新增的对流参数 `cape`、`lifted_index`。
- `DAILY_VARS`：高低温、降水总量、云量均值、最大风速 + 天文 `sunrise/sunset/moonrise/moonset/moon_phase`。

**关键工具**：
- `_pair_lists(d, keys)`：把 Open-Meteo 的 `{var:[...]}` 横向展开为逐点 `{time, var1, var2...}` 列表。
- `_get_model_hourly(base_url, model_name, ...)`：通用模型逐时抓取（ECMWF/GFS 共用）。

| 函数 | 用途 |
|:---|:---|
| `get_forecast(lat, lon, elev, days)` | 通用预报（hourly + daily 天文），供逐时/天文使用 |
| `get_ecmwf_hourly(...)` | ECMWF 逐时 |
| `get_gfs_hourly(...)` | GFS 逐时 |
| `get_historical(lat, lon, start, end)` | 历史归档（日级） |
| `moon_phase_name(phase)` | 月相中文名（新月/娥眉/上弦/盈凸/满月/亏凸/下弦/残月） |
| `moon_illumination_from_phase(phase)` | 由月相算照亮比例：`(1-cos(2π·p))/2*100` |

**月相约定**（Open-Meteo `moon_phase ∈ [0,1)`）：0=新月，0.25=上弦，0.5=满月，0.75=下弦。

---

## 4. 观星评分算法（stargazing.py）★ 核心

对 18:00–次日 05:00 逐小时计算 **0-100 评分**，并按 `STARGAZE_WEIGHTS` 加权。

### 4.1 评分构成（9 维 × 权重）
```
score = s_cloud×0.22 + s_moon×0.13 + s_night×0.18 + s_precip×0.12
      + s_light×0.10 + s_vis×0.07 + s_hum×0.07 + s_wind×0.06 + s_aq×0.05
```

### 4.2 各维度子评分（私有函数）
| 函数 | 逻辑要点 |
|:---|:---|
| `_score_cloud_by_layer` | **v2.2 分层云**：高云>80% 扣×0.3；中云>50% 扣×0.6；低云>30% 扣×1.0（几乎放弃） |
| `_approximate_sun_altitude` | 用正弦曲线近似太阳高度角（分白天/夜间两段） |
| `_score_night_sky` | 按太阳高度分档（民用/航海/天文晨昏），越暗越高 |
| `_score_moon` | 月在地平线下→100；否则 `100-照亮比例` |
| `_score_precipitation` | 降水越大分越低；`≥2mm→0`（硬性约束） |
| `_score_light_pollution` | Bortle 1→100 线性映射到 Bortle 9→0 |
| `_score_visibility` | ≥20km→100，≤2km→0，线性插值 |
| `_score_humidity` | 40–60% 最佳，向两侧线性降分 |
| `_score_wind` | 取阵风优先，`100 - max(0, v-5)×3.5` |
| `_score_air_quality` | 按 AQI 分段（≤50→100 … >200→20） |
| `_score_dew_depression` | **v2.2**：露点分离<2°C→必结露(30)；2-5°C→风险(60)；>5°C→安全(90) |
| `_score_lifted_index` | **v2.2**：LI<-3 强对流(60)；>0 稳定(90)；中性(75) |
| `_score_cape` | **v2.2**：CAPE>1000 高对流(60)；>500(75)；否则(90) |

**降水硬性惩罚**：计算完毕后若 `precip` 较大，整体再乘系数（`≥2mm→×0.05`，`≥1mm→×0.3`，`≥0.5→×0.6`）。

### 4.3 月位置判定
- `_moon_events(daily)`：收集每天 moonrise/moonset 事件并按时间排序。
- `_moon_up_at(t, events)`：统计当前时刻前 rise 与 set 次数，rise>set 则月亮在地平线上。

### 4.4 最佳窗口检测 `_find_best_window`
在夜间各小时中，滑动搜索 `min_duration=2 ~ max_duration=8` 的连续窗口，要求：
- 相邻小时间隔 ≤2h（连续性）；
- 平均分 ≥30（最低门槛）；
- 优先更高平均分；平分时取更长窗口。

返回 `(开始时间, 结束时间, 平均分)`。

### 4.5 建议生成 `_generate_recommendation`
基于最佳窗口、优势/劣势维度、前后半段趋势与光污染严重度，生成自然语言建议（如
「✅ 今晚观星条件优秀，推荐观测窗口 21:10–02:30」）。光污染严重时主动下调评级前缀。

### 4.6 汇总出口 `build_stargazing(lat, lon, elev, date_str)`
1. 取 7 天预报 `hourly/daily`，联合同步取空气质量与光污染（Bortle）。
2. 确定夜窗：`今天日落-30min` ~ `次日日出+30min`。
3. 遍历窗口内逐时点，白天记分 0 (`is_daytime=true`)，夜间完整评分并附 `breakdown` 明细。
4. 统计最佳单小时、连续最佳窗口、可观测时长、平均分等，返回结构化结果。

> 返回 `breakdown` 含 v2.2 新维度的 `cloud_layers / dew_depression / dew_info / lifted_index / cape`，
> 供前端展示「评分维度分解」。

---

## 5. 多模型集成（ensemble.py）

对比 **ECMWF vs GFS** 逐时数据并聚合成日级。

| 函数 | 说明 |
|:---|:---|
| `_points_for_date(hourly, date)` | 按日期过滤逐时点 |
| `_aggregate(points)` | 聚合为 `{high,low,precipitation,cloud_cover_mean,wind_speed_max}` |
| `_ensemble(ec, gfs)` | 逐字段取均值（缺失字段由另一模型补） |
| `_classify(div, small, mid)` | 分歧大小→「小/中/大/未知」 |
| `_divergence(ec, gfs)` | 温度(阈2/4)、降水(2/5)、云量(20/40) 分级 |
| `build_multimodel(lat,lon,elev,date)` | 并抓 ECMWF+GFS，输出 ecmwf/gfs/ensemble/divergence |

---

## 6. 天气系统分析（typhoon.py）

基于 ECMWF 海平面气压趋势与阵风识别台风/强系统。

| 函数 | 说明 |
|:---|:---|
| `_pressure_of(p)` | 优先 `pressure_msl`，退而取 `surface_pressure` |
| `build_analysis(lat,lon,elev,date)` | 取前 7 天→后 1 天 ECMWF，按日聚合气压/风/阵风 |

**判定逻辑**：
- `system_detected`：最低气压 < 980 hPa，或 24h 最大降幅 > 10 hPa。
- `influence_ended`：目标日阵风较峰值下降 > 40% 视为影响已结束。
- 输出 `pressure_series` / `min_pressure` / `max_24h_drop` / `conclusion` 等。

---

## 7. 空气质量 + 光污染（air_quality.py）

组合 Open-Meteo Air Quality API 与本地光污染数据库。

| 函数 | 说明 |
|:---|:---|
| `get_air_quality(lat, lon, elev, target_date)` | current AQI/PM2.5/PM10 等 + hourly(72h) + 光污染 |

- 空气质量：`european_aqi` 等来自 Open-Meteo，`forecast_days=3`。
- 光污染：本地库 `light_pollution.get_light_pollution(lat, lon, elev)`，**不依赖网络**。
- 网络失败时：有缓存→返回 stale；无缓存→仍返回光污染数据并置 `_error=True`。

---

## 8. 光污染评估（light_pollution.py）

基于 **VIIRS 卫星夜间灯光** 构建的本地 **Bortle 1-9 级** 数据库，无需外部 API，离线可用。

- `BortleRef`（dataclass）：bortle / label / sqm / sqm_range / description / milky_way / score。
- `BORTLE_SCALE`：1（优秀暗空，100分）→ 9（市中心，0分）。
- `_LIGHT_POLLUTION_DB`：约 70 个中国城市/地点 `(lat, lon, bortle, name)`。

| 函数 | 说明 |
|:---|:---|
| `_haversine_km` | 两点球面距离（km） |
| `get_light_pollution(lat, lon, elev)` | 主入口：<5km 直接取最近点；否则反向距离加权(`1/d²`)插值最近 5 点；海拔>500m 修正（每千米 -0.5 级，封顶 -2 级） |
| `_idw_interpolate` | 反向距离加权 |
| `bortle_to_score(bortle)` | Bortle → 观星评分 |
| `bortle_to_aqi_equivalent(bortle)` | Bortle → 等效 AQI（兼容旧接口） |

---

## 9. 海拔气温订正（elevation.py）

- `correct_temperature(temp, from_elev, to_elev)`：按 `LAPSE_RATE=6.5°C/1000m` 标准递减率订正气温。

> 注：`open_meteo` 通过请求中的 `elevation` 参数直接地形降尺度；本函数用于需要对 CMA
> (站址海拔) 结果订正到目标地点海拔的场景。