# 02 · 后端核心

## 1. 配置模块（app/config.py）

集中管理所有常量与预置数据，被路由和服务层广泛引用。

### 1.1 城市预设 `City` / `CITIES`
- `City`（dataclass）：`id / name / latitude / longitude / elevation_m / cma_station_id / desc / tags`。
- `CITIES`：约 30+ 内置旅游/观星城市，含坐标、海拔、CMA 站号、描述与标签。
  - 注意：代码中出现 `beijing` 与 `huanghe`（值实为"黄山"）两个重复 key 定义，后者覆盖前者；
    重复 `hangzhou_westlake`、`yinchuan` 等为历史遗留。
- `DEFAULT_CITY_ID = "beijing"`。

### 1.2 工具函数
| 函数 | 说明 |
|:---|:---|
| `get_city(city_id)` | 按 id 查询预设城市，返回 `City` 或 `None` |
| `search_cities(keyword, limit)` | 按名称/描述/标签/ID 模糊搜索预设城市 |
| `lookup_cma_city(name)` | 在 `CMA_STATION_MAP` 中按名称精确/模糊查询站号与坐标 |

### 1.3 CMA 站号库 `CMA_STATION_MAP`
约 50 个主要城市的 `{station_id, lat, lon, elev}` 映射，用于按名称解析站号（供自定义/非预设城市使用）。

### 1.4 外部 API 端点与超时
```
CMA_BASE="https://weather.cma.cn/api"
OPEN_METEO_FORECAST=...forecast   / OPEN_METEO_ECMWF=...ecmwf
OPEN_METEO_GFS=...gfs             / OPEN_METEO_ARCHIVE=...archive
OPEN_METEO_AIR=...air-quality
HTTP_TIMEOUT=15.0   # 单次请求超时（秒）
```

### 1.5 观星评分权重 `STARGAZE_WEIGHTS`
| 维度 | 权重 | 维度 | 权重 |
|:---|:---:|:---|:---:|
| 云量 cloud | 0.22 | 能见度 visibility | 0.07 |
| 天光 night_sky | 0.18 | 湿度 humidity | 0.07 |
| 月相 moon | 0.13 | 风速 wind | 0.06 |
| 降水 precipitation | 0.12 | 空气质量 air_quality | 0.05 |
| 光污染 light_pollution | 0.10 | **合计** | **1.00** |

- `RATING_THRESHOLDS`：`≥70 优 / ≥50 良 / ≥30 中 / <30 差`。
- `rating_for(score)` 返回 `(中文评级, 英文等级)`。
- `LAPSE_RATE=6.5`（°C/1000m）用于海拔气温订正。
- 观星时间窗口：当日 `18:00` 起至次日 `05:00`。

### 1.6 缓存 TTL（秒）`CACHE_TTL`
| 类型 | TTL | 类型 | TTL |
|:---|:---:|:---|:---:|
| now | 600 | astronomy | 86400 (1天) |
| forecast | 3600 | historical | 604800 (7天) |
| hourly | 3600 | analysis | 3600 |
| multimodel | 3600 | air_quality | 1800 |
| stargazing | 3600 | | |

### 1.7 天气系统阈值
- `TYPHOON_PRESSURE_THRESHOLD=980.0`：海平面气压低于此值判为强系统。
- `TYPHOON_DROP_THRESHOLD=10.0`：24h 气压降幅超过此值判为快速增强/过境。

---

## 2. 响应模型（app/models/schemas.py）

全部为 Pydantic v2 模型，定义了统一信封与各端点数据结构。

### 2.1 统一信封
```
class ApiResponse:
    city: CityInfo      # 城市标识
    data: Any           # 业务数据（各端点自定义）
    meta: Meta          # sources / updated_at / confidence / stale
```

### 2.2 各端点数据模型
| 模型 | 对应端点 |
|:---|:---|
| `CurrentWeather` / `WeatherAlarm` | `/now` 实况 + 预警 |
| `DailyForecast` | `/forecast` 7 天 |
| `HourlyPoint` | `/hourly` 逐小时 |
| `ModelValues` / `MultiModelData` | `/multimodel` 集成 |
| `StargazingHour` / `StargazingResult` | `/stargazing` 观星 |
| `AstronomyInfo` | `/astronomy` 天文 |
| `HistoricalYear` / `HistoricalComparison` | `/historical` 历史 |
| `SystemAnalysis` | `/analysis` 系统分析 |

> 实际路由多直接返回 dict（未强制断言 schema），模型主要作为 Swagger 文档与类型约束。

---

## 3. 路由层（app/api/routes.py）

### 3.1 路由前缀与公共工具

