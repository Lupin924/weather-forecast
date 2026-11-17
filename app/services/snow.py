"""赏雪模式服务：降雪概率评分 + 全国雪景城市看板聚合。

数据来源：Open-Meteo 逐小时/逐日预报（含 snowfall / precipitation_probability）。
评分算法（0-100，5 维加权）：
- 气温 temp        34%：日最低气温越低越利于降雪/积雪
- 降水概率 precip  26%：降水发生可能性
- 降雪量 snowfall  22%：预期降雪量（cm）
- 湿度 humidity    10%：空气湿度
- 海拔 elevation    8%：高海拔更易形成积雪

评级：🌨️极佳(≥75) / ❄️较大(55-74) / 🌬️可能(35-54) / ☀️较小(<35)
"""
from __future__ import annotations

import asyncio
from datetime import date, datetime, timedelta

from .. import config
from . import cache, open_meteo

# WMO weather_code 中属于降雪的代码
SNOW_CODES = {71, 73, 75, 77, 85, 86, 68, 69}

# ---------------------------------------------------------------------------
# 动态「推荐赏雪地」权重
# 推荐 ≠ 绝对雪量榜（那样东北城市永远霸榜）。这里面向上海用户，综合：
# - intensity 降雪强度：真实降雪概率，保证推荐可信、不推无雪之城
# - planning 规划窗口：赏雪需提前安排行程，留出 2~5 天的雪讯最理想；
#                      今明两天太赶（来不及订票/请假），远期又不确定，均降权
# - rarity   稀罕度：离上海越近的雪越稀罕（江南雪一旦出现，胜过高纬常态雪）
# - quality  综合评分：雪况本身的质感
# ---------------------------------------------------------------------------
RECOMMEND_WEIGHTS = {
    "intensity": 0.34,
    "planning": 0.28,
    "rarity": 0.26,
    "quality": 0.12,
}


def _planning_score(day_idx: int) -> float:
    """规划窗口评分（0-1）：留出提前量的雪讯最值得推荐。

    day_idx 为距离今天第几天（0=今天）。
    - 0/1（今天/明天）：太赶，来不及规划 → 0.15 / 0.35
    - 2~5 天：黄金规划窗口 → 0.8 ~ 1.0
    - 6 天及以上：仍可规划但更不确定 → 递减
    """
    if day_idx <= 0:
        return 0.15
    if day_idx == 1:
        return 0.35
    if day_idx <= 5:
        return min(1.0, 0.8 + 0.05 * day_idx)  # 2→0.9, 3→0.95, 4~5→1.0
    return max(0.45, 1.0 - 0.12 * (day_idx - 5))



def _temp_score(t_min: float | None, t_max: float | None) -> float:
    """气温评分：日最低温越低越有利，冷而不极端最佳。"""
    if t_min is None:
        return 0.0
    # 以最低温为主，兼顾最高温（若全天都在冰点以上则难积雪）
    ref = t_min if t_min < 0 else (t_max if t_max is not None else t_min)
    if ref <= -12:
        return 90.0
    if ref <= -8:
        return 100.0
    if ref <= -3:
        return 96.0
    if ref <= -1:
        return 82.0
    if ref <= 0:
        return 68.0
    if ref <= 1.5:
        return 40.0
    if ref <= 3:
        return 18.0
    return 0.0


def _precip_score(prob: float | None) -> float:
    if prob is None:
        return 0.0
    return min(100.0, float(prob))


def _snowfall_score(cm: float | None) -> float:
    if cm is None or cm <= 0:
        return 0.0
    # 0.5cm→25, 1cm→40, 3cm→75, 5cm+→100
    return min(100.0, 12.0 + cm * 22.0)


def _humidity_score(h: float | None) -> float:
    if h is None:
        return 50.0
    # 湿度 60-90% 较利于雪
    if h >= 85:
        return 100.0
    if h >= 70:
        return 85.0
    if h >= 55:
        return 60.0
    if h >= 40:
        return 35.0
    return 15.0


