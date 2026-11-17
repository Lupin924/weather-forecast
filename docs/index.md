# 🌌 天气与观星预报系统 · Code Wiki

聚合 **CMA 中央气象台 + ECMWF + GFS** 三源气象数据，面向旅游/观星目的地的 Web 应用。
技术栈：**Python FastAPI** 后端 + **原生 HTML/CSS/JS** 前端 + **Chart.js** 可视化。
无需 API Key、无需前端构建，支持 **EXE / Docker / 开发** 三种运行模式。

---

## 📑 文档结构

| 文档 | 内容 |
|:---|:---|
| [index.md](index.md) | 项目概览、技术栈、数据流、模块地图（本文档） |
| [01-architecture.md](01-architecture.md) | 整体架构、目录结构、数据流、运行模式路径策略 |
| [02-backend.md](02-backend.md) | 后端核心：FastAPI 入口、配置、路由、响应模型 |
| [03-services.md](03-services.md) | 服务层详解：数据源客户端、观星评分算法、缓存、光污染等 |
| [04-frontend.md](04-frontend.md) | 前端：页面结构、API 封装、渲染模块、图表、交互逻辑 |
| [05-deployment.md](05-deployment.md) | 运行方式：开发 / EXE 打包 / Docker 部署、健康检查、故障排查 |

---

## 🧭 功能模块总览

| 模块 | 说明 | 数据源 |
|:---|:---|:---|
| 🌡️ 实时天气 | 气温/体感/气压/湿度/风/降水 + 气象预警徽章 | CMA |
| 🌙 天文信息 | 月相可视化、日出日落、月出月落、照亮比例 | Open-Meteo |
| 📅 7 天预报 | 高低温、天气图标、降水（CMA + Open-Meteo 集成） | CMA + Open-Meteo |
| ⏱️ 逐小时预报 | 温度折线 + 云量面积 + 风速柱（双轴 Chart.js） | CMA + Open-Meteo |
| 🔭 观星条件评分 | 18:00–05:00 逐时 0-100 评分时间轴 + 最佳窗口 | ECMWF + 天文 + 空气质量 |
| 📊 多模型集成 | ECMWF vs GFS 对比表 + 集成值 + 分歧度 | Open-Meteo |
| 📈 历史同期比对 | 近 3 年同期高低温/降水柱状图 | Open-Meteo Archive |
| 🌀 天气系统分析 | 7 天气压趋势 + 台风/强系统识别 | ECMWF |
| 🏙️ 空气质量/光污染 | 欧洲 AQI + Bortle 等级（VIIRS 本地数据库） | Open-Meteo Air + 本地 |

---

## 🔀 技术栈与依赖

**Python 依赖**（见 [requirements.txt](../requirements.txt)）：

| 依赖 | 用途 |
|:---|:---|
| fastapi >= 0.110 | Web API 框架 |
| uvicorn >= 0.27 | ASGI 服务器 |
| httpx >= 0.27 | 异步 HTTP 客户端（对外部 API 请求） |
| pydantic >= 2.6 | 数据校验与响应模型 |

**前端依赖**（CDN 引入，见 [index.html](../static/index.html)）：
- Chart.js 4.4.1 —— 逐小时/历史/气压图表

---

## 🏗️ 一图看懂模块地图

```
weather-forecast-latest/
├── run.py                     # EXE 入口（启动 uvicorn + 打开浏览器）
├── app/                       # —— 后端 ——
│   ├── main.py                # FastAPI 入口（挂 CORS / 静态 / 路由）
│   ├── paths.py               # 统一路径（EXE / Docker / dev 三模式）
│   ├── config.py              # 城市预设 + API端点 + 评分权重 + 缓存TTL
│   ├── api/routes.py          # REST 路由（约 13 个端点）
│   ├── models/schemas.py      # Pydantic 响应模型（统一信封）
│   └── services/              # —— 服务层 ——
│       ├── cma.py             # CMA 中央气象台客户端
│       ├── open_meteo.py      # Open-Meteo 客户端（ECMWF/GFS/历史/天文）
│       ├── ensemble.py        # 多模型集成 + 分歧度
│       ├── stargazing.py      # 观星评分算法（核心）
│       ├── light_pollution.py # Bortle 本地数据库 + 插值
│       ├── elevation.py       # 海拔气温订正
│       ├── typhoon.py         # 台风/强系统识别
│       ├── air_quality.py     # 空气质量 + 光污染集成
│       └── cache.py           # 文件级 TTL 缓存（stale-while-revalidate）
├── static/                    # —— 前端（FastAPI 挂载）——
│   ├── index.html             # 单页布局
│   ├── css/style.css          # 样式（深色/浅色主题）
│   └── js/  api.js · app.js · weather.js · charts.js · stargazing.js
├── Dockerfile · docker-compose.yml · .dockerignore
├── build.spec · build_exe.py  # PyInstaller 打包
├── cache/                     # JSON 缓存（自动生成）
├── logs/                      # 运行日志（自动生成）
└── requirements.txt
```

---

## 🔄 数据流

```
前端 fetch ──> FastAPI 路由 ──> 服务层（缓存优先检查）
      │              │               │
      │              │        ┌──────┴──────┐
      │              │        │ 外部 API 并发抓取 │
      │              │        │ CMA / Open-Meteo │
      │              │        └──────┬──────┘
      │              │        写入 cache/*.json
      │       统一信封 JSON（city + data + meta）
      └────── 前端按卡片分区渲染（各卡独立不阻塞）
```

**多数据源合并策略**：`now` / `forecast` / `hourly` 均采取「CMA 优先 + Open-Meteo 兜底/补充」的方式，
用同一日期键做去重合并，缺失字段（如降水、云量、阵风）由 Open-Meteo 补全。

---

## 🔌 运行方式速览

| 模式 | 命令/入口 | 地址 |
|:---|:---|:---|
| 开发 | `uvicorn app.main:app --reload --host 0.0.0.0 --port 8787` | http://localhost:8787 |
| EXE | `python build_exe.py` 产物 `dist/WeatherForecast.exe` | 127.0.0.1:8000 |
| Docker | `docker compose up -d` | http://localhost:8787 |

> 详见 [05-deployment.md](05-deployment.md) 的逐步说明与故障排查。

---

## 🪪 版本信息

- FastAPI App 版本：`1.0.0`
- `/api/health` 接口返回版本：`2.0.0`

> 本文档由代码分析自动生成，覆盖后端服务层、前端渲染层与部署链路。