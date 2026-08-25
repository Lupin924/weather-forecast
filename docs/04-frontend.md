# 04 · 前端（static/）

前端为**原生 HTML/CSS/JS 单页应用**，无构建步骤，由 FastAPI 直接挂载 `/static`。
通过 5 个 JS 文件分层（全局命名空间约定：`API`、`Charts`、全局渲染函数）。

## 1. 页面结构（index.html）

```
头栏 topbar：品牌 + 城市下拉(citySelect) + 城市搜索(citySearch/searchResults)
            + 日期选择(datePicker) + 刷新(refreshBtn) + 自定义坐标(customToggle/Panel) + 主题切换(themeToggle)
主区 content：
  ├ 三合一：nowCard 实时天气 / astroCard 天文 / airCard 空气质量·光污染
  ├ forecastCard   7 天预报（横向 strip，前 5 天可点击）
  ├ hourlyCard     逐小时（canvas: hourlyChart）
  ├ stargazingCard 观星评分（summary + timeline + breakdown）★highlight
  ├ multimodelCard 多模型对比表
  ├ historicalCard 历史同期（canvas: historicalChart）
  └ analysisCard   天气系统分析 + 气压趋势（canvas: pressureChart）
全局：progressBar / progressLabel 进度条、noDataBanner 无数据提示、toast 轻提示
脚本：api.js → charts.js → weather.js → stargazing.js → app.js（严格顺序）
```

**外部依赖（CDN）**：`chart.js@4.4.1`（`chart.umd.min.js`）。

---

## 2. API 封装（api.js）—— 全局 `API` 对象

统一管理**城市、日期、自定义坐标**参数，集中所有 `/api` 调用。

### 状态字段
| 字段 | 说明 |
|:---|:---|
| `cityId` | 当前城市 id（默认 `beijing`） |
| `custom` | 自定义坐标 `{lat,lon,elev,label}`，为空则走 cityId |
| `date` | 当前选中日期 `YYYY-MM-DD` |
| `currentCity` | 当前城市名称（用于顶部展示） |
| `_preloadCache` | 前端预缓存 `{date: {now, air, ...}}` |
| `_preloadingDates` | 正在预加载的日期集合（防止重复） |

### 核心方法
| 方法 | 说明 |
|:---|:---|
| `_params(extra)` | 组装查询参数（自动带 lat/lon/elevation） |
| `_get(path, extra)` | GET 请求；非 200 抛 `Error(detail)` |
| `cities()` / `searchCities(q)` / `resolveCity(name)` | 城市列表 / 搜索 / 解析 |
| `now/hourly/multimodel/stargazing/astronomy/airQuality/analysis([date])` | 各业务端点 |
| `forecast()` / `historical([date])` | 不加 date 的端点（historical 用 `month_day`) |
| `preloadDate(date)` | **后台预取**某日全部 8 类数据（`Promise.allSettled`，不阻塞 UI） |
| `getCachedData(date)` | 读取预缓存 |
| `clearPreloadCache()` | 切换城市时清空预缓存与预报数据 |

**日期风格**：每个业务方法可选传入日期覆盖（用于预取未来日期），不修改 `this.date`。

---

## 3. 主控逻辑（app.js）—— IIFE

负责加载编排、事件绑定、进度管理、并发渲染、自动刷新。

### 关键流程
- `init()`：`DOMContentLoaded` 后执行。初始化主题 → 城市搜索 → 加载城市列表 →
  绑定事件 → 首次 `loadAll()` → 启动 10 分钟实况自动刷新。
- `loadAll()`：**每张卡片独立并发加载、互不阻塞**。核心编排：
  1. 读取预缓存 `getCachedData(API.date)`。
  2. `forecast` 为 16 天固定列表，仅加载一次（存 `API._forecastData`）。
  3. 定义 `cardDefs`（8 张卡片：fetch + render + 缓存key）。
  4. 每卡：预缓存命中→立即渲染；未命中→显示 spinner 并发请求。
  5. 汇总进度 `totalTasks = 8 + 1`，`taskCompleted()` 推进全局进度条。
  6. 全部完成后更新「更新于」时间；后台 `preloadFutureDates()` 预取未来 2 天。
- `updateAllDateTags()`：同步刷新各卡标题的日期标签（今天/星期几/起止日期）。
- `initCitySearch()`：支持中文输入法组合（`compositionstart/end`）、300ms 防抖、
  搜索结果点击/回车跳转，与下拉选择互锁。
