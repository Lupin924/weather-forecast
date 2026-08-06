// Chart.js 图表封装（支持深色/浅色主题）
// 注意：图表实例属性名（*Chart）须与方法名不同，避免对象字面量中后者覆盖前者。
const Charts = {
  hourlyChart: null,
  historicalChart: null,
  pressureChart: null,
  // 缓存上次渲染的数据，用于主题切换时重新渲染
  _lastHourly: null,
  _lastHistorical: null,
  _lastPressure: null,

  _isLight() {
    return document.body.classList.contains('light-theme');
  },

  _grid() {
    return this._isLight()
      ? { color: 'rgba(90,100,114,.1)' }
      : { color: 'rgba(139,151,166,.12)' };
  },

  _tickColor() {
    return this._isLight() ? '#5a6472' : '#8b97a6';
  },

  _legendColor() {
    return this._isLight() ? '#1a1f26' : '#e6edf3';
  },

  // 数据系列颜色：深色模式用原色，浅色模式用加深色
  _red()    { return this._isLight() ? '#cf222e' : '#f85149'; },
  _blue()   { return this._isLight() ? '#0969da' : '#79c0ff'; },
  _green()  { return this._isLight() ? '#1a7f37' : '#3fb950'; },
  _purple() { return this._isLight() ? '#8250df' : '#bc8cff'; },
  _orange() { return this._isLight() ? '#bc4c00' : '#db6d28'; },

  _destroy(prop) {
    if (this[prop] && typeof this[prop].destroy === 'function') {
      this[prop].destroy();
    }
    this[prop] = null;
  },

  _refreshTheme() {
    // 切换主题时重新渲染所有图表（Chart.js 的 update() 不会重读 scales 颜色配置）
    if (this._lastHourly)    this.hourly(this._lastHourly);
    if (this._lastHistorical) this.historical(this._lastHistorical);
    if (this._lastPressure)  this.pressure(this._lastPressure);
  },

  // 逐小时：温度折线 + 云量面积 + 风速柱
  hourly(points) {
    this._lastHourly = points;
    this._destroy('hourlyChart');
    const ctx = document.getElementById('hourlyChart');
    if (!ctx || !points || !points.length) return;
    const labels = points.map(p => (p.time || '').slice(11, 16) || (p.time || '').slice(5));
    const temps = points.map(p => p.temperature);
    const clouds = points.map(p => p.cloud_cover);
    const winds = points.map(p => p.wind_speed);

    const red  = this._red();
    const blue = this._blue();
    const green = this._green();

    this.hourlyChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            type: 'line', label: '气温 (°C)', data: temps,
            borderColor: red, backgroundColor: 'rgba(248,81,73,.15)',
            yAxisID: 'y', tension: .3, pointRadius: 2, borderWidth: 2, fill: false,
          },
          {
            type: 'line', label: '云量 (%)', data: clouds,
            borderColor: blue, backgroundColor: 'rgba(121,192,255,.25)',
            yAxisID: 'y1', tension: .3, pointRadius: 1, borderWidth: 1.5, fill: true,
          },
          {
            type: 'bar', label: '风速 (km/h)', data: winds,
            backgroundColor: 'rgba(63,185,80,.4)', yAxisID: 'y1',
          },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { labels: { color: this._legendColor() } } },
        scales: {
          x: { ticks: { color: this._tickColor() }, grid: this._grid() },
          y: { type: 'linear', position: 'left', ticks: { color: red }, grid: this._grid(), title: { display: true, text: '°C', color: red } },
          y1: { type: 'linear', position: 'right', ticks: { color: blue }, grid: { drawOnChartArea: false }, title: { display: true, text: '% / km/h', color: blue } },
        },
      },
    });
  },

  // 历史同期：高低温柱 + 降水折线
  historical(years) {
    this._lastHistorical = years;
    this._destroy('historicalChart');
    const ctx = document.getElementById('historicalChart');
    if (!ctx || !years || !years.length) return;
    const labels = years.map(y => y.year);
    const tick = this._tickColor();
    const green = this._green();
    const orange = this._orange();
    const blue = this._blue();

    this.historicalChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: '最高温 (°C)', data: years.map(y => y.high), backgroundColor: 'rgba(219,109,40,.7)' },
          { label: '最低温 (°C)', data: years.map(y => y.low), backgroundColor: 'rgba(88,166,255,.7)' },
          { type: 'line', label: '降水 (mm)', data: years.map(y => y.precipitation), borderColor: green, backgroundColor: 'transparent', yAxisID: 'y1', tension: .2, borderWidth: 2 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: this._legendColor() } } },
        scales: {
          x: { ticks: { color: tick }, grid: this._grid() },
          y: { ticks: { color: tick }, grid: this._grid(), title: { display: true, text: '°C', color: tick } },
          y1: { position: 'right', ticks: { color: green }, grid: { drawOnChartArea: false }, title: { display: true, text: 'mm', color: green } },
        },
      },
    });
  },

  // 气压趋势
  pressure(series) {
    this._lastPressure = series;
    this._destroy('pressureChart');
    const ctx = document.getElementById('pressureChart');
    if (!ctx || !series || !series.length) return;
    const labels = series.map(s => s.date.slice(5));
    const purple = this._purple();
    const red = this._red();

    this.pressureChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: '海平面气压 (hPa)', data: series.map(s => s.pressure), borderColor: purple, backgroundColor: 'rgba(188,140,255,.15)', tension: .3, borderWidth: 2, fill: true, yAxisID: 'y' },
          { label: '阵风 (km/h)', data: series.map(s => s.gust), borderColor: red, backgroundColor: 'transparent', tension: .3, borderWidth: 2, yAxisID: 'y1' },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: this._legendColor() } } },
        scales: {
          x: { ticks: { color: this._tickColor() }, grid: this._grid() },
          y: { position: 'left', ticks: { color: purple }, grid: this._grid(), title: { display: true, text: 'hPa', color: purple } },
          y1: { position: 'right', ticks: { color: red }, grid: { drawOnChartArea: false }, title: { display: true, text: 'km/h', color: red } },
        },
      },
    });
  },
};
