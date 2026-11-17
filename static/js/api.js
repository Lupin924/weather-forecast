/* API 封装：统一处理城市 / 日期 / 自定义坐标 / 双模式 */
const API = {
  cityId: 'anji',
  custom: null, // { lat, lon, elev }
  date: new Date().toISOString().slice(0, 10),

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

  cities(mode = 'all') { return this._get('/cities', { mode }); },

  async searchCities(q) {
    const r = await fetch(`/api/search/cities?q=${encodeURIComponent(q)}`);
    if (!r.ok) throw new Error(`搜索失败 HTTP ${r.status}`);
    return r.json();
  },

  // 观星模式接口（date 可覆盖）
  now(date) { return this._get(`/weather/${this.cityId}/now`, date ? { date } : {}); },
  forecast() { return this._get(`/weather/${this.cityId}/forecast`); },
  hourly(date) { return this._get(`/weather/${this.cityId}/hourly`, date ? { date } : {}); },
  multimodel(date) { return this._get(`/weather/${this.cityId}/multimodel`, date ? { date } : {}); },
  stargazing(date) { return this._get(`/stargazing/${this.cityId}`, date ? { date } : {}); },
  astronomy(date) { return this._get(`/astronomy/${this.cityId}`, date ? { date } : {}); },
  airQuality(date) { return this._get(`/air-quality/${this.cityId}`, date ? { date } : {}); },
  historical(date) {
    const d = date || this.date;
    return this._get(`/historical/${this.cityId}`, { month_day: d.slice(5) });
  },
  analysis(date) { return this._get(`/analysis/${this.cityId}`, date ? { date } : {}); },

  // 赏雪模式接口
  snowBoard(days = 7) { return this._get('/snow/board', { days }); },
  stargazingBoard(days = 7) { return this._get('/stargazing/board', { days }); },
  snowForecast(cityId, days = 7) {
    return this._get(`/snow/forecast/${encodeURIComponent(cityId)}`, { days });
  },

  // 双模式共用：N 天观星条件摘要 / 首屏钉住城市聚合
  stargazingForecast(cityId, days = 15) {
    return this._get(`/stargazing/forecast/${encodeURIComponent(cityId)}`, { days });
  },
  pinnedSummary(ids, days = 7, mode = 'snow') {
    return this._get('/pinned/summary', { ids: ids.join(','), days, mode });
  },
  events(mode = 'stargazing') {
    return this._get('/events', { mode });
  },
};
