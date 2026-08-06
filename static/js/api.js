// API 封装：统一处理城市/日期/自定义坐标参数
const API = {
  cityId: 'anji',
  custom: null, // { lat, lon, elev }
  date: new Date().toISOString().slice(0, 10),
  currentCity: null, // 当前选中的城市信息

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

  now() { return this._get(`/weather/${this.cityId}/now`); },
  forecast() { return this._get(`/weather/${this.cityId}/forecast`); },
  hourly() { return this._get(`/weather/${this.cityId}/hourly`, { date: this.date }); },
  multimodel() { return this._get(`/weather/${this.cityId}/multimodel`, { date: this.date }); },
  stargazing() { return this._get(`/stargazing/${this.cityId}`, { date: this.date }); },
  astronomy() { return this._get(`/astronomy/${this.cityId}`, { date: this.date }); },
  airQuality() { return this._get(`/air-quality/${this.cityId}`); },
  historical() {
    const md = this.date.slice(5); // MM-DD
    return this._get(`/historical/${this.cityId}`, { month_day: md });
  },
  analysis() { return this._get(`/analysis/${this.cityId}`, { date: this.date }); },
};
