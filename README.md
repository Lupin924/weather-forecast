# ✨ 星野与雪国 · 观星 / 赏雪双模式旅行天气预报

聚合 **CMA 中央气象台 + ECMWF + GFS + Open-Meteo** 四源气象数据的 Web 应用。
Python FastAPI 后端 + 原生 HTML/CSS/JS 前端 + 轻量 SVG 图表，**无需 API Key、无需前端构建、无深色模式**。

> 默认以 **上海** 为基准：两种模式的城市选择器、看板排行、常驻卡片均统一按 **距上海由近及远** 单一列表排序（不再按地域分区），方便从上海出发规划周末行程。
>
> 首页为 **PC 高信息密度单屏**：常驻城市卡片 + 今日雪讯/观星速览一屏集中呈现，完整看板与深度分析放入次级页；卡片可点进查看目标城市未来 **15 天**（API 上限 16 天）逐日详情。

---

## 🌟 两种模式

| 模式 | 定位 | 核心能力 |
|:---|:---|:---|
| 🔭 **观星模式** | 原项目模式，已整合简化 | 今夜观星指数、最佳观测窗口、逐小时 0-100 评分时间轴、云量/气温/降水曲线、月相与光污染、多模型对比、历史同期、天气系统分析 |
| ❄️ **赏雪模式** | 本次新增 | 全国雪景城市降雪概率看板、未来 7 天逐日播报、最佳赏雪窗口、分区城市雪况详情（温度/降雪/湿度/评分） |

顶部一键切换，浅色设计随模式切换（观星=星夜蓝紫，赏雪=晨雪冰蓝）。

### ❄️ 赏雪城市覆盖

- **东北雪乡**：哈尔滨、长白山、亚布力、雪乡、漠河
- **华北与辽东**：北京、沈阳、大连
- **山东半岛**：威海、烟台
- **华东高海拔**：太子尖、天目山、浙西西溪、安吉天荒坪、黄山、九华山、莫干山

### 赏雪评分算法（0-100，5 维加权）

- 气温 34% ｜ 降水概率 26% ｜ 降雪量 22% ｜ 湿度 10% ｜ 海拔 8%
- 雪码识别：71/73/75/77/85/86/68/69（雪、阵雪、雨夹雪）
- 评级：🌟 极佳(≥75) / ✨ 较大(≥55) / 🌤 可能(≥35) / ☁ 较小(<35)
- 看板每日聚合一次（缓存 1 小时），数据更新时自动重算未来 7 天有概率下雪的城市。

### 👑 推荐赏雪地（首页动态卡片）

首页主卡片不再是「当前选中城市的雪况」，而是**每天动态计算的"最值得去赏雪地"**——解决高纬/高海拔城市（如长白山）天天霸榜、推荐缺乏变化的问题。四维加权 + 新雪讯检测：

- **降雪强度 34%**：该城窗口期降雪概率（越高越好）
- **规划窗口 28%**：优先推荐「还有 2~5 天」才下的雪——今明太赶、远期不确定都降权，留出安排行程的提前量
- **稀罕度 26%**：距上海越近的南方雪越稀罕（江南近沪雪景额外加权）
- **雪质 12%**：该城降雪评分
- **新雪讯**：与上次聚合对比，新出现的雪讯打 `✦ 新雪讯` 标记
- 综合分排序产出 `recommendations[]`（含 `lead_days` 提前天数、`reason` 推荐理由、`second_window` 第二窗口期），卡片展示榜首并配飘雪动效、数字滚动、徽章；点「查看 15 天逐日详情」进入次级页核对具体雪日。
- **第二窗口期**：每条推荐附带主观雪日之外的另一段降雪时段（`second_window`，日期区间/峰值/提前天数）；因远期预报准确度低，首页仅以一行小字轻提示「另：X 城 M-D 前后还有一波降雪（… · 远期参考）」，不做特效强调。榜首无第二窗时自动取另一推荐城市的窗口，实现「每日播报多个有概率城市」。

### 观星评分算法（0-100，9 维加权）

