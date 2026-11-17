"""空气质量与光污染服务。

空气质量：基于 Open-Meteo 空气质量 API 获取实时 AQI 数据。
光污染：基于 VIIRS 卫星夜间灯光数据的本地 Bortle 等级数据库（light_pollution.py），
       不再依赖 AQI 估算，因为光污染和空气质量是完全不同的概念。
"""
from __future__ import annotations

from datetime import date as _date
from typing import Any

import httpx

from ..config import (
    CACHE_TTL,
    HTTP_TIMEOUT,
    OPEN_METEO_AIR,
)
from . import cache, light_pollution


def _today_str() -> str:
    return _date.today().isoformat()


def _filter_hourly_by_date(hourly: dict, target_date: str) -> dict:
    """从 hourly 字典中筛选指定日期（YYYY-MM-DD）的数据，最多 24 条。"""
    times = hourly.get("time", []) or []
    indices = [i for i, t in enumerate(times) if t.startswith(target_date)]
    if not indices:
        return {"time": [], "aqi": [], "pm2_5": [], "pm10": []}
    return {
        "time": [times[i] for i in indices],
        "aqi": [(hourly.get("european_aqi") or [])[i] for i in indices],
        "pm2_5": [(hourly.get("pm2_5") or [])[i] for i in indices],
        "pm10": [(hourly.get("pm10") or [])[i] for i in indices],
    }


async def get_air_quality(lat: float, lon: float, elevation: int = 0, target_date: str | None = None) -> dict[str, Any]:
    """获取指定日期的空气质量数据 + 光污染数据。

    空气质量来自 Open-Meteo API（获取 3 天预报，按 target_date 后端筛选）。
    光污染来自本地 Bortle 等级数据库（与日期无关，固定值）。
    当 target_date > 今天时，使用 hourly 预报数据；否则使用 current 实时数据。
    """
    target = target_date or _today_str()
    today = _today_str()
    is_forecast = target > today

    # 缓存键包含 target_date（实时 0d、预报按日期分别缓存）
    cache_suffix = target if is_forecast else "today"
    key = f"air_quality_{lat:.2f}_{lon:.2f}_{elevation}_{cache_suffix}"
    cached, stale = cache.get_cache(key, CACHE_TTL["air_quality"])
    if cached is not None and not stale:
        return cached

    # 获取光污染数据（本地数据库，无需网络请求）
    lp = light_pollution.get_light_pollution(lat, lon, elevation)

    try:
        url = (
            f"{OPEN_METEO_AIR}?"
            f"latitude={lat}&longitude={lon}"
            f"&current=european_aqi,pm2_5,pm10,carbon_monoxide,nitrogen_dioxide,"
            f"sulphur_dioxide,ozone"
            f"&hourly=european_aqi,pm2_5,pm10"
            f"&forecast_days=3"
        )
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            data = resp.json()

        current = data.get("current", {})
        hourly = data.get("hourly", {})

        # 根据目标日期返回对应数据
        if is_forecast:
            hourly_out = _filter_hourly_by_date(hourly, target)
            result = {
                "mode": "forecast",
                "target_date": target,
                "current": None,  # 预报模式下无实时 current
                "hourly": hourly_out,
                "light_pollution": lp,
                "_note": f"光污染数据来源：{lp.get('data_source', '本地数据库')}",
            }
        else:
            result = {
                "mode": "realtime",
                "target_date": target,
                "current": {
                    "aqi": current.get("european_aqi", 50),
                    "pm2_5": current.get("pm2_5"),
                    "pm10": current.get("pm10"),
                    "carbon_monoxide": current.get("carbon_monoxide"),
                    "nitrogen_dioxide": current.get("nitrogen_dioxide"),
                    "sulphur_dioxide": current.get("sulphur_dioxide"),
                    "ozone": current.get("ozone"),
                },
                "hourly": {
                    "time": (hourly.get("time", []) or [])[:24],
                    "aqi": (hourly.get("european_aqi", []) or [])[:24],
                    "pm2_5": (hourly.get("pm2_5", []) or [])[:24],
                    "pm10": (hourly.get("pm10", []) or [])[:24],
                },
                "light_pollution": lp,
                "_note": f"光污染数据来源：{lp.get('data_source', '本地数据库')}",
            }

        cache.set_cache(key, result)
        return result
    except Exception:
        if cached is not None:
            cached["_stale"] = True
            return cached
        # 网络失败时仍返回光污染数据
        return {
            "mode": "error",
            "target_date": target,
            "current": {"aqi": None},
            "hourly": {"time": [], "aqi": [], "pm2_5": [], "pm10": []},
            "light_pollution": lp,
            "_note": f"空气质量数据获取失败，光污染数据来源：{lp.get('data_source', '本地数据库')}",
            "_error": True,
        }
