# 纯静态版（无需后端）

`web/` 是整个应用的**浏览器直连版**：没有任何 Python 进程，所有评分与看板都在前端算完，
数据直接从 [Open-Meteo](https://open-meteo.com/)（支持 CORS，无需 API Key）拉取。

## 怎么打开

三种都行，任选一种：

1. **直接双击** `web/index.html`（Chrome / Edge 一般可用；若浏览器限制 `file://` 下的网络请求，改用下面方式）
2. 本地起个静态服务器（推荐，缓存更稳）：
   ```bash
   python -m http.server 9999 -d web
   # 打开 http://127.0.0.1:9999/
   ```
3. 丢到任何静态托管（GitHub Pages / Netlify / Vercel / OSS / COS），根目录指向 `web/` 即可

## 与原版（FastAPI）的差异

| 能力 | 静态版 | 原版 |
| --- | --- | --- |
| 观星 / 赏雪双模式、首页、看板、15 天详情 | ✅ 完全一致 | ✅ |
| 评分算法（9 维观星 / 5 维赏雪、推荐与窗口期） | ✅ 与后端同源移植 | ✅ |
| 光污染（Bortle） | ✅ 本地内置数据库 | ✅ |
| Open-Meteo 预报 / 天文 / 历史 / 空气质量 | ✅ 浏览器直连 | ✅ 服务端代取 |
| CMA 中央气象台实况与预警 | ❌ 无（无 CORS） | ✅ |
| 卫星云图（FY-4）/ 台风追踪 / API 文档页 | ❌ 已移除 | ✅ |
| 服务端定时预热（30 分钟） | ❌ 改为 localStorage 缓存 + 并发拉取 | ✅ |

## 目录

```
web/
├── index.html          # 唯一入口
├── css/style.css       # 与 static/css/style.css 同源
└── js/
    ├── cities.js       # 城市清单 / 分组 / 距离排序（tools/gen_cities_js.py 生成，勿手改）
    ├── lp.js           # 光污染 Bortle 数据库（tools/gen_lp_js.py 生成，勿手改）
    ├── om.js           # Open-Meteo 取数 + localStorage 缓存 + 并发限流
    ├── scoring.js      # 观星 / 赏雪评分、推荐、窗口期（搬自 app/services）
    ├── events.js       # 流星雨 / 冰雪开园事件库
    ├── api.js          # 15 个 API 方法（形状与后端一致）
    ├── charts.js       # 轻量 SVG 图表（无外部依赖）
    └── app.js          # 页面逻辑
```

## 改了后端算法怎么办

`cities.js` / `lp.js` 是生成产物，改完 `app/config.py`、`app/services/light_pollution.py` 后重新生成：

```bash
python tools/gen_cities_js.py
python tools/gen_lp_js.py
```

评分算法（`scoring.js`）是手工移植的，后端改动需要同步过去。

## 缓存说明

- 预报 / 看板结果存 `localStorage`，键前缀 `ss_static_v1_`，TTL 10 分钟（城市级雪况 / 观星 1 小时）
- 首次打开需要并发拉 14（观星）或 22（赏雪）座城市的预报，约 3~8 秒；之后秒开
- 想强制刷新：浏览器控制台执行 `Object.keys(localStorage).filter(k => k.startsWith('ss_static_v1_')).forEach(k => localStorage.removeItem(k))`
