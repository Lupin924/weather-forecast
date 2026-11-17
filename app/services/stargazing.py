"""观星条件评分（0-100）+ 当晚逐时时间轴。

评分维度：
1. 云量 (22%) - 云越少越好
2. 天光/夜间程度 (18%) - 基于日落日出时间，天越黑越好
3. 月相/月位置 (13%) - 月亮在地平线以下且无光时最佳
4. 降水 (12%) - 有降水时大幅扣分（硬性约束）
5. 光污染 (10%) - 基于 AQI 近似估算
6. 能见度 (7%) - 能见度越高越好
7. 湿度 (7%) - 湿度适中为佳，接近露点时扣分
8. 风速 (6%) - 风速越小越好
9. 空气质量 (5%) - 空气清新度
"""
from __future__ import annotations

import asyncio
import logging
import math
from datetime import date, datetime, timedelta
from typing import Any

from .. import config
from ..config import STARGAZE_WEIGHTS, rating_for
from . import air_quality, cache, open_meteo

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# 动态「推荐观星地」权重（与赏雪推荐对称，面向上海用户）
# - quality   观星分：当日夜间最佳观星评分，越高越值得专程前往
# - planning  规划窗口：留出 2~5 天提前量最佳（今明太赶、远期不确定）
# - rarity    稀罕度：离上海越近却仍优质暗空，越稀罕（江南晴夜难得）
# ---------------------------------------------------------------------------
STAR_RECOMMEND_WEIGHTS = {
    "quality": 0.46,
    "planning": 0.30,
    "rarity": 0.24,
}


def _star_planning_score(day_idx: int) -> float:
    """规划窗口评分（0-1），与赏雪同一口径：2~5 天最佳。"""
    if day_idx <= 0:
        return 0.15
    if day_idx == 1:
        return 0.35
    if day_idx <= 5:
        return min(1.0, 0.8 + 0.05 * day_idx)
    return max(0.45, 1.0 - 0.12 * (day_idx - 5))


def _parse_dt(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s)
    except Exception:
        return None


# ---- 太阳高度角近似计算 ----
def _approximate_sun_altitude(
    t: datetime,
    sunset: datetime | None,
    sunrise: datetime | None,
    solar_noon: datetime | None = None
) -> float:
    """
    近似计算给定时刻的太阳高度角（度数）。
    - 正值：太阳在地平线以上（白天）
    - 0° 附近：日落/日出
    - 负值：太阳在地平线以下（夜间/晨昏）
    """
    if sunset is None or sunrise is None:
        return -90.0

    t_date = t.date()

    if t <= sunset:
        sunrise_approx = datetime.combine(t_date, datetime.min.time()) + timedelta(hours=6)
        if t <= sunrise_approx:
            delta_hours = (t - (sunrise_approx - timedelta(hours=6))).total_seconds() / 3600
            altitude = -90 + (delta_hours / 6) * 90
            return max(-90, min(0, altitude))
        day_duration = (sunset - sunrise_approx).total_seconds() / 3600
        if day_duration <= 0:
            return 0
        elapsed = (t - sunrise_approx).total_seconds() / 3600
        progress = elapsed / day_duration
        altitude = math.sin(progress * math.pi) * 75
        return max(0, altitude)
    else:
        night_start = sunset
        night_end = sunrise
        if sunrise.date() == t_date:
            night_duration = (night_end - night_start).total_seconds() / 3600
        else:
            night_duration = ((night_end + timedelta(days=1)) - night_start).total_seconds() / 3600
        if night_duration <= 0:
            return -90
        elapsed = (t - night_start).total_seconds() / 3600
        progress = elapsed / night_duration
        altitude = -math.sin(progress * math.pi) * 90
        return max(-90, min(0, altitude))


def _score_night_sky(altitude: float) -> float:
    """天光/夜间评分：根据太阳高度角计算。"""
    if altitude >= 0:
        return 0.0
    if altitude >= -6:
        return 20 + (0 - altitude) / 6 * 20
    if altitude >= -12:
        return 40 + (-6 - altitude) / 6 * 25
    if altitude >= -18:
        return 65 + (-12 - altitude) / 6 * 20
    depth = min(1.0, (abs(altitude) - 18) / 72)
    return 85 + depth * 15


# ---- 各维度子评分 ----
def _score_cloud(cloud: float | None) -> float:
    """总云量评分（兼容旧调用）"""
    if cloud is None:
        return 50.0
    return max(0.0, min(100.0, 100.0 - cloud))