- 云量 22% ｜ 天光/夜间程度 18% ｜ 月相/月位置 13% ｜ 降水 12% ｜ 光污染 10% ｜ 能见度 7% ｜ 湿度 7% ｜ 风速+阵风 6% ｜ 空气质量 5%
- 评级：🌟 极佳(≥70) / ✨ 良好(≥50) / 🌤 一般(≥30) / ☁ 欠佳(<30)

### 👑 推荐观星地（首页动态卡片，与赏雪对称）

- 观星模式同样按窗口期动态推荐，不再只看今夜：`/api/stargazing/board` 聚合全国 14 座观星地未来 7 天晴夜，产出与赏雪同构的推荐榜。
- 三维加权：**观星分 46%**（窗口期最佳评分）｜ **规划窗口 30%**（2~5 天最佳，同赏雪口径）｜ **稀罕度 24%**（近沪通透夜空难得）；并检测「新出现晴夜」。
- 榜单字段与赏雪一致（`recommendations[]` 含 `lead_days`/`reason`/`second_window`/`score` 等），首页共用同一套推荐卡片渲染逻辑与 15 天详情次级页。

---

## 🚀 快速开始

```bash
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8787
```

- **主界面**：http://localhost:8787
- **API 文档**（Swagger）：http://localhost:8787/docs
- **健康检查**：http://localhost:8787/api/health

> 开发模式直接监听 8787；EXE 模式监听 8000；Docker 模式容器监听 8000 并映射宿主机 8787（见下方）。

---

## 📱 界面与体验

