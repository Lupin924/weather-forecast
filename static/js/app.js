/* 星野与雪国 · 前端主控：双模式 / 城市选择 / 观星 / 赏雪看板 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (v) => {
    if (v == null || v === '' || isNaN(v)) return '--';
    const n = Number(v);
    return Number.isInteger(n) ? String(n) : n.toFixed(1);
  };
  const hhmm = (s) => {
    if (!s) return '--';
    const t = String(s);
    return t.length >= 16 ? t.slice(11, 16) : t.slice(-5);
  };
  const ratingOf = (score) => {
    const s = Number(score) || 0;
    if (s >= 70) return '🌟 极佳';
    if (s >= 50) return '✨ 良好';
    if (s >= 30) return '🌤 一般';
    return '☁ 欠佳';
  };
  const skyIcon = (text) => {
    const t = String(text || '');
    if (/雪/.test(t)) return '❄️';
    if (/雷/.test(t)) return '⛈️';
    if (/雨/.test(t)) return '🌧️';
    if (/云/.test(t)) return '⛅';
    if (/晴/.test(t)) return '☀️';
    if (/阴/.test(t)) return '☁️';
    return '🌡️';
  };

  const PIN_KEY = 'ss_pinned_v1';
  const HOME_CACHE_KEY = 'ss_home_v1';
  const PIN_MAX = 3;
  const PIN_DEFAULTS = {
    stargazing: ['anji', 'taizijian', 'moganshan'],
    snow: ['weihai', 'changbaishan', 'yabuli'],
  };

  const state = {
    mode: 'stargazing',
    view: 'home',
    city: null,
    cityData: { stargazing: null, snow: null },
    board: null,
    boardMap: {},
    snowDay: 0,
    snowCity: null,
    sgData: null,
    hourlyCfg: null,
    pinned: loadPinned(),
    pinSummary: null,
    detailCity: null,
    detailDays: [],
    detailIndex: 0,
  };

  function loadPinned() {
    try {
      const raw = localStorage.getItem(PIN_KEY);
      if (raw) {
        const o = JSON.parse(raw);
        return {
          stargazing: Array.isArray(o.stargazing) ? o.stargazing.slice(0, PIN_MAX) : PIN_DEFAULTS.stargazing.slice(),
          snow: Array.isArray(o.snow) ? o.snow.slice(0, PIN_MAX) : PIN_DEFAULTS.snow.slice(),
        };
      }
    } catch (e) {}
    return { stargazing: PIN_DEFAULTS.stargazing.slice(), snow: PIN_DEFAULTS.snow.slice() };
  }
  function savePinned() {
    try { localStorage.setItem(PIN_KEY, JSON.stringify(state.pinned)); } catch (e) {}
  }
  function isPinned(id) { return state.pinned[state.mode].indexOf(id) >= 0; }
  function togglePin(id) {
    const arr = state.pinned[state.mode];
    const i = arr.indexOf(id);
    if (i >= 0) { arr.splice(i, 1); toast('已取消常驻'); }
    else {
      if (arr.length >= PIN_MAX) { toast('最多钉住 ' + PIN_MAX + ' 个城市'); return; }
      arr.push(id); toast('已加入常驻城市');
    }
    savePinned();
  }

  let toastTimer = null;
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    requestAnimationFrame(() => el.classList.add('show'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.classList.add('hidden'), 300);
    }, 2600);
  }
  function progress(v) {
    const bar = $('progressBar');
    bar.style.width = Math.max(0, Math.min(100, v)) + '%';
    bar.style.opacity = '1';
    if (v >= 100) setTimeout(() => { bar.style.opacity = '0'; }, 500);
  }

  // ---------------- 城市选择 ----------------
  function currentCityData() { return state.cityData[state.mode]; }

  function renderCityGroups(filter = '') {
    const data = currentCityData();
    const box = $('cityGroups');
    if (!data || !data.groups) {
      box.innerHTML = '<div class="muted pad">城市列表加载中…</div>';
      return;
    }
    const q = filter.trim().toLowerCase();
    let html = '';
    (data.groups || []).forEach((g) => {
      const items = (g.cities || []).filter((c) =>
        !q || c.name.toLowerCase().includes(q) ||
        (c.tags || []).join(' ').toLowerCase().includes(q) ||
        String(c.elevation_m || '').includes(q));
      if (!items.length) return;
      html += `<div class="cg"><div class="cg-title">${esc(g.icon || '·')} ${esc(g.name)}</div>`;
      items.forEach((c) => {
        const cur = state.city && state.city.id === c.id;
        const pin = isPinned(c.id);
        const tags = (c.tags || []).slice(0, 2).map((t) => `<span class="cg-tag">${esc(t)}</span>`).join('');
        html += `<div class="cg-item ${cur ? 'is-current' : ''}" data-id="${esc(c.id)}">
          <button type="button" class="pin-toggle ${pin ? 'is-on' : ''}" data-id="${esc(c.id)}" title="${pin ? '取消常驻' : '钉到首屏'}">${pin ? '★' : '☆'}</button>
          <span class="cg-name">${esc(c.name)}</span>${tags}
          <span class="cg-dist">${c.distance_km != null ? c.distance_km + 'km' : ''}</span>
        </div>`;
      });
      html += '</div>';
    });
    box.innerHTML = html || '<div class="muted pad">无匹配城市</div>';
    box.querySelectorAll('.pin-toggle').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        togglePin(el.dataset.id);
        renderCityGroups($('citySearch').value);
        if (state.view === 'home') loadPinnedOnly();
      });
    });
    box.querySelectorAll('.cg-item').forEach((el) => {
      el.addEventListener('click', () => {
        const city = (data.cities || []).find((c) => c.id === el.dataset.id);
        if (city) setCity(city);
      });
    });
  }

  function closePopover() {
    $('cityPopover').classList.add('hidden');
    $('cityBtn').setAttribute('aria-expanded', 'false');
  }

  function setCity(city, quiet) {
    state.city = city;
    API.cityId = city.id;
    API.custom = null;
    $('cityBtnName').textContent = city.name;
    $('cityBtnDist').textContent = city.distance_km != null ? '距上海 ' + city.distance_km + 'km' : '';
    closePopover();
    renderCityGroups($('citySearch').value);
    if (quiet) return;
    if (state.view === 'home') loadHome();
    else if (state.view === 'detail') openDetail(city.id, city.name);
    else if (state.view === 'snow') {
      const full = state.boardMap[city.id];
      if (full) showSnowDetail(full);
    } else loadStargazing();
  }

  function initPicker() {
    $('cityBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      const open = $('cityPopover').classList.toggle('hidden');
      $('cityBtn').setAttribute('aria-expanded', String(!open));
      if (!open) $('citySearch').focus();
    });
    $('cityPopover').addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', closePopover);
    $('citySearch').addEventListener('input', (e) => renderCityGroups(e.target.value));
  }

  // ---------------- 观星模式 ----------------
  async function loadStargazing() {
    progress(8);
    const city = state.city;
    const date = API.date;
    const req = (p) => p.catch((e) => ({ _error: e.message }));
    const [now, sg, astro, fc, hourly, mm, hist, ana] = await Promise.all([
      req(API.now(date)), req(API.stargazing(date)), req(API.astronomy(date)),
      req(API.forecast()), req(API.hourly(date)), req(API.multimodel(date)),
      req(API.historical(date)), req(API.analysis(date)),
    ]);
    progress(70);

    const d = (o) => (o && !o._error && o.data) ? o.data : null;
    const fcData = d(fc);
    const sgData = d(sg);
    state.sgData = sgData;

    const dateText = date.slice(5).replace('-', ' / ');
    ['sgNowDate', 'sgScoreDate', 'sgAstroDate', 'sgHourlyDate', 'sgTimelineDate'].forEach((id) => { $(id).textContent = dateText; });

    renderNow(d(now), city, fcData);
    renderScore(sgData);
    renderAstro(d(astro), sgData);
    renderForecast(fcData);
    renderHourly(d(hourly), sgData);
    renderTimeline(sgData);
    renderMore(d(mm), d(hist), d(ana));

    if (now && now._error) toast('实况数据获取失败，已尽力展示其他数据');
    $('updatedAt').textContent = '更新于 ' + new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    progress(100);
  }

  function renderNow(now, city, forecast) {
    if (!now) return;
    $('nowTemp').textContent = fmt(now.temperature);
    $('nowFeels').textContent = fmt(now.feels_like);
    $('nowHumidity').textContent = fmt(now.humidity) + '%';
    $('nowWind').textContent = fmt(now.wind_speed) + ' m/s';
    $('nowPrecip').textContent = fmt(now.precipitation) + ' mm';
    $('nowElev').textContent = (city && city.elevation_m != null ? city.elevation_m : '--') + ' m';
    const sky = (forecast && forecast[0] && (forecast[0].day_text || forecast[0].night_text)) ||
      (now.mode === 'forecast' ? '预报时段' : '实时观测');
    $('nowSky').textContent = sky;
    const alarms = now.alarms || [];
    if (alarms.length) {
      const a = alarms[0];
      $('nowAlarm').textContent = '⚠ ' + (a.title || a.text || JSON.stringify(a));
      $('nowAlarm').classList.remove('hidden');
    } else {
      $('nowAlarm').classList.add('hidden');
    }
  }

  function renderScore(sg) {
    if (!sg) return;
    const score = Math.round(sg.best_score != null ? sg.best_score : (sg.best_window_avg || 0));
    $('sgScore').textContent = score;
    $('sgScoreRing').style.setProperty('--p', score);
    $('sgRating').textContent = sg.best_rating || ratingOf(score);
    $('sgSummary').textContent = sg.summary || '综合云量、天光、月相、降水、光污染等 9 项条件评分';
    const dur = sg.best_window_duration ? ' · 约 ' + sg.best_window_duration + ' 小时' : '';
    $('sgWindow').textContent = hhmm(sg.best_window_start) + ' — ' + hhmm(sg.best_window_end) + dur;
    $('sgRecommend').textContent = sg.recommendation || '';
  }

  function renderAstro(astro, sg) {
    if (!astro) return;
    $('astroSun').textContent = hhmm(astro.sunset) + ' / ' + hhmm(astro.sunrise);
    $('astroMoon').textContent = astro.moon_phase_name || '--';
    $('astroIllum').textContent = Math.round(astro.moon_illumination != null ? astro.moon_illumination : 0) + '%';
    const lp = sg && sg.light_pollution_info;
    $('astroBortle').textContent = lp ? ('B' + lp.bortle + ' · ' + lp.label) : '--';
    if (lp && (lp.milky_way || lp.description)) {
      $('astroTip').textContent = lp.milky_way || lp.description;
    } else {
      $('astroTip').textContent = (astro.moon_illumination > 60) ? '月光较亮，可避开月出时段观测' : '夜空通透，适合观星与深空摄影';
    }
  }

  function renderForecast(list) {
    const days = (list || []).slice(0, 7);
    if (!days.length) { $('forecastStrip').innerHTML = '<div class="muted">暂无预报数据</div>'; return; }
    $('forecastStrip').innerHTML = days.map((d, i) => {
      const label = i === 0 ? '今天' : i === 1 ? '明天' : String(d.date || '').slice(5).replace('-', '/');
      const text = d.day_text || d.night_text || '—';
      return `<div class="fday ${i === 0 ? 'is-today' : ''}">
        <div class="fdate">${label}</div>
        <div class="fico">${skyIcon(text)}</div>
        <div class="ftemp">${fmt(d.high)}° <small>${fmt(d.low)}°</small></div>
        <div class="fdesc" title="${esc(text)}">${esc(text)}</div>
      </div>`;
    }).join('');
  }

  function renderHourly(hourly, sg) {
    const pts = (hourly || []).slice(0, 24);
    if (!pts.length) { $('hourlyChart').innerHTML = '<div class="muted" style="padding:24px;text-align:center">暂无逐小时数据</div>'; return; }
    const sgMap = {};
    ((sg && sg.hours) || []).forEach((h) => { sgMap[hhmm(h.time)] = h.score; });
    const accent = (getComputedStyle(document.body).getPropertyValue('--accent') || '#6a67d6').trim();
    const cfg = {
      labels: pts.map((p) => hhmm(p.time)),
      series: [
        { label: '气温', color: '#e8834f', values: pts.map((p) => p.temperature), unit: '°C' },
        { label: '云量', color: '#7aa6c9', values: pts.map((p) => p.cloud_cover), min: 0, max: 100, unit: '%' },
        { label: '观星指数', color: accent, values: pts.map((p) => sgMap[hhmm(p.time)]), min: 0, max: 100 },
        { label: '降水', color: '#48b3c9', values: pts.map((p) => p.precipitation), unit: 'mm' },
      ],
      height: 190,
    };
    state.hourlyCfg = cfg;
    Charts.multiLine($('hourlyChart'), cfg);
  }

  function renderTimeline(sg) {
    if (!sg) return;
    const hours = sg.hours || [];
    const bStart = hhmm(sg.best_window_start);
    const bEnd = hhmm(sg.best_window_end);
    const inWindow = (t) => {
      if (!bStart || !bEnd) return false;
      return bEnd >= bStart ? (t >= bStart && t <= bEnd) : (t >= bStart || t <= bEnd);
    };
    if (!hours.length) { $('sgTimeline').innerHTML = '<div class="muted">暂无夜间逐小时评分</div>'; return; }
    $('sgTimeline').innerHTML = hours.map((h) => {
      const t = hhmm(h.time);
      const v = Math.round(h.score || 0);
      return `<div class="tl-hour ${inWindow(t) ? 'is-best' : ''}" title="${t} · 指数 ${v} · ${esc(h.rating)}">
        <div class="tl-bar" style="--v:${v}"><span>${v}</span></div>
        <div class="tl-label">${t.slice(0, 2)}</div>
      </div>`;
    }).join('');
    const st = sg.stats || {};
    const items = [
      ['优秀时段', st.excellent_hours], ['良好时段', st.good_hours],
      ['可观测', st.observable_hours], ['夜间时长', st.total_night_hours],
      ['平均指数', st.avg_score != null ? Math.round(st.avg_score) : null],
    ];
    $('sgStats').innerHTML = items.filter((x) => x[1] != null)
      .map((x) => `<div>${x[0]}<b>${x[1]}${x[0].includes('时长') ? 'h' : ''}</b></div>`).join('');
  }

  function renderMore(mm, hist, ana) {
    if (mm) {
      const row = (label, m) => m ? `<div class="mini-row"><span>${label}</span><b>${fmt(m.high)}° / ${fmt(m.low)}°</b></div>` : '';
      let h = row('ECMWF', mm.ecmwf) + row('GFS', mm.gfs) + row('集合平均', mm.ensemble);
      if (mm.divergence) {
        h += `<div style="font-size:11px;color:#8b97ab;margin-top:6px">模型分歧：${esc(Object.values(mm.divergence).join(' · '))}</div>`;
      }
      $('sgMultimodel').innerHTML = h || '<div class="muted">暂无数据</div>';
    }
    if (hist) {
      $('sgHistorical').innerHTML = (hist.years || []).map((y) =>
        `<div class="mini-row"><span>${y.year} 年</span><b>${fmt(y.high)}° / ${fmt(y.low)}°</b></div>`).join('') || '<div class="muted">暂无历史数据</div>';
    }
    if (ana) {
      $('sgAnalysis').innerHTML = `<div style="font-size:12px;line-height:1.6;margin-bottom:6px">${esc(ana.conclusion || '暂无结论')}</div>
        <div class="mini-row"><span>天气系统</span><b>${esc(ana.system_type || '未检出')}</b></div>
        <div class="mini-row"><span>极大风速</span><b>${fmt(ana.peak_gust)} km/h</b></div>`;
    }
  }

  // ---------------- 赏雪模式 ----------------
  async function loadSnowBoard() {
    progress(8);
    try {
      const j = await API.snowBoard(7);
      state.board = j.data;
      state.boardMap = {};
      (state.board.groups || []).forEach((g) => (g.cities || []).forEach((c) => { state.boardMap[c.id] = c; }));
      renderSnow();
      progress(100);
    } catch (e) {
      toast('赏雪看板加载失败：' + e.message);
      progress(100);
    }
  }

  function renderSnow() {
    const b = state.board;
    if (!b) return;
    $('snowSummary').textContent = b.summary || '全国雪景城市降雪概率播报';
    $('snowUpdated').textContent = '数据更新：' + String(b.generated_at || '').replace('T', ' ') + ' · 数据源 Open-Meteo';
    $('snowActive').textContent = b.active_cities != null ? b.active_cities : '--';
    $('snowEvents').textContent = b.total_events != null ? b.total_events : '--';
    $('snowTotal').textContent = b.total_cities != null ? b.total_cities : '--';
    $('snowDaysLabel').textContent = b.days || 7;
    renderSnowTabs();
    renderSnowRank();
    renderHighlights();
    renderSnowGroups();
    const first = (b.highlights && b.highlights[0]) ||
      (b.groups && b.groups[0] && b.groups[0].cities && b.groups[0].cities[0]);
    if (first) showSnowDetail(state.boardMap[first.id] || first);
  }

  function renderSnowTabs() {
    const days = (state.board && state.board.by_day) || [];
    $('snowDayTabs').innerHTML = days.map((d, i) =>
      `<button type="button" class="day-tab ${i === state.snowDay ? 'is-active' : ''}" data-i="${i}">
        ${esc(d.label)}<small>${String(d.date || '').slice(5)} · ${(d.cities || []).length} 城</small>
      </button>`).join('');
    $('snowDayTabs').querySelectorAll('.day-tab').forEach((el) => {
      el.addEventListener('click', () => {
        state.snowDay = Number(el.dataset.i);
        renderSnowTabs();
        renderSnowRank();
      });
    });
  }

  function renderSnowRank() {
    const b = state.board;
    if (!b) return;
    const day = (b.by_day || [])[state.snowDay];
    const list = day ? (day.cities || []) : (b.highlights || []).slice(0, 10);
    $('snowRank').innerHTML = list.map((c, i) =>
      `<div class="rank-row ${i < 3 ? 'top' + (i + 1) : ''}" data-id="${esc(c.id)}" title="点击查看逐日雪况">
        <div class="rank-num">${i + 1}</div>
        <div style="min-width:0">
          <div class="rank-city" style="display:flex;justify-content:space-between;gap:8px">
            <span>${esc(c.name)}</span><span style="color:#8b97ab;font-size:11px;font-weight:500">距上海 ${c.distance_km != null ? c.distance_km + 'km' : '--'}</span>
          </div>
          <div class="rank-bar"><i style="width:${Math.min(100, Math.max(0, c.prob || 0))}%"></i></div>
          <div class="rank-meta">
            <span class="prob">❄ ${c.prob != null ? c.prob : 0}%</span>
            <span>评分 <b>${fmt(c.score)}</b></span>
            <span>降雪 <b>${fmt(c.snowfall_cm)}cm</b></span>
            <span>最低 <b>${fmt(c.temp_min)}°C</b></span>
          </div>
        </div>
      </div>`).join('') || '<div class="muted">当日暂无城市达到降雪条件</div>';
    $('snowRank').querySelectorAll('.rank-row').forEach((el) => {
      el.addEventListener('click', () => {
        const city = state.boardMap[el.dataset.id];
        if (city) showSnowDetail(city);
      });
    });
  }

  function renderHighlights() {
    const b = state.board;
    if (!b) return;
    $('snowHighlights').innerHTML = (b.highlights || []).slice(0, 8).map((h) =>
      `<div class="hl-card" data-id="${esc(h.id)}" title="点击查看逐日雪况">
        <div class="hl-name">${esc(h.name)}</div>
        <div class="hl-date">${esc(h.date)} · ${esc(h.rating)}</div>
        <div class="hl-prob">${h.snow_probability != null ? h.snow_probability : 0}<small>%</small></div>
        <div class="hl-meta">降雪 ${fmt(h.snowfall_cm)}cm · 距上海 ${h.distance_km != null ? h.distance_km + 'km' : '--'}</div>
      </div>`).join('') || '<div class="muted">暂无亮点城市</div>';
    $('snowHighlights').querySelectorAll('.hl-card').forEach((el) => {
      el.addEventListener('click', () => {
        const city = state.boardMap[el.dataset.id];
        if (city) showSnowDetail(city);
      });
    });
  }

  function renderSnowGroups() {
    const b = state.board;
    if (!b) return;
    $('snowGroups').innerHTML = (b.groups || []).map((g) =>
      `<div class="group">
        <div class="group-head"><span class="gico">${esc(g.icon || '·')}</span>${esc(g.name)}<span class="tag">${(g.cities || []).length} 城</span></div>
        <div class="group-cities">${(g.cities || []).map((c) =>
          `<div class="city-chip ${state.snowCity && state.snowCity.id === c.id ? 'is-current' : ''}" data-id="${esc(c.id)}">
            ${esc(c.name)}<small>${c.distance_km != null ? c.distance_km + 'km' : ''}</small>
          </div>`).join('')}</div>
      </div>`).join('');
    $('snowGroups').querySelectorAll('.city-chip').forEach((el) => {
      el.addEventListener('click', () => {
        const city = state.boardMap[el.dataset.id];
        if (city) { showSnowDetail(city); renderSnowGroups(); }
      });
    });
  }

  function showSnowDetail(city) {
    if (!city) return;
    state.snowCity = city;
    $('snowDetailName').textContent = city.name + (city.elevation_m ? ' · ' + city.elevation_m + 'm' : '');
    $('snowDetailBest').textContent = city.best
      ? '最佳 ' + city.best.date + ' · ' + (city.best.snow_probability != null ? city.best.snow_probability + '%' : '') + ' · ' + (city.best.rating || '')
      : '暂无最佳日';
    $('snowDetail').innerHTML = (city.days || []).map((d) =>
      `<div class="sd-day ${city.best && d.date === city.best.date ? 'is-best' : ''}"
        title="评分 ${fmt(d.score)} · 降水概率 ${fmt(d.precip_probability)}% · 湿度 ${fmt(d.humidity)}%">
        <div class="sd-date">${esc(String(d.date || '').slice(5))}</div>
        <div class="sd-prob">${d.snow_probability != null ? d.snow_probability : 0}<small>%</small></div>
        <div class="sd-rating">${esc(d.rating || '')}</div>
        <div class="sd-row">${fmt(d.temp_max)}° / ${fmt(d.temp_min)}°</div>
        <div class="sd-row">雪 <b>${fmt(d.snowfall_cm)}cm</b></div>
        <div class="sd-bar"><i style="width:${Math.min(100, Math.max(0, d.score || 0))}%"></i></div>
      </div>`).join('') || '<div class="muted">暂无逐日雪况数据</div>';
  }

  // ---------------- 首屏：常驻城市 + 今日速览 ----------------
  function showView(name) {
    state.view = name;
    const map = { home: 'homeView', detail: 'detailView', stargazing: 'viewStargazing', snow: 'viewSnow' };
    Object.entries(map).forEach(([k, id]) => {
      const el = $(id);
      if (el) el.classList.toggle('is-active', k === name);
    });
    // 首屏用视口高度自适应模式：仅 home 时锁定一屏，其余视图正常滚动
    document.body.classList.toggle('home-active', name === 'home');
    $('homeBtn').classList.toggle('hidden', name === 'home');
    if (name !== 'home') window.scrollTo(0, 0);
  }

  function buildBoardMap() {
    state.boardMap = {};
    (((state.board || {}).groups) || []).forEach((g) =>
      (g.cities || []).forEach((c) => { state.boardMap[c.id] = c; }));
  }

  function pinLevel(v) {
    const n = Number(v) || 0;
    const hi = state.mode === 'snow' ? 75 : 70;
    const mid = state.mode === 'snow' ? 55 : 50;
    const lo = state.mode === 'snow' ? 35 : 30;
    return n >= hi ? 'high' : n >= mid ? 'mid' : n >= lo ? 'low' : 'none';
  }

  function renderPinnedCards() {
    const box = $('pinnedCards');
    const items = ((state.pinSummary || {}).items) || [];
    if (!items.length) {
      box.innerHTML = '<div class="muted">暂无常驻城市，在下方城市列表点 ☆ 添加</div>';
      return;
    }
    const unit = state.mode === 'snow' ? '%' : '';
    box.innerHTML = items.map((it) => {
      const days = it.days || [];
      const peak = days.reduce((a, b) => (b.value || 0) > (a.value || 0) ? b : a, { value: 0, date: '' });
      return `<button type="button" class="pin-card" data-id="${esc(it.id)}" title="查看 15 天预报">
        <div class="pc-head"><b>${esc(it.name)}</b><small>${it.distance_km != null ? it.distance_km + 'km' : '—'}</small></div>
        <div class="pc-strip">${days.map((d) =>
          `<i class="pc-cell lv-${pinLevel(d.value)}" title="${esc(d.date)} · ${d.value}${unit}"></i>`).join('')}</div>
        <div class="pc-foot"><span>峰值 <b>${peak.value || 0}${unit}</b></span><span>${String(peak.date || '').slice(5)}</span></div>
      </button>`;
    }).join('');
    box.querySelectorAll('.pin-card').forEach((el) => {
      el.addEventListener('click', () => {
        const it = items.find((x) => String(x.id) === el.dataset.id);
        openDetail(el.dataset.id, it ? it.name : el.dataset.id);
      });
    });
  }

  // 依据逐日序列给出趋势：比较前后半段均值，返回 up/down/flat 与幅度文案
  function dayTrend(days) {
    const v = (days || []).map((d) => Number(d && d.value) || 0).filter((x) => x > 0);
    if (v.length < 3) return { dir: 'flat', text: '—' };
    const cut = Math.max(2, Math.floor(v.length / 2));
    const a = v.slice(0, cut).reduce((s, x) => s + x, 0) / cut;
    const b = v.slice(cut).reduce((s, x) => s + x, 0) / (v.length - cut);
    const d = b - a;
    if (d > 6) return { dir: 'up', text: '走高 +' + Math.round(d) };
    if (d < -6) return { dir: 'down', text: '回落 ' + Math.round(d) };
    return { dir: 'flat', text: '平稳' };
  }

  function levelPill(v) {
    const lv = pinLevel(v);
    const map = { high: '极佳', mid: '良好', low: '一般', none: '偏弱' };
    return `<span class="gr-pill lv-${lv}">${map[lv]}</span>`;
  }

  // WMO 天气代码 → 简洁天气图标（与emoji风格一致，一眼可读）
  function weatherIcon(code) {
    const c = Number(code);
    if (c === 0) return '☀️';
    if (c === 1) return '🌤️';
    if (c === 2) return '⛅';
    if (c === 3) return '☁️';
    if (c === 45 || c === 48) return '🌫️';
    if (c >= 51 && c <= 57) return '🌦️';
    if (c >= 61 && c <= 67) return '🌧️';
    if (c >= 71 && c <= 77) return '❄️';
    if (c >= 80 && c <= 82) return '🌦️';
    if (c >= 85 && c <= 86) return '🌨️';
    if (c >= 95) return '⛈️';
    return '☁️';
  }

  function renderGlance() {
    const box = $('glanceList');
    const snow = state.mode === 'snow';
    $('glanceTitle').textContent = snow ? '今日雪讯速览' : '晴夜观星速览';
    $('glanceTag').textContent = '全国 TOP 5 · 逐日 14 天 · 天气预报';
    // 两模式统一用 recommendations（都带逐日 days），保证逻辑/UI 一致
    const recs = (((state.board || {}).recommendations) || []).slice(0, 5);
    const rows = recs.map((h) => {
      const days = h.days || [];
      const vals = days.map((d) => Number(d && d.value) || 0);
      let peak = 0, peakIdx = -1;
      vals.forEach((v, i) => { if (v > peak) { peak = v; peakIdx = i; } });
      const metric = snow ? Math.round(h.prob || 0) : Math.round(h.score || 0);
      return {
        id: h.id, name: h.name, dist: h.distance_km,
        metric: snow ? metric + '%' : String(metric),
        metricRaw: metric,
        level: h.level || (snow ? h.rating : ''),
        days, recDate: h.date || '', reason: h.reason || '',
        trend: dayTrend(days), peak, peakIdx,
      };
    });
    box.innerHTML = rows.length ? rows.map((r, i) => {
      const cells = r.days.slice(0, 14).map((d, di) => {
        const v = Number(d && d.value) || 0;
        const isRec = String(d.date || '') === r.recDate;
        const full = String(d.date || '');
        const dd = full.slice(8) || full.slice(-2);
        const icon = weatherIcon(d.weather_code);
        const hi = d.temp_max != null ? Math.round(d.temp_max) : null;
        const lo = d.temp_min != null ? Math.round(d.temp_min) : null;
        const temp = hi != null && lo != null ? `${hi}°/${lo}°` : (hi != null ? `${hi}°` : (lo != null ? `${lo}°` : '—'));
        const cls = `gr-day${isRec ? ' is-rec' : ''}`;
        const mark = isRec ? ' · 推荐日' : '';
        return `<span class="${cls}" title="${esc(full)} · ${icon} ${temp} · ${v}${snow ? '%降雪概率' : '分观星指数'}${mark}">
          <small class="grd-date">${esc(dd)}</small>
          <i class="grd-icon">${icon}</i>
          <span class="grd-temp">${esc(temp)}</span>
        </span>`;
      }).join('');
      return `<div class="glance-row">
        <span class="gr-col-gr" data-col="rank"><span class="gr-rank r${i + 1}">${i + 1}</span></span>
        <span class="gr-col-city" data-col="city"><b>${esc(r.name)}</b><small>${r.dist != null ? '距上海 ' + r.dist + 'km' : ''}</small></span>
        <span class="gr-col-metric" data-col="metric"><span class="gr-metric">${snow ? '❄' : '✦'} <em>${esc(r.metric)}</em></span>${levelPill(r.metricRaw)}</span>
        <span class="gr-col-trend" data-col="trend"><span class="gr-trend ${r.trend.dir}" title="未来走势 ${esc(r.trend.text)}">${r.trend.dir === 'up' ? '↗' : r.trend.dir === 'down' ? '↘' : '→'}<em>${esc(r.trend.text)}</em></span></span>
        <span class="gr-col-days" data-col="days"><span class="gr-days">${cells || '<small class="muted">暂无逐日</small>'}</span></span>
        <span class="gr-col-peak" data-col="peak"><span class="gr-peak"><small>峰值</small><b>${r.peak}${snow ? '%' : '分'}</b></span></span>
      </div>`;
    }).join('') : '<div class="muted">暂无数据</div>';
    // 点整行进入该城 15 天详情
    box.querySelectorAll('.glance-row').forEach((el, i) => {
      el.addEventListener('click', () => { const r = rows[i]; if (r) openDetail(r.id, r.name); });
      el.classList.add('is-clickable');
    });
  }

  function countUp(el, target) {
    if (!el) return;
    const t = Number(target);
    if (!isFinite(t)) { el.textContent = target; return; }
    if ((window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) {
      el.textContent = t; return;
    }
    const t0 = performance.now(), dur = 620, from = 0;
    el._ct = (el._ct || 0) + 1;
    const token = el._ct;
    (function step(now) {
      if (el._ct !== token) return;
      const p = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(from + (t - from) * e);
      if (p < 1) requestAnimationFrame(step);
    })(t0);
  }

  function secondWindowText(rec, board, snow) {
    const fmtDate = (d) => String(d || '').slice(5);
    // 优先：榜首城市自身的第二窗口期
    let city = rec && rec.name;
    let sw = rec && rec.second_window;
    if (!sw && board) {
      // 退化：另一座推荐城市的次窗口，实现「每日播报多个有概率的城市」
      const alt = ((board.recommendations || []) || []).slice(1).find((x) => x.second_window);
      if (alt) { city = alt.name; sw = alt.second_window; }
    }
    if (!sw) return '';
    const d = fmtDate(sw.date_start || sw.label);
    if (snow) {
      const p = sw.prob != null ? Math.round(sw.prob) + '%' : '';
      return `另：${city} ${d} 前后还有一波降雪${p ? '（' + p + ' · 远期参考）' : '（远期参考）'}`;
    }
    const s = sw.score != null ? '观星分 ' + sw.score : '';
    return `另：${city} ${d} 前后另有一窗晴夜${s ? '（' + s + ' · 远期参考）' : '（远期参考）'}`;
  }

  function renderHomeHero(info) {
    const snow = state.mode === 'snow';
    const hero = $('homeHero');
    hero.classList.toggle('is-snow', snow);
    const b = info && info.board || state.board;
    const rec = b && (b.recommendations || [])[0];
    const top = b && (b.highlights || [])[0];
    const pin0 = (((state.pinSummary || {}).items) || [])[0];
    const pinMoon = pin0 && (pin0.days || [])[0];
    // 月面优先用推荐城市自身数据，退化时用常驻城市首日
    const moonPctSrc = rec && rec.moon_illumination != null ? rec.moon_illumination
      : (pinMoon && pinMoon.moon_illumination);
    const moonPct = moonPctSrc != null ? Math.round(moonPctSrc) + '%' : '—';
    state.heroRec = rec || null;
    let ctaId = null, ctaName = null;

    $('homeKicker').textContent = snow ? '❄ 推荐赏雪地 · 实时更新' : '✦ 推荐观星地 · 实时更新';
    $('homeCity').textContent = rec ? rec.name : (state.city ? state.city.name : '—');
    $('homeDist').textContent = rec && rec.distance_km != null
      ? '距上海 ' + rec.distance_km + 'km' : '';
    const value = rec ? (snow ? rec.prob : rec.score)
      : (top ? (snow ? top.snow_probability : top.score) : null);
    countUp($('homeMetric'), value != null ? Math.round(value) : '--');
    $('homeMetricUnit').textContent = snow ? '%' : '分';
    $('homeDesc').textContent = rec ? rec.reason
      : (b ? (b.summary || '') : (snow ? '正在汇总全国雪景城市…' : '正在汇总全国观星地…'));

    const badges = [];
    if (rec) {
      badges.push('<span class="hb-badge hb-main">👑 今日推荐 #1</span>');
      const lead = rec.lead_days;
      const leadTxt = (lead != null && lead >= 2)
        ? lead + ' 天后' + (snow ? '可赏雪' : '可观星')
        : (rec.day_label || '窗口');
      badges.push(`<span class="hb-badge hb-day">${esc(leadTxt)}</span>`);
      if (rec.is_new) badges.push(`<span class="hb-badge hb-new">✦ 新${snow ? '雪讯' : '晴夜'}</span>`);
      if (rec.distance_km != null && rec.distance_km < 600) {
        badges.push(`<span class="hb-badge hb-rare">近沪${snow ? '稀雪' : '通透'}</span>`);
      }
    }
    $('homeBadges').innerHTML = badges.join('');

    // 热点事件（流星雨 / 冰雪文旅资讯）——推荐卡上的「当下热门」提示
    const hot = $('homeHot');
    const ev = (state.events || [])[0];
    if (hot) {
      if (ev) {
        const metaTxt = (ev.status ? ev.status + ' · ' : '') + (ev.desc || '');
        hot.innerHTML = `<span class="hot-ico">${esc(ev.icon || '✦')}</span>` +
          `<span class="hot-title">${esc(ev.title)}</span>` +
          `<span class="hot-meta">${esc(metaTxt)}</span>`;
        hot.title = (ev.title || '') + (ev.desc ? ' · ' + ev.desc : '');
        hot.style.cursor = 'pointer';
        hot.onclick = () => {
          const list = (state.events || []).slice(0, 4)
            .map((e) => `${e.icon || '•'} ${e.title}（${e.status || ''}）`);
          toast(list.join('　'));
        };
        hot.hidden = false;
      } else {
        hot.hidden = true;
        hot.textContent = '';
      }
    }

    // 信息条：观星=近期天文现象，赏雪=雪景气象，两模式对称、同构同高
    const rdays = (rec && rec.days) || [];
    const rday = rdays.find((d) => d.date === (rec && rec.date)) || rdays[0] || {};
    const facts = [];
    if (rec && snow) {
      facts.push(['降雪量', rec.snowfall_cm != null ? '❄️ ' + rec.snowfall_cm + ' cm' : '--']);
      facts.push(['最低温', rday.temp_min != null ? '🌡️ ' + fmt(rday.temp_min) + '°' : '--']);
      facts.push(['当日天气', weatherIcon(rday.weather_code)]);
      facts.push(['峰值概率', Math.round(rec.prob || 0) + '%']);
    } else if (rec) {
      facts.push(['月相', (rec.moon_phase_name || '—') + ' ' + moonPct]);
      facts.push(['最佳窗口', hhmm(rec.best_window_start) + '–' + hhmm(rec.best_window_end)]);
      facts.push(['云量', rec.cloud_cover != null ? Math.round(rec.cloud_cover) + '%' : '--']);
      facts.push(['观星分', Math.round(rec.score || 0) + ' 分']);
    } else if (b) {
      facts.push([snow ? '有雪城市' : '晴夜城市', String(b.active_cities || 0)]);
      facts.push(['城市·' + (snow ? '日' : '夜'), String(b.total_events || 0)]);
      facts.push(['候选', (b.recommendations || []).length + ' 处']);
      if (!snow) facts.push(['月面', moonPct]);
    }
    $('homeFacts').innerHTML = facts.map(([k, v]) =>
      `<div class="hf-item"><small>${esc(k)}</small><b>${esc(v)}</b></div>`).join('');

    const second = $('homeSecond');
    const swText = secondWindowText(rec, b, snow);
    if (swText) {
      second.textContent = swText;
      second.hidden = false;
    } else {
      second.textContent = '';
      second.hidden = true;
    }

    ctaId = rec ? rec.id : (state.city ? state.city.id : null);
    ctaName = rec ? rec.name : (state.city ? state.city.name : null);
    const cta = $('homeCta');
    cta.classList.toggle('hidden', !ctaId);
    cta.onclick = ctaId ? () => openDetail(ctaId, ctaName) : null;
  }

  async function loadPinnedOnly() {
    const ids = state.pinned[state.mode] || [];
    if (!ids.length) { state.pinSummary = null; renderPinnedCards(); renderGlance(); return; }
    try {
      const j = await API.pinnedSummary(ids, 7, state.mode);
      state.pinSummary = j.data;
    } catch (e) { state.pinSummary = null; }
    renderPinnedCards();
    renderGlance();
  }

  function readHomeCache(mode) {
    try {
      const o = JSON.parse(localStorage.getItem(HOME_CACHE_KEY + '_' + mode) || 'null');
      return o && o.board && o.pinSummary ? o : null;
    } catch (e) { return null; }
  }
  // 首页缓存瘦身：只留渲染首屏所需（推荐 8 条 + 高亮 3 条），丢弃 groups/by_day 等大字段
  function slimBoardForCache(board) {
    if (!board) return board;
    const recs = (board.recommendations || []).slice(0, 8).map((r) => ({
      ...r, days: (r.days || []).slice(0, 14),
    }));
    return {
      generated_at: board.generated_at,
      days: board.days,
      total_cities: board.total_cities,
      active_cities: board.active_cities,
      total_events: board.total_events,
      summary: board.summary,
      recommendations: recs,
      highlights: (board.highlights || []).slice(0, 3),
    };
  }
  function writeHomeCache(mode, board, pinSummary) {
    try {
      localStorage.setItem(HOME_CACHE_KEY + '_' + mode,
        JSON.stringify({ ts: Date.now(), board: slimBoardForCache(board), pinSummary }));
    } catch (e) { /* 容量超限则忽略 */ }
  }
  function paintHome() {
    renderHomeHero({ board: state.board });
    renderPinnedCards();
    renderGlance();
  }
  function stampUpdated(cached) {
    const el = $('updatedAt');
    if (!el) return;
    el.textContent = (cached ? '缓存 ' : '更新于 ') +
      new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }

  async function loadHome() {
    const snow = state.mode === 'snow';
    // stale-while-revalidate：命中缓存先立即渲染，避免开屏长时间空白
    const cached = readHomeCache(state.mode);
    if (cached) {
      state.board = cached.board;
      state.pinSummary = cached.pinSummary;
      buildBoardMap();
      paintHome();
      stampUpdated(true);
    } else {
      progress(10);
    }
    const ids = state.pinned[state.mode] || [];
    const tasks = [
      API.pinnedSummary(ids, 7, state.mode),
      snow ? API.snowBoard(14) : API.stargazingBoard(14),
      API.events(state.mode),
    ];
    const req = (p) => p.catch((e) => ({ _error: e.message }));
    const res = await Promise.all(tasks.map(req));
    let ok = true;
    if (!res[0]._error && res[0].data) state.pinSummary = res[0].data; else ok = false;
    if (!res[1]._error && res[1].data) { state.board = res[1].data; buildBoardMap(); } else ok = false;
    if (!res[2]._error && res[2].data) state.events = res[2].data.items || [];
    if (ok) {
      writeHomeCache(state.mode, state.board, state.pinSummary);
      stampUpdated(false);
    }
    paintHome();
    progress(100);
  }

  function updateHomeLinks() {
    const snow = state.mode === 'snow';
    $('goFullBtn').textContent = snow ? '查看完整雪讯看板 →' : '查看 7 天观星预报 →';
    $('goAnalysisBtn').textContent = snow ? '查看分区城市与亮点 →' : '观星深度分析 →';
  }

  // ---------------- 15 天详情（两模式共用） ----------------
  async function openDetail(id, name) {
    const ci = ((state.cityData || {})[state.mode] || {}).cities || [];
    const c = ci.find((x) => x.id === id);
    // 名称兜底：入参 → 两模式城市表 → pinSummary → id
    let resolvedName = name;
    if (!resolvedName || resolvedName === id) {
      if (c && c.name) resolvedName = c.name;
      else {
        const pin = (((state.pinSummary || {}).items) || []).find((x) => x.id === id);
        if (pin && pin.name) resolvedName = pin.name;
      }
    }
    const allCities = [].concat(
      (((state.cityData || {}).stargazing || {}).cities || []),
      (((state.cityData || {}).snow || {}).cities || [])
    );
    const distCity = c || allCities.find((x) => x.id === id);
    state.detailCity = { id: id, name: resolvedName || id };
    state.detailDays = [];
    state.detailIndex = 0;
    showView('detail');
    $('detailCity').textContent = resolvedName || id;
    $('detailMeta').textContent = distCity && distCity.distance_km != null
      ? '距上海 ' + distCity.distance_km + 'km' : '城市逐日预报';
    $('detailDaysTitle').textContent = state.mode === 'snow' ? '未来 15 天降雪概率' : '未来 15 天观星条件';
    $('detailRange').textContent = '加载中…';
    $('detailDays').innerHTML = '<div class="muted">加载中…</div>';
    $('detailDayTitle').textContent = '单日详情';
    $('detailDayBody').innerHTML = '<div class="muted">加载完成后点选某一天</div>';
    progress(10);
    try {
      const j = state.mode === 'snow' ? await API.snowForecast(id, 15) : await API.stargazingForecast(id, 15);
      state.detailDays = ((j || {}).data || {}).days || [];
      $('detailRange').textContent = state.detailDays.length + ' 天 · ' +
        String(((j || {}).data || {}).generated_at || '').replace('T', ' ');
      renderDetailDays();
      if (state.detailDays.length) showDetailDay(0);
      else $('detailDays').innerHTML = '<div class="muted">暂无预报数据</div>';
    } catch (e) {
      $('detailDays').innerHTML = '<div class="muted">加载失败：' + esc(e.message) + '</div>';
      toast('详情加载失败：' + e.message);
    }
    progress(100);
  }

  function renderDetailDays() {
    const days = state.detailDays;
    const snow = state.mode === 'snow';
    $('detailDays').innerHTML = days.map((d, i) => {
      const v = snow ? (d.snow_probability != null ? d.snow_probability : 0) : (d.score != null ? d.score : 0);
      const extra = snow
        ? fmt(d.temp_min) + '° · 雪 ' + fmt(d.snowfall_cm) + 'cm'
        : (d.cloud_cover != null ? d.cloud_cover + '%云' : '—') + ' · 月 ' + fmt(d.moon_illumination) + '%';
      const label = i === 0 ? '今天' : i === 1 ? '明天' : String(d.date || '').slice(5);
      return `<button type="button" class="dd-day ${i === state.detailIndex ? 'is-active' : ''} lv-${pinLevel(v)}" data-i="${i}">
        <span class="ddd-date">${esc(label)}</span>
        <span class="ddd-value">${v}${snow ? '%' : ''}</span>
        <span class="ddd-bar"><i style="width:${Math.min(100, Math.max(0, v))}%"></i></span>
        <span class="ddd-rating">${esc(d.rating || '')}</span>
        <span class="ddd-extra">${esc(extra)}</span>
      </button>`;
    }).join('');
    $('detailDays').querySelectorAll('.dd-day').forEach((el) => {
      el.addEventListener('click', () => showDetailDay(Number(el.dataset.i)));
    });
  }

  function showDetailDay(i) {
    state.detailIndex = i;
    const d = state.detailDays[i];
    if (!d) return;
    $('detailDays').querySelectorAll('.dd-day').forEach((el, idx) => el.classList.toggle('is-active', idx === i));
    const snow = state.mode === 'snow';
    $('detailDayTitle').textContent = (i === 0 ? '今天' : i === 1 ? '明天' : String(d.date || '').slice(5)) + ' · 指标拆解';
    $('detailDayTag').textContent = d.rating || '';
    const rows = snow
      ? [['降雪概率', d.snow_probability, '%'], ['综合评分', d.score, ''], ['最低气温', d.temp_min, '°C'],
         ['最高气温', d.temp_max, '°C'], ['降雪量', d.snowfall_cm, 'cm'], ['降水概率', d.precip_probability, '%'],
         ['空气湿度', d.humidity, '%']]
      : [['观星指数', d.score, ''], ['夜间均云量', d.cloud_cover, '%'], ['月面亮度', d.moon_illumination, '%'],
         ['最佳窗口', hhmm(d.best_window_start) + '–' + hhmm(d.best_window_end), ''],
         ['窗口均分', d.best_window_avg, ''], ['可观测时长', d.stats && d.stats.observable_hours, 'h'],
         ['夜间时长', d.stats && d.stats.total_night_hours, 'h']];
    $('detailDayBody').innerHTML = `
      <div class="ddb-grid">${rows.map((r) =>
        `<div class="ddb-item"><span>${esc(r[0])}</span><b>${r[1] != null ? esc(r[1]) : '--'}<small>${esc(r[2] || '')}</small></b></div>`).join('')}</div>
      <div class="ddb-note">${esc(snow ? ('雪日评级：' + (d.rating || '') + ' · 降雪量 ' + fmt(d.snowfall_cm) + 'cm') : (d.summary || d.recommendation || ''))}</div>`;
  }

  // ---------------- 模式切换 ----------------
  function setMode(mode) {
    state.mode = mode;
    document.body.dataset.mode = mode;
    document.querySelectorAll('.mode-btn').forEach((b) => {
      const on = b.dataset.mode === mode;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', String(on));
    });
    $('headerNote').textContent = mode === 'snow' ? '今冬第一场雪，在哪里等你' : '今夜哪片天空最清澈';
    document.querySelector('.date-field').classList.toggle('hidden', mode === 'snow');
    closePopover();

    const data = currentCityData();
    if (data && data.cities && data.cities.length) {
      const def = data.cities.find((c) => c.id === data.default) || data.cities[0];
      setCity(def, true);
    }
    renderCityGroups($('citySearch').value);
    updateHomeLinks();
    showView('home');
    loadHome();
  }

  function initEvents() {
    document.querySelectorAll('.mode-btn').forEach((b) => {
      b.addEventListener('click', () => { if (b.dataset.mode !== state.mode) setMode(b.dataset.mode); });
    });
    $('datePicker').addEventListener('change', (e) => {
      API.date = e.target.value;
      if (state.view === 'home') loadHome();
      else if (state.view === 'stargazing') loadStargazing();
    });
    $('refreshBtn').addEventListener('click', () => {
      if (state.view === 'home') loadHome();
      else if (state.view === 'snow') loadSnowBoard();
      else if (state.view === 'stargazing') loadStargazing();
      else if (state.view === 'detail' && state.detailCity) openDetail(state.detailCity.id, state.detailCity.name);
    });
    $('homeBtn').addEventListener('click', () => showView('home'));
    $('detailBack').addEventListener('click', () => showView('home'));
    const goFull = () => {
      if (state.mode === 'snow') {
        showView('snow');
        if (state.board) renderSnow(); else loadSnowBoard();
      } else {
        showView('stargazing');
        loadStargazing();
      }
    };
    $('goFullBtn').addEventListener('click', goFull);
    $('goAnalysisBtn').addEventListener('click', () => {
      goFull();
      setTimeout(() => {
        const el = $(state.mode === 'snow' ? 'snowHighlights' : 'sgTimeline');
        if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 180);
    });
    let rt = null;
    window.addEventListener('resize', () => {
      clearTimeout(rt);
      rt = setTimeout(() => {
        if (state.mode === 'stargazing' && state.hourlyCfg) {
          Charts.multiLine($('hourlyChart'), state.hourlyCfg);
        }
      }, 180);
    });
  }

  async function init() {
    initPicker();
    initEvents();
    $('datePicker').value = API.date;
    progress(15);
    try {
      const [sg, sn] = await Promise.all([API.cities('stargazing'), API.cities('snow')]);
      state.cityData = { stargazing: sg, snow: sn };
      progress(45);
    } catch (e) {
      toast('城市列表加载失败：' + e.message);
    }
    setMode('stargazing');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