def _score_cloud_by_layer(
    cloud_total: float | None,
    cloud_low: float | None,
    cloud_mid: float | None,
    cloud_high: float | None,
) -> tuple[float, dict]:
    """v2.2: 按云属分级评分 (卷云/中云/低云不同处理)
    依据: 百度贴吧《天文随笔》"卷云少量不影响, 卷层云铺满放弃, 中云基本放弃, 低云完全遮挡"
    返回 (score, info_dict)"""
    info = {}
    score = 100.0
    if cloud_high is not None and cloud_high > 80:
        delta = cloud_high * 0.3
        score -= delta
        info["high_layer"] = f"高云{cloud_high:.0f}%穿透 (扣{delta:.0f})"
    if cloud_mid is not None and cloud_mid > 50:
        delta = cloud_mid * 0.6
        score -= delta
        info["mid_layer"] = f"中云{cloud_mid:.0f}%基本放弃 (扣{delta:.0f})"
    if cloud_low is not None and cloud_low > 30:
        delta = cloud_low * 1.0
        score -= delta
        info["low_layer"] = f"低云{cloud_low:.0f}%完全遮挡 (扣{delta:.0f})"
    score = max(0.0, min(100.0, score))
    return score, info


def _score_lifted_index(li: float | None) -> float:
    """v2.2: 抬升指数 LI 评分 (上海崇明 7 因子之一)
    LI < -3 → 强对流潜势 (扣 20)
    LI > 0 → 稳定大气 (加 10)
    中性 → 不动"""
    if li is None:
        return 80.0  # 缺数据 fallback
    if li < -3: return 60.0  # 强对流
    if li > 0: return 90.0   # 稳定
    return 75.0             # 中性


def _score_cape(cape: float | None) -> float:
    """v2.2: CAPE 对流有效位能"""
    if cape is None: return 80.0
    if cape > 1000: return 60.0  # 高对流
    if cape > 500: return 75.0
    return 90.0


def _score_dew_depression(temp: float | None, dew_point: float | None) -> tuple[float, str]:
    """v2.2: 露点分离度评分 (设备安全)
    <2°C → 必结露 (扣 30)
    2-5°C → 风险 (扣 15)
    >5°C → 安全"""
    if temp is None or dew_point is None:
        return 70.0, "露点数据缺"
    spread = temp - dew_point
    if spread < 2: return 30.0, f"露点分离{spread:.1f}°C必结露"
    if spread < 5: return 60.0, f"露点分离{spread:.1f}°C风险"
    return 90.0, f"露点分离{spread:.1f}°C安全"


def _score_moon(illum: float | None, below_horizon: bool, altitude: float) -> float:
    if below_horizon:
        return 100.0
    if altitude >= 0:
        return 90.0
    if illum is None:
        return 50.0
    return max(0.0, 100.0 - illum)


def _score_precipitation(precip: float | None) -> float:
    """降水评分：有降水时大幅扣分。"""
    if precip is None:
        return 80.0
    if precip <= 0:
        return 100.0
    if precip < 0.1:
        return 85.0
    if precip < 0.5:
        return 60.0
    if precip < 1.0:
        return 35.0
    if precip < 2.0:
        return 15.0
    return 0.0


def _score_visibility(vis_km: float | None) -> float:
    if vis_km is None:
        return 50.0
    if vis_km >= 20:
        return 100.0
    if vis_km <= 2:
        return 0.0
    return (vis_km - 2) / (20 - 2) * 100.0


def _score_humidity(h: float | None, dew_point: float | None = None, temp: float | None = None) -> float:
    """湿度评分：40-60% 最佳。
    ⭐ v2.2: 露点分离度已抽离到 _score_dew_depression(), 此处只评湿度本身"""
    if h is None:
        return 50.0
    base = 100.0
    if h < 40:
        base = max(0.0, 100.0 - (40 - h) * 2.5)
    elif h > 60:
        base = max(0.0, 100.0 - (h - 60) * 2.5)

    return max(0.0, min(100.0, base))


def _score_wind(gust: float | None, wind: float | None) -> float:
    v = gust if gust is not None else wind
    if v is None:
        return 50.0
    return max(0.0, min(100.0, 100.0 - max(0.0, v - 5.0) * 3.5))


def _score_light_pollution(bortle: int | None) -> float:
    """根据 Bortle 等级计算光污染评分（0-100，越高越好）。

    Bortle 1 = 100 分（优秀暗空）
    Bortle 9 = 0 分（市中心严重光污染）
    """
    if bortle is None:
        return 50.0
    # Bortle 1-9 线性映射到 100-0 分
    return max(0.0, min(100.0, (9 - bortle) / 8 * 100))


def _score_air_quality(aqi: float | None) -> float:
    if aqi is None:
        return 50.0
    if aqi <= 50:
        return 100.0
    if aqi <= 100:
        return 80.0
    if aqi <= 150:
        return 60.0
    if aqi <= 200:
        return 40.0
    return 20.0


# ---- 月位置判定 ----
def _moon_events(daily: list[dict]) -> list[tuple[datetime, str]]:
    events: list[tuple[datetime, str]] = []
    for d in daily:
        mr = _parse_dt(d.get("moonrise"))
        ms = _parse_dt(d.get("moonset"))
        if mr:
            events.append((mr, "rise"))
        if ms:
            events.append((ms, "set"))
    events.sort(key=lambda x: x[0])
    return events


def _moon_up_at(t: datetime, events: list[tuple[datetime, str]]) -> bool:
    rises = sum(1 for et, k in events if et <= t and k == "rise")
    sets = sum(1 for et, k in events if et <= t and k == "set")
    return rises > sets


