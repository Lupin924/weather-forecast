"""CMA 中央气象台客户端（实况 / 预警 / 7天预报 / 逐小时）。

接口均为公开免费、无需密钥：
  GET https://weather.cma.cn/api/now/{stationid}
  GET https://weather.cma.cn/api/weather/{stationid}
  GET https://weather.cma.cn/api/hourly/{stationid}
"""
from __future__ import annotations

from typing import Any, Optional

import httpx

from ..config import CMA_BASE, CACHE_TTL, HTTP_TIMEOUT
from . import cache

# CMA 服务器拒绝无浏览器特征的请求（返回 403），需带 User-Agent
_BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Referer": "https://weather.cma.cn/",
}


async def _fetch_json(url: str) -> dict:
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT, headers=_BROWSER_HEADERS) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        return resp.json()


async def get_now(station_id: str) -> dict[str, Any]:
    """实况 + 气象预警。"""
    key = f"cma_now_{station_id}"
    cached, stale = cache.get_cache(key, CACHE_TTL["now"])
    if cached is not None and not stale:
        return cached

    try:
        raw = await _fetch_json(f"{CMA_BASE}/now/{station_id}")
        data = raw.get("data", {})
        result = {
            "location": data.get("location", {}),
            "now": data.get("now", {}),
            "alarms": data.get("alarm", []),
            "last_update": data.get("lastUpdate", ""),
        }
        cache.set_cache(key, result)
        return result
    except Exception:
        # stale-while-revalidate：上游失败时返回过期缓存
        if cached is not None:
            cached["_stale"] = True
            return cached
        raise


async def get_weather(station_id: str) -> dict[str, Any]:
    """7 天预报。"""
    key = f"cma_weather_{station_id}"
    cached, stale = cache.get_cache(key, CACHE_TTL["forecast"])
    if cached is not None and not stale:
        return cached

    try:
        raw = await _fetch_json(f"{CMA_BASE}/weather/{station_id}")
        data = raw.get("data", {})
        result = {
            "daily": data.get("daily", []),
            "last_update": data.get("lastUpdate", ""),
        }
        cache.set_cache(key, result)
        return result
    except Exception:
        if cached is not None:
            cached["_stale"] = True
            return cached
        raise


async def get_hourly(station_id: str, date: Optional[str] = None) -> dict[str, Any]:
    """逐小时预报。返回按日期分组的列表；可按 date 过滤。

    date 格式：YYYY-MM-DD（会匹配 YYYY/MM/DD）。
    """
    key = f"cma_hourly_{station_id}"
    cached, stale = cache.get_cache(key, CACHE_TTL["hourly"])
    if cached is not None and not stale:
        groups = cached.get("groups", [])
    else:
        try:
            raw = await _fetch_json(f"{CMA_BASE}/hourly/{station_id}")
            groups = raw.get("data", [])
            cache.set_cache(key, {"groups": groups})
        except Exception:
            if cached is not None:
                groups = cached.get("groups", [])
            else:
                raise

    if date:
        target = date.replace("-", "/")
        groups = [g for g in groups if g.get("date", "").replace("-", "/") == target]

    hourly_list: list[dict] = []
    for g in groups:
        for item in g.get("list", []):
            hourly_list.append(item)
    return {"hourly": hourly_list, "station_id": station_id}
