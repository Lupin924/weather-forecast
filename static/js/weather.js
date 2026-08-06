// 天气渲染：实况 / 预报 / 逐小时元信息 / 多模型 / 天文 / 系统分析 / 空气质量

// 天气图标映射（WMO code + CMA 中文文本）
function weatherIcon(code, text) {
  const t = (text || '').trim();
  if (t.includes('雷')) return '⛈️';
  if (t.includes('大雪') || t.includes('暴雪')) return '❄️';
  if (t.includes('雪')) return '🌨️';
  if (t.includes('大雨') || t.includes('暴雨')) return '🌧️';
  if (t.includes('中雨')) return '🌧️';
  if (t.includes('小雨') || t.includes('毛雨')) return '🌦️';
  if (t.includes('雾') || t.includes('霾')) return '🌫️';
  if (t.includes('阴')) return '☁️';
  if (t.includes('多云')) return '⛅';
  if (t.includes('晴')) return '☀️';
  // WMO code 兜底
  const c = code == null ? -1 : code;
  if (c === 0) return '☀️';
  if (c <= 3) return '⛅';
  if (c <= 48) return '🌫️';
  if (c <= 57) return '🌦️';
  if (c <= 67) return '🌧️';
  if (c <= 77) return '🌨️';
  if (c <= 82) return '🌦️';
  if (c >= 95) return '⛈️';
  return '🌤️';
}

function safe(v, unit = '', digits) {
  if (v == null || v === '') return '—';
  if (digits != null && typeof v === 'number') return v.toFixed(digits) + unit;
  return v + unit;
}

function windDirText(deg) {
  if (deg == null) return '';
  const dirs = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
  return dirs[Math.round(deg / 45) % 8] + '风';
}

// 实况卡
function renderNow(data) {
  const el = document.getElementById('nowBody');
  const card = document.getElementById('nowCard');

  // 获取当前城市名称
  const cityName = (typeof API !== 'undefined' && API.currentCity) ? API.currentCity : '';

  if (!data) {
    el.className = 'placeholder';
    el.innerHTML = (cityName ? '<div class="city-name">📍 ' + cityName + '</div>' : '') +
      '⚠️ 暂无实况数据，该城市可能不在 CMA 覆盖范围内';
    card.classList.add('no-data');
    return;
  }
  card.classList.remove('no-data');

  // 预报模式 / 不可用模式
  if (data.mode === 'unavailable') {
    el.className = 'placeholder';
    el.innerHTML = (cityName ? '<div class="city-name">📍 ' + cityName + '</div>' : '') +
      '<div class="no-data-hint">📅 ' + (data.message || '该日期暂无实况数据') + '</div>' +
      '<div class="meta-row">点击预报卡前 3 天日期可查看预报详情</div>';
    return;
  }

  const d = data;
  const mode = d.mode || 'realtime';
  const isForecast = mode === 'forecast';
  const modeBadge = isForecast ? '<span class="mode-badge forecast-badge">🔮 预报模式</span>' : '';
  const alarmsHtml = (d.alarms || []).map((a, idx) => {
    const sev = a.severity || 'BLUE';
    // 添加 animate-once 类实现一次性入场动画，避免持续闪烁
    return `<span class="alarm-badge alarm-${sev} animate-once" style="animation-delay:${idx * 0.1}s">⚠️ ${a.title || a.signaltype || ''}</span>`;
  }).join('');
  el.className = '';
  const lastUpdateText = isForecast && d.last_update
    ? d.last_update.slice(11, 16) + ' 预报值'
    : safe(d.last_update);
  const sourceText = isForecast ? 'Open-Meteo预报' : 'CMA';
  // 预报模式显示最高/最低气温，实况模式显示当前温度
  const tempDisplay = isForecast && d.temperature_max != null && d.temperature_min != null
    ? `<span class="d-high">${safe(d.temperature_max, '°')}</span> / <span class="d-low">${safe(d.temperature_min, '°')}</span>`
    : `${safe(d.temperature, '°C')}`;
  el.innerHTML = `
    ${cityName ? '<div class="city-name">📍 ' + cityName + modeBadge + '</div>' : (modeBadge ? '<div>' + modeBadge + '</div>' : '')}
    <div class="now-main">
      <div class="now-temp">${tempDisplay}</div>
      <div>
        <div class="now-feels">体感 ${safe(d.feels_like, '°C')}</div>
        <div class="now-feels">${d.wind_direction || windDirText(d.wind_direction_degree)} ${safe(d.wind_scale) || safe(d.wind_speed, 'm/s')}</div>
      </div>
    </div>
    <div class="now-grid">
      <div class="now-item"><div class="label">气压</div><div class="value">${safe(d.pressure, ' hPa')}</div></div>
      <div class="now-item"><div class="label">湿度</div><div class="value">${safe(d.humidity, '%')}</div></div>
      <div class="now-item"><div class="label">降水</div><div class="value">${safe(d.precipitation, ' mm')}</div></div>
    </div>
    <div class="alarms">${alarmsHtml}</div>
    <div class="meta-row">更新: ${lastUpdateText} · 来源: ${sourceText}</div>
  `;
}

