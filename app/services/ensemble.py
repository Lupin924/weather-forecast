"""多模型集成：ECMWF vs GFS 逐日聚合 + 集成值 + 分歧度。"""
from __future__ import annotations

from typing import Any

from . import open_meteo


def _points_for_date(hourly: list[dict], date_str: str) -> list[dict]:
    return [p for p in hourly if p.get("time", "").startswith(date_str)]


def _aggregate(points: list[dict]) -> dict[str, Any]:
    if not points:
        return {"high": None, "low": None, "precipitation": 0.0,
                "cloud_cover_mean": None, "wind_speed_max": None}

    temps = [p["temperature_2m"] for p in points if p.get("temperature_2m") is not None]
    clouds = [p["cloud_cover"] for p in points if p.get("cloud_cover") is not None]
    winds = [p["wind_speed_10m"] for p in points if p.get("wind_speed_10m") is not None]
    precip = [p["precipitation"] for p in points if p.get("precipitation") is not None]

    return {
        "high": round(max(temps), 1) if temps else None,
        "low": round(min(temps), 1) if temps else None,
        "precipitation": round(sum(precip), 1) if precip else 0.0,
        "cloud_cover_mean": round(sum(clouds) / len(clouds), 1) if clouds else None,
        "wind_speed_max": round(max(winds), 1) if winds else None,
    }


def _ensemble(ec: dict, gfs: dict) -> dict[str, Any]:
    def avg(a, b):
        if a is None and b is None:
            return None
        if a is None:
            return b
        if b is None:
            return a
        return round((a + b) / 2, 1)

    return {
        "high": avg(ec.get("high"), gfs.get("high")),
        "low": avg(ec.get("low"), gfs.get("low")),
        "precipitation": avg(ec.get("precipitation"), gfs.get("precipitation")),
        "cloud_cover_mean": avg(ec.get("cloud_cover_mean"), gfs.get("cloud_cover_mean")),
        "wind_speed_max": avg(ec.get("wind_speed_max"), gfs.get("wind_speed_max")),
    }


def _classify(div: float, small: float, mid: float) -> str:
    if div is None:
        return "未知"
    if div < small:
        return "小"
    if div < mid:
        return "中"
    return "大"


def _divergence(ec: dict, gfs: dict) -> dict[str, str]:
    def diff(a, b):
        if a is None or b is None:
            return None
        return abs(a - b)

    return {
        "temperature": _classify(diff(ec.get("high"), gfs.get("high")), 2, 4),
        "precipitation": _classify(diff(ec.get("precipitation"), gfs.get("precipitation")), 2, 5),
        "cloud_cover": _classify(
            diff(ec.get("cloud_cover_mean"), gfs.get("cloud_cover_mean")), 20, 40
        ),
    }


async def build_multimodel(
    lat: float, lon: float, elevation: int, date_str: str
) -> dict[str, Any]:
    """并抓 ECMWF + GFS，输出聚合 + 集成 + 分歧度。"""
    ec_raw, gfs_raw = await open_meteo.get_ecmwf_hourly(
        lat, lon, elevation, date_str, date_str
    ), await open_meteo.get_gfs_hourly(lat, lon, elevation, date_str, date_str)

    ec_agg = _aggregate(_points_for_date(ec_raw["hourly"], date_str))
    gfs_agg = _aggregate(_points_for_date(gfs_raw["hourly"], date_str))

    return {
        "ecmwf": ec_agg,
        "gfs": gfs_agg,
        "ensemble": _ensemble(ec_agg, gfs_agg),
        "divergence": _divergence(ec_agg, gfs_agg),
    }
