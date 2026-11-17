"""应用配置：城市预设、API 端点、观星评分权重、缓存 TTL 等常量。"""
from __future__ import annotations

from dataclasses import dataclass, field


# ---------------------------------------------------------------------------
# 城市预设 - 热门旅游城市
# ---------------------------------------------------------------------------
@dataclass
class City:
    id: str
    name: str
    latitude: float
    longitude: float
    elevation_m: int
    cma_station_id: str | None = None
    desc: str = ""
    tags: list[str] = field(default_factory=list)


CITIES: dict[str, City] = {
    # --- 原始观星胜地 ---
    "anji": City(
        "anji", "安吉天荒坪", 30.45, 119.68, 900, "58446",
        "江南暗夜保护区，观星胜地", ["观星", "避暑"],
    ),
    "moganshan": City(
        "moganshan", "莫干山", 30.60, 119.90, 600, "58450",
        "避暑名山，竹海云雾", ["避暑", "登山"],
    ),
    "changbaishan": City(
        "changbaishan", "长白山", 42.02, 128.08, 1800, "54085",
        "东北第一高峰，冬季观星/雪景", ["观星", "雪景"],
    ),
    "qinghaihu": City(
        "qinghaihu", "青海湖", 36.90, 100.20, 3200, "52856",
        "高原圣湖，空气通透宜观星", ["观星", "高原"],
    ),
    "ali": City(
        "ali", "阿里天文台", 32.32, 80.10, 5100, "55228",
        "世界级暗夜天文台，北半球最佳观星地之一", ["观星", "天文台"],
    ),
    "huangshan": City(
        "huangshan", "黄山", 30.13, 118.16, 1840, "58437",
        "云海日出，奇松怪石", ["日出", "云海"],
    ),
    # --- 热门旅游城市 ---
    "beijing": City(
        "beijing", "北京", 39.90, 116.40, 50, "54511",
        "古都名城，四季分明", ["历史", "文化"],
    ),
    "shanghai": City(
        "shanghai", "上海", 31.23, 121.47, 10, "58362",
        "东方明珠，魔都风情", ["都市", "现代"],
    ),
    "hangzhou": City(
        "hangzhou", "杭州", 30.27, 120.15, 30, "58457",
        "西湖美景，人间天堂", ["西湖", "江南"],
    ),
    "chengdu": City(
        "chengdu", "成都", 30.57, 104.07, 500, "56294",
        "天府之国，熊猫故乡", ["美食", "熊猫"],
    ),
    "guilin": City(
        "guilin", "桂林", 25.27, 110.29, 200, "59265",
        "山水甲天下，漓江画廊", ["山水", "游船"],
    ),
    "lijiang": City(
        "lijiang", "丽江", 26.87, 100.23, 2400, "56548",
        "古城雪山，纳西风情", ["古城", "雪山"],
    ),
    "xiamen": City(
        "xiamen", "厦门", 24.47, 118.09, 30, "59134",
        "海上花园，鼓浪屿", ["海岛", "文艺"],
    ),
    "sanya": City(
        "sanya", "三亚", 18.25, 109.51, 20, "59431",
        "热带海滨，度假天堂", ["海滩", "度假"],
    ),
    "zhangjiajie": City(
        "zhangjiajie", "张家界", 29.32, 110.44, 1300, "57458",
        "阿凡达取景地，奇峰异石", ["奇峰", "自然"],
    ),
    "jiuzhaigou": City(
        "jiuzhaigou", "九寨沟", 33.26, 103.92, 2000, "56259",
        "童话世界，彩林翠海", ["彩林", "水韵"],
    ),
    "dunhuang": City(
        "dunhuang", "敦煌", 40.14, 94.66, 1150, "52418",
        "丝路明珠，莫高窟鸣沙山", ["沙漠", "文化"],
    ),
    "xining": City(
        "xining", "西宁", 36.62, 101.78, 2300, "52866",
        "高原门户，塔尔寺", ["高原", "宗教"],
    ),
    "yinchuan": City(
        "yinchuan", "银川", 38.46, 106.27, 1100, "53614",
        "塞上江南，西夏文化", ["沙漠", "文化"],
    ),
    "harbin": City(
        "harbin", "哈尔滨", 45.80, 126.53, 150, "50953",
        "冰雪之都，中央大街", ["冰雪", "冬季"],
    ),
    "dalian": City(
        "dalian", "大连", 38.91, 121.60, 40, "54620",
        "北方明珠，海滨城市", ["海滨", "海鲜"],
    ),
    "qingdao": City(
        "qingdao", "青岛", 36.07, 120.38, 100, "54857",
        "帆船之都，啤酒海鲜", ["海滨", "啤酒"],
    ),
    "nanjing": City(
        "nanjing", "南京", 32.06, 118.80, 30, "58238",
        "六朝古都，金陵风韵", ["历史", "文化"],
    ),
    "wuxi": City(
        "wuxi", "无锡", 31.49, 120.31, 30, "58354",
        "太湖明珠，园林之城", ["园林", "太湖"],
    ),
    "suzhou": City(
        "suzhou", "苏州", 31.30, 120.62, 30, "58370",
        "东方威尼斯，园林甲天下", ["园林", "江南"],
    ),
    "yangzhou": City(
        "yangzhou", "扬州", 32.39, 119.43, 20, "58245",
        "淮左名都，烟花三月", ["园林", "美食"],
    ),
    "hangzhou_westlake": City(
        "hangzhou_westlake", "杭州西湖", 30.24, 120.14, 50, "58457",
        "西湖十景，断桥残雪", ["西湖", "摄影"],
    ),
    "putuo": City(
        "putuo", "普陀山", 30.00, 122.40, 300, "58465",
        "海天佛国，观音道场", ["宗教", "海岛"],
    ),
    "wutai": City(
        "wutai", "五台山", 39.04, 113.56, 2890, "53734",
        "华北屋脊，文殊道场", ["宗教", "徒步"],
    ),
    "emei": City(
        "emei", "峨眉山", 29.54, 103.48, 3099, "56197",
        "普贤道场，金顶云海", ["宗教", "登山"],
    ),
    "jiuhua": City(
        "jiuhua", "九华山", 30.10, 117.81, 1344, "58432",
        "地藏道场，莲花佛国", ["宗教", "徒步"],
    ),
    "taishan": City(
        "taishan", "泰山", 36.25, 117.10, 1545, "54857",
        "五岳之首，天下第一山", ["登山", "日出"],
    ),
    "huashan": City(
        "huashan", "华山", 34.48, 110.09, 2155, "53944",
        "奇险天下第一山", ["登山", "探险"],
    ),
    "hengshan": City(
        "hengshan", "恒山", 39.67, 113.72, 2016, "53772",
        "北岳恒山，悬空寺", ["登山", "古迹"],
    ),
    "songshan": City(
        "songshan", "嵩山", 34.50, 113.05, 1492, "53988",
        "中岳嵩山，少林寺", ["武术", "古迹"],
    ),
    "lushan": City(
        "lushan", "庐山", 29.54, 115.98, 1474, "58444",
        "匡庐奇秀甲天下", ["避暑", "瀑布"],
    ),
    "huanghe": City(
        "huanghe", "黄山", 30.13, 118.16, 1864, "58437",
        "五岳归来不看山，黄山归来不看岳", ["登山", "云海"],
    ),
    # --- 赏雪模式：雪景旅游城市 ---
    "shenyang": City(
        "shenyang", "沈阳", 41.80, 123.43, 50, "54324",
        "关外盛京，棋盘山冰雪大世界", ["雪景", "东北"],
    ),
    "changchun": City(
        "changchun", "长春", 43.88, 125.32, 250, "54161",
        "北国春城，净月潭瓦萨冰雪", ["雪景", "东北"],
    ),
    "jilin": City(
        "jilin", "吉林", 43.84, 126.55, 200, "54082",
        "雾凇之都，松花江畔奇观", ["雪景", "雾凇", "东北"],
    ),
    "yabuli": City(
        "yabuli", "亚布力", 44.62, 128.53, 500, None,
        "中国滑雪圣地， Alps of the East", ["雪景", "滑雪", "东北"],
    ),
    "xuexiang": City(
        "xuexiang", "雪乡", 44.20, 128.75, 1100, None,
        "双峰林场，中国雪乡", ["雪景", "东北"],
    ),
    "mohe": City(
        "mohe", "漠河", 52.97, 122.54, 300, "50137",
        "神州北极，极寒冰雪", ["雪景", "极光", "东北"],
    ),
    "weihai": City(
        "weihai", "威海", 37.51, 122.12, 50, "54763",
        "山东半岛雪窝，冬季看海赏雪", ["雪景", "山东半岛"],
    ),
    "yantai": City(
        "yantai", "烟台", 37.46, 121.45, 50, "54765",
        "山东半岛雪窝，滨海雪景", ["雪景", "山东半岛"],
    ),
    "taizijian": City(
        "taizijian", "太子尖", 30.13, 118.90, 1557, None,
        "浙西屋脊，华东著名赏雪徒步地", ["雪景", "浙西", "华东"],
    ),
    "tianmushan": City(
        "tianmushan", "天目山", 30.34, 119.44, 1500, None,
        "浙西名山，古树雾凇雪景", ["雪景", "浙西", "华东"],
    ),
    "xixi_zhexi": City(
        "xixi_zhexi", "浙西大峡谷", 30.20, 118.95, 700, None,
        "浙西临安，冬季雾凇冰瀑", ["雪景", "浙西", "华东"],
    ),
    "huangshan_snow": City(
        "huangshan_snow", "黄山(冬)", 30.13, 118.16, 1840, "58437",
        "黄山冬雪，云海雾凇奇观", ["雪景", "华东"],
    ),
    "jiuhuashan_snow": City(
        "jiuhuashan_snow", "九华山(冬)", 30.10, 117.81, 1344, "58432",
        "九华冬雪，佛国琉璃世界", ["雪景", "华东"],
    ),
}

