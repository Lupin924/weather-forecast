"""天气系统/台风识别：基于 ECMWF 海平面气压趋势与阵风演变。"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Optional

from ..config import TYPHOON_PRESSURE_THRESHOLD, TYPHOON_DROP_THRESHOLD
from . import open_meteo


def _pressure_of(p: dict) -> Optional[float]:
    """优先取海平面气压，退而取地面气压。"""
    return p.get("pressure_msl") if p.get("pressure_msl") is not None else p.get("surface_pressure")


async def build_analysis(
    lat: float, lon: float, elevation: int, date_str: str
) -> dict[str, Any]:
    target = datetime.fromisoformat(date_str)
    start = (target - timedelta(days=7)).strftime("%Y-%m-%d")
    end = (target + timedelta(days=1)).strftime("%Y-%m-%d")

    ec = await open_meteo.get_ecmwf_hourly(lat, lon, elevation, start, end)
    hourly = ec["hourly"]

    # 按日聚合
    by_day: dict[str, list[dict]] = {}
    for p in hourly:
        d = p.get("time", "")[:10]
        if d:
            by_day.setdefault(d, []).append(p)

    series: list[dict] = []
    for d in sorted(by_day.keys()):
        pts = by_day[d]
        pressures = [v for v in (_pressure_of(p) for p in pts) if v is not None]
        gusts = [p["wind_gusts_10m"] for p in pts if p.get("wind_gusts_10m") is not None]
        winds = [p["wind_speed_10m"] for p in pts if p.get("wind_speed_10m") is not None]
        series.append({
            "date": d,
            "pressure": round(sum(pressures) / len(pressures), 1) if pressures else None,
            "wind_speed": round(max(winds), 1) if winds else None,
            "gust": round(max(gusts), 1) if gusts else None,
        })

    valid = [s for s in series if s["pressure"] is not None]
    min_p = min(s["pressure"] for s in valid) if valid else None
    min_p_date = next((s["date"] for s in valid if s["pressure"] == min_p), None)

    # 24h 最大降幅
    max_drop = 0.0
    for i in range(1, len(valid)):
        max_drop = max(max_drop, valid[i - 1]["pressure"] - valid[i]["pressure"])

    system_detected = bool(
        (min_p is not None and min_p < TYPHOON_PRESSURE_THRESHOLD)
        or max_drop > TYPHOON_DROP_THRESHOLD
    )

    peak_gust = max((s["gust"] for s in series if s["gust"] is not None), default=None)
    target_record = next((s for s in series if s["date"] == date_str), None)
    target_gust = target_record["gust"] if target_record else None

    # 影响是否结束：目标日阵风较峰值下降超 40%
    influence_ended = True
    if system_detected and peak_gust and target_gust and peak_gust > 0:
        influence_ended = (peak_gust - target_gust) / peak_gust > 0.4

    # 结论文本
    if not system_detected:
        conclusion = "近 7 天气压平稳，未识别到台风/强天气系统。"
    elif influence_ended:
        conclusion = (
            f"识别到强系统（最低气压 {min_p} hPa，出现于 {min_p_date}），"
            f"至 {date_str} 阵风已由峰值 {peak_gust} km/h 降至 {target_gust} km/h，"
            "影响已结束。"
        )
    else:
        conclusion = (
            f"识别到强系统（最低气压 {min_p} hPa，出现于 {min_p_date}），"
            f"{date_str} 阵风 {target_gust} km/h 仍接近峰值 {peak_gust} km/h，"
            "影响尚未结束，请关注。"
        )

    return {
        "date": date_str,
        "pressure_series": series,
        "min_pressure": min_p,
        "min_pressure_date": min_p_date,
        "max_24h_drop": round(max_drop, 1),
        "system_detected": system_detected,
        "system_type": "台风/强系统" if system_detected else "正常",
        "peak_gust": peak_gust,
        "target_gust": target_gust,
        "influence_ended": influence_ended,
        "conclusion": conclusion,
    }