# ---- 连续最佳窗口检测 ----
def _find_best_window(
    night_hours: list[dict],
    min_duration: int = 2,
    max_duration: int = 8,
    min_score: float = 30.0,
) -> tuple[str, str, float] | None:
    """
    在夜间时段中寻找连续的最佳观测窗口。

    搜索所有可能的窗口尺寸（min_duration ~ max_duration），
    返回平均评分最高且满足最低评分阈值的连续时段。
    较长窗口在相同评分下优先（更稳定的观测条件）。

    返回 (开始时间, 结束时间, 平均评分)。
    """
    if not night_hours:
        return None

    sorted_hours = sorted(night_hours, key=lambda h: h["time"])
    n = len(sorted_hours)

    if n < min_duration:
        # 不足最小持续时间，返回最佳的单个小时（仅当满足阈值时）
        best = max(sorted_hours, key=lambda h: h["score"])
        if best["score"] < min_score:
            return None
        return (best["time"], best["time"], best["score"])

    best_window = None
    best_avg = -1
    best_len = 0

    upper = min(n, max_duration)

    # 滑动窗口搜索所有尺寸
    for window_size in range(min_duration, upper + 1):
        for i in range(n - window_size + 1):
            window = sorted_hours[i:i + window_size]
            times = [_parse_dt(h["time"]) for h in window]
            if None in times:
                continue
            # 连续性检查：相邻小时间隔不超过 2 小时
            is_continuous = all(
                (times[j + 1] - times[j]).total_seconds() <= 2 * 3600
                for j in range(len(times) - 1)
            )
            if not is_continuous:
                continue

            avg_score = sum(h["score"] for h in window) / len(window)

            # 最低评分门槛
            if avg_score < min_score:
                continue

            # 评分更高，或评分相同但窗口更长时优先
            if avg_score > best_avg + 0.5 or (
                abs(avg_score - best_avg) <= 0.5 and window_size > best_len
            ):
                best_avg = avg_score
                best_window = (window[0]["time"], window[-1]["time"], avg_score)
                best_len = window_size

    return best_window