DEFAULT_CITY_ID = "beijing"

# 用户在上海：作为两种模式的优先参考城市
HOME_CITY_ID = "shanghai"
HOME_CITY_LAT = 31.23
HOME_CITY_LON = 121.47


def get_city(city_id: str) -> City | None:
    return CITIES.get(city_id)


def search_cities(keyword: str, limit: int = 20) -> list[dict]:
    """根据关键词搜索城市（名称、别名、描述、标签）。"""
    keyword = keyword.strip().lower()
    if not keyword:
        return []
    
    results = []
    for c in CITIES.values():
        name = c.name.lower()
        desc = c.desc.lower()
        tags_str = ' '.join(c.tags).lower()
        
        if (keyword in name or 
            keyword in desc or 
            keyword in tags_str or
            keyword in c.id.lower()):
            results.append({
                "id": c.id,
                "name": c.name,
                "latitude": c.latitude,
                "longitude": c.longitude,
                "elevation_m": c.elevation_m,
                "cma_station_id": c.cma_station_id,
                "desc": c.desc,
                "tags": c.tags,
            })
            if len(results) >= limit:
                break
    
    return results


# ---------------------------------------------------------------------------
# CMA 城市站号数据库（用于按名称查站号）
# ---------------------------------------------------------------------------
CMA_STATION_MAP: dict[str, dict] = {
    "北京": {"station_id": "54511", "lat": 39.90, "lon": 116.40, "elev": 50},
    "上海": {"station_id": "58362", "lat": 31.23, "lon": 121.47, "elev": 10},
    "广州": {"station_id": "59287", "lat": 23.12, "lon": 113.27, "elev": 30},
    "深圳": {"station_id": "59493", "lat": 22.53, "lon": 114.13, "elev": 20},
    "杭州": {"station_id": "58457", "lat": 30.27, "lon": 120.15, "elev": 30},
    "南京": {"station_id": "58238", "lat": 32.06, "lon": 118.80, "elev": 30},
    "成都": {"station_id": "56294", "lat": 30.57, "lon": 104.07, "elev": 500},
    "重庆": {"station_id": "57516", "lat": 29.56, "lon": 106.55, "elev": 250},
    "武汉": {"station_id": "57494", "lat": 30.59, "lon": 114.30, "elev": 30},
    "西安": {"station_id": "57036", "lat": 34.26, "lon": 108.94, "elev": 400},
    "长沙": {"station_id": "57584", "lat": 28.23, "lon": 112.93, "elev": 50},
    "合肥": {"station_id": "58321", "lat": 31.86, "lon": 117.28, "elev": 30},
    "福州": {"station_id": "58847", "lat": 26.07, "lon": 119.30, "elev": 30},
    "郑州": {"station_id": "53186", "lat": 34.75, "lon": 113.65, "elev": 110},
    "济南": {"station_id": "54857", "lat": 36.65, "lon": 117.00, "elev": 100},
    "沈阳": {"station_id": "54324", "lat": 41.80, "lon": 123.43, "elev": 50},
    "哈尔滨": {"station_id": "50953", "lat": 45.80, "lon": 126.53, "elev": 150},
    "长春": {"station_id": "54161", "lat": 43.88, "lon": 125.32, "elev": 250},
    "大连": {"station_id": "54620", "lat": 38.91, "lon": 121.60, "elev": 40},
    "青岛": {"station_id": "54857", "lat": 36.07, "lon": 120.38, "elev": 100},
    "昆明": {"station_id": "56778", "lat": 25.04, "lon": 102.68, "elev": 1900},
    "贵阳": {"station_id": "57816", "lat": 26.65, "lon": 106.63, "elev": 1100},
    "南宁": {"station_id": "59287", "lat": 22.81, "lon": 108.37, "elev": 50},
    "海口": {"station_id": "59758", "lat": 20.02, "lon": 110.35, "elev": 20},
    "三亚": {"station_id": "59431", "lat": 18.25, "lon": 109.51, "elev": 20},
    "兰州": {"station_id": "52889", "lat": 36.06, "lon": 103.83, "elev": 1500},
    "西宁": {"station_id": "52866", "lat": 36.62, "lon": 101.78, "elev": 2300},
    "银川": {"station_id": "53614", "lat": 38.46, "lon": 106.27, "elev": 1100},
    "乌鲁木齐": {"station_id": "51431", "lat": 43.82, "lon": 87.62, "elev": 900},
    "拉萨": {"station_id": "55591", "lat": 29.71, "lon": 91.13, "elev": 3645},
    "桂林": {"station_id": "59265", "lat": 25.27, "lon": 110.29, "elev": 200},
    "厦门": {"station_id": "59134", "lat": 24.47, "lon": 118.09, "elev": 30},
    "苏州": {"station_id": "58370", "lat": 31.30, "lon": 120.62, "elev": 30},
    "无锡": {"station_id": "58354", "lat": 31.49, "lon": 120.31, "elev": 30},
    "丽江": {"station_id": "56548", "lat": 26.87, "lon": 100.23, "elev": 2400},
    "大理": {"station_id": "56538", "lat": 25.60, "lon": 100.27, "elev": 2100},
    "香格里拉": {"station_id": "56555", "lat": 27.83, "lon": 99.71, "elev": 3300},
    "九寨沟": {"station_id": "56259", "lat": 33.26, "lon": 103.92, "elev": 2000},
    "张家界": {"station_id": "57458", "lat": 29.32, "lon": 110.44, "elev": 1300},
    "黄山": {"station_id": "58437", "lat": 30.13, "lon": 118.16, "elev": 1840},
    "泰山": {"station_id": "54857", "lat": 36.25, "lon": 117.10, "elev": 1545},
    "华山": {"station_id": "53944", "lat": 34.48, "lon": 110.09, "elev": 2155},
    "峨眉山": {"station_id": "56197", "lat": 29.54, "lon": 103.48, "elev": 3099},
    "普陀山": {"station_id": "58465", "lat": 30.00, "lon": 122.40, "elev": 300},
    "五台山": {"station_id": "53734", "lat": 39.04, "lon": 113.56, "elev": 2890},
    "长白山": {"station_id": "54085", "lat": 42.02, "lon": 128.08, "elev": 1800},
    "莫干山": {"station_id": "58450", "lat": 30.60, "lon": 119.90, "elev": 600},
    "安吉": {"station_id": "58446", "lat": 30.45, "lon": 119.68, "elev": 900},
    "青海湖": {"station_id": "52856", "lat": 36.90, "lon": 100.20, "elev": 3200},
    "敦煌": {"station_id": "52418", "lat": 40.14, "lon": 94.66, "elev": 1150},
}


