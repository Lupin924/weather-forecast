"""后台缓存预热与定时刷新。

服务启动后延迟一段时间（等容器网络/DNS 就绪）再预热两模式看板（days=7 与 days=14），
之后每隔 REFRESH_MINUTES 分钟强制重算一次，保证缓存常热：用户打开页面即可命中缓存。

失败处理：单次构建异常只记 warning 不抛出；若一轮全部失败（通常意味着上游 API
还没通），30 秒后重试，而不是空等半小时把空缓存留在 TTL 里。
"""
from __future__ import annotations

import asyncio
import logging

from . import snow, stargazing

logger = logging.getLogger(__name__)

REFRESH_MINUTES = 30
FIRST_DELAY_SECONDS = 20  # 容器刚起来时 DNS/TLS 常未就绪，直接打上游会整轮失败
RETRY_SECONDS = 30  # 整轮失败后的重试间隔
_DAYS = (14, 7)  # 14 供首页速览（loadHome），7 供完整看板页
_BUILDERS = (
    ("snow", snow.build_board),
    ("stargazing", stargazing.build_stargazing_board),
)


async def warm_once() -> int:
    """串行重算并写入两模式、两档天数的看板缓存，返回成功构建的数量（0-4）。

    串行是为了避免瞬时打爆上游 API。
    """
    ok = 0
    for days in _DAYS:
        for name, builder in _BUILDERS:
            try:
                await builder(days, force=True)
                ok += 1
            except Exception as exc:  # noqa: BLE001 - 预热失败不应影响服务
                logger.warning(
                    "预热失败 mode=%s days=%s: %s: %s",
                    name, days, type(exc).__name__, exc,
                )
    return ok


async def run_warmer() -> None:
    """常驻后台任务：启动后延迟预热一轮，随后定时刷新。"""
    await asyncio.sleep(FIRST_DELAY_SECONDS)
    while True:
        ok = await warm_once()
        if ok:
            await asyncio.sleep(REFRESH_MINUTES * 60)
        else:
            logger.warning("本轮预热全部失败，%ss 后重试", RETRY_SECONDS)
            await asyncio.sleep(RETRY_SECONDS)
