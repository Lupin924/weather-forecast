"""空气质量与光污染服务。

空气质量：基于 Open-Meteo 空气质量 API 获取实时 AQI 数据。
光污染：基于 VIIRS 卫星夜间灯光数据的本地 Bortle 等级数据库（light_pollution.py），
       不再依赖 AQI 估算，因为光污染和空气质量是完全不同的概念。
"""
from __future__ import annotations

from typing import Any, Optional

import httpx

from ..config import (
    HTTP_TIMEOUT,
    OPEN_METEO_AIR,
    CACHE_TTL,
)
from . import cache, light_pollution


async def get_air_quality(lat: float, lon: float, elevation: int = 0) -> dict[str, Any]:
    """获取当前空气质量数据 + 光污染数据。

    空气质量来自 Open-Meteo API，光污染来自本地 Bortle 等级数据库。
    """
    key = f"air_quality_{lat:.2f}_{lon:.2f}_{elevation}"
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
            f"&forecast_days=1"
        )
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            data = resp.json()

        current = data.get("current", {})
        hourly = data.get("hourly", {})

        aqi = current.get("european_aqi", 50)

        result = {
            "current": {
                "aqi": aqi,
                "pm2_5": current.get("pm2_5"),
                "pm10": current.get("pm10"),
                "carbon_monoxide": current.get("carbon_monoxide"),
                "nitrogen_dioxide": current.get("nitrogen_dioxide"),
                "sulphur_dioxide": current.get("sulphur_dioxide"),
                "ozone": current.get("ozone"),
            },
            "hourly": {
                "time": hourly.get("time", [])[:24],
                "aqi": hourly.get("european_aqi", [])[:24],
                "pm2_5": hourly.get("pm2_5", [])[:24],
                "pm10": hourly.get("pm10", [])[:24],
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
            "current": {"aqi": None},
            "light_pollution": lp,
            "_note": f"空气质量数据获取失败，光污染数据来源：{lp.get('data_source', '本地数据库')}",
            "_error": True,
        }
