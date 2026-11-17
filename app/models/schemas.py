"""Pydantic 响应模型 —— 统一信封 + 各端点数据结构。"""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# 统一信封
# ---------------------------------------------------------------------------
class CityInfo(BaseModel):
    id: str
    name: str
    latitude: float
    longitude: float
    elevation_m: int
    cma_station_id: str | None = None


class Meta(BaseModel):
    sources: list[str] = Field(default_factory=list)
    updated_at: str
    confidence: str = "中"
    stale: bool = False


class ApiResponse(BaseModel):
    city: CityInfo
    data: Any
    meta: Meta


# ---------------------------------------------------------------------------
# 实况
# ---------------------------------------------------------------------------
class WeatherAlarm(BaseModel):
    title: str
    signaltype: str = ""
    signallevel: str = ""
    effective: str = ""
    severity: str = ""


class CurrentWeather(BaseModel):
    temperature: float
    feels_like: float
    pressure: float
    humidity: float
    wind_direction: str
    wind_direction_degree: float
    wind_speed: float  # m/s
    wind_scale: str
    precipitation: float
    alarms: list[WeatherAlarm] = Field(default_factory=list)
    last_update: str


# ---------------------------------------------------------------------------
# 7 天预报
# ---------------------------------------------------------------------------
class DailyForecast(BaseModel):
    date: str
    high: float
    low: float
    day_text: str
    night_text: str
    day_wind_direction: str
    night_wind_direction: str
    day_wind_scale: str
    night_wind_scale: str
    # Open-Meteo 补充（超出 CMA 7 天窗口时）
    precipitation: float | None = None
    cloud_cover: float | None = None


# ---------------------------------------------------------------------------
# 逐小时
# ---------------------------------------------------------------------------
class HourlyPoint(BaseModel):
    time: str
    temperature: float
    humidity: float | None = None
    pressure: float | None = None
    precipitation: float | None = None
    cloud_cover: float | None = None
    wind_speed: float | None = None  # km/h
    wind_direction: float | None = None
    wind_gusts: float | None = None  # km/h
    visibility: float | None = None  # km
    dew_point: float | None = None
    weather_code: int | None = None
    text: str | None = None


# ---------------------------------------------------------------------------
# 多模型集成
# ---------------------------------------------------------------------------
class ModelValues(BaseModel):
    high: float
    low: float
    precipitation: float
    cloud_cover_mean: float
    wind_speed_max: float


class MultiModelData(BaseModel):
    ecmwf: ModelValues
    gfs: ModelValues
    ensemble: ModelValues
    divergence: dict[str, str]  # {"temperature":"小","precipitation":"大",...}


# ---------------------------------------------------------------------------
# 观星
# ---------------------------------------------------------------------------
class StargazingHour(BaseModel):
    time: str
    score: float
    rating: str
    level: str
    cloud_cover: float | None = None
    visibility: float | None = None
    humidity: float | None = None
    wind_speed: float | None = None
    wind_gusts: float | None = None
    moon_illumination: float | None = None
    moon_below_horizon: bool | None = None
    breakdown: dict[str, float] = Field(default_factory=dict)


class StargazingResult(BaseModel):
    date: str
    hours: list[StargazingHour]
    best_window: str | None = None
    best_score: float = 0.0
    summary: str = ""


# ---------------------------------------------------------------------------
# 天文
# ---------------------------------------------------------------------------
class AstronomyInfo(BaseModel):
    date: str
    sunrise: str | None = None
    sunset: str | None = None
    moonrise: str | None = None
    moonset: str | None = None
    moon_phase: float | None = None
    moon_illumination: float | None = None
    moon_phase_name: str = ""


# ---------------------------------------------------------------------------
# 历史同期
# ---------------------------------------------------------------------------
class HistoricalYear(BaseModel):
    year: int
    high: float
    low: float
    precipitation: float
    cloud_cover_mean: float
    wind_speed_max: float


class HistoricalComparison(BaseModel):
    month_day: str
    years: list[HistoricalYear]


# ---------------------------------------------------------------------------
# 天气系统分析
# ---------------------------------------------------------------------------
class SystemAnalysis(BaseModel):
    date: str
    pressure_series: list[dict]  # [{"date":..,"pressure":..,"wind_speed":..,"gust":..}]
    min_pressure: float | None = None
    min_pressure_date: str | None = None
    system_detected: bool = False
    system_type: str = "正常"
    peak_gust: float | None = None
    target_gust: float | None = None
    influence_ended: bool = True
    conclusion: str = ""