- `router = APIRouter(prefix="/api")`。
- `_today_str()` —— 今日 `YYYY-MM-DD`。
- `_resolve_city(city_id, lat, lon, elevation, station_id)` —— **城市解析核心**，支持四类来源：
  1. 显式 `station_id` → 直接构造 Site 站点。
  2. `city_id == "custom"` → 自定义坐标。
  3. 预设城市（`get_city`）。
  4. 按名称模糊搜索 CMA 站号（`lookup_cma_city`）。
  5. 均未命中 → 抛 `HTTPException(404)`。
- `_envelope(city, data, sources, confidence, stale)` —— 组装统一信封 JSON。

### 3.2 端点清单

| 方法 | 路径 | 核心函数 | 说明 |
|:---|:---|:---|:---|
| GET | `/api/cities` | `list_cities` | 预设城市列表 + default |
| GET | `/api/search/cities?q=` | `search_cities_endpoint` | 关键词搜索（预设 + CMA） |
| GET | `/api/search/resolve?name=` | `resolve_city` | 按名称解析城市并跳转 |
| GET | `/api/weather/{id}/now` | `weather_now` | 实况 + 预警（支持日期，未来≤3天用预报） |
| GET | `/api/weather/{id}/forecast` | `weather_forecast` | 7 天预报（CMA + Open-Meteo 合并） |
| GET | `/api/weather/{id}/hourly?date=` | `weather_hourly` | 逐小时（CMA 近24h + Open-Meteo 补齐） |
| GET | `/api/weather/{id}/multimodel?date=` | `weather_multimodel` | ECMWF/GFS 集成 + 分歧度 |
| GET | `/api/stargazing/{id}?date=` | `stargazing_score` | 观星评分时间轴 |
| GET | `/api/astronomy/{id}?date=` | `astronomy` | 月相/日出日落 |
| GET | `/api/air-quality/{id}` | `get_air_quality_endpoint` | 空气质量 + 光污染 |
| GET | `/api/historical/{id}?month_day=` | `historical` | 近 3 年同期比对 |
| GET | `/api/analysis/{id}?date=` | `analysis` | 天气系统分析 |
| GET | `/api/health` | `health_check` | 健康检查（version 2.0.0） |

> 绝大多数端点都支持 `lat / lon / elevation / station_id` 查询参数，以覆盖自定义坐标场景。

### 3.3 关键端点实现细节

**now（实况，含日期逻辑）**
1. `target == today`：用 `cma.get_now` 取实况 + 预警；无 CMA 站号或失败时，用 Open-Meteo
   `hourly[0]` 兜底。
2. `target > today`（仅 ≤3 天）：取 Open-Meteo 预报同时刻点，叠加 CMA 预报的最高/最低温，
   `mode="forecast"`；标记 `sources=["Open-Meteo预报"]`。
3. `target < today` 或 `>3 天`：返回 `mode="unavailable"`。

**forecast（7 天 + 合并）**
- 优先 CMA `daily`（含中文天气文本），过滤掉早于今天的过期日期（防停用站号返回旧数据）。
- 用 Open-Meteo 补齐 `precipitation / cloud_cover`，并追加 CMA 窗口外的日期。
- 结果按日期升序排序。

**hourly（逐小时 + 合并）**
- CMA `get_hourly` 提供近 24h 中文 `text`，风速度 `m/s→km/h`。
- Open-Meteo 补充 7 天窗口、`wind_gusts / dew_point / visibility` 等，跳过 CMA 已覆盖时刻。
- 按时间排序，去重由 CMA 时刻集合控制。

**historical（历史同期）**
- 取 `{year-1, year-2, year-3}` 三整年，调用 Open-Meteo Archive 逐次查询，任一失败则跳过。

---

## 4. EXE 启动脚本（run.py）

PyInstaller onefile 打包的入口（`Analysis(['run.py'])`），负责：
- `setup_logging()`：日志写入 `logs/weather_forecast.log`（FileHandler），抑制 httpx/uvicorn 噪音。
- `is_port_available(host, port)`：检测 8000 端口是否空闲。
- 端口被占用：直接尝试打开浏览器并挂起。
- 否则：子线程启动 `uvicorn.run(app, 127.0.0.1:8000)`（非阻塞、无 console、access_log 关闭）。
- `wait_for_server(host, port, max_wait=15)`：轮询探测端口就绪。
- 就绪后 `open_browser(url)` 打开系统默认浏览器（Windows：`os.startfile`）。
- 主线程常驻保持进程存活。

> README 中描述 EXE 产物体积约 18MB；`build_exe.py` 中注释约 30MB（实际以产物为准）。