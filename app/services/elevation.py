"""海拔气温订正（标准递减率 6.5°C/1000m）。"""
from __future__ import annotations

from ..config import LAPSE_RATE


def correct_temperature(
    temp_c: float | None,
    from_elevation_m: float,
    to_elevation_m: float,
) -> float | None:
    """将气温从 from_elevation 订正到 to_elevation。"""
    if temp_c is None:
        return None
    delta_m = to_elevation_m - from_elevation_m
    return round(temp_c - LAPSE_RATE * delta_m / 1000.0, 1)