def _elevation_score(elev: int) -> float:
    # 500m→40, 1000m→65, 1500m→85, 2000m+→100
    if elev >= 2000:
        return 100.0
    if elev >= 1500:
        return 85.0
    if elev >= 1000:
        return 65.0
    if elev >= 600:
        return 45.0
    if elev >= 300:
        return 28.0
    return 12.0


def _snow_probability(
    snowfall_cm: float | None,
    precip_prob: float | None,
    weather_codes: list[int],
    temp_min: float | None,
) -> float:
    """综合判断降雪概率（0-100）。"""
    codes = set(c for c in weather_codes if c is not None)
    has_snow_code = bool(codes & SNOW_CODES)
    if snowfall_cm and snowfall_cm > 0:
        prob = 70.0 + min(30.0, snowfall_cm * 8.0)
    elif has_snow_code and (precip_prob or 0) > 20 and (temp_min or 99) < 2:
        prob = 45.0 + (precip_prob or 0) * 0.4
    elif (temp_min or 99) < 1 and (precip_prob or 0) >= 55:
        # 低温 + 高降水概率，即使无显式雪代码也可能出现雨夹雪/雪
        prob = 20.0 + (precip_prob or 0) * 0.35
    else:
        return 0.0
    if temp_min is not None and temp_min > 4:
        prob *= 0.3  # 气温过高，雪概率大打折扣
    return round(min(100.0, prob))


def _score_day(day: dict, hours: list[dict], elevation: int) -> dict:
    """对单日数据计算雪况评分。"""
    raw_date = day.get("time") or day.get("date") or ""
    d = str(raw_date)[:10]  # 兼容 "2026-11-17" 与 "2026-11-17T00:00"
    t_max = day.get("temperature_2m_max")
    t_min = day.get("temperature_2m_min")
    snowfall = day.get("snowfall_sum")
    precip_prob = day.get("precipitation_probability_max")

    # 当日逐小时：提取天气代码、平均湿度、精细降雪概率
    day_hours = [h for h in hours if str(h.get("time", "")).startswith(d)]
    codes = [h.get("weather_code") for h in day_hours if h.get("weather_code") is not None]
    # 日级天气代码：优先 daily 字段，退化取当日逐小时众数（用于逐日天气图标）
    day_code = day.get("weather_code")
    if day_code is None and codes:
        try:
            day_code = max(set(codes), key=codes.count)
        except Exception:
            day_code = codes[0]
    humidities = [h.get("relative_humidity_2m") for h in day_hours if h.get("relative_humidity_2m") is not None]
    humidity = sum(humidities) / len(humidities) if humidities else None

    w = config.SNOW_WEIGHTS
    factors = {
        "temp": round(_temp_score(t_min, t_max), 1),
        "precip": round(_precip_score(precip_prob), 1),
        "snowfall": round(_snowfall_score(snowfall), 1),
        "humidity": round(_humidity_score(humidity), 1),
        "elevation": round(_elevation_score(elevation), 1),
    }
    score = (
        factors["temp"] * w["temp"]
        + factors["precip"] * w["precip"]
        + factors["snowfall"] * w["snowfall"]
        + factors["humidity"] * w["humidity"]
        + factors["elevation"] * w["elevation"]
    )
    score = round(score)
    prob = _snow_probability(snowfall, precip_prob, codes, t_min)
    # 评分为 0 但概率高时给一个保底分，保证看板排序合理
    if prob >= 60 and score < 35:
        score = 35
    rating, level = config.snow_rating_for(score)

    return {
        "date": d,
        "weather_code": day_code,
        "temp_max": round(t_max, 1) if t_max is not None else None,
        "temp_min": round(t_min, 1) if t_min is not None else None,
        "snowfall_cm": round(snowfall, 1) if snowfall is not None else 0.0,
        "precip_probability": round(precip_prob) if precip_prob is not None else None,
        "humidity": round(humidity) if humidity is not None else None,
        "snow_probability": round(prob),
        "score": score,
        "rating": rating,
        "level": level,
        "factors": factors,
    }