def lookup_cma_city(name: str) -> dict | None:
    """根据城市名查询 CMA 站号及坐标。"""
    name = name.strip()
    # 精确匹配
    if name in CMA_STATION_MAP:
        result = CMA_STATION_MAP[name].copy()
        result["name"] = name
        return result
    # 模糊匹配（包含关系）
    for cn, info in CMA_STATION_MAP.items():
        if name in cn or cn in name:
            result = info.copy()
            result["name"] = cn
            result["matched_by"] = "fuzzy"
            return result
    return None


# ---------------------------------------------------------------------------
# 外部 API 端点
# ---------------------------------------------------------------------------
CMA_BASE = "https://weather.cma.cn/api"
OPEN_METEO_FORECAST = "https://api.open-meteo.com/v1/forecast"
OPEN_METEO_ECMWF = "https://api.open-meteo.com/v1/ecmwf"
OPEN_METEO_GFS = "https://api.open-meteo.com/v1/gfs"
OPEN_METEO_ARCHIVE = "https://archive-api.open-meteo.com/v1/archive"
OPEN_METEO_AIR = "https://air-quality-api.open-meteo.com/v1/air-quality"

HTTP_TIMEOUT = 15.0  # 单次请求超时（秒）


# ---------------------------------------------------------------------------
# 观星评分权重（合计 1.0）
# ---------------------------------------------------------------------------
STARGAZE_WEIGHTS = {
    "cloud": 0.22,          # 云量
    "night_sky": 0.18,      # 天光/夜间程度（基于日落日出）
    "moon": 0.13,           # 月相
    "precipitation": 0.12,  # 降水（硬性约束：有雨基本无法观星）
    "light_pollution": 0.10, # 光污染
    "visibility": 0.07,     # 能见度
    "humidity": 0.07,       # 湿度
    "wind": 0.06,           # 风速 + 阵风
    "air_quality": 0.05,    # 空气质量
}

