// 观星条件渲染：圆形评分仪表盘 + 信息卡片 + 增强时间轴 + 加权评分分解

function sgColor(score) {
  if (score >= 70) return '#3fb950';
  if (score >= 50) return '#d29922';
  if (score >= 30) return '#db6d28';
  return '#f85149';
}

function sgColorVar(score) {
  if (score >= 70) return 'var(--green)';
  if (score >= 50) return 'var(--yellow)';
  if (score >= 30) return 'var(--orange)';
  return 'var(--red)';
}

function sgMoonIcon(below, illum) {
  if (below) return '🌑';
  if (illum == null) return '🌕';
  if (illum < 15) return '🌑';
  if (illum < 40) return '🌒';
  if (illum < 60) return '🌓';
  if (illum < 85) return '🌔';
  return '🌕';
}

function sgSkyIcon(altitude) {
  if (altitude == null) return '❓';
  if (altitude >= 0) return '☀️';
  if (altitude >= -6) return '🌆';
  if (altitude >= -12) return '🌃';
  return '🌌';
}

function sgSkyLabel(altitude) {
  if (altitude == null) return '未知';
  if (altitude >= 0) return '白天';
  if (altitude >= -6) return '民用晨昏';
  if (altitude >= -12) return '航海晨昏';
  if (altitude >= -18) return '天文晨昏';
  return '夜晚';
}

function fmtTime(isoStr) {
  if (!isoStr) return '—';
  const parts = isoStr.split('T');
  return parts[1]?.substring(0, 5) || isoStr;
}

// === 圆形评分仪表盘 SVG ===
function sgGaugeSVG(score, color, label) {
  const s = Math.round(score);
  const r = 52;
  const cx = 60, cy = 60;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - Math.max(0, Math.min(100, s)) / 100);

  return `<div class="sg-gauge-wrap">
    <svg class="sg-gauge" viewBox="0 0 120 120" width="120" height="120">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--bg-card-3)" stroke-width="8"/>
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}"
        stroke-width="8" stroke-linecap="round"
        stroke-dasharray="${circumference}"
        stroke-dashoffset="${offset}"
        transform="rotate(-90 ${cx} ${cy})"
        style="transition: stroke-dashoffset 0.8s cubic-bezier(0.4,0,0.2,1);"/>
      <text x="${cx}" y="${cy - 2}" text-anchor="middle" class="sg-gauge-num" fill="${color}">${s}</text>
      <text x="${cx}" y="${cy + 16}" text-anchor="middle" class="sg-gauge-label" fill="var(--text-dim)">${label || '评分'}</text>
    </svg>
  </div>`;
}