- `initTheme()`：深/浅色主题切换（localStorage 记忆），切换后 `Charts._refreshTheme()`。
- `refreshNow()`：定时器每 10 分钟只刷新实况卡。

### 事件绑定（bindEvents）
城市下拉切换、日期选择、预报卡前5天点击切换日期、刷新按钮、自定义坐标应用。

---

## 4. 渲染模块（weather.js）

全局渲染函数，负责实况/天文/空气质量/7天预报/逐小时/多模型/系统分析的 DOM 输出。

### 通用工具
- `weatherIcon(code, text)`：按 CMA 中文文本关键词或 WMO code 映射 emoji 图标。
- `safe(v, unit, digits)`：空值显示「—」，数字可定精度。
- `windDirText(deg)`：风向角度→中文方位。

### 渲染函数
| 函数 | 卡片 | 要点 |
|:---|:---|:---|
| `renderNow` | 实时天气 | 区分实时/预报/不可用模式；预警徽章（severity 动画）；预报模式显示高/低温 |
| `renderAstronomy` | 天文 | SVG 动态月相描边（`moonPhasePath`）+ 照亮比例 + 四时时刻 |
| `renderAirQuality` | 空气质量/光污染 | AQI 等级、污染物、Bortle 徽章/SQM/银河、方法标注 |
| `renderForecast` | 7 天预报 | 高低温/图标/降水；`today/selected/clickable` 状态 |
| `renderHourly` | 逐小时 | 设置日期标签与来源元信息，委托 `Charts.hourly` |
| `renderMultimodel` | 多模型 | ECMWF/GFS/集成三行对比 + 分歧度徽章 |
| `renderAnalysis` | 系统分析 | 结论文本 + 系统标签 + `Charts.pressure` |

- `moonPhasePath(phase, R)`：根据月相值计算月面亮区 SVG 路径（新月→满月→新月）。

---

## 5. 图表封装（charts.js）—— 全局 `Charts` 对象

封装 Chart.js，支持 **深色/浅色主题**，缓存上次数据以便主题切换重绘。

| 方法 | 图表 | 数据 |
|:---|:---|:---|
| `hourly(points)` | 逐小时 | 温度折线(y) + 云量面积(y1) + 风速柱(y1)，双 Y 轴 |
| `historical(years)` | 历史同期 | 高低温柱 + 降水折线(y1) |
| `pressure(series)` | 气压趋势 | 海平面气压折线(y) + 阵风折线(y1) |

**设计约束**：实例属性（`hourlyChart` 等）与方法名不同，避免对象字面量中方法覆盖实例。
- 内部颜色均通过 `_red/_blue/_green/_purple/_orange` 按主题返回。
- `_refreshTheme()`：切换主题时重新渲染 3 类图表（Chart.js `update()` 不重读 scales 颜色）。

---

## 6. 观星渲染（stargazing.js）

观星卡三部分组成：**圆形评分仪表盘 + 信息卡片**、**时间轴**、**评分维度分解**。

| 函数 | 说明 |
|:---|:---|
| `sgColor / sgColorVar` | 评分→颜色（≥70 绿 / ≥50 黄 / ≥30 橙 / <30 红） |
| `sgMoonIcon / sgSkyIcon / sgSkyLabel` | 月相 / 天光 emoji 与晨昏标签 |
| `sgGaugeSVG(score, color, label)` | 生成带过渡动画的圆环仪表盘 SVG |
| `renderStargazing(data)` | 主入口：摘要区（仪表盘+日落/日出/窗口/时长/统计）+ 逐时时间轴 + 最佳小时维度分解 |

- 时间轴每根条代表一小时：高度对应评分，标注降水/光污染/月相等悬浮信息，标记「最佳」与「窗口内」。
- 维度分解展示 9 维（含 v2.2 的露点/抬升/对流/云层）的评分条与**加权贡献分**。

---

## 7. 样式（css/style.css）

- 深色主题（默认）+ `.light-theme` 浅色主题，使用 CSS 变量（`--bg-card`, `--text-dim`, `--green` 等）。
- 含进度条、卡片加载 spinner、天气预警动画、观星时间轴、维度分解条、响应式网格类。
- 前端脚本通过 `?v=14` 查询串做缓存破除（改样式/脚本时递增版本号强制刷新）。