- **清新浅色 UI**：无深色模式；观星蓝紫 / 赏雪冰蓝双主题，圆角卡片 + 柔和渐变
- **设计令牌系统**：借鉴 Meta [Astryx](https://github.com/meta/astryx) 设计系统理念（主题即一组 CSS 自定义属性覆盖），`:root` 统一定义间距（--sp-1..6）、圆角（--r-xs/sm/md/lg）、边界（--edge）、控件高度（--ctl-h）令牌；落地 5 条层级原则——
  - Spatial Hierarchy：间距 local(8) < group(12) < section(16/20) 刻意递增
  - Elevation：单一边界语言（淡描边 --edge 替代描边+阴影双满强度），感知顺序=实际顺序
  - Shape：圆角系统化收敛为 5 档，嵌套同心（内圆角≈外圆角−间距）
  - Control Rhythm：同排控件（城市/日期/刷新/城市徽章）统一 40px 高度与基线
  - Color Emphasis：强调稀缺（仅推荐日 ★、推荐徽章用高饱和色）
- **移动优先**：820 / 760 / 560px 三级响应式断点，手机端单列排布、看板横向滑动
- **双模式城市选择器**：单一「距上海由近及远」有序列表；支持中文名/标签/海拔搜索；每城标注距上海公里数
- **常驻城市卡片（钉住）**：首页可钉住最多 3 城（localStorage 持久化），展示 7 天迷你降雪概率/观星评分条 + 峰值；点卡片进 15 天详情次级页；城市列表点 ☆ 即可增删，无需「管理」弹窗
- **PC 高信息密度单屏**：首屏采用**三列布局**——左侧「推荐地」主卡（加宽减高，内嵌近期天文现象 / 雪景气象信息四格 `hh-facts`）、中间「常驻城市」（3 座、与左卡等高）、右上「跳转入口」（完整看板 / 深度分析）；下方今日速览 TOP5 适度加高、14 天逐日天气预报更舒展，主内容整体不超出一屏；完整看板、分区亮点、深度分析移至次级页，减少上下翻页
- **逐日速览条**：速览 TOP5 每城并列展示未来 14 天简化天气预报（WMO 天气图标 + 最高/最低温），日期仅标 DD、推荐日高亮，hover 显示天气与温度详情（赏雪附降雪概率 / 观星附观星分）；两模式共用，PC 通栏铺满、窄屏下横向可滚动不溢出
- **推荐地卡片（两模式共用）**：首页主卡片动态推荐最值得去的赏雪城市 / 观星地（加权评分 + 规划窗口 + 新信号检测），配飘雪（赏雪）/数字滚动动效、徽章、第二窗口期小字提示与「15 天逐日详情」入口；`prefers-reduced-motion` 下自动关闭动效
- **两模式一致**：观星/赏雪共用首页推荐卡片、详情次级页、城市选择器与距离排序逻辑
- **全局进度条 + 轻量 Toast**：分模块容错加载，单个上游失败不影响整体页面
- **零外部 CDN**：图表由自研轻量 SVG 渲染，离线可用

---

## 🐳 部署

### Docker Compose（推荐）

```bash
docker compose up -d      # 启动
docker compose logs -f    # 日志
docker compose down       # 停止
```

宿主机 8787 → 容器 8000；`./cache` 与 `./logs` 已挂载持久化。

### 原生 Docker

```bash
docker build -t weather-forecast:latest .
docker run -d --name weather-forecast -p 8787:8000 \
  -v $(pwd)/cache:/app/cache -v $(pwd)/logs:/app/logs \
  -e TZ=Asia/Shanghai weather-forecast:latest
```

### 打包为 EXE

```bash
pip install pyinstaller
python build_exe.py
# 产物：dist/WeatherForecast.exe（约 18 MB，双击运行，自动打开浏览器）
```

路径策略由 `app/paths.py` 统一处理：EXE 写同目录、Docker 写 `/app`、开发写项目根目录。

### 纯静态版（`web/`，无需后端）

同一套界面与算法的**浏览器直连版**：没有后端进程，评分与看板全在前端算，数据直接从 Open-Meteo 拉取（支持 CORS，无需 Key）。

```bash
python -m http.server 9999 -d web     # 打开 http://127.0.0.1:9999/
```

也可以直接双击 `web/index.html`，或把 `web/` 整个目录丢到 GitHub Pages / Netlify / Vercel / OSS 等静态托管。

- ✅ 观星 / 赏雪双模式、首页、看板、15 天详情、评分与推荐算法、光污染 Bortle 数据库 —— 与原版一致
- ❌ 无 CMA 实况与预警（无 CORS）、无卫星云图 / 台风追踪 / API 文档页
- 缓存用 `localStorage`（首次并发拉 14~22 座城市约 3~8 秒，之后秒开）

细节见 [`web/README.md`](web/README.md)。`web/js/cities.js`、`web/js/lp.js` 是生成产物，改完 `app/config.py` / `app/services/light_pollution.py` 后执行 `python tools/gen_cities_js.py && python tools/gen_lp_js.py` 重新生成。

---

## 🏗️ 架构

```
weather/
├── app/
│   ├── main.py                # FastAPI 入口（标题/版本 2.1.0）
│   ├── config.py              # 城市预设（含上海基准排序）、双模式分组、评分权重、缓存 TTL
│   ├── paths.py               # EXE/Docker/dev 三模式路径
│   ├── api/routes.py          # REST 路由（含 /snow/board、/snow/forecast、/stargazing/forecast、/pinned/summary）
│   ├── models/schemas.py      # Pydantic 响应模型
│   └── services/
│       ├── cma.py             # CMA 客户端（浏览器 UA，规避 403）
│       ├── open_meteo.py      # Open-Meteo（ECMWF/GFS/历史/天文/降雪量）
│       ├── ensemble.py        # 多模型集成 + 分歧度
│       ├── stargazing.py      # 观星 9 维评分 + 逐日预报（复用预取数据）
│       ├── snow.py            # ★ 赏雪降雪概率评分 + 看板聚合
│       ├── light_pollution.py # Bortle 等级本地数据库
│       ├── elevation.py       # 海拔气温订正
│       ├── typhoon.py         # 天气系统识别
│       ├── air_quality.py     # 空气质量 + 光污染
│       └── cache.py           # 文件 TTL 缓存（stale-while-revalidate）
├── static/
│   ├── index.html             # 双模式外壳
│   ├── css/style.css          # 浅色双主题响应式设计系统
│   └── js/                    # api.js / charts.js(SVG) / app.js(主控)
├── web/                        # ★ 纯静态版（浏览器直连，无需后端）
│   ├── index.html
│   ├── css/style.css          # 与 static/css 同源
│   └── js/                    # cities / lp / om / scoring / events / api / charts / app
├── tools/                      # 生成 web/js/cities.js、web/js/lp.js
├── cache/  logs/              # 自动生成
├── run.py  build.spec  build_exe.py
├── Dockerfile  docker-compose.yml
└── requirements.txt
```

**数据流（后端版）**：前端 fetch → FastAPI 路由 → 服务层并发抓取外部 API（缓存优先）→ 统一信封 JSON → 前端分模式渲染。

**数据流（静态版）**：浏览器 → `om.js`（直连 Open-Meteo，localStorage 缓存 + 限流）→ `scoring.js` 本地评分 → `api.js` 拼出同形状信封 → 同一套 `app.js` 渲染。

---

## 🔌 API 端点

所有响应统一信封：`{ city, data, meta }`。

| 方法 | 路径 | 说明 |
|:---|:---|:---|
| GET | `/api/cities?mode=stargazing\|snow\|all` | 城市列表（分组 + 上海优先排序 + 距离） |
| GET | `/api/weather/{city_id}/now` | 实况 + 预警 |
| GET | `/api/weather/{city_id}/forecast` | 7 天预报 |
| GET | `/api/weather/{city_id}/hourly?date=` | 逐小时 |
| GET | `/api/weather/{city_id}/multimodel?date=` | ECMWF/GFS 集成 |
| GET | `/api/air-quality/{city_id}?date=` | 空气质量 + 光污染 |
| GET | `/api/stargazing/{city_id}?date=` | 观星评分时间轴 |
| GET | `/api/stargazing/forecast/{city_id}?days=15` | ★ 观星逐日预报（1-15 天，一次取数复用评分） |
| GET | `/api/pinned/summary?ids=&days=7&mode=snow\|stargazing` | ★ 常驻城市卡片汇总（并发聚合） |
| GET | `/api/astronomy/{city_id}?date=` | 月相/日出日落 |
| GET | `/api/historical/{city_id}?month_day=08-15` | 近 3 年同期 |
| GET | `/api/analysis/{city_id}?date=` | 天气系统分析 |
| GET | `/api/snow/board?days=7` | ★ 赏雪看板（汇总 / recommendations 动态推荐 / highlights / by_day / groups） |
| GET | `/api/stargazing/board?days=7` | ★ 观星看板（结构与赏雪看板对称） |
| GET | `/api/snow/forecast/{city_id}?days=7` | ★ 单城逐日雪况（含自定义坐标） |
| GET | `/api/events?mode=stargazing\|snow&window_days=60` | ★ 热点事件（流星雨 / 冰雪文旅资讯，供首页推荐卡播报） |
| GET | `/api/health` | 健康检查（版本、模式、特性） |

自定义坐标：`city_id=custom` 并附带 `lat` / `lon` / `elevation` 查询参数。

**看板数据结构**：`by_day[]` 为每日有概率下雪的城市排行（`prob/score/level/snowfall_cm/temp_min/distance_km`）；`groups[]` 每城自带完整 7 天 `days[]`，前端一次请求即可渲染整块看板。

---

## 📝 说明

- **数据源免费**：CMA 公开接口、Open-Meteo（CC-BY 4.0，非商用 <1 万次/天）
- **CMA 带浏览器 UA**：CMA 拒绝无 UA 请求（403）
- **缓存**：实况 10 分钟、预报/逐小时/赏雪看板 1 小时、历史 7 天、天文 1 天；上游失败返回过期缓存（`stale:true`）
- **后台定时预热**：FastAPI `lifespan` 启动一个每 30 分钟运行的预热任务（`app/services/prewarm.py`），串行强制重算 7/14 天的赏雪与观星看板并写缓存；前端 `localStorage` 采用 stale-while-revalidate——打开即渲染上次缓存数据（秒开不空白），后台再拉新数据回写并刷新「更新于 / 缓存 HH:MM」时间戳
- **预报上限**：Open-Meteo 逐日预报最长 16 天；`/snow/forecast` 与 `/stargazing/forecast` 均支持 `days=1..16`，默认 15 天
- **海拔订正**：Open-Meteo 通过 `elevation` 参数地形降尺度；CMA 按 6.5°C/1000m 递减率订正
- **上机/上线提示**：天气数据仅供参考，出行前请复核当地气象部门预警
