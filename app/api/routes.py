"""REST API 路由：天气/观星/天文/历史/系统分析/城市搜索/空气质量。"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from ..config import (
    CITIES,
    DEFAULT_CITY_ID,
    get_city,
    search_cities,
    lookup_cma_city,
)
from ..models.schemas import CityInfo
from ..services import (
    cma,
    ensemble,
    open_meteo,
    stargazing,
    typhoon,
    air_quality,
)

router = APIRouter(prefix="/api")


# ---------------------------------------------------------------------------
# 工具
# ---------------------------------------------------------------------------
def _today_str() -> str:
    return date.today().isoformat()


def _resolve_city(
    city_id: str,
    lat: Optional[float],
    lon: Optional[float],
    elevation: Optional[int],
    station_id: Optional[str] = None,
):
    """支持预设城市、自定义坐标（city_id='custom'）、按名称搜索的城市。"""
    
    # 如果提供了 station_id，直接使用
    if station_id:
        if lat is None or lon is None:
            raise HTTPException(400, "提供 station_id 时需同时提供 lat 与 lon")
        return CityInfo(
            id=f"station_{station_id}",
            name=f"站点 {station_id}",
            latitude=lat,
            longitude=lon,
            elevation_m=int(elevation or 0),
            cma_station_id=station_id,
        )
    
    if city_id == "custom":
        if lat is None or lon is None:
            raise HTTPException(400, "自定义坐标需提供 lat 与 lon")
        return CityInfo(
            id="custom",
            name=f"自定义({lat:.2f},{lon:.2f})",
            latitude=lat,
            longitude=lon,
            elevation_m=int(elevation or 0),
            cma_station_id=None,
        )
    
    # 先检查是否是预设城市
    city = get_city(city_id)
    if city:
        return CityInfo(
            id=city.id,
            name=city.name,
            latitude=city.latitude,
            longitude=city.longitude,
            elevation_m=city.elevation_m,
            cma_station_id=city.cma_station_id,
        )
    
    # 再尝试按名称搜索
    cma_result = lookup_cma_city(city_id)
    if cma_result:
        return CityInfo(
            id=f"cma_{cma_result['name']}",
            name=cma_result["name"],
            latitude=cma_result["lat"],
            longitude=cma_result["lon"],
            elevation_m=cma_result.get("elev", 0),
            cma_station_id=cma_result["station_id"],
        )
    
    raise HTTPException(404, f"未知城市: {city_id}。可通过 /api/search/cities?q=关键词 搜索")


def _envelope(city: CityInfo, data, sources: list[str], confidence: str = "中", stale: bool = False):
    return {
        "city": city.model_dump(),
        "data": data,
        "meta": {
            "sources": sources,
            "updated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "confidence": confidence,
            "stale": stale,
        },
    }


# ---------------------------------------------------------------------------
# 城市列表
# ---------------------------------------------------------------------------
@router.get("/cities")
def list_cities():
    out = []
    for c in CITIES.values():
        out.append({
            "id": c.id,
            "name": c.name,
            "latitude": c.latitude,
            "longitude": c.longitude,
            "elevation_m": c.elevation_m,
            "cma_station_id": c.cma_station_id,
            "desc": c.desc,
            "tags": c.tags,
        })
    return {"cities": out, "default": DEFAULT_CITY_ID}


# ---------------------------------------------------------------------------
# 城市搜索（支持关键词搜索预设城市和 CMA 站号）
# ---------------------------------------------------------------------------
@router.get("/search/cities")
def search_cities_endpoint(q: str = Query(..., description="搜索关键词")):
    """搜索城市（预设城市 + CMA 站号数据库）。"""
    q = q.strip()
    if not q:
        return {"results": [], "total": 0}
    
    # 1. 搜索预设城市
    preset_results = search_cities(q, limit=20)
    
    # 2. 搜索 CMA 站号
    cma_result = lookup_cma_city(q)
    cma_data = None
    if cma_result:
        cma_data = {
            "id": f"cma_{cma_result['name']}",
            "name": cma_result["name"],
            "latitude": cma_result["lat"],
            "longitude": cma_result["lon"],
            "elevation_m": cma_result.get("elev", 0),
            "cma_station_id": cma_result["station_id"],
            "source": "CMA_station",
            "matched_by": cma_result.get("matched_by", "exact"),
        }
    
    results = {
        "preset": preset_results,
        "cma_match": cma_data,
        "total": len(preset_results) + (1 if cma_data else 0),
    }
    
    return results


@router.get("/search/resolve")
def resolve_city(
    name: str = Query(..., description="城市名称或关键词"),
):
    """根据名称解析城市信息（用于直接跳转）。"""
    name = name.strip()
    
    # 先检查是否是预设城市 ID
    city = get_city(name)
    if city:
        return {
            "success": True,
            "city": {
                "id": city.id,
                "name": city.name,
                "latitude": city.latitude,
                "longitude": city.longitude,
                "elevation_m": city.elevation_m,
                "cma_station_id": city.cma_station_id,
                "source": "preset",
            }
        }
    
    # 按名称搜索预设城市
    preset_results = search_cities(name, limit=1)
    if preset_results:
        return {
            "success": True,
            "city": {
                **preset_results[0],
                "source": "preset",
            }
        }
    
    # 搜索 CMA 站号
    cma_result = lookup_cma_city(name)
    if cma_result:
        return {
            "success": True,
            "city": {
                "id": f"cma_{cma_result['name']}",
                "name": cma_result["name"],
                "latitude": cma_result["lat"],
                "longitude": cma_result["lon"],
                "elevation_m": cma_result.get("elev", 0),
                "cma_station_id": cma_result["station_id"],
                "source": "CMA_station",
                "matched_by": cma_result.get("matched_by", "exact"),
            }
        }
    
    return {
        "success": False,
        "message": f"未找到匹配的城市: {name}",
        "suggestion": "请检查拼写，或使用 /api/search/cities?q=关键词 查看搜索结果",
    }


# ---------------------------------------------------------------------------
# 实况
# ---------------------------------------------------------------------------
@router.get("/weather/{city_id}/now")
async def weather_now(
    city_id: str,
    lat: Optional[float] = Query(None),
    lon: Optional[float] = Query(None),
    elevation: Optional[int] = Query(None),
    station_id: Optional[str] = Query(None, description="CMA 站号（可选）"),
):
    city = _resolve_city(city_id, lat, lon, elevation, station_id)
    sources, stale = [], False

    if city.cma_station_id:
        try:
            raw = await cma.get_now(city.cma_station_id)
            now = raw.get("now", {})
            data = {
                "temperature": now.get("temperature"),
                "feels_like": now.get("feelst"),
                "pressure": now.get("pressure"),
                "humidity": now.get("humidity"),
                "wind_direction": now.get("windDirection"),
                "wind_direction_degree": now.get("windDirectionDegree"),
                "wind_speed": now.get("windSpeed"),  # m/s
                "wind_scale": now.get("windScale"),
                "precipitation": now.get("precipitation"),
                "alarms": raw.get("alarms", []),
                "last_update": raw.get("last_update", ""),
            }
            sources.append("CMA")
            stale = raw.get("_stale", False)
        except Exception:
            data = None
    else:
        data = None

    # 无 CMA 时用 Open-Meteo current 兜底
    if data is None:
        try:
            fc = await open_meteo.get_forecast(
                city.latitude, city.longitude, city.elevation_m, forecast_days=1
            )
            hourly = fc.get("hourly", [])
            now_pt = hourly[0] if hourly else {}
            data = {
                "temperature": now_pt.get("temperature_2m"),
                "feels_like": now_pt.get("apparent_temperature"),
                "pressure": now_pt.get("surface_pressure"),
                "humidity": now_pt.get("relative_humidity_2m"),
                "wind_direction": "",
                "wind_direction_degree": now_pt.get("wind_direction_10m"),
                "wind_speed": (now_pt.get("wind_speed_10m") or 0) / 3.6,  # km/h -> m/s
                "wind_scale": "",
                "precipitation": now_pt.get("precipitation"),
                "alarms": [],
                "last_update": now_pt.get("time", ""),
            }
            sources.append("Open-Meteo")
        except Exception as e:
            raise HTTPException(502, f"数据源获取失败: {e}")

    return _envelope(city, data, sources, "高", stale)


# ---------------------------------------------------------------------------
# 7 天预报
# ---------------------------------------------------------------------------
@router.get("/weather/{city_id}/forecast")
async def weather_forecast(
    city_id: str,
    lat: Optional[float] = Query(None),
    lon: Optional[float] = Query(None),
    elevation: Optional[int] = Query(None),
    station_id: Optional[str] = Query(None, description="CMA 站号（可选）"),
):
    city = _resolve_city(city_id, lat, lon, elevation, station_id)
    sources, stale = [], False
    daily_out: list[dict] = []

    # CMA 7 天
    if city.cma_station_id:
        try:
            raw = await cma.get_weather(city.cma_station_id)
            for d in raw.get("daily", []):
                daily_out.append({
                    "date": d.get("date", "").replace("/", "-"),
                    "high": d.get("high"),
                    "low": d.get("low"),
                    "day_text": d.get("dayText"),
                    "night_text": d.get("nightText"),
                    "day_wind_direction": d.get("dayWindDirection"),
                    "night_wind_direction": d.get("nightWindDirection"),
                    "day_wind_scale": d.get("dayWindScale"),
                    "night_wind_scale": d.get("nightWindScale"),
                    "precipitation": None,
                    "cloud_cover": None,
                })
            sources.append("CMA")
            stale = raw.get("_stale", False)
        except Exception:
            pass

    # Open-Meteo 补充（扩展到 16 天 + 补全降水/云量）
    try:
        fc = await open_meteo.get_forecast(
            city.latitude, city.longitude, city.elevation_m, forecast_days=16
        )
        om_daily = {d["time"]: d for d in fc.get("daily", [])}
        for entry in daily_out:
            om = om_daily.get(entry["date"])
            if om:
                entry["precipitation"] = om.get("precipitation_sum")
                entry["cloud_cover"] = om.get("cloud_cover_mean")
        # 追加 CMA 7 天之外的日期
        existing = {e["date"] for e in daily_out}
        for d in fc.get("daily", []):
            if d["time"] not in existing:
                daily_out.append({
                    "date": d["time"],
                    "high": d.get("temperature_2m_max"),
                    "low": d.get("temperature_2m_min"),
                    "day_text": "",
                    "night_text": "",
                    "day_wind_direction": "",
                    "night_wind_direction": "",
                    "day_wind_scale": "",
                    "night_wind_scale": "",
                    "precipitation": d.get("precipitation_sum"),
                    "cloud_cover": d.get("cloud_cover_mean"),
                })
        sources.append("Open-Meteo")
    except Exception:
        pass

    if not daily_out:
        raise HTTPException(502, "预报数据源获取失败")
    return _envelope(city, daily_out, sources, "中", stale)


# ---------------------------------------------------------------------------
# 逐小时
# ---------------------------------------------------------------------------
@router.get("/weather/{city_id}/hourly")
async def weather_hourly(
    city_id: str,
    date: Optional[str] = Query(None, description="YYYY-MM-DD，默认今天"),
    lat: Optional[float] = Query(None),
    lon: Optional[float] = Query(None),
    elevation: Optional[int] = Query(None),
    station_id: Optional[str] = Query(None, description="CMA 站号（可选）"),
):
    city = _resolve_city(city_id, lat, lon, elevation, station_id)
    target = date or _today_str()
    sources, stale = [], False
    hourly_out: list[dict] = []

    # CMA 逐小时（仅近 24h，含中文天气文本）
    if city.cma_station_id:
        try:
            raw = await cma.get_hourly(city.cma_station_id, target)
            for item in raw.get("hourly", []):
                ft = item.get("forecastTime", "").replace("/", "-")
                hourly_out.append({
                    "time": ft,
                    "temperature": item.get("temperature"),
                    "humidity": item.get("humidity"),
                    "pressure": item.get("pressure"),
                    "precipitation": item.get("precipitation"),
                    "cloud_cover": item.get("totalCloudCover"),
                    "wind_speed": (item.get("windSpeed") or 0) * 3.6,  # m/s -> km/h
                    "wind_direction": item.get("windDirection"),
                    "wind_gusts": None,
                    "visibility": item.get("visibility"),
                    "dew_point": None,
                    "weather_code": item.get("weather"),
                    "text": item.get("text"),
                    "source": "CMA",
                })
            if hourly_out:
                sources.append("CMA")
                stale = raw.get("_stale", False)
        except Exception:
            pass

    # Open-Meteo 逐小时（覆盖更广 + 阵风/露点）
    try:
        fc = await open_meteo.get_forecast(
            city.latitude, city.longitude, city.elevation_m, forecast_days=16
        )
        cma_times = {h["time"] for h in hourly_out}
        for p in fc.get("hourly", []):
            if not p.get("time", "").startswith(target):
                continue
            if p["time"] in cma_times:
                continue  # CMA 已覆盖该时刻
            hourly_out.append({
                "time": p.get("time"),
                "temperature": p.get("temperature_2m"),
                "humidity": p.get("relative_humidity_2m"),
                "pressure": p.get("surface_pressure"),
                "precipitation": p.get("precipitation"),
                "cloud_cover": p.get("cloud_cover"),
                "wind_speed": p.get("wind_speed_10m"),
                "wind_direction": p.get("wind_direction_10m"),
                "wind_gusts": p.get("wind_gusts_10m"),
                "visibility": p.get("visibility"),
                "dew_point": p.get("dew_point_2m"),
                "weather_code": p.get("weather_code"),
                "text": None,
                "source": "Open-Meteo",
            })
        sources.append("Open-Meteo")
    except Exception:
        pass

    hourly_out.sort(key=lambda h: h.get("time") or "")
    if not hourly_out:
        raise HTTPException(502, "逐小时数据源获取失败")
    return _envelope(city, hourly_out, sources, "中", stale)


# ---------------------------------------------------------------------------
# 多模型集成
# ---------------------------------------------------------------------------
@router.get("/weather/{city_id}/multimodel")
async def weather_multimodel(
    city_id: str,
    date: Optional[str] = Query(None),
    lat: Optional[float] = Query(None),
    lon: Optional[float] = Query(None),
    elevation: Optional[int] = Query(None),
    station_id: Optional[str] = Query(None, description="CMA 站号（可选）"),
):
    city = _resolve_city(city_id, lat, lon, elevation, station_id)
    target = date or _today_str()
    try:
        data = await ensemble.build_multimodel(
            city.latitude, city.longitude, city.elevation_m, target
        )
    except Exception as e:
        raise HTTPException(502, f"多模型数据获取失败: {e}")
    return _envelope(city, data, ["ECMWF", "GFS"], "中")


# ---------------------------------------------------------------------------
# 观星
# ---------------------------------------------------------------------------
@router.get("/stargazing/{city_id}")
async def stargazing_score(
    city_id: str,
    date: Optional[str] = Query(None),
    lat: Optional[float] = Query(None),
    lon: Optional[float] = Query(None),
    elevation: Optional[int] = Query(None),
    station_id: Optional[str] = Query(None, description="CMA 站号（可选）"),
):
    city = _resolve_city(city_id, lat, lon, elevation, station_id)
    target = date or _today_str()
    try:
        data = await stargazing.build_stargazing(
            city.latitude, city.longitude, city.elevation_m, target
        )
    except Exception as e:
        raise HTTPException(502, f"观星评分计算失败: {e}")
    return _envelope(city, data, ["ECMWF", "Open-Meteo-Astronomy", "AirQuality"], "中")


# ---------------------------------------------------------------------------
# 天文
# ---------------------------------------------------------------------------
@router.get("/astronomy/{city_id}")
async def astronomy(
    city_id: str,
    date: Optional[str] = Query(None),
    lat: Optional[float] = Query(None),
    lon: Optional[float] = Query(None),
    elevation: Optional[int] = Query(None),
    station_id: Optional[str] = Query(None, description="CMA 站号（可选）"),
):
    city = _resolve_city(city_id, lat, lon, elevation, station_id)
    target = date or _today_str()
    try:
        fc = await open_meteo.get_forecast(
            city.latitude, city.longitude, city.elevation_m, forecast_days=16
        )
        day = next((d for d in fc.get("daily", []) if d.get("time") == target), None)
        if not day:
            raise HTTPException(404, "该日期无天文数据")
        phase = day.get("moon_phase")
        data = {
            "date": target,
            "sunrise": day.get("sunrise"),
            "sunset": day.get("sunset"),
            "moonrise": day.get("moonrise"),
            "moonset": day.get("moonset"),
            "moon_phase": phase,
            "moon_illumination": open_meteo.moon_illumination_from_phase(phase),
            "moon_phase_name": open_meteo.moon_phase_name(phase),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"天文数据获取失败: {e}")
    return _envelope(city, data, ["Open-Meteo"], "高")


# ---------------------------------------------------------------------------
# 空气质量/光污染
# ---------------------------------------------------------------------------
@router.get("/air-quality/{city_id}")
async def get_air_quality_endpoint(
    city_id: str,
    lat: Optional[float] = Query(None),
    lon: Optional[float] = Query(None),
    elevation: Optional[int] = Query(None),
    station_id: Optional[str] = Query(None, description="CMA 站号（可选）"),
):
    city = _resolve_city(city_id, lat, lon, elevation, station_id)
    try:
        data = await air_quality.get_air_quality(city.latitude, city.longitude, city.elevation_m)
    except Exception as e:
        raise HTTPException(502, f"空气质量数据获取失败: {e}")
    return _envelope(city, data, ["Open-Meteo-AirQuality"], "中")


# ---------------------------------------------------------------------------
# 历史同期
# ---------------------------------------------------------------------------
@router.get("/historical/{city_id}")
async def historical(
    city_id: str,
    month_day: str = Query(..., description="MM-DD，如 08-15"),
    lat: Optional[float] = Query(None),
    lon: Optional[float] = Query(None),
    elevation: Optional[int] = Query(None),
    station_id: Optional[str] = Query(None, description="CMA 站号（可选）"),
):
    city = _resolve_city(city_id, lat, lon, elevation, station_id)
    today = date.today()
    years_data = []
    # 取过去 3 个完整年
    for y in [today.year - 1, today.year - 2, today.year - 3]:
        d_str = f"{y}-{month_day}"
        try:
            raw = await open_meteo.get_historical(
                city.latitude, city.longitude, d_str, d_str
            )
            daily = raw.get("daily", [])
            if daily:
                d = daily[0]
                years_data.append({
                    "year": y,
                    "high": d.get("temperature_2m_max"),
                    "low": d.get("temperature_2m_min"),
                    "precipitation": d.get("precipitation_sum"),
                    "cloud_cover_mean": d.get("cloud_cover_mean"),
                    "wind_speed_max": d.get("wind_speed_10m_max"),
                })
        except Exception:
            continue
    data = {"month_day": month_day, "years": years_data}
    return _envelope(city, data, ["Open-Meteo-Archive"], "高")


# ---------------------------------------------------------------------------
# 天气系统分析
# ---------------------------------------------------------------------------
@router.get("/analysis/{city_id}")
async def analysis(
    city_id: str,
    date: Optional[str] = Query(None),
    lat: Optional[float] = Query(None),
    lon: Optional[float] = Query(None),
    elevation: Optional[int] = Query(None),
    station_id: Optional[str] = Query(None, description="CMA 站号（可选）"),
):
    city = _resolve_city(city_id, lat, lon, elevation, station_id)
    target = date or _today_str()
    try:
        data = await typhoon.build_analysis(
            city.latitude, city.longitude, city.elevation_m, target
        )
    except Exception as e:
        raise HTTPException(502, f"系统分析失败: {e}")
    return _envelope(city, data, ["ECMWF"], "中")


# ---------------------------------------------------------------------------
# 健康检查
# ---------------------------------------------------------------------------
@router.get("/health")
async def health_check():
    """健康检查接口。"""
    return {
        "status": "ok",
        "version": "2.0.0",
        "features": [
            "multi-source",
            "stargazing",
            "light-pollution",
            "city-search",
            "dark-light-mode",
        ],
    }
