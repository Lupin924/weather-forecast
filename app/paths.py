"""统一路径处理：兼容 EXE(PyInstaller) / Docker / 开发 三种运行模式。

模式判断优先级：
1. sys.frozen + _MEIPASS  → EXE 模式（PyInstaller onefile）
2. DOCKER_RUNNING 环境变量 → Docker 模式
3. 否则 → 开发模式（项目根目录）
"""
from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Literal

RunMode = Literal["exe", "docker", "dev"]


def detect_mode() -> RunMode:
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        return "exe"
    if os.environ.get("DOCKER_RUNNING") == "1":
        return "docker"
    return "dev"


MODE: RunMode = detect_mode()


def get_base_dir() -> Path:
    if MODE == "exe":
        return Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
    if MODE == "docker":
        return Path("/app")
    return Path(__file__).resolve().parent.parent


def get_data_dir() -> Path:
    """数据根目录：存放可变数据（缓存、日志）。

    EXE: 与 EXE 同目录
    Docker: /app
    Dev: 项目根目录
    """
    if MODE == "exe":
        return Path(sys.executable).parent
    return get_base_dir()


BASE_DIR = get_base_dir()
DATA_DIR = get_data_dir()

STATIC_DIR = BASE_DIR / "static"
CACHE_DIR = DATA_DIR / "cache"
LOGS_DIR = DATA_DIR / "logs"


def ensure_dirs() -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    LOGS_DIR.mkdir(parents=True, exist_ok=True)