// 根据月相值生成 SVG 亮区路径
// phase ∈ [0,1): 0 新月, 0.25 上弦(右半亮), 0.5 满月, 0.75 下弦(左半亮)
function moonPhasePath(phase, R) {
  const cx = R, cy = R;
  const theta = 2 * Math.PI * phase;
  const rx = R * Math.cos(theta);        // 带符号的晨昏线半宽
  const arx = Math.max(0.01, Math.abs(rx)); // 避免 0 半轴导致路径退化
  const waxing = phase < 0.5;            // 盈月右侧亮，亏月左侧亮
  const top = `${cx} ${cy - R}`;
  const bot = `${cx} ${cy + R}`;
  const limbSweep = waxing ? 1 : 0;      // 盈月走右半圆(顺时针)，亏月走左半圆(逆时针)
  const termSweep = waxing ? (rx < 0 ? 1 : 0) : (rx < 0 ? 0 : 1);
  return `M ${top} A ${R} ${R} 0 0 ${limbSweep} ${bot} A ${arx} ${R} 0 0 ${termSweep} ${top} Z`;
}

// 天文卡
function renderAstronomy(data) {
  const el = document.getElementById('astroBody');
  const card = document.getElementById('astroCard');
  if (!data) { 
    el.className = 'placeholder'; 
    el.textContent = '⚠️ 暂无天文数据'; 
    card.classList.add('no-data');
    return; 
  }
  card.classList.remove('no-data');
  const illum = data.moon_illumination != null ? data.moon_illumination : 0;
  const phase = data.moon_phase != null ? data.moon_phase : 0;
  const R = 40;
  const litPath = moonPhasePath(phase, R);
  const glow = 4 + illum * 0.2;
  el.className = '';
  el.innerHTML = `
    <div class="astro-main">
      <svg width="80" height="80" viewBox="0 0 80 80" style="flex-shrink:0;filter:drop-shadow(0 0 ${glow}px rgba(240,230,210,${0.1 + illum/250}));">
        <defs>
          <radialGradient id="moonLit" cx="35%" cy="35%">
            <stop offset="0%" stop-color="#f5ecd6"/>
            <stop offset="100%" stop-color="#b8ad94"/>
          </radialGradient>
        </defs>
        <circle cx="40" cy="40" r="40" fill="#2a2f38"/>
        <path d="${litPath}" fill="url(#moonLit)"/>
      </svg>
      <div class="moon-info">
        <div class="phase-name">${data.moon_phase_name || '—'}</div>
        <div class="illum">照亮 ${safe(illum, '%')}</div>
      </div>
    </div>
    <div class="astro-times">
      <div class="now-item"><div class="label">🌅 日出</div><div class="value">${safe((data.sunrise||'').slice(11,16))}</div></div>
      <div class="now-item"><div class="label">🌇 日落</div><div class="value">${safe((data.sunset||'').slice(11,16))}</div></div>
      <div class="now-item"><div class="label">🌕 月出</div><div class="value">${safe((data.moonrise||'').slice(11,16))}</div></div>
      <div class="now-item"><div class="label">🌑 月落</div><div class="value">${safe((data.moonset||'').slice(11,16))}</div></div>
    </div>
  `;
}