async def _city_snow(city_id: str, days: int) -> dict | None:
    """单城市雪况预报（含缓存）。"""
    city = config.get_city(city_id)
    if not city:
        return None
    key = f"snow_city_{city_id}_{days}"
    cached, stale = cache.get_cache(key, config.CACHE_TTL["snow"])
    if cached is not None and not stale:
        return cached
    try:
        fc = await open_meteo.get_forecast(
            city.latitude, city.longitude, city.elevation_m, forecast_days=days
        )
        hours = fc.get("hourly", [])
        daily = fc.get("daily", [])[:days]
        scored = [_score_day(d, hours, city.elevation_m) for d in daily]
        best = max(scored, key=lambda x: x["score"]) if scored else None
        result = {
            "city": config.city_to_dict(city),
            "days": scored,
            "best": best,
            "generated_at": datetime.now().isoformat(timespec="seconds"),
        }
        cache.set_cache(key, result)
        return result
    except Exception as e:
        if cached is not None:
            return cached
        return {
            "city": config.city_to_dict(city),
            "days": [],
            "best": None,
            "error": str(e),
            "generated_at": datetime.now().isoformat(timespec="seconds"),
        }


async def build_city_forecast(city_id: str, days: int = 7) -> dict:
    """供 API 调用的单城市雪况预报。"""
    result = await _city_snow(city_id, days)
    if result is None:
        return {"city_id": city_id, "days": [], "error": "未知城市"}
    return result


def _recommend_reason(city_name: str, tag: str, prob: int, day_label: str,
                      rarity: float, is_new: bool, lead_days: int = 2) -> str:
    """根据主导因子生成一句话推荐理由。"""
    parts = []
    # 规划期提示：留出提前量的雪讯最值得推荐，今明太赶
    if 2 <= lead_days <= 5:
        parts.append(str(lead_days) + " 天后 · 宜规划行程")
    elif lead_days >= 6:
        parts.append(str(lead_days) + " 天后 · 提前锁定")
    elif lead_days <= 1:
        parts.append("雪讯临近·适合说走就走")
    if is_new:
        parts.append("新出现雪讯")
    if rarity >= 0.7:
        parts.append("近沪罕见降雪")
    elif rarity >= 0.5:
        parts.append("江南难得雪信")
    if prob >= 85:
        parts.append("降雪概率极高")
    elif prob >= 60:
        parts.append("雪势强劲")
    if not parts:
        parts.append("综合雪况优越")
    return " · ".join(parts[:3])


def _second_snow_window(days: list[dict], primary_idx: int, threshold: int = 35) -> dict | None:
    """在主雪日之外寻找「第二窗口期」——另一个降雪时段。

    过远预报可信度低，这里只返回精简信息（日期区间/峰值/提前天数），
    前端仅作一行小字提示，不参与主推荐、不做特效强调。
    """
    windows: list[dict] = []
    cur = None
    for i, dd in enumerate(days):
        p = dd.get("snow_probability", 0)
        if p >= threshold:
            if cur is None:
                cur = {"start": i, "end": i, "peak_i": i, "peak": p}
            else:
                cur["end"] = i
                if p > cur["peak"]:
                    cur["peak"], cur["peak_i"] = p, i
        else:
            if cur:
                windows.append(cur)
                cur = None
    if cur:
        windows.append(cur)
    if not windows:
        return None
    primary = next((w for w in windows if w["start"] <= primary_idx <= w["end"]), None)
    others = [w for w in windows if w is not primary]
    if not others:
        return None
    others.sort(key=lambda w: (w["peak"], w["start"]), reverse=True)
    w2 = others[0]
    d0 = str(days[w2["start"]].get("date", ""))[:10]
    d1 = str(days[w2["end"]].get("date", ""))[:10]
    label = d0[5:] if d0 else "远期"
    return {
        "date_start": d0,
        "date_end": d1,
        "lead_days": w2["start"],
        "prob": w2["peak"],
        "label": label,
        "day_label": "今天" if w2["start"] == 0 else ("明天" if w2["start"] == 1 else label),
    }


