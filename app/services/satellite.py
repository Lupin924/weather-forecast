"""国家卫星气象中心（NSMC）风云四号（FY-4B）卫星云图服务。

背景：Windy.com 的 embed iframe 在境内常被网络策略阻断（官方已停止境内线路），
导致卫星页 / 台风页隐藏了云图。此服务改为拉取国家卫星气象中心（img.nsmc.org.cn）
的 FY-4B 中国区域真彩合成云图，境内直连、免密钥，包含文件级 TTL 缓存。
"""
from __future__ import annotations

import time
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta

import httpx

from ..config import HTTP_TIMEOUT, NSMC_FY4_CHINA_XML
from . import cache

# 缓存键 / TTL
_CACHE_KEY = "satellite_fy4_china"
_CACHE_TTL = 600  # 10 分钟

_SOURCE_NAME = "国家卫星气象中心 · 风云四号B星 · 真彩合成"


def _parse_local_time(time_utc_str: str) -> tuple[str, str]:
    """解析 NSMC time 属性（UTC），返回 (utc_iso, 北京时间字符串)。"""
    if not time_utc_str:
        return "", ""
    try:
        dt = datetime.strptime(time_utc_str.strip(), "%Y-%m-%d %H:%M (UTC)")
    except ValueError:
        return "", ""
    local = dt + timedelta(hours=8)
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ"), local.strftime("%Y-%m-%d %H:%M")


def _parse_images(xml_text: str) -> list[dict]:
    """解析 <imagelist> 下的 <image> 列表，返回完整尺寸（跳过缩略图）。"""
    root = ET.fromstring(xml_text)
    items: list[dict] = []
    for img in root.findall(".//image"):
        url = (img.get("url") or "").strip()
        if not url or "thumb" in url.lower():
            continue  # 只取完整尺寸 JPG
        if url.startswith("//"):
            url = "https:" + url
        utc, local = _parse_local_time(img.get("time") or "")
        items.append({"url": url, "time_utc": utc, "time_local": local})
    return items


async def get_fy4_latest(region: str = "china") -> dict:
    """获取最新一张风云四号云图元信息。

    返回结构：{ok, satellite, region, url, time_utc, time_local, source, updated_at}
    上游异常时提供 stale-while-revalidate 兜底；缓存与上游均不可用则抛出异常。
    """
    xml_url = NSMC_FY4_CHINA_XML
    region_key = "china" if region != "disk" else "disk"
    cache_key = f"satellite_fy4_{region_key}"

    cached, stale = cache.get_cache(cache_key, _CACHE_TTL)
    if cached is not None and not stale:
        return cached

    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
            resp = await client.get(xml_url, follow_redirects=True)
            resp.raise_for_status()
        items = _parse_images(resp.text)
        if not items:
            raise RuntimeError("NSMC 卫星云图列表为空")
        latest = items[0]
        result = {
            "ok": True,
            "satellite": "FY-4B",
            "region": region_key,
            "url": latest["url"],
            "time_utc": latest["time_utc"],
            "time_local": latest["time_local"],
            "source": _SOURCE_NAME,
            "updated_at": int(time.time()),
        }
        cache.set_cache(cache_key, result)
        return result
    except Exception:
        if cached is not None:
            cached["_stale"] = True
            return cached
        raise