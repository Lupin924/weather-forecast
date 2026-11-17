"""热点事件（天文现象 & 雪季文旅资讯）。

为首页「推荐地」卡提供当下热门提示，例如：
- 观星模式：狮子座流星雨、双子座流星雨等年度流星雨；
- 赏雪模式：亚布力雪季开板、雪乡开园、哈尔滨冰雪大世界开园等。

流星雨按公历日期每年循环自动生成；冰雪文旅事件为可维护的手填日期
（每年按官方公告更新 SNOW_EVENTS 即可）。
"""
from __future__ import annotations

from datetime import date, timedelta

# 年度流星雨（公历近似极大日，每年循环）。
METEOR_SHOWERS = [
    {"id": "quadrantids", "title": "象限仪座流星雨", "month": 1, "day": 3, "span": 1,
     "peak": "每小时约 80 颗", "note": "年初短促而强烈"},
    {"id": "lyrids", "title": "天琴座流星雨", "month": 4, "day": 22, "span": 1,
     "peak": "每小时约 18 颗", "note": "春季经典流星雨"},
    {"id": "perseids", "title": "英仙座流星雨", "month": 8, "day": 12, "span": 2,
     "peak": "每小时约 60–100 颗", "note": "夏季观星重头戏"},
    {"id": "orionids", "title": "猎户座流星雨", "month": 10, "day": 21, "span": 1,
     "peak": "每小时约 20 颗", "note": "哈雷彗星碎片"},
    {"id": "leonids", "title": "狮子座流星雨", "month": 11, "day": 17, "span": 2,
     "peak": "每小时约 15 颗", "note": "后半夜辐射点升高后更佳"},
    {"id": "geminids", "title": "双子座流星雨", "month": 12, "day": 14, "span": 2,
     "peak": "每小时可达 100+ 颗", "note": "全年最稳定的流星雨"},
]

# 冰雪文旅热点（手填日期，可按官方公告维护；跨年区间用 end 覆盖到来年）。
SNOW_EVENTS = [
    {"id": "yabuli_open", "title": "亚布力雪季开板", "city": "亚布力",
     "start": "2026-11-15", "end": "2027-03-31",
     "peak": "粉雪期到来", "note": "国内顶级滑雪场开板"},
    {"id": "xuexiang_open", "title": "雪乡正式开园", "city": "雪乡",
     "start": "2026-11-20", "end": "2027-03-10",
     "peak": "童话雪屋季开启", "note": "预计 11 月下旬开园"},
    {"id": "iceworld_open", "title": "哈尔滨冰雪大世界开园", "city": "哈尔滨",
     "start": "2026-12-20", "end": "2027-02-28",
     "peak": "全球最大冰雪乐园", "note": "预计 12 月下旬开园"},
]


def _status_text(start: date, peak: date, ref: date) -> tuple[str, int]:
    """返回 (状态文案, 距极大日天数)。"""
    if start <= ref <= peak:
        return "进行中", (peak - ref).days
    days = (peak - ref).days
    if days == 0:
        return "今日极大", 0
    if days == 1:
        return "明晚极大", 1
    if days > 1:
        return f"{days} 天后", days
    return "", days


def _meteor_items(ref: date, window_days: int) -> list[dict]:
    items: list[dict] = []
    for year_offset in (0, 1):
        y = ref.year + year_offset
        for m in METEOR_SHOWERS:
            peak = date(y, m["month"], m["day"])
            start = peak - timedelta(days=m.get("span", 1))
            end = peak + timedelta(days=m.get("span", 1))
            # 只保留极大日在 [今天-3, 今天+window] 内的事件
            if not (-3 <= (peak - ref).days <= window_days):
                continue
            status, days = _status_text(start, peak, ref)
            items.append({
                "id": f"{m['id']}-{y}",
                "mode": "stargazing",
                "icon": "🌠",
                "title": m["title"],
                "desc": f"{m['peak']} · {m['note']}",
                "status": status,
                "days_until": days,
                "start": start.isoformat(),
                "end": end.isoformat(),
                "peak": peak.isoformat(),
                "active": start <= ref <= end,
            })
    return items


def _snow_items(ref: date, window_days: int) -> list[dict]:
    items: list[dict] = []
    for e in SNOW_EVENTS:
        start = date.fromisoformat(e["start"])
        end = date.fromisoformat(e["end"])
        # 尚未结束、且在窗口内即将开始（或正在进行）
        if end < ref or (start - ref).days > window_days:
            continue
        status, days = _status_text(start, start, ref)
        if start <= ref <= end:
            status = "进行中"
        items.append({
            "id": e["id"],
            "mode": "snow",
            "icon": "❄️",
            "title": e["title"],
            "desc": f"{e['peak']} · {e['note']}",
            "city": e["city"],
            "status": status,
            "days_until": days,
            "start": e["start"],
            "end": e["end"],
            "peak": e["start"],
            "active": start <= ref <= end,
        })
    return items


def get_events(mode: str = "stargazing", ref: date | None = None,
               window_days: int = 60) -> list[dict]:
    """返回某模式下即将发生/正在进行的热点事件，按相关度排序。"""
    ref = ref or date.today()
    if mode == "snow":
        items = _snow_items(ref, window_days)
    else:
        items = _meteor_items(ref, window_days)

    # 排序：临近开幕（0–7 天内最「新」）> 进行中 > 更远期；同级按天数接近
    def _urgency(x: dict) -> tuple:
        d = x["days_until"]
        if not x["active"] and 0 <= d <= 7:
            return (0, d)
        if x["active"]:
            return (1, abs(d))
        return (2, d)

    items.sort(key=_urgency)
    return items