# 评级阈值
RATING_THRESHOLDS = [
    (70, "🟢 优", "excellent"),
    (50, "🟡 良", "good"),
    (30, "🟠 中", "moderate"),
    (0, "🔴 差", "poor"),
]

# 观星时间窗口（当地晚间）
STARGAZE_START_HOUR = 18   # 当日 18:00 起
STARGAZE_END_HOUR = 5      # 次日 05:00 止（含）

# 海拔气温递减率（°C / 1000m）
LAPSE_RATE = 6.5


# ---------------------------------------------------------------------------
# 缓存 TTL（秒）
# ---------------------------------------------------------------------------
CACHE_TTL = {
    "now": 600,        # 10 分钟
    "forecast": 3600,  # 1 小时
    "hourly": 3600,    # 1 小时
    "multimodel": 3600,
    "stargazing": 3600,
    "astronomy": 86400,  # 1 天
    "historical": 604800,  # 7 天
    "analysis": 3600,
    "air_quality": 1800,  # 30 分钟
    "snow": 3600,         # ❄️ 赏雪单城预报 1 小时
    "board": 3600,        # ❄️ 赏雪看板 1 小时
}


# ---------------------------------------------------------------------------
# 天气系统识别阈值
# ---------------------------------------------------------------------------
TYPHOON_PRESSURE_THRESHOLD = 980.0   # 海平面气压低于此值视为强系统
TYPHOON_DROP_THRESHOLD = 10.0        # 24h 气压降幅超过此值视为快速增强/过境