def build_recommendations(by_id: dict, ids: list[str], days: int,
                          highlights: list[dict]) -> list[dict]:
    """动态推荐赏雪地（面向上海用户）。

    与 highlights（绝对雪量榜）不同，这里用 RECOMMEND_WEIGHTS 四维加权，
    让近沪的稀罕雪景（如天荒坪）在有雪时能压过常年有雪的东北城市，
    并标注「新出现雪讯」与推荐理由，实现每日动态变化。
    """
    prev_raw, _ = cache.get_cache("snow_recommend_prev", 7 * 86400)
    prev_ids = set(prev_raw.get("ids", [])) if isinstance(prev_raw, dict) else set()
    w = RECOMMEND_WEIGHTS
    recs: list[dict] = []
    for cid in ids:
        r = by_id.get(cid)
        if not r:
            continue
        city = r["city"]
        dist = city.get("distance_km") or 3000
        # 选「最值得推荐」的雪日：在有雪信号的日子里，综合概率与规划窗口，
        # 避免推荐今天/明天的雪讯（用户来不及安排），优先留出提前量的日子。
        day = None
        day_idx = 99
        best_sel = -1.0
        for i, dd in enumerate(r.get("days", [])):
            p = dd.get("snow_probability", 0)
            if p < 35:
                continue
            sel = (p / 100.0) * 0.62 + _planning_score(i) * 0.38
            if sel > best_sel:
                best_sel, day, day_idx = sel, dd, i
        if day is None:
            continue
        prob = day.get("snow_probability", 0)
        intensity = min(1.0, prob / 100.0)
        planning = _planning_score(day_idx)
        rarity = max(0.0, 1.0 - dist / 2200.0)  # 近沪稀罕度
        quality = min(1.0, day.get("score", 0) / 100.0)
        score = round(100 * (w["intensity"] * intensity + w["planning"] * planning
                             + w["rarity"] * rarity + w["quality"] * quality))
        if rarity >= 0.8 and prob >= 45 and planning >= 0.8:  # 江南近沪、且留足规划期的稀罕雪，额外加权
            score += 10
        score = min(100, score)
        raw_date = day.get("date", "")
        day_label = "今天" if day_idx == 0 else ("明天" if day_idx == 1 else str(raw_date)[5:])
        lead_days = day_idx
        tags = city.get("tags", [])
        # 逐日精简条：供首页「速览」行内展示未来数日雪况，标注推荐日。
        compact_days = [
            {
                "date": str(dd.get("date", ""))[:10],
                "value": round(dd.get("snow_probability", 0) or 0),
                "level": dd.get("level", ""),
                "weather_code": dd.get("weather_code"),
                "temp_max": dd.get("temp_max"),
                "temp_min": dd.get("temp_min"),
            }
            for dd in r.get("days", [])[:14]
        ]
        rec = {
            "id": cid,
            "name": city.get("name", cid),
            "distance_km": dist,
            "tags": tags,
            "recommend_score": score,
            "days": compact_days,
            "prob": prob,
            "score": day.get("score", 0),
            "rating": day.get("rating", ""),
            "level": day.get("level", ""),
            "snowfall_cm": day.get("snowfall_cm", 0),
            "temp_min": day.get("temp_min"),
            "date": str(raw_date)[:10],
            "day_label": day_label,
            "lead_days": lead_days,
            "is_new": cid not in prev_ids,
            "reason": _recommend_reason(city.get("name", cid), tags, prob,
                                        day_label, rarity, cid not in prev_ids,
                                        lead_days),
        }
        # 第二窗口期：过远预报仅作次要提示，不参与主评分
        rec["second_window"] = _second_snow_window(r.get("days", []), day_idx)
        recs.append(rec)
    recs.sort(key=lambda x: (x["recommend_score"], x["prob"]), reverse=True)
    for i, rec in enumerate(recs):
        rec["rank"] = i + 1
    cache.set_cache("snow_recommend_prev", {"ids": [r["id"] for r in recs[:8]]})
    return recs[:8]


