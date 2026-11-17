/* 浏览器端数据层：Open-Meteo 直连 + localStorage 缓存
 *
 * 与后端版差异（纯静态部署的限制）：
 * - 无 CMA、无卫星云图、无服务端代理（Open-Meteo 支持 CORS，可直连）
 * - 缓存落在 localStorage（带 TTL），并发请求自动去重
 */
const OM = (() => {
  const BASE = 'https://api.open-meteo.com/v1/forecast';
  const AIR = 'https://air-quality-api.open-meteo.com/v1/air-quality';
  const ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive';

  // 逐小时变量（与后端 HOURLY_VARS 对齐）
  const HOURLY_VARS = [
    'temperature_2m', 'relative_humidity_2m', 'dew_point_2m', 'apparent_temperature',
    'precipitation', 'weather_code', 'surface_pressure', 'pressure_msl',
    'cloud_cover', 'cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high',
    'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m', 'visibility',
    'cape', 'lifted_index', 'precipitation_probability', 'snowfall', 'rain',
  ];
  const DAILY_VARS = [
    'weather_code', 'temperature_2m_max', 'temperature_2m_min', 'precipitation_sum',
    'cloud_cover_mean', 'wind_speed_10m_max', 'sunrise', 'sunset',
    'moonrise', 'moonset', 'moon_phase',
    'precipitation_probability_max', 'snowfall_sum',
  ];

  /* ---------------- 缓存（localStorage + 内存） ---------------- */
  const PREFIX = 'ss_static_v1_';
  const mem = new Map();
  const inflight = new Map();

  function cacheGet(key, ttlSec) {
    if (mem.has(key)) return mem.get(key);
    try {
      const raw = localStorage.getItem(PREFIX + key);
      if (!raw) return null;
      const o = JSON.parse(raw);
      if (!o || !o.ts) return null;
      if (Date.now() - o.ts > ttlSec * 1000) return null;
      mem.set(key, o.data);
      return o.data;
    } catch (e) { return null; }
  }

  function cacheGetStale(key) {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      if (!raw) return null;
      const o = JSON.parse(raw);
      return o && o.ts ? o.data : null;
    } catch (e) { return null; }
  }

  function cacheSet(key, data) {
    mem.set(key, data);
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify({ ts: Date.now(), data }));
    } catch (e) {
      /* 容量超限：清掉本应用最旧的一批键后放弃写入 */
      try {
        const keys = Object.keys(localStorage).filter((k) => k.startsWith(PREFIX));
        keys.sort();
        keys.slice(0, Math.max(1, Math.floor(keys.length / 3)))
          .forEach((k) => localStorage.removeItem(k));
      } catch (e2) { /* ignore */ }
    }
  }

  let lastError = null;
  const getLastError = () => lastError;

  /* ---------------- 请求（带重试 + 去重） ---------------- */
  async function getJSON(url, retries = 2) {
    let err = null;
    for (let i = 0; i < retries; i++) {
      try {
        const r = await fetch(url);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        lastError = null;
        return await r.json();
      } catch (e) {
        err = e;
        if (i < retries - 1) await new Promise((res) => setTimeout(res, 500));
      }
    }
    lastError = err;
    throw err;
  }

  function dedupe(key, fn) {
    if (inflight.has(key)) return inflight.get(key);
    const p = fn().finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  }

  /* ---------------- 通用预报 ---------------- */
  const FC_TTL = 3600;          // 1h
  const FC_TTL_TODAY = 600;     // 10min（当天）

  function forecastKey(lat, lon, elev, days) {
    return `fc_${lat.toFixed(2)}_${lon.toFixed(2)}_${elev}_${days}`;
  }

  async function getForecast(lat, lon, elevation, forecastDays = 16) {
    const days = Math.max(1, Math.min(16, forecastDays));
    const key = forecastKey(lat, lon, elevation, days);
    const cached = cacheGet(key, FC_TTL_TODAY);
    if (cached) return cached;
    return dedupe(key, async () => {
      const p = new URLSearchParams({
        latitude: lat,
        longitude: lon,
        elevation: elevation,
        hourly: HOURLY_VARS.join(','),
        daily: DAILY_VARS.join(','),
        forecast_days: days,
        timezone: 'auto',
        wind_speed_unit: 'kmh',
      });
      try {
        const raw = await getJSON(`${BASE}?${p}`);
        const result = {
          hourly: pairLists(raw.hourly || {}, HOURLY_VARS),
          daily: pairLists(raw.daily || {}, DAILY_VARS),
          utc_offset_seconds: raw.utc_offset_seconds || 0,
          elevation: raw.elevation != null ? raw.elevation : elevation,
        };
        cacheSet(key, result);
        return result;
      } catch (e) {
        const stale = cacheGetStale(key);
        if (stale) return stale;
        throw e;
      }
    });
  }

  function pairLists(d, keys) {
    const times = d.time || [];
    const out = [];
    for (let i = 0; i < times.length; i++) {
      const p = { time: times[i] };
      for (const k of keys) {
        const arr = d[k];
        p[k] = arr && i < arr.length ? arr[i] : null;
      }
      out.push(p);
    }
    return out;
  }

  /* ---------------- 多模型（ECMWF / GFS） ---------------- */
  async function getModelHourly(model, lat, lon, elevation, startDate, endDate) {
    const url = model === 'ecmwf'
      ? 'https://api.open-meteo.com/v1/ecmwf'
      : 'https://api.open-meteo.com/v1/gfs';
    const key = `${model}_${lat.toFixed(2)}_${lon.toFixed(2)}_${elevation}_${startDate}_${endDate}`;
    const cached = cacheGet(key, FC_TTL);
    if (cached) return cached;
    return dedupe(key, async () => {
      const vars = ['temperature_2m', 'precipitation', 'cloud_cover', 'wind_speed_10m'];
      const p = new URLSearchParams({
        latitude: lat, longitude: lon, elevation: elevation,
        hourly: vars.join(','),
        start_date: startDate, end_date: endDate,
        timezone: 'auto', wind_speed_unit: 'kmh',
      });
      try {
        const raw = await getJSON(`${url}?${p}`);
        const result = pairLists(raw.hourly || {}, vars);
        cacheSet(key, result);
        return result;
      } catch (e) {
        const stale = cacheGetStale(key);
        if (stale) return stale;
        throw e;
      }
    });
  }

  /* ---------------- 历史同期 ---------------- */
  async function getArchive(lat, lon, startDate, endDate) {
    const key = `arc_${lat.toFixed(2)}_${lon.toFixed(2)}_${startDate}_${endDate}`;
    const cached = cacheGet(key, 7 * 86400);
    if (cached) return cached;
    return dedupe(key, async () => {
      const vars = [
        'temperature_2m_max', 'temperature_2m_min', 'precipitation_sum',
        'cloud_cover_mean', 'wind_speed_10m_max',
      ];
      const p = new URLSearchParams({
        latitude: lat, longitude: lon,
        start_date: startDate, end_date: endDate,
        daily: vars.join(','), timezone: 'auto', wind_speed_unit: 'kmh',
      });
      try {
        const raw = await getJSON(`${ARCHIVE}?${p}`);
        const result = pairLists(raw.daily || {}, vars);
        cacheSet(key, result);
        return result;
      } catch (e) {
        const stale = cacheGetStale(key);
        if (stale) return stale;
        throw e;
      }
    });
  }

  /* ---------------- 空气质量（AQI） ---------------- */
  const AQ_TTL = 1800;
  async function getAqi(lat, lon) {
    const key = `aq_${lat.toFixed(2)}_${lon.toFixed(2)}`;
    const cached = cacheGet(key, AQ_TTL);
    if (cached !== null) return cached;
    return dedupe(key, async () => {
      const p = new URLSearchParams({
        latitude: lat, longitude: lon,
        current: 'european_aqi,pm2_5,pm10',
        timezone: 'auto',
      });
      try {
        const raw = await getJSON(`${AIR}?${p}`);
        const cur = raw.current || {};
        const result = {
          aqi: cur.european_aqi != null ? cur.european_aqi : null,
          pm2_5: cur.pm2_5 != null ? cur.pm2_5 : null,
          pm10: cur.pm10 != null ? cur.pm10 : null,
        };
        cacheSet(key, result);
        return result;
      } catch (e) {
        const stale = cacheGetStale(key);
        if (stale !== null) return stale;
        return { aqi: null, pm2_5: null, pm10: null };
      }
    });
  }

  /* ---------------- 月相工具 ---------------- */
  function moonIlluminationFromPhase(phase) {
    if (phase == null) return null;
    return Math.round(((1 - Math.cos(2 * Math.PI * phase)) / 2) * 100);
  }

  function moonPhaseName(phase) {
    if (phase == null) return '未知';
    const p = ((phase % 1) + 1) % 1;
    if (p < 0.0625 || p >= 0.9375) return '新月';
    if (p < 0.1875) return '娥眉月';
    if (p < 0.3125) return '上弦月';
    if (p < 0.4375) return '盈凸月';
    if (p < 0.5625) return '满月';
    if (p < 0.6875) return '亏凸月';
    if (p < 0.8125) return '下弦月';
    return '残月';
  }

  /* ---------------- 并发限流 ---------------- */
  async function mapLimit(items, limit, fn) {
    const out = new Array(items.length);
    let idx = 0;
    async function worker() {
      while (idx < items.length) {
        const i = idx++;
        try { out[i] = await fn(items[i], i); } catch (e) { out[i] = null; }
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return out;
  }

  return {
    HOURLY_VARS, DAILY_VARS,
    getForecast, getModelHourly, getArchive, getAqi,
    moonIlluminationFromPhase, moonPhaseName,
    cacheGet, cacheSet, mapLimit, getLastError,
  };
})();