def rating_for(score: float) -> tuple[str, str]:
    """根据评分返回 (中文评级, 英文等级)。"""
    for threshold, label, key in RATING_THRESHOLDS:
        if score >= threshold:
            return label, key
    return RATING_THRESHOLDS[-1][1], RATING_THRESHOLDS[-1][2]


# ---------------------------------------------------------------------------
# 两种模式：观星 / 赏雪 —— 城市分组与排序
# ---------------------------------------------------------------------------
# 赏雪模式监控的雪景城市分组（按地域组织，保序）
SNOW_CITY_GROUPS: list[dict] = [
    {"name": "东北雪乡", "icon": "❄️", "cities": ["harbin", "yabuli", "xuexiang", "mohe", "jilin", "changchun", "shenyang", "changbaishan"]},
    {"name": "华北京城", "icon": "🏯", "cities": ["beijing", "wutai"]},
    {"name": "辽东半岛", "icon": "🌊", "cities": ["dalian"]},
    {"name": "山东半岛", "icon": "🏖️", "cities": ["weihai", "yantai", "qingdao", "taishan"]},
    {"name": "华东高山", "icon": "⛰️", "cities": ["taizijian", "tianmushan", "xixi_zhexi", "anji", "moganshan", "huangshan_snow", "jiuhuashan_snow"]},
]

