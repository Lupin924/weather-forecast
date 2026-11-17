"""文件级 TTL 缓存，支持 stale-while-revalidate。"""
from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

from ..paths import CACHE_DIR


def _cache_path(key: str) -> Path:
    safe = key.replace("/", "_").replace(" ", "_").replace(":", "_")
    return CACHE_DIR / f"{safe}.json"


def get_cache(key: str, ttl: int) -> tuple[Any | None, bool]:
    """读取缓存。

    返回 (data, stale):
      - 缓存不存在 -> (None, False)
      - 缓存存在且未过期 -> (data, False)
      - 缓存存在但已过期 -> (data, True)  供 stale-while-revalidate 使用
    """
    p = _cache_path(key)
    if not p.exists():
        return None, False
    try:
        raw = json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return None, False
    age = time.time() - raw.get("ts", 0)
    return raw.get("data"), age > ttl


def set_cache(key: str, data: Any) -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    p = _cache_path(key)
    payload = {"ts": time.time(), "data": data}
    p.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
