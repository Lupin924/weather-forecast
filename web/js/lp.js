/* 光污染（Bortle）本地数据库 + 反距离加权插值
 * 搬自 app/services/light_pollution.py，无需网络请求
 */
const LP = (() => {
  const DB = [
  [31.23, 121.47, 9, '上海'],
  [39.9, 116.4, 9, '北京'],
  [22.53, 114.13, 9, '深圳'],
  [23.12, 113.27, 9, '广州'],
  [29.56, 106.55, 8, '重庆'],
  [30.57, 104.07, 8, '成都'],
  [30.27, 120.15, 7, '杭州'],
  [32.06, 118.8, 7, '南京'],
  [28.23, 112.93, 7, '长沙'],
  [34.26, 108.94, 7, '西安'],
  [30.59, 114.3, 7, '武汉'],
  [36.07, 120.38, 7, '青岛'],
  [38.91, 121.6, 7, '大连'],
  [36.65, 117.0, 7, '济南'],
  [45.8, 126.53, 7, '哈尔滨'],
  [43.88, 125.32, 7, '长春'],
  [41.8, 123.43, 7, '沈阳'],
  [34.75, 113.65, 7, '郑州'],
  [24.47, 118.09, 7, '厦门'],
  [18.25, 109.51, 6, '三亚'],
  [20.02, 110.35, 6, '海口'],
  [25.04, 102.68, 6, '昆明'],
  [26.65, 106.63, 6, '贵阳'],
  [22.81, 108.37, 6, '南宁'],
  [36.06, 103.83, 6, '兰州'],
  [38.46, 106.27, 6, '银川'],
  [43.82, 87.62, 6, '乌鲁木齐'],
  [31.86, 117.28, 7, '合肥'],
  [26.07, 119.3, 6, '福州'],
  [25.27, 110.29, 5, '桂林'],
  [29.32, 110.44, 5, '张家界'],
  [33.26, 103.92, 5, '九寨沟'],
  [36.62, 101.78, 4, '西宁'],
  [36.9, 100.2, 3, '青海湖'],
  [40.14, 94.66, 3, '敦煌'],
  [32.32, 80.1, 1, '阿里天文台'],
  [29.71, 91.13, 2, '拉萨'],
  [42.02, 128.08, 3, '长白山'],
  [30.45, 119.68, 4, '安吉天荒坪'],
  [30.6, 119.9, 4, '莫干山'],
  [30.13, 118.16, 4, '黄山'],
  [36.25, 117.1, 4, '泰山'],
  [34.48, 110.09, 3, '华山'],
  [29.54, 103.48, 3, '峨眉山'],
  [39.04, 113.56, 3, '五台山'],
  [30.1, 117.81, 4, '九华山'],
  [30.0, 122.4, 4, '普陀山'],
  [29.54, 115.98, 4, '庐山'],
  [26.87, 100.23, 4, '丽江'],
  [25.6, 100.27, 3, '大理'],
  [27.83, 99.71, 2, '香格里拉'],
  [31.3, 120.62, 6, '苏州'],
  [31.49, 120.31, 6, '无锡'],
  [32.39, 119.43, 6, '扬州'],
  ];

  const SCALE = {
  1: { bortle: 1, label: '优秀暗空', sqm: 21.8, sqm_range: '≥21.3', score: 100.0, milky_way: '银河结构清晰可见，M31/M33轻易可见' },
  2: { bortle: 2, label: '真正暗空', sqm: 21.2, sqm_range: '21.0-21.3', score: 92.0, milky_way: '银河清晰可见，有结构感' },
  3: { bortle: 3, label: '乡村天空', sqm: 20.8, sqm_range: '20.6-21.0', score: 82.0, milky_way: '银河可见但细节减少' },
  4: { bortle: 4, label: '乡村/郊区', sqm: 20.4, sqm_range: '20.2-20.6', score: 68.0, milky_way: '银河勉强可见' },
  5: { bortle: 5, label: '郊区天空', sqm: 19.9, sqm_range: '19.6-20.2', score: 52.0, milky_way: '银河地平线附近不可见' },
  6: { bortle: 6, label: '明亮郊区', sqm: 19.0, sqm_range: '18.5-19.6', score: 35.0, milky_way: '银河不可见' },
  7: { bortle: 7, label: '郊区/城市', sqm: 18.2, sqm_range: '18.0-18.5', score: 20.0, milky_way: '银河完全不可见' },
  8: { bortle: 8, label: '城市天空', sqm: 17.5, sqm_range: '17.0-18.0', score: 8.0, milky_way: '仅可见少数亮星' },
  9: { bortle: 9, label: '市中心', sqm: 16.5, sqm_range: '<17.0', score: 0.0, milky_way: '仅可见极少数亮星' },
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