# ---- 建议生成 ----
def _generate_recommendation(
    best_window_info: tuple[str, str, float] | None,
    night_hours: list[dict],
    sunset: datetime | None,
    sunrise: datetime | None,
) -> str:
    """根据条件生成可操作的观星建议，包含趋势分析和关键影响因素。"""
    if not night_hours:
        return "🌅 当前为白天时段，请在日落后查看观星条件。"

    if not best_window_info:
        # 分析不适合的原因
        worst_dims = _analyze_worst_factors(night_hours)
        reason = "、".join(worst_dims) if worst_dims else "综合条件不佳"
        return f"⚠️ 今晚不适合观星（{reason}），建议改日再试。"

    start, end, avg = best_window_info
    start_time = _parse_dt(start)
    end_time = _parse_dt(end)

    start_str = start_time.strftime("%H:%M") if start_time else start
    end_str = end_time.strftime("%H:%M") if end_time else end

    # 分析窗口内的最佳小时
    window_hours = [
        h for h in night_hours
        if start <= h["time"] <= end
    ]
    best_hour = max(window_hours, key=lambda h: h["score"]) if window_hours else max(night_hours, key=lambda h: h["score"])
    bd = best_hour.get("breakdown", {})

    # 优势因素
    strengths = []
    if bd.get("cloud", 0) >= 80:
        strengths.append("天空晴朗")
    if bd.get("moon", 0) >= 90:
        strengths.append("月光影响小")
    if bd.get("night_sky", 0) >= 85:
        strengths.append("天光条件好")
    if bd.get("precipitation", 0) >= 90:
        strengths.append("无降水")
    if bd.get("visibility", 0) >= 90:
        strengths.append("能见度佳")

    # 劣势因素
    weaknesses = []
    if bd.get("cloud", 100) < 50:
        weaknesses.append("云量较多")
    if bd.get("precipitation", 100) < 60:
        weaknesses.append("有降水风险")
    if bd.get("moon", 100) < 50:
        weaknesses.append("月光干扰较大")
    if bd.get("night_sky", 0) < 60:
        weaknesses.append("天光较亮")
    if bd.get("humidity", 100) < 50:
        weaknesses.append("湿度偏高")
    if bd.get("wind", 100) < 50:
        weaknesses.append("风力较大")
    # 光污染劣势（基于 Bortle 等级）
    lp_score = bd.get("light_pollution", 100)
    if lp_score is not None and lp_score < 30:
        weaknesses.append("光污染严重")
    elif lp_score is not None and lp_score < 50:
        weaknesses.append("光污染明显")

    # 趋势分析：条件是否在窗口内改善或恶化
    trend_text = ""
    if len(window_hours) >= 2:
        first_half = window_hours[:len(window_hours)//2]
        second_half = window_hours[len(window_hours)//2:]
        avg_first = sum(h["score"] for h in first_half) / len(first_half)
        avg_second = sum(h["score"] for h in second_half) / len(second_half)
        diff = avg_second - avg_first
        if diff > 8:
            trend_text = "，条件逐渐转好"
        elif diff < -8:
            trend_text = "，建议尽早观测"

    # 组合因素描述
    factor_parts = []
    if strengths:
        factor_parts.append("、".join(strengths[:3]))
    if weaknesses:
        factor_parts.append("需注意" + "、".join(weaknesses[:3]))
    factor_text = "；".join(factor_parts) if factor_parts else "各项条件均衡"

    # 光污染严重时下调评级前缀（即使天气条件好，严重光污染也会极大影响观星）
    lp_severe = lp_score is not None and lp_score < 30
    if lp_severe and avg >= 70:
        prefix = "🟡 今晚天气条件尚可，但光污染严重影响观测"
    elif lp_severe and avg >= 50:
        prefix = "🟠 今晚观星条件一般（光污染严重）"
    elif avg >= 70:
        prefix = "✅ 今晚观星条件优秀"
    elif avg >= 50:
        prefix = "🟡 今晚观星条件尚可"
    elif avg >= 30:
        prefix = "🟠 今晚观星条件一般"
    else:
        prefix = "🔴 今晚观星条件较差"

    if start == end:
        return f"{prefix}，最佳时段约 {start_str}（{factor_text}）{trend_text}。"
    else:
        return f"{prefix}，推荐观测窗口 {start_str}–{end_str}（{factor_text}）{trend_text}。"


def _analyze_worst_factors(night_hours: list[dict]) -> list[str]:
    """分析导致观星条件差的主要因素。"""
    if not night_hours:
        return []
    # 取所有小时的平均 breakdown
    total = {}
    count = 0
    for h in night_hours:
        bd = h.get("breakdown", {})
        if not bd:
            continue
        for k, v in bd.items():
            if v is None:
                continue
            total[k] = total.get(k, 0) + v
        count += 1
    if count == 0:
        return []
    avg_bd = {k: v / count for k, v in total.items()}

    worst = []
    if avg_bd.get("cloud", 100) < 40:
        worst.append("云量过大")
    if avg_bd.get("precipitation", 100) < 50:
        worst.append("降水频繁")
    if avg_bd.get("moon", 100) < 40:
        worst.append("月光干扰强")
    if avg_bd.get("humidity", 100) < 40:
        worst.append("湿度偏高")
    if avg_bd.get("wind", 100) < 40:
        worst.append("风力较大")
    if avg_bd.get("night_sky", 0) < 50:
        worst.append("天光较亮")
    return worst[:3]


async def build_stargazing(
    lat: float, lon: float, elevation: int, date_str: str,
    fc: dict | None = None, air: dict | None = None,
) -> dict[str, Any]:
    """构建观星评分数据。

    fc/air 可由批量预报预取后传入以复用，避免 N 天预报重复请求 API。
    """
    if fc is None:
        try:
            target_date = datetime.fromisoformat(date_str).date()
            need = (target_date - date.today()).days + 2
        except Exception:
            need = 7
        fc = await open_meteo.get_forecast(
            lat, lon, elevation, forecast_days=max(7, min(16, need))
        )
    daily = fc["daily"]
    hourly = fc["hourly"]

    if air is None:
        try:
            air = await air_quality.get_air_quality(lat, lon, elevation)
        except Exception:
            air = None
    if air is not None:
        try:
            current_aqi = air.get("current", {}).get("aqi")
            light_pollution_info = air.get("light_pollution", {})
            bortle = light_pollution_info.get("bortle")
        except Exception:
            current_aqi = None
            bortle = None
            light_pollution_info = {"bortle": None, "label": "未知", "score": 50.0}
    else:
        current_aqi = None
        bortle = None
        light_pollution_info = {"bortle": None, "label": "未知", "score": 50.0}

    target_day = next((d for d in daily if d.get("time") == date_str), None)
    sunset_today = _parse_dt(target_day.get("sunset")) if target_day else None

    target_dt = datetime.fromisoformat(date_str)
    next_date_str = (target_dt + timedelta(days=1)).strftime("%Y-%m-%d")
    next_day = next((d for d in daily if d.get("time") == next_date_str), None)
    sunrise_tomorrow = _parse_dt(next_day.get("sunrise")) if next_day else None

    moon_phase = target_day.get("moon_phase") if target_day else None
    illum = open_meteo.moon_illumination_from_phase(moon_phase)

    events = _moon_events(daily)

    if sunset_today and sunrise_tomorrow:
        window_start = sunset_today - timedelta(minutes=30)
        window_end = sunrise_tomorrow + timedelta(minutes=30)
    else:
        window_start = datetime.fromisoformat(f"{date_str}T18:00")
        window_end = datetime.fromisoformat(f"{next_date_str}T05:00")

    hours: list[dict] = []
    for p in hourly:
        t = _parse_dt(p.get("time"))
        if t is None or not (window_start <= t <= window_end):
            continue

        altitude = _approximate_sun_altitude(t, sunset_today, sunrise_tomorrow)
        s_night = _score_night_sky(altitude)

        cloud = p.get("cloud_cover")
        vis = p.get("visibility")
        hum = p.get("relative_humidity_2m")
        dew = p.get("dew_point_2m")
        temp = p.get("temperature_2m")
        wind = p.get("wind_speed_10m")
        gust = p.get("wind_gusts_10m")
        precip = p.get("precipitation")
        # ⭐ v2.2: 三层云量 + 对流参数
        cloud_low = p.get("cloud_cover_low")
        cloud_mid = p.get("cloud_cover_mid")
        cloud_high = p.get("cloud_cover_high")
        cape = p.get("cape")
        li = p.get("lifted_index")
        below = not _moon_up_at(t, events)

        if altitude >= 0:
            score = 0.0
            rating = "🔴 白天"
            level = "daytime"
            hours.append({
                "time": p["time"],
                "score": score,
                "rating": rating,
                "level": level,
                "cloud_cover": cloud,
                "visibility": vis,
                "humidity": hum,
                "wind_speed": wind,
                "wind_gusts": gust,
                "precipitation": precip,
                "moon_illumination": illum,
                "moon_below_horizon": below,
                "light_pollution_score": None,
                "light_pollution_label": light_pollution_info.get("label", "未知"),
                "bortle": bortle,
                "air_quality_score": None,
                "solar_altitude": round(altitude, 1),
                "night_sky_score": 0.0,
                "is_daytime": True,
                "breakdown": {
                    "cloud": round(_score_cloud(cloud), 1),
                    "moon": round(_score_moon(illum, below, altitude), 1),
                    "night_sky": 0.0,
                    "precipitation": round(_score_precipitation(precip), 1),
                    "light_pollution": None,
                    "visibility": None,
                    "humidity": None,
                    "wind": None,
                    "air_quality": None,
                },
            })
            continue

        # ⭐ v2.2: 云属分级评分 (卷云/中云/低云不同处理)
        s_cloud, cloud_info = _score_cloud_by_layer(cloud, cloud_low, cloud_mid, cloud_high)
        s_moon = _score_moon(illum, below, altitude)
        s_precip = _score_precipitation(precip)
        s_light = _score_light_pollution(bortle)
        s_vis = _score_visibility(vis)
        s_hum = _score_humidity(hum, dew, temp)
        s_wind = _score_wind(gust, wind)
        s_aq = _score_air_quality(current_aqi)
        # ⭐ v2.2: 露点分离度 + LI + CAPE (上海崇明 7 因子)
        s_dew, dew_info = _score_dew_depression(temp, dew)
        s_li = _score_lifted_index(li)
        s_cape = _score_cape(cape)

        score = (
            s_cloud * STARGAZE_WEIGHTS["cloud"]
            + s_moon * STARGAZE_WEIGHTS["moon"]
            + s_night * STARGAZE_WEIGHTS["night_sky"]
            + s_precip * STARGAZE_WEIGHTS["precipitation"]
            + s_light * STARGAZE_WEIGHTS["light_pollution"]
            + s_vis * STARGAZE_WEIGHTS["visibility"]
            + s_hum * STARGAZE_WEIGHTS["humidity"]
            + s_wind * STARGAZE_WEIGHTS["wind"]
            + s_aq * STARGAZE_WEIGHTS["air_quality"]
        )

        # 降水硬性约束：如果降水量大，额外施加惩罚乘数
        if precip is not None:
            if precip >= 2.0:
                score *= 0.05  # 大雨：几乎无法观星
            elif precip >= 1.0:
                score *= 0.3
            elif precip >= 0.5:
                score *= 0.6

        score = round(max(0, min(100, score)), 1)
        rating, level = rating_for(score)

        hours.append({
            "time": p["time"],
            "score": score,
            "rating": rating,
            "level": level,
            "cloud_cover": cloud,
            "visibility": vis,
            "humidity": hum,
            "wind_speed": wind,
            "wind_gusts": gust,
            "precipitation": precip,
            "moon_illumination": illum,
            "moon_below_horizon": below,
            "light_pollution_score": round(s_light, 1),
            "light_pollution_label": light_pollution_info.get("label", "未知"),
            "bortle": bortle,
            "bortle_label": light_pollution_info.get("label", "未知"),
            "sqm": light_pollution_info.get("sqm"),
            "air_quality_score": round(s_aq, 1),
            "solar_altitude": round(altitude, 1),
            "night_sky_score": round(s_night, 1),
            "precipitation_score": round(s_precip, 1),
            "is_daytime": False,
            "breakdown": {
                "cloud": round(s_cloud, 1),
                "cloud_layers": cloud_info,  # ⭐ v2.2: 云属分级详情
                "moon": round(s_moon, 1),
                "night_sky": round(s_night, 1),
                "precipitation": round(s_precip, 1),
                "light_pollution": round(s_light, 1),
                "visibility": round(s_vis, 1),
                "humidity": round(s_hum, 1),
                "wind": round(s_wind, 1),
                "air_quality": round(s_aq, 1),
                "dew_depression": round(s_dew, 1),  # ⭐ v2.2
                "dew_info": dew_info,
                "lifted_index": round(s_li, 1),    # ⭐ v2.2
                "cape": round(s_cape, 1),          # ⭐ v2.2
            },
        })

    night_hours = [h for h in hours if not h.get("is_daytime", True)]

    # 单小时最佳
    best = max(night_hours, key=lambda h: h["score"]) if night_hours else None
    best_score = best["score"] if best else 0.0
    best_window = best["time"] if best else None

    # 连续最佳窗口
    best_window_info = _find_best_window(night_hours, min_duration=2)
    recommendation = _generate_recommendation(best_window_info, night_hours, sunset_today, sunrise_tomorrow)

    # 生成摘要
    if not hours:
        summary = "暂无该时段的预报数据。"
    elif best_score >= 70:
        summary = f"当晚观星条件优秀，最佳时段 {best_window}（评分 {best_score}）。"
    elif best_score >= 50:
        summary = f"当晚观星条件尚可，最佳时段 {best_window}（评分 {best_score}）。"
    elif best_score >= 30:
        summary = f"当晚观星条件一般，最佳时段 {best_window}（评分 {best_score}）。"
    else:
        summary = f"当晚观星条件较差，最佳时段 {best_window}（评分 {best_score}）。"

    # 提取窗口信息
    window_start_str = best_window_info[0] if best_window_info else None
    window_end_str = best_window_info[1] if best_window_info else None
    window_avg = round(best_window_info[2], 1) if best_window_info else 0.0

    # 计算窗口持续时长（小时）
    window_duration = 0
    if best_window_info:
        ws = _parse_dt(window_start_str)
        we = _parse_dt(window_end_str)
        if ws and we:
            window_duration = max(1, round((we - ws).total_seconds() / 3600) + 1)

    # 可观测时长统计
    excellent_hours = sum(1 for h in night_hours if h["score"] >= 70)
    good_hours = sum(1 for h in night_hours if h["score"] >= 50)
    observable_hours = sum(1 for h in night_hours if h["score"] >= 30)
    total_night_hours = len(night_hours)

    # 平均评分
    avg_score = round(sum(h["score"] for h in night_hours) / total_night_hours, 1) if night_hours else 0.0

    return {
        "date": date_str,
        "hours": hours,
        "best_window": best_window,
        "best_score": best_score,
        "best_window_start": window_start_str,
        "best_window_end": window_end_str,
        "best_window_avg": window_avg,
        "best_window_duration": window_duration,
        "recommendation": recommendation,
        "summary": summary,
        "light_pollution_info": light_pollution_info,
        "air_quality_aqi": current_aqi,
        "sunset": sunset_today.isoformat() if sunset_today else None,
        "sunrise": sunrise_tomorrow.isoformat() if sunrise_tomorrow else None,
        "window_start": window_start.isoformat(),
        "window_end": window_end.isoformat(),
        "stats": {
            "excellent_hours": excellent_hours,
            "good_hours": good_hours,
            "observable_hours": observable_hours,
            "total_night_hours": total_night_hours,
            "avg_score": avg_score,
        },
    }


async def build_stargazing_forecast(
    lat: float, lon: float, elevation: int, days: int = 15
) -> dict[str, Any]:
    """未来 N 天观星条件摘要：每天一条，供钉住卡片与详情页共用。

    一次取数 + 一次空气质量请求，逐日复用 build_stargazing 评分，
    返回精简的逐日字段（不含逐小时明细，明细走 /stargazing/{city_id}?date=）。
    """
    days = max(1, min(16, days))
    fc = await open_meteo.get_forecast(
        lat, lon, elevation, forecast_days=min(days + 1, 16)
    )
    try:
        air = await air_quality.get_air_quality(lat, lon, elevation)
    except Exception:
        air = None

    out: list[dict] = []
    for d in fc.get("daily", [])[:days]:
        ds = str(d.get("time", ""))[:10]
        if not ds:
            continue
        try:
            sg = await build_stargazing(lat, lon, elevation, ds, fc=fc, air=air)
        except Exception:
            continue
        night = [h for h in sg.get("hours", []) if not h.get("is_daytime", True)]
        clouds = [
            h.get("cloud_cover") for h in night
            if h.get("cloud_cover") is not None
        ]
        cloud_avg = round(sum(clouds) / len(clouds)) if clouds else None
        phase = d.get("moon_phase")
        best_score = sg.get("best_score", 0.0)
        rating, level = rating_for(best_score)
        out.append({
            "date": ds,
            "score": best_score,
            "rating": rating,
            "level": level,
            "best_window_start": sg.get("best_window_start"),
            "best_window_end": sg.get("best_window_end"),
            "best_window_avg": sg.get("best_window_avg"),
            "best_window_duration": sg.get("best_window_duration"),
            "cloud_cover": cloud_avg,
            "weather_code": d.get("weather_code"),
            "temp_max": round(d["temperature_2m_max"], 1) if d.get("temperature_2m_max") is not None else None,
            "temp_min": round(d["temperature_2m_min"], 1) if d.get("temperature_2m_min") is not None else None,
            "moon_illumination": open_meteo.moon_illumination_from_phase(phase),
            "moon_phase": phase,
            "moon_phase_name": open_meteo.moon_phase_name(phase),
            "summary": sg.get("summary"),
            "recommendation": sg.get("recommendation"),
            "stats": sg.get("stats"),
            "sunset": sg.get("sunset"),
            "sunrise": sg.get("sunrise"),
        })

    return {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "days": out,
        "best": max(out, key=lambda x: x["score"]) if out else None,
    }


# ---------------------------------------------------------------------------
# 动态「推荐观星地」（与赏雪推荐对称）
# ---------------------------------------------------------------------------
def _star_recommend_reason(name: str, score: float, lead_days: int,
                           rarity: float, is_new: bool) -> str:
    parts = []
    if 2 <= lead_days <= 5:
        parts.append(str(lead_days) + " 天后 · 宜规划行程")
    elif lead_days >= 6:
        parts.append(str(lead_days) + " 天后 · 提前锁定")
    elif lead_days <= 1:
        parts.append("晴夜临近·适合说走就走")
    if is_new:
        parts.append("新出现晴夜")
    if rarity >= 0.7:
        parts.append("近沪罕见通透夜空")
    elif rarity >= 0.5:
        parts.append("江南难得晴夜")
    if score >= 85:
        parts.append("观星条件极佳")
    elif score >= 70:
        parts.append("观星条件良好")
    if not parts:
        parts.append("综合夜空条件优越")
    return " · ".join(parts[:3])


def _second_star_window(days: list[dict], primary_idx: int,
                        threshold: float = 55) -> dict | None:
    """主观星夜之外的「第二窗口期」（另一段晴夜），仅作次要小字提示。"""
    windows: list[dict] = []
    cur = None
    for i, dd in enumerate(days):
        v = dd.get("score", 0)
        if v >= threshold:
            if cur is None:
                cur = {"start": i, "end": i, "peak_i": i, "peak": v}
            else:
                cur["end"] = i
                if v > cur["peak"]:
                    cur["peak"], cur["peak_i"] = v, i
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
        "score": round(w2["peak"]),
        "label": label,
        "day_label": "今天" if w2["start"] == 0 else ("明天" if w2["start"] == 1 else label),
    }


def build_stargazing_recommendations(by_id: dict, ids: list[str], days: int) -> list[dict]:
    """动态推荐观星地（面向上海用户，与赏雪推荐同构）。

    key 维度：观星分(quality) + 规划窗口(planning) + 稀罕度(rarity)，
    让近沪的优质晴夜能压过常年干燥的高原，并标注「新出现晴夜」实现每日变化。
    """
    prev_raw, _ = cache.get_cache("stargaze_recommend_prev", 7 * 86400)
    prev_ids = set(prev_raw.get("ids", [])) if isinstance(prev_raw, dict) else set()
    w = STAR_RECOMMEND_WEIGHTS
    recs: list[dict] = []
    for cid in ids:
        r = by_id.get(cid)
        if not r:
            continue
        city = r["city"]
        dist = city.get("distance_km") or 3000
        day = None
        day_idx = 99
        best_sel = -1.0
        for i, dd in enumerate(r.get("days", [])):
            v = dd.get("score", 0)
            if v < 45:  # 观星分低于 45 视为不宜专程前往
                continue
            sel = (v / 100.0) * 0.62 + _star_planning_score(i) * 0.38
            if sel > best_sel:
                best_sel, day, day_idx = sel, dd, i
        if day is None:
            continue
        score = day.get("score", 0)
        quality = min(1.0, score / 100.0)
        planning = _star_planning_score(day_idx)
        rarity = max(0.0, 1.0 - dist / 2200.0)
        rec_score = round(100 * (w["quality"] * quality + w["planning"] * planning
                                 + w["rarity"] * rarity))
        rec_score = min(100, rec_score)
        raw_date = day.get("date", "")
        day_label = "今天" if day_idx == 0 else ("明天" if day_idx == 1 else str(raw_date)[5:])
        is_new = cid not in prev_ids
        # 逐日精简条：供首页「速览」行内展示未来数日观星条件，标注推荐日。
        compact_days = [
            {
                "date": str(dd.get("date", ""))[:10],
                "value": round(dd.get("score", 0) or 0),
                "level": dd.get("level", ""),
                "cloud": dd.get("cloud_cover"),
                "weather_code": dd.get("weather_code"),
                "temp_max": dd.get("temp_max"),
                "temp_min": dd.get("temp_min"),
            }
            for dd in r.get("days", [])[:14]
        ]
        recs.append({
            "id": cid,
            "name": city.get("name", cid),
            "distance_km": dist,
            "tags": city.get("tags", []),
            "recommend_score": rec_score,
            "days": compact_days,
            "score": round(score),
            "rating": day.get("rating", ""),
            "level": day.get("level", ""),
            "cloud_cover": day.get("cloud_cover"),
            "moon_illumination": day.get("moon_illumination"),
            "moon_phase_name": day.get("moon_phase_name"),
            "best_window_start": day.get("best_window_start"),
            "best_window_end": day.get("best_window_end"),
            "date": str(raw_date)[:10],
            "day_label": day_label,
            "lead_days": day_idx,
            "is_new": is_new,
            "reason": _star_recommend_reason(city.get("name", cid), score,
                                             day_idx, rarity, is_new),
            "second_window": _second_star_window(r.get("days", []), day_idx),
        })
    recs.sort(key=lambda x: (x["recommend_score"], x["score"]), reverse=True)
    for i, rec in enumerate(recs):
        rec["rank"] = i + 1
    cache.set_cache("stargaze_recommend_prev", {"ids": [r["id"] for r in recs[:8]]})
    return recs[:8]


async def build_stargazing_board(days: int = 7, force: bool = False) -> dict:
    """观星窗口期看板：聚合多城未来 N 天观星条件，生成动态推荐（结构对齐赏雪看板）。

    force=True 时忽略缓存强制重算（供后台定时预热使用）。
    """
    key = f"stargaze_board_{days}"
    if not force:
        cached, stale = cache.get_cache(key, config.CACHE_TTL["board"])
        if cached is not None and not stale:
            # 空缓存（一个城市都没聚合到）是上游故障留下的，按未命中处理并重算
            groups = cached.get("groups") or []
            if groups and (groups[0].get("cities") or []):
                return cached
            logger.warning("观星看板缓存无城市数据，忽略并重算 days=%s", days)

    ids = config.stargaze_city_ids()
    cities = {cid: config.city_to_dict(config.CITIES[cid]) for cid in ids if cid in config.CITIES}

    async def one(cid: str):
        c = config.CITIES.get(cid)
        if not c:
            return None
        try:
            fc = await build_stargazing_forecast(c.latitude, c.longitude, c.elevation_m, days)
            return {"city": cities[cid], "days": fc.get("days", []), "best": fc.get("best")}
        except Exception as exc:  # noqa: BLE001 - 单城失败不应拖垮整块看板
            logger.warning(
                "观星看板单城失败 %s: %s: %s", cid, type(exc).__name__, exc
            )
            return None

    results = await asyncio.gather(*[one(cid) for cid in ids])
    by_id = {r["city"]["id"]: r for r in results if r}

    recommendations = build_stargazing_recommendations(by_id, ids, days)

    # 城市按距上海由近及远排列（单组）
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

    # highlights：绝对观星分榜
    all_best = []
    for cid in ids:
        r = by_id.get(cid)
        if not r or not r.get("best"):
            continue
        all_best.append({
            "id": cid,
            "name": r["city"]["name"],
            "distance_km": r["city"].get("distance_km"),
            **r["best"],
        })
    all_best.sort(key=lambda x: x.get("score", 0), reverse=True)

    # 每日晴夜播报
    by_day = []
    for i in range(days):
        d = (date.today() + timedelta(days=i)).isoformat()
        label = "今天" if i == 0 else ("明天" if i == 1 else d[5:])
        entries = []
        for cid in ids:
            r = by_id.get(cid)
            if not r:
                continue
            for dd in r.get("days", []):
                if dd.get("date") == d and dd.get("score", 0) >= 55:
                    entries.append({
                        "id": cid, "name": r["city"]["name"],
                        "score": round(dd.get("score", 0)),
                        "level": dd.get("level"),
                        "cloud_cover": dd.get("cloud_cover"),
                        "distance_km": r["city"].get("distance_km"),
                    })
                    break
        entries.sort(key=lambda e: e["score"], reverse=True)
        by_day.append({"date": d, "label": label, "cities": entries})

    active_cities = len([c for c in all_best if c.get("score", 0) >= 55])
    total_events = sum(len(day["cities"]) for day in by_day)
    if recommendations:
        top = recommendations[0]
        summary = (f"未来 {days} 天，全国 {active_cities} 座观星地有上佳晴夜，"
                   f"共 {total_events} 个城市·夜；今日推荐：{top['name']}"
                   f"（{top['reason']}，观星分 {top['score']}）")
    elif active_cities:
        top = all_best[0]
        summary = f"未来 {days} 天，全国 {active_cities} 座观星地有上佳晴夜；当前最佳：{top['name']}（观星分 {round(top.get('score',0))}）"
    else:
        summary = f"未来 {days} 天，监控的观星地暂无明显晴夜信号。"

    result = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "days": days,
        "total_cities": len(ids),
        "active_cities": active_cities,
        "total_events": total_events,
        "summary": summary,
        "recommendations": recommendations,
        "highlights": all_best[:8],
        "by_day": by_day,
        "groups": groups,
    }
    # 一个城市都没取到说明上游整体不可用，此时不能把空结果写进缓存——
    # 否则 TTL 内所有请求都会拿到「暂无晴夜信号」，看起来像服务坏了。
    if cities_out:
        cache.set_cache(key, result)
    else:
        logger.warning("观星看板无任何城市数据，跳过缓存写入 days=%s", days)
    return result