// 空气质量 / 光污染卡
function renderAirQuality(data) {
  const el = document.getElementById('airBody');
  const card = document.getElementById('airCard');
  if (!data) {
    el.className = 'placeholder';
    el.textContent = '⚠️ 暂无空气质量数据';
    card.classList.add('no-data');
    return;
  }
  card.classList.remove('no-data');

  const lightPollution = data.light_pollution || {};

  // 判断是否为预报模式（未来日期）— 使用本地日期避免 UTC 偏移
  const _now = new Date();
  const todayStr = _now.getFullYear() + '-' + String(_now.getMonth() + 1).padStart(2, '0') + '-' + String(_now.getDate()).padStart(2, '0');
  const targetDate = (typeof API !== 'undefined' && API.date) ? API.date : todayStr;
  const isForecast = targetDate !== todayStr;

  // 从 hourly 中选取目标日期同时刻代表值
  let aqi = null, pm2_5 = null, pm10 = null, repHour = null;
  if (isForecast && data.hourly && data.hourly.time) {
    const times = data.hourly.time;
    const currentHour = new Date().getHours();
    let bestDiff = 99;
    for (let i = 0; i < times.length; i++) {
      if (!times[i].startsWith(targetDate)) continue;
      try {
        const h = parseInt(times[i].slice(11, 13));
        const d = Math.abs(h - currentHour);
        if (d < bestDiff) {
          bestDiff = d;
          aqi = data.hourly.aqi[i];
          pm2_5 = data.hourly.pm2_5 ? data.hourly.pm2_5[i] : null;
          pm10 = data.hourly.pm10 ? data.hourly.pm10[i] : null;
          repHour = h;
        }
      } catch (e) { /* skip */ }
    }
  } else {
    const current = data.current || {};
    aqi = current.aqi;
    pm2_5 = current.pm2_5;
    pm10 = current.pm10;
  }

  // 预报模式下无数据
  const noAqiData = isForecast && aqi == null;

  // AQI 等级
  let aqiClass = 'aqi-good';
  let aqiText = '优';
  if (aqi != null) {
    if (aqi <= 50) { aqiClass = 'aqi-good'; aqiText = '优'; }
    else if (aqi <= 100) { aqiClass = 'aqi-moderate'; aqiText = '良'; }
    else if (aqi <= 150) { aqiClass = 'aqi-unhealthy'; aqiText = '轻度污染'; }
    else { aqiClass = 'aqi-hazardous'; aqiText = '中重度污染'; }
  }

  // 光污染等级（基于 Bortle 暗空分类 1-9 级）
  const bortle = lightPollution.bortle;
  const lpName = lightPollution.label || '未知';
  const lpSqm = lightPollution.sqm;
  const lpMilkyWay = lightPollution.milky_way || '';
  const lpMethod = lightPollution.method || '';
  const lpDataSource = lightPollution.data_source || '';

  // Bortle 等级对应的 CSS 类
  let lpClass = 'lp-unknown';
  if (bortle != null) {
    if (bortle <= 2) lpClass = 'lp-excellent';
    else if (bortle <= 4) lpClass = 'lp-good';
    else if (bortle <= 5) lpClass = 'lp-moderate';
    else if (bortle <= 7) lpClass = 'lp-poor';
    else lpClass = 'lp-severe';
  }

  const modeBadge = isForecast && !noAqiData
    ? `<span class="mode-badge forecast-badge">🔮 预报 ${String(repHour).padStart(2,'0')}:00</span>`
    : '';
  const aqiDisplay = noAqiData
    ? `<div class="aqi-big aqi-good" style="opacity:0.5">—<div style="font-size:12px;margin-top:4px;">超出3天范围</div></div>`
    : `<div class="aqi-big ${aqiClass}">${aqi != null ? aqi : '—'}<div style="font-size:14px;margin-top:4px;">${aqiText}</div></div>`;
  const pollutantRow = noAqiData
    ? `<div style="font-size:12px;color:var(--text-dim);padding:8px 0;">该日期超出空气质量预报范围（最多3天）</div>`
    : `<div class="air-items">
        <div class="now-item"><div class="label">PM2.5</div><div class="value">${safe(pm2_5, ' μg/m³')}</div></div>
        <div class="now-item"><div class="label">PM10</div><div class="value">${safe(pm10, ' μg/m³')}</div></div>
        ${isForecast
          ? '<div class="now-item"><div class="label">O₃</div><div class="value">—</div></div><div class="now-item"><div class="label">NO₂</div><div class="value">—</div></div>'
          : `<div class="now-item"><div class="label">O₃</div><div class="value">${safe((data.current||{}).ozone, ' μg/m³')}</div></div>
             <div class="now-item"><div class="label">NO₂</div><div class="value">${safe((data.current||{}).nitrogen_dioxide, ' μg/m³')}</div></div>`
        }
      </div>`;

  el.className = '';
  el.innerHTML = `
    <div class="air-main">
      ${aqiDisplay}
      <div>
        ${modeBadge ? '<div style="margin-bottom:6px;">' + modeBadge + '</div>' : ''}
        <div style="margin-bottom:6px;">
          <span class="light-pollution-badge ${lpClass}">💡 Bortle ${bortle != null ? bortle : '?'}级 · ${lpName}</span>
          ${lpSqm != null ? `<span style="font-size:12px;color:var(--text-dim);margin-left:8px;">SQM ${lpSqm}</span>` : ''}
        </div>
        ${lpMilkyWay ? `<div style="font-size:12px;color:var(--text-dim);margin-bottom:4px;">🌌 ${lpMilkyWay}</div>` : ''}
        ${lpMethod ? `<div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;">${lpMethod}</div>` : ''}
        ${pollutantRow}
      </div>
    </div>
    <div class="meta-row">
      ${lpDataSource ? '光污染: ' + lpDataSource + ' · ' : ''}空气质量: ${isForecast ? 'Open-Meteo 预报' : 'Open-Meteo Air Quality API'}
    </div>
    ${data._error ? '<div style="color:var(--orange);font-size:12px;margin-top:4px;">⚠️ 部分数据获取失败，显示估算值</div>' : ''}
  `;
}

// 7-16 天预报
function renderForecast(daily) {
  const el = document.getElementById('forecastBody');
  const card = document.querySelector('#forecastBody').closest('.card');
  if (!daily || !daily.length) {
    el.className = 'forecast-strip placeholder';
    el.textContent = '⚠️ 暂无预报数据';
    card.classList.add('no-data');
    return;
  }
  card.classList.remove('no-data');
  // 使用本地日期避免 toISOString 的 UTC 偏移
  const now = new Date();
  const today = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
  // 计算前 3 天可点击日期（今天 + 未来 2 天）
  const clickable = new Set();
  for (let n = 0; n < 3; n++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + n);
    const ds = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    clickable.add(ds);
  }
  const selectedDate = (typeof API !== 'undefined' && API.date) ? API.date : today;
  el.className = 'forecast-strip';
  el.innerHTML = daily.map(d => {
    const isToday = d.date === today;
    const isSelected = d.date === selectedDate;
    const isClickable = clickable.has(d.date);
    const cls = ['day-card'];
    if (isToday) cls.push('today');
    if (isSelected) cls.push('selected');
    if (isClickable) cls.push('clickable'); else cls.push('disabled');
    const icon = weatherIcon(null, d.day_text);
    return `<div class="${cls.join(' ')}" data-date="${d.date}">
      <div class="d-date">${d.date.slice(5)}</div>
      <div class="d-icon">${icon}</div>
      <div class="d-temp"><span class="d-high">${safe(d.high,'°')}</span> / <span class="d-low">${safe(d.low,'°')}</span></div>
      <div class="d-text">${d.day_text || '—'}${d.precipitation != null ? ' · '+d.precipitation+'mm' : ''}</div>
    </div>`;
  }).join('');
}

// 逐小时元信息
function renderHourly(points, sources) {
  document.getElementById('hourlyDateTag').textContent = points.length ? points[0].time.slice(0, 10) : '';
  const srcSet = [...new Set(points.map(p => p.source).filter(Boolean))];
  document.getElementById('hourlyMeta').innerHTML = `共 ${points.length} 小时 · 来源: ${srcSet.join(' + ') || 'Open-Meteo'}`;
  Charts.hourly(points);
}

// 多模型对比表
function renderMultimodel(data) {
  const el = document.getElementById('multimodelBody');
  const card = document.querySelector('#multimodelBody').closest('.card');
  if (!data) { 
    el.className = 'placeholder'; 
    el.textContent = '⚠️ 暂无多模型数据'; 
    card.classList.add('no-data');
    return; 
  }
  card.classList.remove('no-data');
  const row = (name, v, cls = '') => `<tr class="${cls}">
    <td>${name}</td>
    <td>${safe(v.high,'°C')}</td><td>${safe(v.low,'°C')}</td>
    <td>${safe(v.precipitation,' mm')}</td><td>${safe(v.cloud_cover_mean,' %')}</td>
    <td>${safe(v.wind_speed_max,' km/h')}</td></tr>`;
  const div = data.divergence || {};
  const divBadge = (d) => d ? `<span class="div-badge div-${d}">${d}</span>` : '';
  el.className = '';
  el.innerHTML = `
    <table class="mm-table">
      <thead><tr><th>模型</th><th>最高</th><th>最低</th><th>降水</th><th>云量均值</th><th>最大风速</th></tr></thead>
      <tbody>
        ${row('🇪🇺 ECMWF', data.ecmwf)}
        ${row('🇺🇸 GFS', data.gfs)}
        ${row('⚡ 集成', data.ensemble, 'ens')}
      </tbody>
    </table>
    <div class="meta-row">分歧度 — 气温:${divBadge(div.temperature)} 降水:${divBadge(div.precipitation)} 云量:${divBadge(div.cloud_cover)}</div>
  `;
}

// 天气系统分析
function renderAnalysis(data) {
  const el = document.getElementById('analysisBody');
  const card = document.querySelector('#analysisBody').closest('.card');
  if (!data) { 
    el.className = 'placeholder'; 
    el.textContent = '⚠️ 暂无分析数据'; 
    card.classList.add('no-data');
    return; 
  }
  card.classList.remove('no-data');
  const tagCls = data.system_detected ? 'warn' : 'ok';
  const tagText = data.system_detected ? (data.influence_ended ? '系统已远离' : '影响中') : '无强系统';
  el.className = '';
  el.innerHTML = `
    <div class="analysis-conclusion">
      <span>${data.conclusion}</span>
      <span class="sys-tag ${tagCls}">${tagText}</span>
    </div>
    <div class="meta-row">
      最低气压: ${safe(data.min_pressure,' hPa')} (${safe(data.min_pressure_date)}) ·
      峰值阵风: ${safe(data.peak_gust,' km/h')} ·
      目标日阵风: ${safe(data.target_gust,' km/h')}
    </div>
  `;
  Charts.pressure(data.pressure_series || []);
}
