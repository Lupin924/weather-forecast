"""后台缓存预热与定时刷新。

服务启动时立即（异步、不阻塞启动）预热两模式看板（days=7 与 days=14），
之后每隔 REFRESH_MINUTES 分钟强制重算一次，保证缓存常热：用户打开页面
即可命中缓存，无需等待数秒的实时多城 API 计算。
"""
from __future__ import annotations

import asyncio

from . import snow, stargazing

REFRESH_MINUTES = 30
_DAYS = (14, 7)  # 14 供首页速览（loadHome），7 供完整看板页


async def warm_once() -> None:
    """串行重算并写入两模式、两档天数的看板缓存（串行避免瞬时打爆上游 API）。"""
    for days in _DAYS:
        for builder in (snow.build_board, stargazing.build_stargazing_board):
            try:
                await builder(days, force=True)
            except Exception:
                # 预热失败不影响服务；缓存未命中时请求仍会按需实时计算
                pass


async def run_warmer() -> None:
    """常驻后台任务：启动即预热一轮，随后定时刷新。"""
    await asyncio.sleep(2)  # 让服务先完成启动、可对外响应
    while True:
        await warm_once()
        await asyncio.sleep(REFRESH_MINUTES * 60)
