// API 封装：统一处理城市/日期/自定义坐标参数
const API = {
  cityId: 'beijing',
  custom: null, // { lat, lon, elev }
  date: new Date().toISOString().slice(0, 10),
  currentCity: null, // 当前选中的城市信息
  _preloadCache: {}, // 前端预缓存：{ "YYYY-MM-DD": { now: {...}, air: {...}, ... } }
  _preloadingDates: new Set(), // 正在预加载的日期

  _params(extra = {}) {
    const p = new URLSearchParams();
    if (this.custom) {
      p.set('lat', this.custom.lat);
      p.set('lon', this.custom.lon);
      p.set('elevation', this.custom.elev);
    }
    for (const [k, v] of Object.entries(extra)) {
      if (v != null && v !== '') p.set(k, v);
    }
    return p.toString();
  },

  async _get(path, extra = {}) {
    const q = this._params(extra);
    const url = `/api${path}${q ? '?' + q : ''}`;
    const r = await fetch(url);
    if (!r.ok) {
      let msg = `HTTP ${r.status}`;
      try { const j = await r.json(); msg = j.detail || msg; } catch (e) {}
      throw new Error(msg);
    }
    return r.json();
  },

  cities() { return this._get('/cities'); },

  // 城市搜索
  async searchCities(q) {
    const url = `/api/search/cities?q=${encodeURIComponent(q)}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`搜索失败 HTTP ${r.status}`);
    return r.json();
  },

  // 按名称解析城市
  async resolveCity(name) {
    const url = `/api/search/resolve?name=${encodeURIComponent(name)}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`解析失败 HTTP ${r.status}`);
    return r.json();
  },

  // 带日期参数的请求（不影响 this.date）
  _getForDate(path, date, extra = {}) {
    const params = { ...extra, date };
    return this._get(path, params);
  },

  now(dateOverride) {
    if (dateOverride) return this._getForDate(`/weather/${this.cityId}/now`, dateOverride);
    return this._get(`/weather/${this.cityId}/now`, { date: this.date });
  },
  forecast() { return this._get(`/weather/${this.cityId}/forecast`); },
  hourly(dateOverride) {
    if (dateOverride) return this._getForDate(`/weather/${this.cityId}/hourly`, dateOverride);
    return this._get(`/weather/${this.cityId}/hourly`, { date: this.date });
  },
  multimodel(dateOverride) {
    if (dateOverride) return this._getForDate(`/weather/${this.cityId}/multimodel`, dateOverride);
    return this._get(`/weather/${this.cityId}/multimodel`, { date: this.date });
  },
  stargazing(dateOverride) {
    if (dateOverride) return this._getForDate(`/stargazing/${this.cityId}`, dateOverride);
    return this._get(`/stargazing/${this.cityId}`, { date: this.date });
  },
  astronomy(dateOverride) {
    if (dateOverride) return this._getForDate(`/astronomy/${this.cityId}`, dateOverride);
    return this._get(`/astronomy/${this.cityId}`, { date: this.date });
  },
  airQuality(dateOverride) {
    if (dateOverride) return this._getForDate(`/air-quality/${this.cityId}`, dateOverride);
    return this._get(`/air-quality/${this.cityId}`, { date: this.date });
  },
  historical(dateOverride) {
    const d = dateOverride || this.date;
    const md = d.slice(5); // MM-DD
    return this._get(`/historical/${this.cityId}`, { month_day: md });
  },
  analysis(dateOverride) {
    if (dateOverride) return this._getForDate(`/analysis/${this.cityId}`, dateOverride);
    return this._get(`/analysis/${this.cityId}`, { date: this.date });
  },

  // 预缓存指定日期的所有数据（后台静默拉取）
  async preloadDate(date) {
    if (this._preloadingDates.has(date)) return;
    if (this._preloadCache[date]) return;
    this._preloadingDates.add(date);
    try {
      const [now, air, hourly, sg, astro, mm, ana, hist] = await Promise.allSettled([
        this.now(date),
        this.airQuality(date),
        this.hourly(date),
        this.stargazing(date),
        this.astronomy(date),
        this.multimodel(date),
        this.analysis(date),
        this.historical(date),
      ]);
      this._preloadCache[date] = { now, air, hourly, sg, astro, mm, ana, hist };
    } finally {
      this._preloadingDates.delete(date);
    }
  },

  // 获取预缓存数据（如果存在）
  getCachedData(date) {
    return this._preloadCache[date] || null;
  },

  // 清除预缓存（切换城市时调用）
  clearPreloadCache() {
    this._preloadCache = {};
    this._preloadingDates.clear();
    this._forecastData = null;  // forecast 数据也需要清除（城市变化）
  },
};
