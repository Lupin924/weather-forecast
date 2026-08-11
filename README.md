# 🌌 旅游城市天气预报及观星条件预报软件

聚合 **CMA 中央气象台 + ECMWF + GFS** 三源气象数据，面向旅游/观星目的地的 Web 应用。
Python FastAPI 后端 + 原生 HTML/CSS/JS 前端 + Chart.js 可视化，无需 API Key、无需前端构建。

---

## ✨ 功能特性

| 模块 | 说明 | 数据源 |
|:---|:---|:---|
| 🌡️ 实时天气 | 气温/体感/气压/湿度/风/降水 + 气象预警徽章 | CMA |
| 🌙 天文信息 | 月相可视化、日出日落、月出月落、照亮比例 | Open-Meteo |
| 📅 7 天预报 | 高低温、天气图标、降水；CMA + Open-Meteo 集成 | CMA + Open-Meteo |
| ⏱️ 逐小时预报 | 温度折线 + 云量面积 + 风速柱（双轴 Chart.js） | CMA + Open-Meteo |
| 🔭 观星条件评分 | 18:00-05:00 逐时 0-100 评分时间轴 + 最佳窗口 | ECMWF + 天文 |
| 📊 多模型集成 | ECMWF vs GFS 对比表 + 集成值 + 分歧度 | Open-Meteo |
| 📈 历史同期比对 | 近 3 年同期高低温/降水柱状图 | Open-Meteo Archive |
| 🌀 天气系统分析 | 7天气压趋势 + 台风/强系统识别 | ECMWF |

**观星评分算法**（0-100，加权）：
- 云量 35% ｜ 月相/月位置 25% ｜ 能见度 15% ｜ 湿度 15% ｜ 风速+阵风 10%
- 评级：🟢优(≥70) / 🟡良(50-69) / 🟠中(30-49) / 🔴差(<30)

---

## 🚀 快速开始

### 1. 安装依赖

```bash
pip install -r requirements.txt
```

### 2. 启动服务

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8787
```

### 3. 访问应用

- **主界面**：http://localhost:8787
- **API 文档**（Swagger）：http://localhost:8787/docs

---

## 📦 打包为 EXE（可选）

生成单个 Windows 可执行文件（约 18MB），双击即可运行，无需任何环境依赖。

### 1. 安装 PyInstaller

```bash
pip install pyinstaller
```

### 2. 执行打包

```bash
python build_exe.py
```

### 3. 产物说明

打包完成后，产物为单个文件：

```
dist/WeatherForecast.exe    # 约 18 MB
```

所有依赖（Python 运行时、FastAPI、uvicorn、前端资源等）均已内嵌在单个 EXE 中。

### 4. 分发与运行

1. 将 `WeatherForecast.exe` 复制到目标电脑
2. 双击运行，程序会自动解压临时文件并启动服务
3. 服务就绪后自动打开默认浏览器访问应用

**特性**：
- 🔹 **单文件分发**：仅一个 EXE，方便邮件/网盘传输
- 🔹 **无控制台窗口**：纯净后台运行
- 🔹 **自动打开浏览器**：服务就绪后自动打开系统默认浏览器
- 🔹 **完整后端服务**：所有 API 端点完全内置

**注意**：
- 首次启动需几秒解压时间（onefile 模式固有特性）
- 运行期间 EXE 会解压到临时目录，建议固定磁盘位置运行
- 如需退出，在任务管理器结束 `WeatherForecast.exe`

### 5. 故障排查

如果程序无法正常工作，请查看日志文件：
```
<EXE所在目录>/logs/weather_forecast.log
```

常见问题：
- **页面显示"无法访问此页面"**：杀毒软件可能拦截了解压过程，临时关闭杀毒软件或添加白名单
- **端口被占用**：关闭占用 8787 端口的程序后重试
- **首次启动慢**：onefile 模式需解压，首次启动约 5-15 秒

---

## 🐳 Docker 部署

将应用部署为 Docker 容器，适合服务器/VPS 环境长期运行。

### 方式一：docker compose（推荐）

```bash
# 构建并启动
docker compose up -d

# 查看日志
docker compose logs -f

# 停止
docker compose down
```

### 方式二：原生 Docker

```bash
# 构建镜像
docker build -t weather-forecast:latest .

# 运行容器（挂载缓存和日志目录）
docker run -d \
  --name weather-forecast \
  -p 8787:8000 \
  -v $(pwd)/cache:/app/cache \
  -v $(pwd)/logs:/app/logs \
  -e TZ=Asia/Shanghai \
  weather-forecast:latest