function renderStargazing(data) {
  const body = document.getElementById('stargazingBody');
  const sum = document.getElementById('stargazingSummary');
  const breakdown = document.getElementById('stargazingBreakdown');
  const card = document.querySelector('#stargazingBody').closest('.card');

  if (!data || !data.hours || data.hours.length === 0) {
    sum.textContent = '';
    body.className = 'stargaze-timeline placeholder';
    body.textContent = '⚠️ 暂无观星数据';
    card.classList.add('no-data');
    breakdown.classList.add('hidden');
    return;
  }
  card.classList.remove('no-data');

  const nightHours = data.hours.filter(h => !h.is_daytime);
  const stats = data.stats || {};

  // === 1. 摘要区：仪表盘 + 信息卡片 ===
  const sunsetT = fmtTime(data.sunset);
  const sunriseT = fmtTime(data.sunrise);
  const bestT = fmtTime(data.best_window);
  const bestScore = data.best_score != null ? data.best_score : 0;
  const scoreColor = sgColor(bestScore);

  // 连续窗口信息
  const winStart = fmtTime(data.best_window_start);
  const winEnd = fmtTime(data.best_window_end);
  const winAvg = data.best_window_avg != null ? data.best_window_avg : null;
  const winDur = data.best_window_duration || 0;
  const hasWindow = winStart !== '—' && winEnd !== '—' && winStart !== winEnd;

  let summaryHtml = '';

  // 顶部：仪表盘 + 关键信息
  summaryHtml += '<div class="sg-header">';

  // 圆形仪表盘
  summaryHtml += sgGaugeSVG(bestScore, scoreColor, '最佳评分');

  // 右侧关键指标
  summaryHtml += '<div class="sg-header-info">';

  // 建议横幅
  if (data.recommendation) {
    summaryHtml += `<div class="sg-recommendation" style="border-left-color:${scoreColor};">`;
    summaryHtml += `<span class="sg-rec-text">${data.recommendation}</span>`;
    summaryHtml += `</div>`;
  }

  // 核心指标行
  summaryHtml += '<div class="sg-key-metrics">';
  summaryHtml += `<div class="sg-key-metric"><span class="sg-km-icon">🌅</span><span class="sg-km-label">日落</span><span class="sg-km-value">${sunsetT}</span></div>`;
  summaryHtml += `<div class="sg-key-metric"><span class="sg-km-icon">🌄</span><span class="sg-km-label">日出</span><span class="sg-km-value">${sunriseT}</span></div>`;
  if (hasWindow) {
    summaryHtml += `<div class="sg-key-metric sg-km-window" style="--km-color:${scoreColor};"><span class="sg-km-icon">🕐</span><span class="sg-km-label">推荐窗口</span><span class="sg-km-value" style="color:${scoreColor};">${winStart}–${winEnd}</span></div>`;
    if (winDur > 0) {
      summaryHtml += `<div class="sg-key-metric"><span class="sg-km-icon">⏱️</span><span class="sg-km-label">持续时长</span><span class="sg-km-value">${winDur}h</span></div>`;
    }
  } else {
    summaryHtml += `<div class="sg-key-metric"><span class="sg-km-icon">⭐</span><span class="sg-km-label">最佳时段</span><span class="sg-km-value" style="color:${scoreColor};">${bestT}</span></div>`;
  }
  summaryHtml += '</div>'; // sg-key-metrics

  summaryHtml += '</div>'; // sg-header-info
  summaryHtml += '</div>'; // sg-header

  // 统计卡片行
  summaryHtml += '<div class="sg-stats-row">';
  const totalNight = stats.total_night_hours || nightHours.length;
  const excellentH = stats.excellent_hours || 0;
  const goodH = stats.good_hours || 0;
  const observableH = stats.observable_hours || 0;
  const avgSc = stats.avg_score != null ? Math.round(stats.avg_score) : '—';

  summaryHtml += `<div class="sg-stat-chip"><span class="sg-stat-num" style="color:var(--green);">${excellentH}</span><span class="sg-stat-label">优(≥70)h</span></div>`;
  summaryHtml += `<div class="sg-stat-chip"><span class="sg-stat-num" style="color:var(--yellow);">${goodH}</span><span class="sg-stat-label">良(≥50)h</span></div>`;
  summaryHtml += `<div class="sg-stat-chip"><span class="sg-stat-num" style="color:var(--orange);">${observableH}</span><span class="sg-stat-label">可观测(≥30)h</span></div>`;
  summaryHtml += `<div class="sg-stat-chip"><span class="sg-stat-num">${totalNight}</span><span class="sg-stat-label">夜间总h</span></div>`;
  summaryHtml += `<div class="sg-stat-chip"><span class="sg-stat-num" style="color:${sgColor(avgSc)};">${avgSc}</span><span class="sg-stat-label">平均分</span></div>`;
  summaryHtml += '</div>';

  sum.innerHTML = summaryHtml;

  // === 2. 时间轴 ===
  const bestTime = data.best_window;
  const winStartTime = data.best_window_start;
  const winEndTime = data.best_window_end;

  body.className = 'stargaze-timeline';

  if (nightHours.length === 0) {
    body.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-dim);">🌅 当前时段为白天，请等待日落后再来查看</div>';
    breakdown.classList.add('hidden');
    return;
  }

  body.innerHTML = nightHours.map(h => {
    const c = sgColor(h.score);
    const hgt = Math.max(20, h.score * 1.4);
    const isBest = h.time === bestTime;
    const inWindow = hasWindow && h.time >= winStartTime && h.time <= winEndTime;
    const skyIcon = sgSkyIcon(h.solar_altitude);
    const moonIcon = sgMoonIcon(h.moon_below_horizon, h.moon_illumination);
    const precipInfo = h.precipitation != null ? `降水:${h.precipitation}mm` : '';
    const lightPollInfo = h.bortle != null ? `光污染:Bortle ${h.bortle}级(${h.light_pollution_label || ''})` : (h.light_pollution_label ? `光污染:${h.light_pollution_label}` : '');
    const altitudeInfo = h.solar_altitude != null ? `太阳高度:${h.solar_altitude.toFixed(1)}°` : '';
    const nightSkyInfo = h.night_sky_score != null ? `天光:${Math.round(h.night_sky_score)}` : '';
    const moonInfo = h.moon_illumination != null ? `月相:${Math.round(h.moon_illumination)}%` : '';

    let classes = 'sg-hour';
    if (isBest) classes += ' best';
    else if (inWindow) classes += ' in-window';

    // 降水指示
    let precipMarker = '';
    if (h.precipitation != null && h.precipitation > 0.1) {
      const pIntensity = h.precipitation >= 1.0 ? 'heavy' : (h.precipitation >= 0.5 ? 'med' : 'light');
      precipMarker = `<span class="sg-precip-marker ${pIntensity}" title="${precipInfo}">💧</span>`;
    }

    return `<div class="${classes}" title="云量:${h.cloud_cover ?? '—'}% 能见度:${h.visibility ?? '—'}km 湿度:${h.humidity ?? '—'}% 阵风:${h.wind_gusts ?? '—'}km/h ${precipInfo} ${lightPollInfo} ${moonInfo} ${altitudeInfo} ${nightSkyInfo}">
      <span class="sg-time">${h.time.slice(11, 16)}</span>
      <span class="sg-icons">${skyIcon}${precipMarker}</span>
      <div class="sg-bar" style="height:${hgt}px;background:${c};">${Math.round(h.score)}</div>
      <span class="sg-moon-icon">${moonIcon}</span>
      <span class="sg-score" style="color:${c};">${h.rating}</span>
    </div>`;
  }).join('');

  // === 3. 评分分解（加权贡献版） ===
  const bestHour = data.hours.find(h => h.time === bestTime);
  if (bestHour && bestHour.breakdown) {
    breakdown.classList.remove('hidden');
    const bd = bestHour.breakdown;

    const dims = [
      { key: 'cloud',           label: '☁️ 云量',     weight: 0.22 },
      { key: 'night_sky',       label: '🌌 天光',     weight: 0.18 },
      { key: 'moon',            label: '🌙 月相',     weight: 0.13 },
      { key: 'precipitation',   label: '🌧️ 降水',     weight: 0.12 },
      { key: 'light_pollution', label: '💡 光污染',   weight: 0.10 },
      { key: 'visibility',      label: '👁️ 能见度',   weight: 0.07 },
      { key: 'humidity',        label: '💧 湿度',     weight: 0.07 },
      { key: 'wind',            label: '💨 风速',     weight: 0.06 },
      { key: 'air_quality',     label: '🏭 空气质量', weight: 0.05 },
    ];

    let breakdownHtml = '<div class="breakdown-title">📊 最佳时段评分维度分解</div>';
    // 副标题：日落/日出/最佳时间 + 光污染信息
    const bortle = bestHour.bortle;
    const bortleLabel = bestHour.bortle_label || bestHour.light_pollution_label || '';
    const sqm = bestHour.sqm;
    let subtitleParts = [];
    if (sunsetT !== '—') subtitleParts.push(`🌅 日落 ${sunsetT}`);
    if (sunriseT !== '—') subtitleParts.push(`🌄 日出 ${sunriseT}`);
    if (bestT !== '—') subtitleParts.push(`⭐ 最佳 ${bestT}`);
    if (bortle != null) subtitleParts.push(`💡 Bortle ${bortle}级${bortleLabel ? `（${bortleLabel}）` : ''}`);
    if (sqm != null) subtitleParts.push(`SQM ${sqm}`);
    breakdownHtml += `<div class="breakdown-subtitle">${subtitleParts.join(' · ')}</div>`;
    breakdownHtml += '<div class="breakdown-bars">';

    for (const dim of dims) {
      const val = bd[dim.key];
      if (val == null) continue;
      const v = Math.round(val);
      const c = sgColor(v);
      // 加权贡献值
      const contribution = (val * dim.weight).toFixed(1);
      const weightPct = Math.round(dim.weight * 100);

      breakdownHtml += `
        <div class="breakdown-bar-item">
          <div class="breakdown-bar-header">
            <span class="breakdown-bar-label">${dim.label}</span>
            <span class="breakdown-bar-meta">
              <span class="breakdown-bar-weight">${weightPct}%</span>
              <span class="breakdown-bar-value" style="color:${c};">${v}</span>
            </span>
          </div>
          <div class="breakdown-bar-track">
            <div class="breakdown-bar-fill" style="width:${v}%;background:${c};"></div>
          </div>
          <div class="breakdown-bar-contrib">贡献 ${contribution} 分</div>
        </div>`;
    }

    breakdownHtml += '</div>';
    breakdown.innerHTML = breakdownHtml;
  } else {
    breakdown.classList.add('hidden');
  }
}