async def build_board(days: int = config.SNOW_BOARD_DAYS, force: bool = False) -> dict:
    """全国雪景城市看板：按分组聚合未来 N 天降雪概率，生成每日播报。

    force=True 时忽略缓存强制重算（供后台定时预热使用）。
    """
    key = f"snow_board_{days}"
    if not force:
        cached, stale = cache.get_cache(key, config.CACHE_TTL["board"])
        if cached is not None and not stale:
            return cached

    ids = config.snow_city_ids()
    results = await asyncio.gather(*[_city_snow(cid, days) for cid in ids])
    by_id = {r["city"]["id"]: r for r in results if r and r.get("city")}

    # 不再按地域分区：全部城市统一按距上海由近及远排列为单组
    cities_out = []
    for cid in config.sort_cities_for_home(ids):
        r = by_id.get(cid)
        if not r:
            continue
        cities_out.append({
            "id": cid,
            "name": r["city"]["name"],
            "distance_km": r["city"].get("distance_km"),
            "tags": r["city"].get("tags", []),
            "days": r.get("days", []),
            "best": r.get("best"),
        })
    groups = [{"name": "距上海由近及远", "icon": "📍", "cities": cities_out}]

    # 每日播报：按日期列出有降雪概率的城市
    today = date.today()
    by_day = []
    for i in range(days):
        d = (today + timedelta(days=i)).isoformat()
        d_str = "今天" if i == 0 else ("明天" if i == 1 else d[5:])
        entries = []
        for cid in ids:
            r = by_id.get(cid)
            if not r:
                continue
            for dd in r.get("days", []):
                if dd["date"] == d and dd["snow_probability"] >= 25:
                    entries.append({
                        "id": cid,
                        "name": r["city"]["name"],
                        "prob": dd["snow_probability"],
                        "score": dd["score"],
                        "level": dd["level"],
                        "snowfall_cm": dd["snowfall_cm"],
                        "temp_min": dd["temp_min"],
                        "distance_km": r["city"].get("distance_km"),
                    })
                    break
        entries.sort(key=lambda e: (e["prob"], e["score"]), reverse=True)
        by_day.append({"date": d, "label": d_str, "cities": entries})

    # 重点推荐：未来 N 天内最佳评分最高的城市
    all_best = []
    for cid in ids:
        r = by_id.get(cid)
        if not r or not r.get("best"):
            continue
        b = r["best"]
        if b["snow_probability"] >= 25:
            all_best.append({
                "id": cid,
                "name": r["city"]["name"],
                "distance_km": r["city"].get("distance_km"),
                **b,
            })
    all_best.sort(key=lambda x: (x["score"], x["snow_probability"]), reverse=True)

    # 动态推荐赏雪地（面向上海用户，区别于绝对雪量榜）
    recommendations = build_recommendations(by_id, ids, days, all_best)

    # 播报摘要
    active_cities = len(all_best)
    total_snow_events = sum(len(day["cities"]) for day in by_day)
    if recommendations:
        top = recommendations[0]
        summary = (f"未来 {days} 天，全国 {active_cities} 座雪景城市有降雪机会，"
                   f"共 {total_snow_events} 个城市·日；今日推荐：{top['name']}"
                   f"（{top['reason']}，降雪概率 {top['prob']}%）")
    elif active_cities:
        top = all_best[0]
        summary = f"未来 {days} 天，全国 {active_cities} 座雪景城市有降雪机会，共 {total_snow_events} 个城市·日；当前最佳：{top['name']}（{top['rating']}，概率 {top['snow_probability']}%）"
    else:
        summary = f"未来 {days} 天，监控的雪景城市暂无明显降雪信号。"

    result = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "days": days,
        "total_cities": len(ids),
        "active_cities": active_cities,
        "total_events": total_snow_events,
        "summary": summary,
        "recommendations": recommendations,
        "highlights": all_best[:8],
        "by_day": by_day,
        "groups": groups,
    }
    cache.set_cache(key, result)
    return result
