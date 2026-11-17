# 05 · 运行方式与部署

项目支持 **开发 / EXE / Docker** 三种部署模式，共用同一套代码，仅路径策略差异
（由 [app/paths.py](../app/paths.py) 统一处理）。

| 模式 | 入口 | 运行地址 | 适用场景 |
|:---|:---|:---|:---|
| 开发 | `run.py` / `uvicorn` | 127.0.0.1（开发提示 8787/8000） | 本地迭代 |
| EXE | `build_exe.py` → `dist/WeatherForecast.exe` | 127.0.0.1:8000 | 桌面用户双击即用 |
| Docker | Dockerfile CMD | 容器 0.0.0.0:8000 | 服务器长期运行 |

---

## 1. 开发模式

### 1.1 安装依赖
```bash
pip install -r requirements.txt
```
依赖：`fastapi / uvicorn / httpx / pydantic`（见 [requirements.txt](../requirements.txt)）。

### 1.2 启动服务
```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8787
```
- 环境要求：项目根目录运行以保证 `app` 包可导入、静态资源可找到。
- 开发模式路径根目录为项目根，缓存/日志写入 `cache/` 与 `logs/`。

### 1.3 访问
- 主界面：http://localhost:8787
- Swagger / OpenAPI 文档：http://localhost:8787/docs

---

## 2. EXE 打包（单文件分发）

> 符合用户偏好：**单文件 EXE** 而非文件夹分发。

### 2.1 前置
```bash
pip install pyinstaller
```

### 2.2 执行打包
```bash
python build_exe.py
```
- 脚本以 `--noconfirm --clean` 调用 `PyInstaller build.spec`，仅输出关键日志。
- 产物：`dist/WeatherForecast.exe`（单文件，约 18–30 MB，视版本）。

### 2.3 打包配置要点（build.spec）
- **onefile**：`EXE(pyz, a.binaries, a.datas, console=False, ...)` 全部内嵌。
- `datas=[('static','static')]`：随包携带前端静态资源。
- `hiddenimports`：显式列出 uvicorn/fastapi/starlette/httpx/pydantic/app 各子模块，防遗漏。
- `excludes`：剔除 `matplotlib/numpy/pandas/selenium/PyQt/sqlalchemy` 等不需要的重量库，控制体积。
- 入口脚本 `run.py`（无控制台窗口，后台运行 + 自动开浏览器）。

### 2.4 分发与运行
1. 复制 `dist/WeatherForecast.exe` 到目标机。
2. 双击运行：自动解压临时文件、启动服务、打开默认浏览器。
3. 停止：任务管理器结束 `WeatherForecast.exe`。

**运行行为**（见 [run.py](../run.py)）：
- 日志写 EXE 同目录 `logs/weather_forecast.log`。
- 端口 8000 被占用：直接尝试打开浏览器并提示。
- 服务就绪后自动打开浏览器（约 5–15 秒，onefile 首次解压较慢）。

**常见问题**：
| 现象 | 处理 |
|:---|:---|
| 页面无法访问 | 杀毒软件可能拦截解压，临时关闭或加白名单 |
| 端口被占用 | 关闭占用 8000 端口的程序 |
| 首次启动慢 | onefile 解压固有延迟，属正常现象 |

---

## 3. Docker 部署

### 3.1 Dockerfile
```dockerfile
FROM python:3.11-slim
ENV DOCKER_RUNNING=1   # 触发 docker 模式路径
WORKDIR /app
COPY requirements.txt . && pip install --no-cache-dir -r requirements.txt
COPY app/ static/ .
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### 3.2 方式一：docker compose（推荐）
```bash
docker compose up -d          # 构建并启动
docker compose logs -f        # 查看日志
docker compose down           # 停止
```
`docker-compose.yml` 要点：
- 端口映射 `8787:8000`；挂载 `./cache` 与 `./logs` 到 `/app` 持久化。
- `restart: unless-stopped`；`TZ=Asia/Shanghai`。
- **健康检查**：每 30s `urllib.request.urlopen('http://localhost:8000/api/health')`。

### 3.3 方式二：原生 Docker
```bash
docker build -t weather-forecast:latest .
docker run -d --name weather-forecast -p 8787:8000 \
  -v $(pwd)/cache:/app/cache -v $(pwd)/logs:/app/logs \
  -e TZ=Asia/Shanghai weather-forecast:latest
```

### 3.4 环境变量
| 变量 | 说明 | 默认 |
|:---|:---|:---|
| `TZ` | 时区 | - |
| `DOCKER_RUNNING` | `1` 表示 Docker 模式（路径策略用） | 由 Dockerfile 设置 |
| `PYTHONUNBUFFERED` / `PYTHONDONTWRITEBYTECODE` | 日志实时 / 不写 pyc | Dockerfile 设置 |

### 3.5 持久化与健康检查
- 挂载 volume 保证缓存/日志不因容器重建丢失。
- 通过 `/api/health` 探活（compose 已配置 30s 健康检查）。

---

## 4. 三模式路径策略对照

| 路径 | EXE | Docker | 开发 |
|:---|:---|:---|:---|
| 静态资源 `STATIC_DIR` | 临时解压目录 `/static` | `/app/static` | 项目根 `/static` |
| 缓存 `CACHE_DIR` | EXE 同目录 `/cache` | `/app/cache` | 项目根 `/cache` |
| 日志 `LOGS_DIR` | EXE 同目录 `/logs` | `/app/logs` | 项目根 `/logs` |
| 判定 | `sys.frozen + _MEIPASS` | `DOCKER_RUNNING=1` | 兜底 |

> README 提到的访问地址（主界面 `:8787`，API 文档 `/docs`）在三种模式下均遵循
> `{host}/` 与 `{host}/docs` 约定；EXE 默认 8000 端口。