```

### 环境变量

| 变量 | 说明 | 默认 |
|:---|:---|:---|
| `TZ` | 时区 | - |
| `DOCKER_RUNNING` | 自动设置为 `1`，标识 Docker 模式 | 由 Dockerfile 设置 |

### 持久化

`docker-compose.yml` 已配置以下 volume 挂载：
- `./cache → /app/cache`（API 响应缓存，避免重复请求）
- `./logs → /app/logs`（运行日志）

数据不会因容器重建而丢失。

### 健康检查

容器内置 `/api/health` 端点，compose 配置了 30 秒间隔的健康检查。

### 访问

启动后访问：http://localhost:8787

---

## 🔀 双模式部署说明

项目支持两种部署模式，共用同一套代码：

| 模式 | 入口 | 运行位置 | 适用场景 |
|:---|:---|:---|:---|
| **EXE** | `run.py` | 本机 127.0.0.1:8000 | 桌面用户，双击即用 |
| **Docker** | `CMD uvicorn ...` | 容器 0.0.0.0:8000 | 服务器部署，长期运行 |

路径策略由 [app/paths.py](app/paths.py) 统一处理：
- **EXE 模式**：缓存/日志写入 EXE 同目录
- **Docker 模式**：缓存/日志写入 `/app`（建议挂载 volume）
- **开发模式**：缓存/日志写入项目根目录

---

## 🎨 界面交互

- **加载动画**：页面顶部有全局进度条显示加载进度，每个卡片在加载时会显示旋转 Spinner
- **实时反馈**：每个模块加载完成后会独立更新，不会阻塞其他模块
- **自动刷新**：实时天气每 10 分钟自动刷新一次

---

## 🏗️ 架构

```
weather/
├── app/
│   ├── main.py              # FastAPI 入口（挂载静态、CORS、路由）
│   ├── paths.py             # 统一路径处理（EXE/Docker/dev 三模式）
│   ├── config.py            # 城市预设、API 端点、评分权重、缓存 TTL
│   ├── api/routes.py        # 9 个 REST 端点
│   ├── services/
│   │   ├── cma.py           # CMA 客户端（带浏览器 UA，规避 403）
│   │   ├── open_meteo.py    # Open-Meteo 客户端（ECMWF/GFS/历史/天文）
│   │   ├── ensemble.py      # 多模型集成 + 分歧度
│   │   ├── stargazing.py    # 观星评分算法
│   │   ├── light_pollution.py # Bortle 等级本地数据库 + 插值
│   │   ├── elevation.py     # 海拔气温订正
│   │   ├── typhoon.py       # 天气系统/台风识别
│   │   ├── air_quality.py   # 空气质量 + 光污染集成
│   │   └── cache.py         # 文件 TTL 缓存（stale-while-revalidate）
│   └── models/schemas.py    # Pydantic 响应模型
├── static/                  # 前端（FastAPI 挂载）
│   ├── index.html
│   ├── css/style.css
│   └── js/ (api, charts, weather, stargazing, app)
├── cache/                   # JSON 缓存（自动生成）
├── logs/                    # 运行日志（自动生成）
├── run.py                   # EXE 入口（PyInstaller 打包用）
├── build.spec               # PyInstaller 打包配置
├── Dockerfile               # Docker 构建文件
├── docker-compose.yml       # Docker Compose 编排
├── .dockerignore            # Docker 构建忽略规则
└── requirements.txt
```

**数据流**：前端 fetch → FastAPI 路由 → 服务层并发抓取外部 API（缓存优先）→ 统一信封 JSON → 前端分区渲染。

---

## 🌍 内置城市预设

| 城市 | 坐标 | 海拔 | CMA 站点 |
|:---|:---|:---:|:---:|
| 北京（默认） | 39.904, 116.407 | 43 | 54511 |
| 莫干山 | 30.60, 119.90 | 600m | 58450 |
| 长白山 | 42.02, 128.08 | 1800m | 54085 |
| 青海湖 | 36.90, 100.20 | 3200m | 52856 |
| 阿里天文台 | 32.32, 80.10 | 5100m | 55228 |
| 黄山 | 30.13, 118.16 | 1840m | 58437 |

也支持顶栏「📍 自定义坐标」输入任意经纬度+海拔。

---

## 🔌 API 端点

| 方法 | 路径 | 说明 |
|:---|:---|:---|
| GET | `/api/cities` | 预设城市列表 |
| GET | `/api/weather/{city_id}/now` | 实况 + 预警 |
| GET | `/api/weather/{city_id}/forecast` | 7 天预报 |
| GET | `/api/weather/{city_id}/hourly?date=` | 逐小时 |
| GET | `/api/weather/{city_id}/multimodel?date=` | ECMWF/GFS 集成 |
| GET | `/api/stargazing/{city_id}?date=` | 观星评分时间轴 |
| GET | `/api/astronomy/{city_id}?date=` | 月相/日出日落 |
| GET | `/api/historical/{city_id}?month_day=08-15` | 近 3 年同期 |
| GET | `/api/analysis/{city_id}?date=` | 天气系统分析 |

自定义坐标：`city_id=custom` 并附带 `lat`/`lon`/`elevation` 查询参数。

---

## 📝 说明

- **数据源均为免费**：CMA 公开接口、Open-Meteo（CC-BY 4.0，非商用 <1 万次/天）
- **CMA 客户端带浏览器 User-Agent**：CMA 服务器拒绝无 UA 的请求（返回 403）
- **缓存**：实况 10 分钟、预报/逐小时 1 小时、历史 7 天、天文 1 天；上游失败时返回过期缓存（`stale:true`）
- **海拔订正**：Open-Meteo 通过 `elevation` 参数地形降尺度；CMA 数据按 6.5°C/1000m 递减率订正
