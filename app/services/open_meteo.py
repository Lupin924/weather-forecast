"""Open-Meteo 客户端（ECMWF / GFS / 历史 / 天文）。

所有接口免费、无需密钥（非商用 <1 万次/天）。
统一返回标准化 dict，字段命名与 Open-Meteo 一致。
"""
from __future__ import annotations

import math
from typing import Any, Optional

import httpx

from ..config import (
    CACHE_TTL,
    HTTP_TIMEOUT,
    OPEN_METEO_ARCHIVE,
    OPEN_METEO_ECMWF,
    OPEN_METEO_FORECAST,
    OPEN_METEO_GFS,
)
from . import cache

# 逐小时变量集合（覆盖观星评分所需全部要素）
HOURLY_VARS = [
    "temperature_2m",
    "relative_humidity_2m",
    "dew_point_2m",
    "apparent_temperature",
    "precipitation",
    "weather_code",
    "surface_pressure",
    "pressure_msl",
    "cloud_cover",
    "wind_speed_10m",
    "wind_direction_10m",
    "wind_gusts_10m",
    "visibility",
]

# 日变量（天文 + 概要）
DAILY_VARS = [
    "temperature_2m_max",
    "temperature_2m_min",
    "precipitation_sum",
    "cloud_cover_mean",
    "wind_speed_10m_max",
    "sunrise",
    "sunset",
    "moonrise",
    "moonset",
    "moon_phase",
]


async def _fetch_json(url: str, params: dict) -> dict:
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
        resp = await client.get(url, params=params)
        resp.raise_for_status()
        return resp.json()


def _pair_lists(d: dict, keys: list[str]) -> list[dict]:
    """把 Open-Meteo 的 {var:[...]} 横向展开为逐点 dict 列表。"""
    times = d.get("time", [])
    out = []
    for i, t in enumerate(times):
        point = {"time": t}
        for k in keys:
            vals = d.get(k)
            point[k] = vals[i] if vals and i < len(vals) else None
        out.append(point)
    return out


async def get_forecast(
    lat: float,
    lon: float,
    elevation: int,
    forecast_days: int = 16,
) -> dict[str, Any]:
    """通用预报端点：逐小时 + 日（含天文/月相）。用于逐小时展示与天文。"""
    key = f"om_forecast_{lat}_{lon}_{elevation}_{forecast_days}"
    cached, stale = cache.get_cache(key, CACHE_TTL["hourly"])
    if cached is not None and not stale:
        return cached

    params = {
        "latitude": lat,
        "longitude": lon,
        "elevation": elevation,
        "hourly": ",".join(HOURLY_VARS),
        "daily": ",".join(DAILY_VARS),
        "forecast_days": forecast_days,
        "timezone": "auto",
        "wind_speed_unit": "kmh",
    }
    try:
        raw = await _fetch_json(OPEN_METEO_FORECAST, params)
        result = {
            "hourly": _pair_lists(raw.get("hourly", {}), HOURLY_VARS),
            "daily": _pair_lists(raw.get("daily", {}), DAILY_VARS),
            "utc_offset_seconds": raw.get("utc_offset_seconds", 0),
            "elevation": raw.get("elevation", elevation),
        }
        cache.set_cache(key, result)
        return result
    except Exception:
        if cached is not None:
            return cached
        raise


async def _get_model_hourly(
    base_url: str,
    model_name: str,
    lat: float,
    lon: float,
    elevation: int,
    start_date: str,
    end_date: str,
) -> dict[str, Any]:
    key = f"om_{model_name}_{lat}_{lon}_{elevation}_{start_date}_{end_date}"
    cached, stale = cache.get_cache(key, CACHE_TTL["multimodel"])
    if cached is not None and not stale:
        return cached

    params = {
        "latitude": lat,
        "longitude": lon,
        "elevation": elevation,
        "hourly": ",".join(HOURLY_VARS),
        "start_date": start_date,
        "end_date": end_date,
        "timezone": "auto",
        "wind_speed_unit": "kmh",
    }
    try:
        raw = await _fetch_json(base_url, params)
        result = {
            "model": model_name,
            "hourly": _pair_lists(raw.get("hourly", {}), HOURLY_VARS),
            "elevation": raw.get("elevation", elevation),
        }
        cache.set_cache(key, result)
        return result
    except Exception:
        if cached is not None:
            return cached
        raise


async def get_ecmwf_hourly(
    lat: float, lon: float, elevation: int, start_date: str, end_date: str
) -> dict[str, Any]:
    return await _get_model_hourly(
        OPEN_METEO_ECMWF, "ecmwf", lat, lon, elevation, start_date, end_date
    )


async def get_gfs_hourly(
    lat: float, lon: float, elevation: int, start_date: str, end_date: str
) -> dict[str, Any]:
    return await _get_model_hourly(
        OPEN_METEO_GFS, "gfs", lat, lon, elevation, start_date, end_date
    )


async def get_historical(
    lat: float,
    lon: float,
    start_date: str,
    end_date: str,
) -> dict[str, Any]:
    """历史归档数据（日级）。"""
    key = f"om_archive_{lat}_{lon}_{start_date}_{end_date}"
    cached, stale = cache.get_cache(key, CACHE_TTL["historical"])
    if cached is not None and not stale:
        return cached

    hist_daily = [
        "temperature_2m_max",
        "temperature_2m_min",
        "precipitation_sum",
        "cloud_cover_mean",
        "wind_speed_10m_max",
    ]
    params = {
        "latitude": lat,
        "longitude": lon,
        "start_date": start_date,
        "end_date": end_date,
        "daily": ",".join(hist_daily),
        "timezone": "auto",
        "wind_speed_unit": "kmh",
    }
    try:
        raw = await _fetch_json(OPEN_METEO_ARCHIVE, params)
        result = {"daily": _pair_lists(raw.get("daily", {}), hist_daily)}
        cache.set_cache(key, result)
        return result
    except Exception:
        if cached is not None:
            return cached
        raise


def moon_phase_name(phase: Optional[float]) -> str:
    """Open-Meteo moon_phase ∈ [0,1)：0=新月, 0.25=上弦, 0.5=满月, 0.75=下弦。"""
    if phase is None:
        return ""
    p = phase % 1.0
    if p < 0.03 or p > 0.97:
        return "新月"
    if p < 0.22:
        return "蛾眉月"
    if p < 0.28:
        return "上弦月"
    if p < 0.47:
        return "盈凸月"
    if p < 0.53:
        return "满月"
    if p < 0.72:
        return "亏凸月"
    if p < 0.78:
        return "下弦月"
    return "残月"


def moon_illumination_from_phase(phase: Optional[float]) -> Optional[float]:
    """由月相计算照亮比例（%）。标准公式：(1 - cos(2π·phase)) / 2。

    phase=0 新月 0%，0.25 上弦 50%，0.5 满月 100%，0.75 下弦 50%。
    """
    if phase is None:
        return None
    p = phase % 1.0
    illum = (1 - math.cos(2 * math.pi * p)) / 2 * 100
    return round(illum, 1)
