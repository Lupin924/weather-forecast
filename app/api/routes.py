"""REST API 路由：天气/观星/天文/历史/系统分析/城市搜索/空气质量。"""
from __future__ import annotations

import asyncio
from datetime import date, datetime

from fastapi import APIRouter, HTTPException, Query

from ..config import (
    CITIES,
    DEFAULT_CITY_ID,
    HOME_CITY_ID,
    city_to_dict,
    distance_from_home,
    get_city,
    lookup_cma_city,
    search_cities,
    snow_city_ids,
    sort_cities_for_home,
    stargaze_city_ids,
)
from ..models.schemas import CityInfo
from ..services import (
    air_quality,
    cache,
    cma,
    ensemble,
    events,
    open_meteo,
    snow,
    stargazing,
    typhoon,
)

router = APIRouter(prefix="/api")


# ---------------------------------------------------------------------------
# 工具
# ---------------------------------------------------------------------------
def _today_str() -> str:
    return date.today().isoformat()


def _resolve_city(
    city_id: str,
    lat: float | None,
    lon: float | None,
    elevation: int | None,
    station_id: str | None = None,
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
def list_cities(mode: str = Query("all", description="模式：stargazing/snow/all")):
    """城市列表。

    - mode=stargazing：观星模式分组（华东近沪优先）
    - mode=snow：赏雪模式分组（雪景城市）
    - mode=all：全部城市，按离上海距离升序
    """
    if mode == "snow":
        ordered_ids = sort_cities_for_home(snow_city_ids())
        out = [city_to_dict(CITIES[cid]) for cid in ordered_ids if cid in CITIES]
        # 统一按距上海由近及远排序，不做地域分区
        groups = [{"name": "距上海由近及远", "icon": "📍", "cities": out}]
        return {
            "cities": out,
            "groups": groups,
            "default": "weihai",
            "home_city": HOME_CITY_ID,
            "mode": mode,
        }
    if mode == "stargazing":
        ordered_ids = sort_cities_for_home(stargaze_city_ids())
        out = [city_to_dict(CITIES[cid]) for cid in ordered_ids if cid in CITIES]
        # 统一按距上海由近及远排序，不做地域分区
        groups = [{"name": "距上海由近及远", "icon": "📍", "cities": out}]
        return {
            "cities": out,
            "groups": groups,
            "default": "anji",
            "home_city": HOME_CITY_ID,
            "mode": mode,
        }
    # all：保持旧行为但按上海距离排序（新增 distance_km 字段）
    ordered_ids = sort_cities_for_home(list(CITIES.keys()))
    out = [city_to_dict(CITIES[cid]) for cid in ordered_ids if cid in CITIES]
    return {"cities": out, "default": DEFAULT_CITY_ID, "home_city": HOME_CITY_ID, "mode": "all"}


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
    lat: float | None = Query(None),
    lon: float | None = Query(None),
    elevation: int | None = Query(None),
    station_id: str | None = Query(None, description="CMA 站号（可选）"),
    date: str | None = Query(None, description="YYYY-MM-DD，默认今天"),
):
    city = _resolve_city(city_id, lat, lon, elevation, station_id)
    target = date or _today_str()
    today = _today_str()
    sources, stale = [], False

    # 未来日期：从 Open-Meteo 预报中取同时刻数据
    if target > today:
        try:
            from datetime import datetime as _dt
            diff = (_dt.fromisoformat(target) - _dt.fromisoformat(today)).days
        except Exception:
            diff = 99
        if diff > 3:
            data = {"mode": "unavailable", "message": "该日期超出 3 天预报范围，暂无实况数据"}
            return _envelope(city, data, [], "低")
        # 取目标日同时刻预报
        try:
            fc = await open_meteo.get_forecast(
                city.latitude, city.longitude, city.elevation_m, forecast_days=7
            )
            hourly = fc.get("hourly", [])
            current_hour = datetime.now().hour
            now_pt = None
            best_diff = 99
            for p in hourly:
                t = p.get("time", "")
                if not t.startswith(target):
                    continue
                try:
                    h = int(t[11:13])
                except Exception:
                    continue
                d = abs(h - current_hour)
                if d < best_diff:
                    best_diff = d
                    now_pt = p
            if now_pt is None:
                # 取目标日第一个点
                now_pt = next((p for p in hourly if p.get("time", "").startswith(target)), {})
            # 优先从 CMA 预报取最高/最低气温（与预报卡片数据源一致）
            temp_max = None
            temp_min = None
            if city.cma_station_id:
                try:
                    cma_raw = await cma.get_weather(city.cma_station_id)
                    for d in cma_raw.get("daily", []):
                        if d.get("date", "").replace("/", "-") == target:
                            temp_max = d.get("high")
                            temp_min = d.get("low")
                            break
                except Exception:
                    pass
            # CMA 无数据时回退到 Open-Meteo daily
            if temp_max is None or temp_min is None:
                daily = fc.get("daily", [])
                day_pt = next((d for d in daily if d.get("time", "") == target), {})
                if temp_max is None:
                    temp_max = day_pt.get("temperature_2m_max")
                if temp_min is None:
                    temp_min = day_pt.get("temperature_2m_min")
            data = {
                "mode": "forecast",
                "temperature": now_pt.get("temperature_2m"),
                "temperature_max": temp_max,
                "temperature_min": temp_min,
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
            sources.append("Open-Meteo预报")
        except Exception as e:
            raise HTTPException(502, f"预报数据获取失败: {e}")
        return _envelope(city, data, sources, "中")

    # 过去日期
    if target < today:
        data = {"mode": "unavailable", "message": "无法查看历史实况数据，请选择今天或未来 3 天"}
        return _envelope(city, data, [], "低")

    # 今天：走现有实况逻辑
    if city.cma_station_id:
        try:
            raw = await cma.get_now(city.cma_station_id)
            now = raw.get("now", {})
            data = {
                "mode": "realtime",
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
                "mode": "realtime",
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
    lat: float | None = Query(None),
    lon: float | None = Query(None),
    elevation: int | None = Query(None),
    station_id: str | None = Query(None, description="CMA 站号（可选）"),
):
    city = _resolve_city(city_id, lat, lon, elevation, station_id)
    sources, stale = [], False
    daily_out: list[dict] = []

    # CMA 7 天
    if city.cma_station_id:
        try:
            raw = await cma.get_weather(city.cma_station_id)
            today = _today_str()
            for d in raw.get("daily", []):
                d_date = d.get("date", "").replace("/", "-")
                # 过滤过去日期：CMA 偶发返回过时数据（如已停用站号返回几年前数据）
                if d_date < today:
                    continue
                daily_out.append({
                    "date": d_date,
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
            city.latitude, city.longitude, city.elevation_m, forecast_days=7
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
    # 按日期升序排序，避免数据源拼接导致日期错乱
    daily_out.sort(key=lambda x: x.get("date", ""))
    return _envelope(city, daily_out, sources, "中", stale)


# ---------------------------------------------------------------------------
# 逐小时
# ---------------------------------------------------------------------------
@router.get("/weather/{city_id}/hourly")
async def weather_hourly(
    city_id: str,
    date: str | None = Query(None, description="YYYY-MM-DD，默认今天"),
    lat: float | None = Query(None),
    lon: float | None = Query(None),
    elevation: int | None = Query(None),
    station_id: str | None = Query(None, description="CMA 站号（可选）"),
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
            city.latitude, city.longitude, city.elevation_m, forecast_days=7
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
    date: str | None = Query(None),
    lat: float | None = Query(None),
    lon: float | None = Query(None),
    elevation: int | None = Query(None),
    station_id: str | None = Query(None, description="CMA 站号（可选）"),
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
@router.get("/stargazing/board")
async def stargazing_board(days: int = Query(7, ge=1, le=16, description="预报天数")):
    """观星看板：全国观星地未来 N 天晴夜聚合 + 动态窗口期推荐（结构与赏雪看板对齐）。"""
    try:
        data = await stargazing.build_stargazing_board(days)
    except Exception as e:
        raise HTTPException(502, f"观星看板生成失败: {e}")
    return {
        "data": data,
        "meta": {
            "sources": ["Open-Meteo"],
            "updated_at": data.get("generated_at"),
            "confidence": "中",
            "stale": False,
        },
    }


@router.get("/stargazing/{city_id}")
async def stargazing_score(
    city_id: str,
    date: str | None = Query(None),
    lat: float | None = Query(None),
    lon: float | None = Query(None),
    elevation: int | None = Query(None),
    station_id: str | None = Query(None, description="CMA 站号（可选）"),
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


@router.get("/stargazing/forecast/{city_id}")
async def stargazing_forecast(
    city_id: str,
    days: int = Query(15, ge=1, le=16, description="预报天数，最长 16 天"),
    lat: float | None = Query(None),
    lon: float | None = Query(None),
    elevation: int | None = Query(None),
    station_id: str | None = Query(None, description="CMA 站号（可选）"),
):
    """单城市未来 N 天观星条件摘要（每日一条，供详情页展示）。"""
    city = _resolve_city(city_id, lat, lon, elevation, station_id)
    try:
        data = await stargazing.build_stargazing_forecast(
            city.latitude, city.longitude, city.elevation_m, days
        )
    except Exception as e:
        raise HTTPException(502, f"观星多日预报失败: {e}")
    return _envelope(city, data, ["ECMWF", "Open-Meteo-Astronomy", "AirQuality"], "中")


# ---------------------------------------------------------------------------
# 天文
# ---------------------------------------------------------------------------
@router.get("/astronomy/{city_id}")
async def astronomy(
    city_id: str,
    date: str | None = Query(None),
    lat: float | None = Query(None),
    lon: float | None = Query(None),
    elevation: int | None = Query(None),
    station_id: str | None = Query(None, description="CMA 站号（可选）"),
):
    city = _resolve_city(city_id, lat, lon, elevation, station_id)
    target = date or _today_str()
    try:
        fc = await open_meteo.get_forecast(
            city.latitude, city.longitude, city.elevation_m, forecast_days=7
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
    lat: float | None = Query(None),
    lon: float | None = Query(None),
    elevation: int | None = Query(None),
    station_id: str | None = Query(None, description="CMA 站号（可选）"),
    date: str | None = Query(None, description="YYYY-MM-DD，默认今天"),
):
    city = _resolve_city(city_id, lat, lon, elevation, station_id)
    try:
        data = await air_quality.get_air_quality(city.latitude, city.longitude, city.elevation_m, target_date=date)
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
    lat: float | None = Query(None),
    lon: float | None = Query(None),
    elevation: int | None = Query(None),
    station_id: str | None = Query(None, description="CMA 站号（可选）"),
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
    date: str | None = Query(None),
    lat: float | None = Query(None),
    lon: float | None = Query(None),
    elevation: int | None = Query(None),
    station_id: str | None = Query(None, description="CMA 站号（可选）"),
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
@router.get("/snow/board")
async def snow_board(days: int = Query(7, ge=1, le=16, description="预报天数")):
    """赏雪看板：全国雪景城市未来 N 天降雪概率聚合 + 每日播报。"""
    try:
        data = await snow.build_board(days)
    except Exception as e:
        raise HTTPException(502, f"赏雪看板生成失败: {e}")
    return {
        "data": data,
        "meta": {
            "sources": ["Open-Meteo"],
            "updated_at": data.get("generated_at"),
            "confidence": "中",
            "stale": False,
        },
    }


@router.get("/snow/forecast/{city_id}")
async def snow_forecast(
    city_id: str,
    days: int = Query(7, ge=1, le=16, description="预报天数"),
    lat: float | None = Query(None),
    lon: float | None = Query(None),
    elevation: int | None = Query(None),
):
    """单城市雪况预报：逐日降雪概率/评分/因子。"""
    # 自定义坐标走临时城市注册
    if city_id == "custom" and lat is not None and lon is not None:
        from ..config import City
        cid = f"custom_{lat:.3f}_{lon:.3f}"
        if cid not in CITIES:
            CITIES[cid] = City(cid, f"自定义({lat:.2f},{lon:.2f})", lat, lon, int(elevation or 0), None, "自定义坐标", ["自定义"])
        city_id = cid
    city = get_city(city_id)
    if not city:
        raise HTTPException(404, f"未知城市: {city_id}")
    try:
        data = await snow.build_city_forecast(city_id, days)
    except Exception as e:
        raise HTTPException(502, f"雪况预报失败: {e}")
    city_info = CityInfo(
        id=city.id,
        name=city.name,
        latitude=city.latitude,
        longitude=city.longitude,
        elevation_m=city.elevation_m,
        cma_station_id=city.cma_station_id,
    )
    return _envelope(city_info, data, ["Open-Meteo"], "中")


@router.get("/pinned/summary")
async def pinned_summary(
    ids: str = Query(..., description="逗号分隔的城市 ID（最多 10 个）"),
    days: int = Query(7, ge=1, le=16, description="每城展示天数"),
    mode: str = Query("snow", pattern="^(snow|stargazing)$"),
):
    """首屏钉住城市卡片：一次拿到多城未来 N 天的核心指标。"""
    city_ids = [x.strip() for x in ids.split(",") if x.strip()][:10]
    if not city_ids:
        raise HTTPException(400, "ids 不能为空")

    cache_key = f"pinned_{mode}_{days}_{'_'.join(city_ids)}"
    cached, stale = cache.get_cache(cache_key, 1800)
    if cached is not None and not stale:
        return {"data": cached, "meta": {
            "sources": ["Open-Meteo"],
            "updated_at": cached.get("generated_at"),
            "confidence": "中",
            "cached": True,
        }}

    async def one(cid: str):
        city = get_city(cid)
        if not city:
            return None
        dist = round(distance_from_home(city), 1)
        try:
            if mode == "snow":
                raw = await snow.build_city_forecast(cid, days)
                items = [{
                    "date": x["date"],
                    "value": x["snow_probability"],
                    "score": x["score"],
                    "rating": x["rating"],
                    "level": x["level"],
                    "snowfall_cm": x["snowfall_cm"],
                    "temp_min": x["temp_min"],
                    "temp_max": x["temp_max"],
                    "precip_probability": x["precip_probability"],
                } for x in raw.get("days", [])]
            else:
                raw = await stargazing.build_stargazing_forecast(
                    city.latitude, city.longitude, city.elevation_m, days
                )
                items = [{
                    "date": x["date"],
                    "value": x["score"],
                    "score": x["score"],
                    "rating": x["rating"],
                    "level": x["level"],
                    "cloud_cover": x["cloud_cover"],
                    "moon_illumination": x["moon_illumination"],
                    "best_window_start": x["best_window_start"],
                    "best_window_end": x["best_window_end"],
                } for x in raw.get("days", [])]
            return {
                "id": cid,
                "name": city.name,
                "distance_km": dist,
                "days": items,
                "best": raw.get("best"),
            }
        except Exception:
            return {"id": cid, "name": city.name, "distance_km": dist, "days": [], "best": None}

    results = await asyncio.gather(*[one(cid) for cid in city_ids])
    data = {
        "items": [x for x in results if x],
        "days": days,
        "mode": mode,
        "generated_at": datetime.now().isoformat(timespec="seconds"),
    }
    if any(x and x.get("days") for x in results):
        cache.set_cache(cache_key, data)
    return {
        "data": data,
        "meta": {
            "sources": ["Open-Meteo"],
            "updated_at": data["generated_at"],
            "confidence": "中",
        },
    }


@router.get("/events")
async def list_events(
    mode: str = Query("stargazing", description="模式：stargazing/snow"),
    window_days: int = Query(60, ge=1, le=180),
):
    """返回某模式下即将发生/正在进行的热点事件（流星雨 / 冰雪文旅）。"""
    items = events.get_events(mode=mode, window_days=window_days)
    return {
        "data": {
            "mode": mode,
            "items": items,
            "generated_at": datetime.now().isoformat(timespec="seconds"),
        },
        "meta": {
            "sources": ["内置事件库"],
            "confidence": "参考",
        },
    }


@router.get("/health")
async def health_check():
    """健康检查接口。"""
    return {
        "status": "ok",
        "version": "2.3.0",
        "modes": ["stargazing", "snow"],
        "features": [
            "multi-source",
            "stargazing",
            "snow-forecast",
            "snow-board",
            "hot-events",
            "light-pollution",
            "city-search",
            "home-city-sorting",
        ],
    }
