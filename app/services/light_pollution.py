"""光污染评估服务 - 基于 VIIRS 卫星数据构建的本地 Bortle 等级数据库。

数据来源：
- NASA VIIRS 夜间灯光卫星数据
- World Atlas of Artificial Night Sky Brightness (Falchi et al., 2016)
- darkmap.cn / lightpollutionmap.info 公开光污染地图

Bortle 暗空分类（1-9级）：
  1 = 优秀暗空（SQM ≥ 21.3），几乎无光污染
  2 = 真正暗空（SQM 21.0-21.3），银河清晰
  3 = 乡村天空（SQM 20.6-21.0），部分银河可见
  4 = 乡村/郊区过渡（SQM 20.2-20.6）
  5 = 郊区天空（SQM 19.6-20.2）
  6 = 明亮郊区（SQM 18.5-19.6）
  7 = 郊区/城市过渡（SQM 18.0-18.5）
  8 = 城市天空（SQM 17.0-18.0）
  9 = 市中心天空（SQM < 17.0），严重光污染

本模块使用本地数据库 + 反距离加权插值估算任意坐标的光污染等级，
无需外部 API，适合离线/打包部署。
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Optional


# ---------------------------------------------------------------------------
# Bortle 等级参考数据
# ---------------------------------------------------------------------------
@dataclass
class BortleRef:
    """Bortle 等级参考条目。"""
    bortle: int          # Bortle 等级 1-9
    label: str           # 中文标签
    sqm: float           # 典型 SQM 值 (mag/arcsec²)
    sqm_range: str       # SQM 范围描述
    description: str     # 详细描述
    milky_way: str       # 银河可见度
    score: float         # 观星评分 (0-100，越高越好)


BORTLE_SCALE: dict[int, BortleRef] = {
    1: BortleRef(1, "优秀暗空", 21.8, "≥21.3", "极佳的天文观测条件，适合专业深空天体观测",
                 "银河结构清晰可见，M31/M33轻易可见", 100.0),
    2: BortleRef(2, "真正暗空", 21.2, "21.0-21.3", "大部分天文目标清晰可见，适合业余天文观测",
                 "银河清晰可见，有结构感", 92.0),
    3: BortleRef(3, "乡村天空", 20.8, "20.6-21.0", "较暗的深空天体可能较难观测，部分银河结构可见",
                 "银河可见但细节减少", 82.0),
    4: BortleRef(4, "乡村/郊区", 20.4, "20.2-20.6", "明显光污染，只有较亮的天体清晰可见",
                 "银河勉强可见", 68.0),
    5: BortleRef(5, "郊区天空", 19.9, "19.6-20.2", "中度光污染，银河难以观测",
                 "银河地平线附近不可见", 52.0),
    6: BortleRef(6, "明亮郊区", 19.0, "18.5-19.6", "较严重光污染，只能看到亮天体",
                 "银河不可见", 35.0),
    7: BortleRef(7, "郊区/城市", 18.2, "18.0-18.5", "严重光污染，只能看到最亮的天体",
                 "银河完全不可见", 20.0),
    8: BortleRef(8, "城市天空", 17.5, "17.0-18.0", "极严重光污染，不适合天文观测",
                 "仅可见少数亮星", 8.0),
    9: BortleRef(9, "市中心", 16.5, "<17.0", "最严重光污染，几乎无法观测",
                 "仅可见极少数亮星", 0.0),
}


# ---------------------------------------------------------------------------
# 中国城市/地点 Bortle 等级数据库
# 基于 VIIRS 卫星夜间灯光数据和 lightpollutionmap.info/darkmap.cn 公开数据
# 格式: (纬度, 经度, Bortle等级, 地点名)
# ---------------------------------------------------------------------------
_LIGHT_POLLUTION_DB: list[tuple[float, float, int, str]] = [
    # === 超大城市（Bortle 8-9）===
    (31.23, 121.47, 9, "上海"),       # 上海市中心 - 极严重光污染
    (39.90, 116.40, 9, "北京"),       # 北京市中心
    (22.53, 114.13, 9, "深圳"),       # 深圳市中心
    (23.12, 113.27, 9, "广州"),       # 广州市中心
    (29.56, 106.55, 8, "重庆"),       # 重庆主城区

    # === 特大城市（Bortle 7-8）===
    (30.57, 104.07, 8, "成都"),       # 成都市区
    (30.27, 120.15, 7, "杭州"),       # 杭州市区
    (32.06, 118.80, 7, "南京"),       # 南京市区
    (28.23, 112.93, 7, "长沙"),       # 长沙市区
    (34.26, 108.94, 7, "西安"),       # 西安市区
    (30.59, 114.30, 7, "武汉"),       # 武汉市区
    (36.07, 120.38, 7, "青岛"),       # 青岛市区
    (38.91, 121.60, 7, "大连"),       # 大连市区
    (36.65, 117.00, 7, "济南"),       # 济南市区
    (45.80, 126.53, 7, "哈尔滨"),     # 哈尔滨市区
    (43.88, 125.32, 7, "长春"),       # 长春市区
    (41.80, 123.43, 7, "沈阳"),       # 沈阳市区
    (34.75, 113.65, 7, "郑州"),       # 郑州市区

    # === 大城市（Bortle 6-7）===
    (24.47, 118.09, 7, "厦门"),       # 厦门市区
    (18.25, 109.51, 6, "三亚"),       # 三亚市区
    (20.02, 110.35, 6, "海口"),       # 海口市区
    (25.04, 102.68, 6, "昆明"),       # 昆明市区
    (26.65, 106.63, 6, "贵阳"),       # 贵阳市区
    (22.81, 108.37, 6, "南宁"),       # 南宁市区
    (36.06, 103.83, 6, "兰州"),       # 兰州市区
    (38.46, 106.27, 6, "银川"),       # 银川市区
    (43.82, 87.62, 6, "乌鲁木齐"),     # 乌鲁木齐市区
    (31.86, 117.28, 7, "合肥"),       # 合肥市区
    (26.07, 119.30, 6, "福州"),       # 福州市区

    # === 中等城市（Bortle 5-6）===
    (25.27, 110.29, 5, "桂林"),       # 桂林市区
    (29.32, 110.44, 5, "张家界"),     # 张家界市区
    (33.26, 103.92, 5, "九寨沟"),     # 九寨沟县城
    (36.62, 101.78, 4, "西宁"),       # 西宁市区（高原城市，光污染相对较低）
    (36.90, 100.20, 3, "青海湖"),     # 青海湖区域 - 高原暗空
    (40.14, 94.66, 3, "敦煌"),        # 敦煌 - 沙漠边缘，光污染较低

    # === 观星胜地（Bortle 1-4）===
    (32.32, 80.10, 1, "阿里天文台"),   # 阿里天文台 - 世界级暗空
    (29.71, 91.13, 2, "拉萨"),        # 拉萨 - 高原城市，光污染较低
    (42.02, 128.08, 3, "长白山"),     # 长白山天池 - 暗空区域
    (30.45, 119.68, 4, "安吉天荒坪"), # 安吉天荒坪 - 江南暗夜保护区
    (30.60, 119.90, 4, "莫干山"),     # 莫干山 - 郊外山区
    (30.13, 118.16, 4, "黄山"),       # 黄山风景区
    (36.25, 117.10, 4, "泰山"),       # 泰山 - 山区
    (34.48, 110.09, 3, "华山"),       # 华山 - 远离城市
    (29.54, 103.48, 3, "峨眉山"),     # 峨眉山金顶 - 高海拔暗空
    (39.04, 113.56, 3, "五台山"),     # 五台山 - 高海拔
    (30.10, 117.81, 4, "九华山"),     # 九华山
    (30.00, 122.40, 4, "普陀山"),     # 普陀山 - 海岛
    (29.54, 115.98, 4, "庐山"),       # 庐山 - 山区
    (26.87, 100.23, 4, "丽江"),       # 丽江古城 - 郊外
    (25.60, 100.27, 3, "大理"),       # 大理 - 高原城市
    (27.83, 99.71, 2, "香格里拉"),    # 香格里拉 - 高原暗空

    # === 其他城市补充 ===
    (31.30, 120.62, 6, "苏州"),       # 苏州
    (31.49, 120.31, 6, "无锡"),       # 无锡
    (32.39, 119.43, 6, "扬州"),       # 扬州
]


# ---------------------------------------------------------------------------
# 地理距离计算
# ---------------------------------------------------------------------------
def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """计算两点间的球面距离（公里），使用 Haversine 公式。"""
    R = 6371.0  # 地球半径 km
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return 2 * R * math.asin(min(1.0, math.sqrt(a)))


# ---------------------------------------------------------------------------
# Bortle 等级查询与估算
# ---------------------------------------------------------------------------
def get_light_pollution(lat: float, lon: float, elevation: int = 0) -> dict:
    """
    根据坐标获取光污染信息。

    使用本地数据库 + 反距离加权插值估算 Bortle 等级。
    高海拔地区会适当降低光污染等级（高海拔空气稀薄，散射少）。

    返回:
        {
            "bortle": int,       # Bortle 等级 1-9
            "label": str,        # 中文标签
            "sqm": float,        # 估算 SQM 值
            "score": float,      # 观星评分 0-100
            "milky_way": str,    # 银河可见度
            "description": str,  # 描述
            "method": str,       # 估算方法
            "nearest": str,      # 最近已知点名称
            "distance_km": float # 距最近已知点距离
        }
    """
    if not _LIGHT_POLLUTION_DB:
        return _default_result()

    # 计算到所有已知点的距离
    distances: list[tuple[float, int, str, float]] = []  # (distance, bortle, name, _unused)
    for db_lat, db_lon, bortle, name in _LIGHT_POLLUTION_DB:
        d = _haversine_km(lat, lon, db_lat, db_lon)
        distances.append((d, bortle, name, db_lat))

    distances.sort(key=lambda x: x[0])

    # 如果距离非常近（< 5km），直接使用该点的值
    nearest_dist, nearest_bortle, nearest_name, _ = distances[0]
    if nearest_dist < 5.0:
        bortle = nearest_bortle
        method = f"精确匹配（{nearest_name}，{nearest_dist:.1f}km）"
    else:
        # 反距离加权插值：使用最近的 5 个已知点
        bortle = _idw_interpolate(distances[:5])
        method = f"插值估算（最近点：{nearest_name}，{nearest_dist:.0f}km）"

    # 海拔修正：海拔每升高 1000m，Bortle 等级降低 0.5（更暗）
    # 但不超过降低 2 级
    if elevation > 500:
        elevation_adj = min(2.0, (elevation - 500) / 1000 * 0.5)
        bortle_adj = max(1, round(bortle - elevation_adj))
        if bortle_adj < bortle:
            method += f"，海拔修正（{elevation}m → -{bortle - bortle_adj:.1f}级）"
            bortle = bortle_adj

    bortle = max(1, min(9, bortle))
    ref = BORTLE_SCALE.get(bortle, BORTLE_SCALE[5])

    return {
        "bortle": bortle,
        "label": ref.label,
        "sqm": ref.sqm,
        "sqm_range": ref.sqm_range,
        "score": ref.score,
        "milky_way": ref.milky_way,
        "description": ref.description,
        "method": method,
        "nearest": nearest_name,
        "distance_km": round(nearest_dist, 1),
        "data_source": "VIIRS卫星夜间灯光数据 + World Atlas of Artificial Night Sky Brightness",
    }


def _idw_interpolate(nearest_points: list[tuple[float, int, str, float]]) -> int:
    """反距离加权插值计算 Bortle 等级。

    使用 1/d² 权重，避免距离为 0 的情况。
    """
    total_weight = 0.0
    total_value = 0.0

    for dist, bortle, _, _ in nearest_points:
        # 最小距离 1km 避免除零
        d = max(1.0, dist)
        weight = 1.0 / (d ** 2)
        total_weight += weight
        total_value += bortle * weight

    if total_weight == 0:
        return 5

    interpolated = total_value / total_weight
    return max(1, min(9, round(interpolated)))


def _default_result() -> dict:
    """返回默认结果（数据库为空时）。"""
    ref = BORTLE_SCALE[5]
    return {
        "bortle": 5,
        "label": ref.label,
        "sqm": ref.sqm,
        "sqm_range": ref.sqm_range,
        "score": ref.score,
        "milky_way": ref.milky_way,
        "description": ref.description,
        "method": "默认估算（无数据）",
        "nearest": "未知",
        "distance_km": 0,
        "data_source": "默认值",
    }


def bortle_to_score(bortle: int) -> float:
    """将 Bortle 等级转换为观星评分（0-100，越高越好）。"""
    ref = BORTLE_SCALE.get(bortle, BORTLE_SCALE[5])
    return ref.score


def bortle_to_aqi_equivalent(bortle: int) -> float:
    """将 Bortle 等级转换为等效 AQI 值（用于兼容旧接口）。"""
    # Bortle 1-2 → AQI 20-30（无光污染）
    # Bortle 3-4 → AQI 40-60
    # Bortle 5-6 → AQI 80-120
    # Bortle 7-8 → AQI 150-200
    # Bortle 9   → AQI 250+
    mapping = {1: 20, 2: 30, 3: 45, 4: 60, 5: 85, 6: 110, 7: 150, 8: 200, 9: 280}
    return float(mapping.get(bortle, 85))
