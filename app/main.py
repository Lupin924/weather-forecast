"""旅游城市天气预报及观星条件预报软件 —— FastAPI 入口。

启动：uvicorn app.main:app --reload
访问：http://localhost:8000
文档：http://localhost:8000/docs
"""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .api.routes import router
from .paths import STATIC_DIR, ensure_dirs

ensure_dirs()

app = FastAPI(
    title="旅游城市天气预报及观星条件预报",
    description="聚合 CMA + ECMWF + GFS 三源气象数据，提供旅游/观星条件预报。",
    version="1.0.0",
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


@app.get("/api/health")
def health():
    return {"status": "ok"}
