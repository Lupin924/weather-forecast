# 01 · 整体架构

## 1. 层级结构

项目采用「三层结构」：**路由层 → 服务层 → 数据源层**。

```
┌─────────────────────────────────────────────────────────┐
│                      前端 (static/)                      │
│  index.html + api.js + app.js + weather.js + charts.js  │
│                    + stargazing.js                       │
└──────────────────────────┬──────────────────────────────┘
                           │ fetch /api/*
┌──────────────────────────▼──────────────────────────────┐
│                    路由层 (app/api/routes.py)            │
│  · 解析城市 (_resolve_city)  · 统一信封 (_envelope)     │
└──────────────────────────┬──────────────────────────────┘
┌──────────────────────────▼──────────────────────────────┐
│              服务层 (app/services/)                      │
│  cma · open_meteo · ensemble · stargazing · typhoon     │
│  air_quality · light_pollution · elevation · cache       │
└──────────────────────────┬──────────────────────────────┘
┌──────────────────────────▼──────────────────────────────┐
│               数据源层（外部 HTTP API）                  │
│  CMA 中央气象台 · Open-Meteo(ECMWF/GFS/Archive/Air)     │
└─────────────────────────────────────────────────────────┘
```

- **路由层**：负责参数解析、校验、并发编排、异常兜底、封装统一 JSON 信封。
- **服务层**：封装数据源调用、数据聚合、算法计算、缓存读写。服务层之间可互相依赖
  （如 `stargazing` 依赖 `open_meteo` 与 `air_quality`）。
- **数据源层**：外部免费 HTTP API，通过 `httpx.AsyncClient` 异步并发请求。

---

## 2. 运行模式与路径策略（app/paths.py）

`paths.py` 通过模式检测统一了**可执行文件 / 容器 / 开发环境**下的资源、缓存与日志路径，避免
不同部署形态下找不到静态资源或无法写盘的问题。

```
detect_mode() ──> MODE ∈ {"exe", "docker", "dev"}
```

| 模式 | 判定条件 | BASE_DIR | DATA_DIR |
|:---|:---|:---|:---|
| `exe` | `sys.frozen and _MEIPASS`（PyInstaller onefile） | 临时解压目录 `_MEIPASS` | EXE 所在目录（`sys.executable.parent`） |
| `docker` | 环境变量 `DOCKER_RUNNING=1` | `/app` | `/app` |
| `dev` | 兜底 | 项目根目录 | 项目根目录 |

派生路径：

- `STATIC_DIR = BASE_DIR / "static"` —— 前端静态资源
- `CACHE_DIR  = DATA_DIR / "cache"` —— JSON 缓存
- `LOGS_DIR   = DATA_DIR / "logs"` —— 运行日志
- `ensure_dirs()` —— 启动时创建缓存与日志目录
  - **`main.py` 在模块加载时调用 `ensure_dirs()`**，保证胃任何端点被访问前目录已就绪。

> 设计要点：**EXE 模式下静态资源从临时解压目录读取（只读），可变数据（缓存/日志）写入
> EXE 所在目录**，从而支持 onefile 单文件运行。

---

## 3. FastAPI 应用装配（app/main.py）

```
fastapi.FastAPI(title=..., version="1.0.0")
  ├── add_middleware(CORSMiddleware, allow_origins=["*"], ...)
  ├── include_router(router)              # /api/* 全部路由
  ├── mount("/static", StaticFiles(static)) # 前端静态资源
  ├── GET /         → 返回 index.html
  └── GET /api/health → {"status":"ok"}
```

- CORS 全放开（`*`），便于任意前端/代理访问。
- 静态目录挂载在 `/static`，`/` 直接返回 `index.html`。
- 应用入口对象为模块级 `app`，供 `uvicorn` 与 EXE 启动脚本导入。

---

## 4. 请求链路示例（实时天气）

```
GET /api/weather/beijing/now?date=2026-08-25
  → weather_now()
  → _resolve_city("beijing", ...)  → CityInfo(北京, 39.90, 116.40, 50, cma=54511)
  → target == today → 走「今天」分支
  → cma.get_now("54511")           → 实况 + 预警（带缓存）
  → 组装 data, 记录 sources=["CMA"], stale
  → _envelope(city, data, sources, confidence, stale) → 统一 JSON
```

未来日期（`target > today`）分支会改用 Open-Meteo 预报的同一时刻数据，并用 CMA 预报
补齐最高/最低气温，标记 `mode="forecast"`；超出 3 天返回 `mode="unavailable"`。

---

## 5. 依赖关系图（模块间）

```
main.py ──> paths.py（模块加载即 ensure_dirs）
  └──> api/routes.py ──> config.py
        │   ├──> models/schemas.py（CityInfo）
        ├──> services/cma.py ───────> config.py, services/cache.py
        ├──> services/open_meteo.py ─> config.py, services/cache.py
        ├──> services/ensemble.py ───> services/open_meteo.py
        ├──> services/stargazing.py ─> open_meteo, air_quality, config
        ├──> services/typhoon.py ────> services/open_meteo.py, config
        └──> services/air_quality.py -> open_meteo, light_pollution, cache, config
```

**依赖规则**：`services/cache.py` 与 `services/light_pollution.py` 是最底层（无项目内依赖，
仅依赖 `paths.py` / 标准库）；`open_meteo`、`cma` 为数据源基础；上层算法模块（`stargazing`、
`ensemble`、`typhoon`）依赖数据源模块完成组合计算。