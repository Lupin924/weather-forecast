# -*- coding: utf-8 -*-
"""生成 web/js/lp.js（光污染 Bortle 数据库 + 插值，搬自 app/services/light_pollution.py）"""
import io
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app.services import light_pollution as lp  # noqa: E402

rows = "\n".join(
    "  [%r, %r, %d, %r]," % (a, b, c, d) for a, b, c, d in lp._LIGHT_POLLUTION_DB
)

scale = []
for k in sorted(lp.BORTLE_SCALE):
    r = lp.BORTLE_SCALE[k]
    scale.append(
        "  %d: { bortle: %d, label: %r, sqm: %r, sqm_range: %r, score: %r, milky_way: %r },"
        % (k, r.bortle, r.label, r.sqm, r.sqm_range, r.score, r.milky_way)
    )
scale_js = "\n".join(scale)

js = """/* 光污染（Bortle）本地数据库 + 反距离加权插值
 * 搬自 app/services/light_pollution.py，无需网络请求
 */
const LP = (() => {
  const DB = [
%s
  ];

  const SCALE = {
%s
  };

  function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371.0, rad = Math.PI / 180;
    const p1 = lat1 * rad, p2 = lat2 * rad;
    const dp = (lat2 - lat1) * rad, dl = (lon2 - lon1) * rad;
    const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  function idw(points) {
    let tw = 0, tv = 0;
    for (const p of points) {
      const d = Math.max(1.0, p.dist);
      const w = 1.0 / (d * d);
      tw += w; tv += p.bortle * w;
    }
    if (!tw) return 5;
    return Math.max(1, Math.min(9, Math.round(tv / tw)));
  }

  function getLightPollution(lat, lon, elevation = 0) {
    const dists = DB.map((row) => ({
      dist: haversineKm(lat, lon, row[0], row[1]),
      bortle: row[2],
      name: row[3],
    })).sort((a, b) => a.dist - b.dist);

    const nearest = dists[0];
    let bortle, method;
    if (nearest.dist < 5.0) {
      bortle = nearest.bortle;
      method = `精确匹配（${nearest.name}，${nearest.dist.toFixed(1)}km）`;
    } else {
      bortle = idw(dists.slice(0, 5));
      method = `插值估算（最近点：${nearest.name}，${Math.round(nearest.dist)}km）`;
    }

    if (elevation > 500) {
      const adj = Math.min(2.0, ((elevation - 500) / 1000) * 0.5);
      const nb = Math.max(1, Math.round(bortle - adj));
      if (nb < bortle) {
        method += `，海拔修正（${elevation}m → -${(bortle - nb).toFixed(1)}级）`;
        bortle = nb;
      }
    }
    bortle = Math.max(1, Math.min(9, bortle));
    const ref = SCALE[bortle] || SCALE[5];
    return {
      bortle,
      label: ref.label,
      sqm: ref.sqm,
      sqm_range: ref.sqm_range,
      score: ref.score,
      milky_way: ref.milky_way,
      method,
      nearest: nearest.name,
      distance_km: Math.round(nearest.dist * 10) / 10,
    };
  }

  function bortleToScore(bortle) {
    const ref = SCALE[bortle] || SCALE[5];
    return ref.score;
  }

  return { getLightPollution, bortleToScore, SCALE };
})();
""" % (rows, scale_js)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
with io.open(os.path.join(ROOT, "web", "js", "lp.js"), "w", encoding="utf-8") as f:
    f.write(js)
print("web/js/lp.js written")
