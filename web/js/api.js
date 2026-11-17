/* API 层（纯静态版）：与后端同名的 15 个方法，全部在浏览器内算完
 *
 * 数据源：Open-Meteo（支持 CORS，无需 Key）
 * 缓存：localStorage（见 om.js）
 * 与后端版差异：无 CMA 实况、无卫星云图、无服务端预热
 */
const API = (() => {
  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  const cityInfo = (c) => ({
    id: c.id,
    name: c.name,
    latitude: c.lat,
    longitude: c.lon,
    elevation_m: c.elev,
    desc: c.desc,
    tags: c.tags,
  });

  function envelope(city, data, sources, confidence = '中') {
    return {
      city: cityInfo(city),
      data,
      meta: {
        sources: sources || ['Open-Meteo'],
        updated_at: new Date().toLocaleString('zh-CN'),
        confidence,
        stale: false,
      },
    };
  }

  /* ===================== 城市清单 ===================== */
  function cities(mode = 'all') {
    const ids = mode === 'snow' ? snowCityIds()
      : mode === 'stargazing' ? stargazeCityIds()
        : Object.keys(CITIES);
    const ordered = sortCitiesForHome(ids);
    const list = ordered.map((cid) => cityToDict(CITIES[cid]));
    const groups = [{ name: '距上海由近及远', icon: '📍', cities: list }];
    const defaults = { snow: 'weihai', stargazing: 'anji' };
    return Promise.resolve({
      cities: list,
      groups,
      default: defaults[mode] || 'anji',
      mode,
      home_city: HOME.id,
    });
  }

  /* ===================== 单城雪况 ===================== */
  const SNOW_CACHE_TTL = 3600;

  async function buildCitySnow(cityId, days) {
    const city = CITIES[cityId];
    if (!city) return null;
    const key = `snowcity_${cityId}_${days}`;
    const cached = OM.cacheGet(key, SNOW_CACHE_TTL);
    if (cached) return cached;

    try {
      const fc = await OM.getForecast(city.lat, city.lon, city.elev, days);
      const hours = fc.hourly || [];
      const daily = (fc.daily || []).slice(0, days);
      const scored = daily.map((d) => SNOW_SCORING.scoringDay(d, hours, city.elev));
      let best = scored[0] || null;
      for (const s of scored) if (best && s.score > best.score) best = s;
      const result = {
        city: cityToDict(city),
        days: scored,
        best,
        generated_at: new Date().toISOString().slice(0, 19),
      };
      OM.cacheSet(key, result);
      return result;
    } catch (e) {
      return {
        city: cityToDict(city),
        days: [],
        best: null,
        error: String(e && e.message || e),
        generated_at: new Date().toISOString().slice(0, 19),
      };
    }
  }

  async function snowForecast(cityId, days = 15) {
    const raw = await buildCitySnow(cityId, days);
    const city = CITIES[cityId];
    if (!city) throw new Error('未知城市: ' + cityId);
    if (!raw) throw new Error('雪况预报失败');
    return envelope(city, raw, ['Open-Meteo']);
  }

  /* ===================== 单城观星（逐日） ===================== */
  async function buildCityStar(cityId, days) {
    const city = CITIES[cityId];
    if (!city) return null;
    const key = `starcity_${cityId}_${days}`;
    const cached = OM.cacheGet(key, SNOW_CACHE_TTL);
    if (cached) return cached;

    try {
      const fc = await OM.getForecast(city.lat, city.lon, city.elev, Math.min(16, days + 1));
      const aq = await OM.getAqi(city.lat, city.lon);
      const lp = LP.getLightPollution(city.lat, city.lon, city.elev);

      const out = [];
      for (const d of (fc.daily || []).slice(0, days)) {
        const ds = String(d.time || '').slice(0, 10);
        if (!ds) continue;
        const night = STAR_SCORING.buildNight(city.lat, city.lon, city.elev, ds, fc, aq.aqi, lp);
        const nightHours = (night.hours || []).filter((h) => !h.is_daytime);
        const clouds = nightHours.map((h) => h.cloud_cover).filter((v) => v != null);
        const cloudAvg = clouds.length ? Math.round(clouds.reduce((a, b) => a + b, 0) / clouds.length) : null;
        const phase = d.moon_phase;
        const [rating, level] = STAR_SCORING.ratingFor(night.best_score || 0);
        out.push({
          date: ds,
          score: night.best_score || 0,
          rating,
          level,
          best_window_start: night.best_window_start,
          best_window_end: night.best_window_end,
          best_window_avg: night.best_window_avg,
          best_window_duration: night.best_window_duration,
          cloud_cover: cloudAvg,
          weather_code: d.weather_code,
          temp_max: d.temperature_2m_max != null ? Math.round(d.temperature_2m_max * 10) / 10 : null,
          temp_min: d.temperature_2m_min != null ? Math.round(d.temperature_2m_min * 10) / 10 : null,
          moon_illumination: OM.moonIlluminationFromPhase(phase),
          moon_phase: phase,
          moon_phase_name: OM.moonPhaseName(phase),
          summary: night.summary,
          recommendation: night.recommendation,
          stats: night.stats,
          sunset: night.sunset,
          sunrise: night.sunrise,
        });
      }
      let best = out[0] || null;
      for (const x of out) if (best && x.score > best.score) best = x;
      const result = {
        city: cityToDict(city),
        days: out,
        best,
        generated_at: new Date().toISOString().slice(0, 19),
      };
      OM.cacheSet(key, result);
      return result;
    } catch (e) {
      return {
        city: cityToDict(city),
        days: [],
        best: null,
        error: String(e && e.message || e),
        generated_at: new Date().toISOString().slice(0, 19),
      };
    }
  }

  async function stargazingForecast(cityId, days = 15) {
    const raw = await buildCityStar(cityId, days);
    const city = CITIES[cityId];
    if (!city) throw new Error('未知城市: ' + cityId);
    if (!raw) throw new Error('观星预报失败');
    return envelope(city, raw, ['Open-Meteo']);
  }

  /* ===================== 赏雪看板 ===================== */
  function prevIds(key) {
    try {
      const o = JSON.parse(localStorage.getItem('ss_static_prev_' + key) || 'null');
      return new Set((o && o.ids) || []);
    } catch (e) { return new Set(); }
  }
  function savePrevIds(key, recs) {
    try {
      localStorage.setItem('ss_static_prev_' + key,
        JSON.stringify({ ts: Date.now(), ids: recs.slice(0, 8).map((r) => r.id) }));
    } catch (e) { /* ignore */ }
  }

  async function snowBoard(days = 7) {
    const ids = snowCityIds();
    const results = await OM.mapLimit(ids, 5, (cid) => buildCitySnow(cid, days));
    const byId = {};
    for (const r of results) if (r && r.city) byId[r.city.id] = r;

    // 分组（按距上海由近及远）
    const citiesOut = [];
    for (const cid of sortCitiesForHome(ids)) {
      const r = byId[cid];
      if (!r) continue;
      citiesOut.push({
        id: cid,
        name: r.city.name,
        distance_km: r.city.distance_km,
        tags: r.city.tags || [],
        days: r.days || [],
        best: r.best,
      });
    }
    const groups = [{ name: '距上海由近及远', icon: '📍', cities: citiesOut }];

    // 每日播报
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const byDay = [];
    for (let i = 0; i < days; i++) {
      const dt = new Date(today.getTime() + i * 86400000);
      const ds = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
      const label = i === 0 ? '今天' : (i === 1 ? '明天' : ds.slice(5));
      const entries = [];
      for (const cid of ids) {
        const r = byId[cid];
        if (!r) continue;
        for (const dd of (r.days || [])) {
          if (dd.date === ds && dd.snow_probability >= 25) {
            entries.push({
              id: cid, name: r.city.name,
              prob: dd.snow_probability, score: dd.score, level: dd.level,
              snowfall_cm: dd.snowfall_cm, temp_min: dd.temp_min,
              distance_km: r.city.distance_km,
            });
            break;
          }
        }
      }
      entries.sort((a, b) => (b.prob - a.prob) || (b.score - a.score));
      byDay.push({ date: ds, label, cities: entries });
    }

    // 绝对雪量榜
    const allBest = [];
    for (const cid of ids) {
      const r = byId[cid];
      if (!r || !r.best) continue;
      if (r.best.snow_probability >= 25) {
        allBest.push({
          id: cid, name: r.city.name,
          distance_km: r.city.distance_km,
          ...r.best,
        });
      }
    }
    allBest.sort((a, b) => (b.score - a.score) || (b.snow_probability - a.snow_probability));

    const recs = SNOW_SCORING.buildRecommendations(byId, ids, prevIds('snow'));
    savePrevIds('snow', recs);

    const activeCities = allBest.length;
    const totalEvents = byDay.reduce((s, d) => s + d.cities.length, 0);
    let summary;
    if (recs.length) {
      const top = recs[0];
      summary = `未来 ${days} 天，全国 ${activeCities} 座雪景城市有降雪机会，`
        + `共 ${totalEvents} 个城市·日；今日推荐：${top.name}`
        + `（${top.reason}，降雪概率 ${top.prob}%）`;
    } else if (activeCities) {
      const top = allBest[0];
      summary = `未来 ${days} 天，全国 ${activeCities} 座雪景城市有降雪机会，共 ${totalEvents} 个城市·日；当前最佳：${top.name}（${top.rating}，概率 ${top.snow_probability}%）`;
    } else {
      summary = `未来 ${days} 天，监控的雪景城市暂无明显降雪信号。`;
    }

    return {
      data: {
        generated_at: new Date().toISOString().slice(0, 19),
        days,
        total_cities: ids.length,
        active_cities: activeCities,
        total_events: totalEvents,
        summary,
        recommendations: recs,
        highlights: allBest.slice(0, 8),
        by_day: byDay,
        groups,
      },
      meta: { sources: ['Open-Meteo'], confidence: '中' },
    };
  }

  /* ===================== 观星看板 ===================== */
  async function stargazingBoard(days = 7) {
    const ids = stargazeCityIds();
    const results = await OM.mapLimit(ids, 4, (cid) => buildCityStar(cid, days));
    const byId = {};
    for (const r of results) if (r && r.city) byId[r.city.id] = r;

    const citiesOut = [];
    for (const cid of sortCitiesForHome(ids)) {
      const r = byId[cid];
      if (!r) continue;
      citiesOut.push({
        id: cid,
        name: r.city.name,
        distance_km: r.city.distance_km,
        tags: r.city.tags || [],
        days: r.days || [],
        best: r.best,
      });
    }
    const groups = [{ name: '距上海由近及远', icon: '📍', cities: citiesOut }];

    const allBest = [];
    for (const cid of ids) {
      const r = byId[cid];
      if (!r || !r.best) continue;
      allBest.push({
        id: cid, name: r.city.name,
        distance_km: r.city.distance_km,
        ...r.best,
      });
    }
    allBest.sort((a, b) => (b.score || 0) - (a.score || 0));

    const recs = STAR_SCORING.buildRecommendations(byId, ids, prevIds('star'));
    savePrevIds('star', recs);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const byDay = [];
    for (let i = 0; i < days; i++) {
      const dt = new Date(today.getTime() + i * 86400000);
      const ds = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
      const label = i === 0 ? '今天' : (i === 1 ? '明天' : ds.slice(5));
      const entries = [];
      for (const cid of ids) {
        const r = byId[cid];
        if (!r) continue;
        for (const dd of (r.days || [])) {
          if (dd.date === ds && (dd.score || 0) >= 55) {
            entries.push({
              id: cid, name: r.city.name,
              score: Math.round(dd.score || 0), level: dd.level,
              cloud_cover: dd.cloud_cover,
              distance_km: r.city.distance_km,
            });
            break;
          }
        }
      }
      entries.sort((a, b) => b.score - a.score);
      byDay.push({ date: ds, label, cities: entries });
    }

    const activeCities = allBest.filter((c) => (c.score || 0) >= 55).length;
    const totalEvents = byDay.reduce((s, d) => s + d.cities.length, 0);
    let summary;
    if (recs.length) {
      const top = recs[0];
      summary = `未来 ${days} 天，全国 ${activeCities} 座观星地有上佳晴夜，`
        + `共 ${totalEvents} 个城市·夜；今日推荐：${top.name}`
        + `（${top.reason}，观星分 ${top.score}）`;
    } else if (activeCities) {
      summary = `未来 ${days} 天，全国 ${activeCities} 座观星地有上佳晴夜；当前最佳：${allBest[0].name}（观星分 ${Math.round(allBest[0].score || 0)}）`;
    } else {
      summary = `未来 ${days} 天，监控的观星地暂无明显晴夜信号。`;
    }

    return {
      data: {
        generated_at: new Date().toISOString().slice(0, 19),
        days,
        total_cities: ids.length,
        active_cities: activeCities,
        total_events: totalEvents,
        summary,
        recommendations: recs,
        highlights: allBest.slice(0, 8),
        by_day: byDay,
        groups,
      },
      meta: { sources: ['Open-Meteo'], confidence: '中' },
    };
  }

  /* ===================== 常驻城市聚合 ===================== */
  async function pinnedSummary(ids, days = 7, mode = 'snow') {
    const cityIds = String(ids).split(',').map((s) => s.trim()).filter(Boolean).slice(0, 10);
    if (!cityIds.length) throw new Error('ids 不能为空');

    const items = await OM.mapLimit(cityIds, 4, async (cid) => {
      const city = CITIES[cid];
      if (!city) return null;
      const dist = Math.round(distanceFromHome(city) * 10) / 10;
      try {
        if (mode === 'snow') {
          const raw = await buildCitySnow(cid, days);
          return {
            id: cid, name: city.name, distance_km: dist,
            days: (raw.days || []).map((x) => ({
              date: x.date, value: x.snow_probability, score: x.score,
              rating: x.rating, level: x.level,
              snowfall_cm: x.snowfall_cm,
              temp_min: x.temp_min, temp_max: x.temp_max,
              precip_probability: x.precip_probability,
            })),
            best: raw.best,
          };
        }
        const raw = await buildCityStar(cid, days);
        return {
          id: cid, name: city.name, distance_km: dist,
          days: (raw.days || []).map((x) => ({
            date: x.date, value: x.score, score: x.score,
            rating: x.rating, level: x.level,
            cloud_cover: x.cloud_cover,
            moon_illumination: x.moon_illumination,
            best_window_start: x.best_window_start,
            best_window_end: x.best_window_end,
          })),
          best: raw.best,
        };
      } catch (e) {
        return { id: cid, name: city.name, distance_km: dist, days: [], best: null };
      }
    });

    return {
      data: {
        items: items.filter(Boolean),
        days,
        mode,
        generated_at: new Date().toISOString().slice(0, 19),
      },
      meta: { sources: ['Open-Meteo'], confidence: '中' },
    };
  }

  /* ===================== 热点事件 ===================== */
  function events(mode = 'stargazing') {
    const items = EVENTS.getEvents(mode, 60);
    return Promise.resolve({
      data: { mode, items, generated_at: new Date().toISOString().slice(0, 19) },
      meta: { sources: ['内置事件库'], confidence: '参考' },
    });
  }

  /* ===================== 实况 ===================== */
  async function now(date) {
    const cityId = API.cityId;
    const city = CITIES[cityId] || CITIES.anji;
    const target = date || todayStr();
    try {
      const fc = await OM.getForecast(city.lat, city.lon, city.elev, 2);
      const hourly = fc.hourly || [];
      const today = todayStr();
      let point = null;
      if (target === today) {
        const nowHour = new Date().getHours();
        let bestDiff = 99;
        for (const p of hourly) {
          if (!String(p.time).startsWith(target)) continue;
          const h = parseInt(String(p.time).slice(11, 13), 10);
          const d = Math.abs(h - nowHour);
          if (d < bestDiff) { bestDiff = d; point = p; }
        }
      } else {
        point = hourly.find((p) => String(p.time).startsWith(target)) || null;
      }
      if (!point) point = hourly[0] || {};

      const dirs = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
      const deg = point.wind_direction_10m;
      const dirText = deg != null ? dirs[Math.round(deg / 45) % 8] + '风' : '';

      return envelope(city, {
        mode: target > today ? 'forecast' : 'realtime',
        temperature: point.temperature_2m,
        feels_like: point.apparent_temperature,
        pressure: point.surface_pressure,
        humidity: point.relative_humidity_2m,
        wind_direction: dirText,
        wind_direction_degree: deg,
        wind_speed: point.wind_speed_10m != null ? Math.round(point.wind_speed_10m / 3.6 * 10) / 10 : null,
        wind_scale: '',
        precipitation: point.precipitation,
        alarms: [],
        last_update: point.time || '',
      }, ['Open-Meteo'], '中');
    } catch (e) {
      throw new Error('实况获取失败: ' + (e && e.message || e));
    }
  }

  /* ===================== 7 天预报 ===================== */
  const WMO_TEXT = {
    0: '晴', 1: '晴间多云', 2: '多云', 3: '阴',
    45: '雾', 48: '雾凇', 51: '毛毛雨', 53: '小雨', 55: '中雨',
    56: '冻雨', 57: '冻雨', 61: '小雨', 63: '中雨', 65: '大雨',
    66: '冻雨', 67: '冻雨', 71: '小雪', 73: '中雪', 75: '大雪', 77: '雪粒',
    80: '阵雨', 81: '强阵雨', 82: '暴雨', 85: '阵雪', 86: '强阵雪',
    95: '雷阵雨', 96: '雷阵雨伴冰雹', 99: '强雷暴',
  };
  const codeToText = (c) => WMO_TEXT[Number(c)] || '—';

  async function forecast() {
    const city = CITIES[API.cityId] || CITIES.anji;
    const fc = await OM.getForecast(city.lat, city.lon, city.elev, 16);
    const days = (fc.daily || []).slice(0, 7).map((d) => ({
      date: String(d.time).slice(0, 10),
      high: d.temperature_2m_max,
      low: d.temperature_2m_min,
      day_text: codeToText(d.weather_code),
      night_text: codeToText(d.weather_code),
      precipitation: d.precipitation_sum,
      cloud_cover: d.cloud_cover_mean,
    }));
    return envelope(city, days, ['Open-Meteo'], '中');
  }

  /* ===================== 逐小时 ===================== */
  async function hourly(date) {
    const city = CITIES[API.cityId] || CITIES.anji;
    const target = date || todayStr();
    const fc = await OM.getForecast(city.lat, city.lon, city.elev, 16);
    const pts = (fc.hourly || [])
      .filter((p) => String(p.time).startsWith(target))
      .slice(0, 24)
      .map((p) => ({
        time: p.time,
        temperature: p.temperature_2m,
        humidity: p.relative_humidity_2m,
        pressure: p.surface_pressure,
        precipitation: p.precipitation,
        cloud_cover: p.cloud_cover,
        wind_speed: p.wind_speed_10m,
        wind_direction: p.wind_direction_10m,
        wind_gusts: p.wind_gusts_10m,
        visibility: p.visibility,
        dew_point: p.dew_point_2m,
        weather_code: p.weather_code,
        text: codeToText(p.weather_code),
        source: 'Open-Meteo',
      }));
    return envelope(city, pts, ['Open-Meteo'], '中');
  }

  /* ===================== 单夜观星（详细） ===================== */
  async function stargazing(date) {
    const city = CITIES[API.cityId] || CITIES.anji;
    const target = date || todayStr();
    const [fc, aq] = await Promise.all([
      OM.getForecast(city.lat, city.lon, city.elev, 16),
      OM.getAqi(city.lat, city.lon),
    ]);
    const lp = LP.getLightPollution(city.lat, city.lon, city.elev);
    const night = STAR_SCORING.buildNight(city.lat, city.lon, city.elev, target, fc, aq.aqi, lp);
    const [rating] = STAR_SCORING.ratingFor(night.best_score || 0);
    night.best_rating = rating;
    return envelope(city, night, ['Open-Meteo'], '中');
  }

  /* ===================== 天文 ===================== */
  async function astronomy(date) {
    const city = CITIES[API.cityId] || CITIES.anji;
    const target = date || todayStr();
    const fc = await OM.getForecast(city.lat, city.lon, city.elev, 16);
    const d = (fc.daily || []).find((x) => String(x.time).slice(0, 10) === target) || (fc.daily || [])[0] || {};
    const phase = d.moon_phase;
    return envelope(city, {
      date: String(d.time || target).slice(0, 10),
      sunrise: d.sunrise || null,
      sunset: d.sunset || null,
      moonrise: d.moonrise || null,
      moonset: d.moonset || null,
      moon_phase: phase != null ? phase : null,
      moon_illumination: OM.moonIlluminationFromPhase(phase),
      moon_phase_name: OM.moonPhaseName(phase),
    }, ['Open-Meteo'], '中');
  }

  /* ===================== 空气质量 ===================== */
  async function airQuality(date) {
    const city = CITIES[API.cityId] || CITIES.anji;
    const aq = await OM.getAqi(city.lat, city.lon);
    const lp = LP.getLightPollution(city.lat, city.lon, city.elev);
    return envelope(city, {
      mode: 'realtime',
      target_date: date || todayStr(),
      current: { aqi: aq.aqi, pm2_5: aq.pm2_5, pm10: aq.pm10 },
      hourly: { time: [], aqi: [], pm2_5: [], pm10: [] },
      light_pollution: lp,
      _note: '光污染数据来源：本地数据库',
    }, ['Open-Meteo-AirQuality'], '中');
  }

  /* ===================== 多模型集成 ===================== */
  function aggHourly(points, key) {
    const vals = points.map((p) => p[key]).filter((v) => v != null);
    if (!vals.length) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  }

  async function multimodel(date) {
    const city = CITIES[API.cityId] || CITIES.anji;
    const target = date || todayStr();
    const [ec, gfs] = await Promise.all([
      OM.getModelHourly('ecmwf', city.lat, city.lon, city.elev, target, target),
      OM.getModelHourly('gfs', city.lat, city.lon, city.elev, target, target),
    ]);
    const summarize = (pts) => {
      const t = aggHourly(pts, 'temperature_2m');
      if (t == null) return null;
      const shift = 3.0;
      return {
        high: Math.round((t + shift) * 10) / 10,
        low: Math.round((t - shift) * 10) / 10,
        precipitation: Math.round((aggHourly(pts, 'precipitation') || 0) * 10) / 10,
        cloud_cover: Math.round(aggHourly(pts, 'cloud_cover') || 0),
        wind_speed_max: Math.round(aggHourly(pts, 'wind_speed_10m') || 0),
      };
    };
    const e = summarize(ec), g = summarize(gfs);
    const ensemble = (e && g) ? {
      high: Math.round(((e.high + g.high) / 2) * 10) / 10,
      low: Math.round(((e.low + g.low) / 2) * 10) / 10,
    } : (e || g);
    const divergence = {};
    if (e && g) {
      divergence['最高温'] = `ECMWF ${e.high}° / GFS ${g.high}°`;
      divergence['最低温'] = `ECMWF ${e.low}° / GFS ${g.low}°`;
      divergence['云量'] = `ECMWF ${e.cloud_cover}% / GFS ${g.cloud_cover}%`;
    }
    return envelope(city, { date: target, ecmwf: e, gfs: g, ensemble, divergence },
      ['ECMWF', 'GFS'], '中');
  }

  /* ===================== 历史同期 ===================== */
  async function historical(date) {
    const city = CITIES[API.cityId] || CITIES.anji;
    const d = date || todayStr();
    const md = d.slice(5);
    const year = parseInt(d.slice(0, 4), 10) || new Date().getFullYear();
    const years = [];
    for (const y of [year - 3, year - 2, year - 1]) {
      try {
        const pts = await OM.getArchive(city.lat, city.lon, `${y}-${md}`, `${y}-${md}`);
        const p = pts[0] || {};
        years.push({
          year: y,
          high: p.temperature_2m_max,
          low: p.temperature_2m_min,
          precipitation: p.precipitation_sum,
          cloud_cover_mean: p.cloud_cover_mean,
          wind_speed_max: p.wind_speed_10m_max,
        });
      } catch (e) { /* 单年失败忽略 */ }
    }
    return envelope(city, { month_day: md, years }, ['Open-Meteo-Archive'], '中');
  }

  /* ===================== 天气系统分析 ===================== */
  async function analysis(date) {
    const city = CITIES[API.cityId] || CITIES.anji;
    const target = date || todayStr();
    const fc = await OM.getForecast(city.lat, city.lon, city.elev, 8);
    const daily = fc.daily || [];
    const series = daily.slice(0, 7).map((d) => ({
      date: String(d.time).slice(0, 10),
      pressure: null,
      wind_speed: d.wind_speed_10m_max,
      gust: d.wind_speed_10m_max,
    }));
    // 用逐小时气压估算每日最低气压
    const hourly = fc.hourly || [];
    for (const row of series) {
      const pts = hourly.filter((p) => String(p.time).startsWith(row.date));
      const ps = pts.map((p) => p.pressure_msl).filter((v) => v != null);
      row.pressure = ps.length ? Math.min(...ps) : null;
    }
    let minP = null, minPDate = null;
    for (const row of series) {
      if (row.pressure != null && (minP == null || row.pressure < minP)) {
        minP = row.pressure; minPDate = row.date;
      }
    }
    let peakGust = null;
    for (const row of series) {
      if (row.gust != null && (peakGust == null || row.gust > peakGust)) peakGust = row.gust;
    }
    const targetRow = series.find((r) => r.date === target);
    const systemDetected = (minP != null && minP < 1000) || (peakGust != null && peakGust > 60);
    const type = !systemDetected ? '正常'
      : (minP != null && minP < 990 ? '强低压系统' : '低压扰动');
    const conclusion = systemDetected
      ? `未来 7 天检测到${type}，最低气压 ${minP != null ? Math.round(minP) : '—'} hPa（${minPDate || '—'}），峰值阵风 ${peakGust != null ? Math.round(peakGust) : '—'} km/h。`
      : '未来 7 天气压平稳，无强天气系统影响。';
    return envelope(city, {
      date: target,
      pressure_series: series,
      min_pressure: minP,
      min_pressure_date: minPDate,
      system_detected: systemDetected,
      system_type: type,
      peak_gust: peakGust,
      target_gust: targetRow ? targetRow.gust : null,
      influence_ended: true,
      conclusion,
    }, ['Open-Meteo'], '中');
  }

  return {
    cityId: 'anji',
    custom: null,
    date: todayStr(),
    cities, now, forecast, hourly, multimodel, stargazing, astronomy,
    airQuality, historical, analysis,
    snowBoard, stargazingBoard, snowForecast, stargazingForecast,
    pinnedSummary, events,
  };
})();
