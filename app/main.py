"""星野与雪国 —— 观星 / 赏雪双模式旅行天气预报（FastAPI 入口）。

启动：uvicorn app.main:app --reload
访问：http://localhost:8000
文档：http://localhost:8000/docs
"""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .api.routes import router
from .paths import STATIC_DIR, ensure_dirs
from .services import prewarm

ensure_dirs()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """启动时拉起后台缓存预热任务，关闭时优雅停止。"""
    task = asyncio.create_task(prewarm.run_warmer())
    try:
        yield
    finally:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


app = FastAPI(
    title="星野与雪国 · 双模式旅行天气预报",
    description="观星模式（全国暗夜条件评分）与赏雪模式（雪景城市降雪概率看板）；聚合 CMA + ECMWF + GFS 三源气象数据，默认以上海为基准排序。",
    version="2.3.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)

if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
def index():
    index_path = STATIC_DIR / "index.html"
    if index_path.exists():
        return FileResponse(index_path)
    return {"message": "前端尚未生成，请访问 /docs 查看 API。"}


@app.get("/satellite")
def satellite():
    """独立卫星云图页面（全屏显示）。"""
    page_path = STATIC_DIR / "satellite.html"
    if page_path.exists():
        return FileResponse(page_path)
    return {"message": "satellite.html 尚未生成"}


@app.get("/typhoon")
def typhoon():
    """独立台风追踪页面（全屏显示）。"""
    page_path = STATIC_DIR / "typhoon.html"
    if page_path.exists():
        return FileResponse(page_path)
    return {"message": "typhoon.html 尚未生成"}


