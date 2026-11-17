# -*- coding: utf-8 -*-
"""从 app/config.py 生成 web/js/cities.js（城市清单 + 分组 + 距离工具）。"""
import json
import io
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app import config as c  # noqa: E402


def js_num(v):
    return "null" if v is None else repr(v)


cities = {}
for k, v in c.CITIES.items():
    cities[k] = {
        "id": v.id,
        "name": v.name,
        "lat": v.latitude,
        "lon": v.longitude,
        "elev": v.elevation_m,
        "desc": v.desc,
        "tags": v.tags,
    }

out = io.StringIO()
out.write("/* 城市清单（由 app/config.py 生成，勿手改）*/\n")
out.write("const HOME = { id: '%s', lat: %r, lon: %r };\n\n" % (
    c.HOME_CITY_ID, c.HOME_CITY_LAT, c.HOME_CITY_LON))
out.write("const CITIES = ")
out.write(json.dumps(cities, ensure_ascii=False, indent=0).replace("\n", ""))
out.write(";\n\n")
out.write("const STARGAZE_CITY_GROUPS = ")
out.write(json.dumps(c.STARGAZE_CITY_GROUPS, ensure_ascii=False))
out.write(";\n\n")
out.write("const SNOW_CITY_GROUPS = ")
out.write(json.dumps(c.SNOW_CITY_GROUPS, ensure_ascii=False))
out.write(";\n\n")
out.write("""/* ---- 距离 / 排序 / 去重（与 Python 版口径一致） ---- */
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371.0, rad = Math.PI / 180;
  const p1 = lat1 * rad, p2 = lat2 * rad;
  const dp = (lat2 - lat1) * rad, dl = (lon2 - lon1) * rad;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function distanceFromHome(city) {
  return haversine(HOME.lat, HOME.lon, city.lat, city.lon);
}

function cityToDict(city) {
  return {
    id: city.id,
    name: city.name,
    latitude: city.lat,
    longitude: city.lon,
    elevation_m: city.elev,
    desc: city.desc,
    tags: city.tags,
    distance_km: Math.round(distanceFromHome(city)),
  };
}

function sortCitiesForHome(ids) {
  return ids.slice().sort((a, b) => {
    if (a === HOME.id) return -1;
    if (b === HOME.id) return 1;
    const ca = CITIES[a], cb = CITIES[b];
    if (!ca) return 1;
    if (!cb) return -1;
    return distanceFromHome(ca) - distanceFromHome(cb);
  });
}

function _groupIds(groups) {
  const seen = new Set(), out = [];
  for (const g of groups) {
    for (const cid of g.cities) {
      if (!seen.has(cid) && CITIES[cid]) { seen.add(cid); out.push(cid); }
    }
  }
  return out;
}

const snowCityIds = () => _groupIds(SNOW_CITY_GROUPS);
const stargazeCityIds = () => _groupIds(STARGAZE_CITY_GROUPS);
""")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
with io.open(os.path.join(ROOT, "web", "js", "cities.js"), "w", encoding="utf-8") as f:
    f.write(out.getvalue())

print("web/js/cities.js written; cities=%d stargaze=%d snow=%d"
      % (len(cities), len(c.stargaze_city_ids()), len(c.snow_city_ids())))