# 观星模式整合后的精选城市分组（简化：只保留观星相关，上海/华东靠前）
STARGAZE_CITY_GROUPS: list[dict] = [
    {"name": "华东·近沪", "icon": "🌌", "cities": ["shanghai", "anji", "moganshan", "taizijian", "huangshan"]},
    {"name": "高原暗夜", "icon": "🏔️", "cities": ["ali", "qinghaihu", "xining"]},
    {"name": "北方星空", "icon": "🌠", "cities": ["changbaishan", "wutai", "beijing"]},
    {"name": "名山大川", "icon": "⛰️", "cities": ["jiuhua", "lushan", "emei"]},
]

# 所有雪景城市 id（去重、保序）
def snow_city_ids() -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for g in SNOW_CITY_GROUPS:
        for cid in g["cities"]:
            if cid not in seen and cid in CITIES:
                seen.add(cid)
                out.append(cid)
    return out


def stargaze_city_ids() -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for g in STARGAZE_CITY_GROUPS:
        for cid in g["cities"]:
            if cid not in seen and cid in CITIES:
                seen.add(cid)
                out.append(cid)
    return out


def _haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """两地球面距离（km）。"""
    import math
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def distance_from_home(city: City) -> float:
    """城市到上海（用户所在地）的距离 km。"""
    return _haversine(HOME_CITY_LAT, HOME_CITY_LON, city.latitude, city.longitude)


def sort_cities_for_home(city_ids: list[str]) -> list[str]:
    """按离上海距离升序排列；上海本身排第一。"""
    def key(cid: str) -> float:
        c = CITIES.get(cid)
        if not c:
            return 1e9
        if cid == HOME_CITY_ID:
            return -1.0
        return distance_from_home(c)
    return sorted(city_ids, key=key)


def city_to_dict(c: City) -> dict:
    return {
        "id": c.id,
        "name": c.name,
        "latitude": c.latitude,
        "longitude": c.longitude,
        "elevation_m": c.elevation_m,
        "cma_station_id": c.cma_station_id,
        "desc": c.desc,
        "tags": c.tags,
        "distance_km": round(distance_from_home(c)),
    }


# ---------------------------------------------------------------------------
# 赏雪评分配置（0-100，5 维加权）
# ---------------------------------------------------------------------------
SNOW_WEIGHTS = {
    "temp": 0.34,          # 气温（低于 0℃ 越有利于雪）
    "precip": 0.26,        # 降水概率
    "snowfall": 0.22,      # 降雪量
    "humidity": 0.10,      # 湿度
    "elevation": 0.08,     # 海拔（高海拔更易积雪）
}

SNOW_RATING_THRESHOLDS = [
    (75, "🌨️ 极佳", "excellent"),
    (55, "❄️ 较大", "good"),
    (35, "🌬️ 可能", "moderate"),
    (0, "☀️ 较小", "poor"),
]


def snow_rating_for(score: float) -> tuple[str, str]:
    for threshold, label, key in SNOW_RATING_THRESHOLDS:
        if score >= threshold:
            return label, key
    return SNOW_RATING_THRESHOLDS[-1][1], SNOW_RATING_THRESHOLDS[-1][2]


# 赏雪看板：未来 N 天
SNOW_BOARD_DAYS = 7
