/* 评分算法（搬自后端 snow.py / stargazing.py，口径保持一致） */

const SNOW_SCORING = (() => {
  const SNOW_CODES = new Set([71, 73, 75, 77, 85, 86, 68, 69]);
  const W = { temp: 0.34, precip: 0.26, snowfall: 0.22, humidity: 0.10, elevation: 0.08 };
  const REC_W = { intensity: 0.34, planning: 0.28, rarity: 0.26, quality: 0.12 };

  function ratingFor(score) {
    if (score >= 75) return ['🌨️ 极佳', 'excellent'];
    if (score >= 55) return ['❄️ 较大', 'good'];
    if (score >= 35) return ['🌬️ 可能', 'moderate'];
    return ['☀️ 较小', 'poor'];
  }

  function planningScore(dayIdx) {
    if (dayIdx <= 0) return 0.15;
    if (dayIdx === 1) return 0.35;
    if (dayIdx <= 5) return Math.min(1.0, 0.8 + 0.05 * dayIdx);
    return Math.max(0.45, 1.0 - 0.12 * (dayIdx - 5));
  }

  function tempScore(tMin, tMax) {
    if (tMin == null) return 0.0;
    const ref = tMin < 0 ? tMin : (tMax != null ? tMax : tMin);
    if (ref <= -12) return 90.0;
    if (ref <= -8) return 100.0;
    if (ref <= -3) return 96.0;
    if (ref <= -1) return 82.0;
    if (ref <= 0) return 68.0;
    if (ref <= 1.5) return 40.0;
    if (ref <= 3) return 18.0;
    return 0.0;
  }

  const precipScore = (p) => (p == null ? 0.0 : Math.min(100, p));
  const snowfallScore = (cm) => (cm == null || cm <= 0 ? 0.0 : Math.min(100, 12.0 + cm * 22.0));

  function humidityScore(h) {
    if (h == null) return 50.0;
    if (h >= 85) return 100.0;
    if (h >= 70) return 85.0;
    if (h >= 55) return 60.0;
    if (h >= 40) return 35.0;
    return 15.0;
  }

  function elevationScore(elev) {
    if (elev >= 2000) return 100.0;
    if (elev >= 1500) return 85.0;
    if (elev >= 1000) return 65.0;
    if (elev >= 600) return 45.0;
    if (elev >= 300) return 28.0;
    return 12.0;
  }

  function snowProbability(snowfallCm, precipProb, weatherCodes, tempMin) {
    const codes = weatherCodes.filter((c) => c != null);
    const hasSnowCode = codes.some((c) => SNOW_CODES.has(c));
    let prob;
    if (snowfallCm && snowfallCm > 0) {
      prob = 70.0 + Math.min(30.0, snowfallCm * 8.0);
    } else if (hasSnowCode && (precipProb || 0) > 20 && (tempMin == null ? 99 : tempMin) < 2) {
      prob = 45.0 + (precipProb || 0) * 0.4;
    } else if ((tempMin == null ? 99 : tempMin) < 1 && (precipProb || 0) >= 55) {
      prob = 20.0 + (precipProb || 0) * 0.35;
    } else {
      return 0.0;
    }
    if (tempMin != null && tempMin > 4) prob *= 0.3;
    return Math.round(Math.min(100.0, prob));
  }

  function scoreDay(day, hours, elevation) {
    const rawDate = day.time || day.date || '';
    const d = String(rawDate).slice(0, 10);
    const tMax = day.temperature_2m_max;
    const tMin = day.temperature_2m_min;
    const snowfall = day.snowfall_sum;
    const precipProb = day.precipitation_probability_max;

    const dayHours = hours.filter((h) => String(h.time || '').startsWith(d));
    const codes = dayHours.map((h) => h.weather_code).filter((c) => c != null);
    let dayCode = day.weather_code;
    if (dayCode == null && codes.length) {
      const freq = new Map();
      let bestC = codes[0], bestN = 0;
      for (const c of codes) {
        const n = (freq.get(c) || 0) + 1;
        freq.set(c, n);
        if (n > bestN) { bestN = n; bestC = c; }
      }
      dayCode = bestC;
    }
    const hums = dayHours.map((h) => h.relative_humidity_2m).filter((v) => v != null);
    const humidity = hums.length ? hums.reduce((a, b) => a + b, 0) / hums.length : null;

    const factors = {
      temp: Math.round(tempScore(tMin, tMax) * 10) / 10,
      precip: Math.round(precipScore(precipProb) * 10) / 10,
      snowfall: Math.round(snowfallScore(snowfall) * 10) / 10,
      humidity: Math.round(humidityScore(humidity) * 10) / 10,
      elevation: Math.round(elevationScore(elevation) * 10) / 10,
    };
    let score = factors.temp * W.temp + factors.precip * W.precip
      + factors.snowfall * W.snowfall + factors.humidity * W.humidity
      + factors.elevation * W.elevation;
    score = Math.round(score);
    const prob = snowProbability(snowfall, precipProb, codes, tMin);
    if (prob >= 60 && score < 35) score = 35;
    const [rating, level] = ratingFor(score);

    return {
      date: d,
      weather_code: dayCode,
      temp_max: tMax != null ? Math.round(tMax * 10) / 10 : null,
      temp_min: tMin != null ? Math.round(tMin * 10) / 10 : null,
      snowfall_cm: snowfall != null ? Math.round(snowfall * 10) / 10 : 0.0,
      precip_probability: precipProb != null ? Math.round(precipProb) : null,
      humidity: humidity != null ? Math.round(humidity) : null,
      snow_probability: Math.round(prob),
      score,
      rating,
      level,
      factors,
    };
  }

  function recommendReason(prob, leadDays, rarity, isNew) {
    const parts = [];
    if (leadDays >= 2 && leadDays <= 5) parts.push(leadDays + ' 天后 · 宜规划行程');
    else if (leadDays >= 6) parts.push(leadDays + ' 天后 · 提前锁定');
    else if (leadDays <= 1) parts.push('雪讯临近·适合说走就走');
    if (isNew) parts.push('新出现雪讯');
    if (rarity >= 0.7) parts.push('近沪罕见降雪');
    else if (rarity >= 0.5) parts.push('江南难得雪信');
    if (prob >= 85) parts.push('降雪概率极高');
    else if (prob >= 60) parts.push('雪势强劲');
    if (!parts.length) parts.push('综合雪况优越');
    return parts.slice(0, 3).join(' · ');
  }

  function secondWindow(days, primaryIdx, threshold = 35) {
    const windows = [];
    let cur = null;
    days.forEach((dd, i) => {
      const p = dd.snow_probability || 0;
      if (p >= threshold) {
        if (!cur) cur = { start: i, end: i, peak_i: i, peak: p };
        else {
          cur.end = i;
          if (p > cur.peak) { cur.peak = p; cur.peak_i = i; }
        }
      } else if (cur) { windows.push(cur); cur = null; }
    });
    if (cur) windows.push(cur);
    if (!windows.length) return null;
    const primary = windows.find((w) => w.start <= primaryIdx && primaryIdx <= w.end);
    const others = windows.filter((w) => w !== primary);
    if (!others.length) return null;
    others.sort((a, b) => (b.peak - a.peak) || (b.start - a.start));
    const w2 = others[0];
    const d0 = String(days[w2.start].date || '').slice(0, 10);
    const d1 = String(days[w2.end].date || '').slice(0, 10);
    const label = d0 ? d0.slice(5) : '远期';
    return {
      date_start: d0,
      date_end: d1,
      lead_days: w2.start,
      prob: w2.peak,
      label,
      day_label: w2.start === 0 ? '今天' : (w2.start === 1 ? '明天' : label),
    };
  }

  function buildRecommendations(byId, ids, prevIds) {
    const recs = [];
    for (const cid of ids) {
      const r = byId[cid];
      if (!r) continue;
      const city = r.city;
      const dist = city.distance_km || 3000;
      let day = null, dayIdx = 99, bestSel = -1.0;
      r.days.forEach((dd, i) => {
        const p = dd.snow_probability || 0;
        if (p < 35) return;
        const sel = (p / 100.0) * 0.62 + planningScore(i) * 0.38;
        if (sel > bestSel) { bestSel = sel; day = dd; dayIdx = i; }
      });
      if (!day) continue;

      const prob = day.snow_probability || 0;
      const intensity = Math.min(1.0, prob / 100.0);
      const planning = planningScore(dayIdx);
      const rarity = Math.max(0.0, 1.0 - dist / 2200.0);
      const quality = Math.min(1.0, (day.score || 0) / 100.0);
      let score = Math.round(100 * (REC_W.intensity * intensity + REC_W.planning * planning
        + REC_W.rarity * rarity + REC_W.quality * quality));
      if (rarity >= 0.8 && prob >= 45 && planning >= 0.8) score += 10;
      score = Math.min(100, score);

      const rawDate = day.date || '';
      const dayLabel = dayIdx === 0 ? '今天' : (dayIdx === 1 ? '明天' : String(rawDate).slice(5));
      const isNew = !prevIds.has(cid);
      const compactDays = r.days.slice(0, 14).map((dd) => ({
        date: String(dd.date || '').slice(0, 10),
        value: Math.round(dd.snow_probability || 0),
        level: dd.level || '',
        weather_code: dd.weather_code,
        temp_max: dd.temp_max,
        temp_min: dd.temp_min,
      }));

      recs.push({
        id: cid,
        name: city.name || cid,
        distance_km: dist,
        tags: city.tags || [],
        recommend_score: score,
        days: compactDays,
        prob,
        score: day.score || 0,
        rating: day.rating || '',
        level: day.level || '',
        snowfall_cm: day.snowfall_cm || 0,
        temp_min: day.temp_min,
        date: String(rawDate).slice(0, 10),
        day_label: dayLabel,
        lead_days: dayIdx,
        is_new: isNew,
        reason: recommendReason(prob, dayIdx, rarity, isNew),
        second_window: secondWindow(r.days, dayIdx),
      });
    }
    recs.sort((a, b) => (b.recommend_score - a.recommend_score) || (b.prob - a.prob));
    recs.forEach((r, i) => { r.rank = i + 1; });
    return recs.slice(0, 8);
  }

  return { ratingFor, scoringDay: scoreDay, buildRecommendations, planningScore };
})();


const STAR_SCORING = (() => {
  const W = {
    cloud: 0.22, night_sky: 0.18, moon: 0.13, precipitation: 0.12,
    light_pollution: 0.10, visibility: 0.07, humidity: 0.07, wind: 0.06, air_quality: 0.05,
  };
  const REC_W = { quality: 0.46, planning: 0.30, rarity: 0.24 };

  function ratingFor(score) {
    if (score >= 70) return ['🟢 优', 'excellent'];
    if (score >= 50) return ['🟡 良', 'good'];
    if (score >= 30) return ['🟠 中', 'moderate'];
    return ['🔴 差', 'poor'];
  }

  function planningScore(dayIdx) {
    if (dayIdx <= 0) return 0.15;
    if (dayIdx === 1) return 0.35;
    if (dayIdx <= 5) return Math.min(1.0, 0.8 + 0.05 * dayIdx);
    return Math.max(0.45, 1.0 - 0.12 * (dayIdx - 5));
  }

  function parseDt(s) {
    if (!s) return null;
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  function sunAltitude(t, sunset, sunrise) {
    if (!sunset || !sunrise) return -90.0;
    const tDate = new Date(t.getFullYear(), t.getMonth(), t.getDate());
    if (t <= sunset) {
      const sunriseApprox = new Date(tDate.getTime() + 6 * 3600 * 1000);
      if (t <= sunriseApprox) {
        const deltaH = (t - new Date(sunriseApprox.getTime() - 6 * 3600 * 1000)) / 3600000;
        return Math.max(-90, Math.min(0, -90 + (deltaH / 6) * 90));
      }
      const dayDur = (sunset - sunriseApprox) / 3600000;
      if (dayDur <= 0) return 0;
      const elapsed = (t - sunriseApprox) / 3600000;
      return Math.max(0, Math.sin((elapsed / dayDur) * Math.PI) * 75);
    }
    let nightDur;
    if (sunrise.getDate() === t.getDate()
      && sunrise.getMonth() === t.getMonth()
      && sunrise.getFullYear() === t.getFullYear()) {
      nightDur = (sunrise - sunset) / 3600000;
    } else {
      nightDur = ((sunrise.getTime() + 86400000) - sunset.getTime()) / 3600000;
    }
    if (nightDur <= 0) return -90;
    const elapsed = (t - sunset) / 3600000;
    return Math.max(-90, Math.min(0, -Math.sin((elapsed / nightDur) * Math.PI) * 90));
  }

  function nightSkyScore(alt) {
    if (alt >= 0) return 0.0;
    if (alt >= -6) return 20 + ((0 - alt) / 6) * 20;
    if (alt >= -12) return 40 + ((-6 - alt) / 6) * 25;
    if (alt >= -18) return 65 + ((-12 - alt) / 6) * 20;
    const depth = Math.min(1.0, (Math.abs(alt) - 18) / 72);
    return 85 + depth * 15;
  }

  const cloudScore = (c) => (c == null ? 50.0 : Math.max(0, Math.min(100, 100 - c)));

  function cloudByLayer(total, low, mid, high) {
    const info = {};
    let score = 100.0;
    if (high != null && high > 80) {
      const delta = high * 0.3; score -= delta;
      info.high_layer = `高云${Math.round(high)}%穿透 (扣${Math.round(delta)})`;
    }
    if (mid != null && mid > 50) {
      const delta = mid * 0.6; score -= delta;
      info.mid_layer = `中云${Math.round(mid)}%基本放弃 (扣${Math.round(delta)})`;
    }
    if (low != null && low > 30) {
      const delta = low * 1.0; score -= delta;
      info.low_layer = `低云${Math.round(low)}%完全遮挡 (扣${Math.round(delta)})`;
    }
    return [Math.max(0, Math.min(100, score)), info];
  }

  const liftedIndexScore = (li) => (li == null ? 80.0 : (li < -3 ? 60.0 : (li > 0 ? 90.0 : 75.0)));
  const capeScore = (cape) => (cape == null ? 80.0 : (cape > 1000 ? 60.0 : (cape > 500 ? 75.0 : 90.0)));

  function dewDepressionScore(temp, dew) {
    if (temp == null || dew == null) return [70.0, '露点数据缺'];
    const spread = temp - dew;
    if (spread < 2) return [30.0, `露点分离${spread.toFixed(1)}°C必结露`];
    if (spread < 5) return [60.0, `露点分离${spread.toFixed(1)}°C风险`];
    return [90.0, `露点分离${spread.toFixed(1)}°C安全`];
  }

  function moonScore(illum, belowHorizon, alt) {
    if (belowHorizon) return 100.0;
    if (alt >= 0) return 90.0;
    if (illum == null) return 50.0;
    return Math.max(0.0, 100.0 - illum);
  }

  function precipScore(p) {
    if (p == null) return 80.0;
    if (p <= 0) return 100.0;
    if (p < 0.1) return 85.0;
    if (p < 0.5) return 60.0;
    if (p < 1.0) return 35.0;
    if (p < 2.0) return 15.0;
    return 0.0;
  }

  function visScore(v) {
    if (v == null) return 50.0;
    if (v >= 20) return 100.0;
    if (v <= 2) return 0.0;
    return ((v - 2) / 18) * 100.0;
  }

  function humidityScore(h) {
    if (h == null) return 50.0;
    let base = 100.0;
    if (h < 40) base = Math.max(0.0, 100.0 - (40 - h) * 2.5);
    else if (h > 60) base = Math.max(0.0, 100.0 - (h - 60) * 2.5);
    return Math.max(0.0, Math.min(100.0, base));
  }

  function windScore(gust, wind) {
    const v = gust != null ? gust : wind;
    if (v == null) return 50.0;
    return Math.max(0.0, Math.min(100.0, 100.0 - Math.max(0.0, v - 5.0) * 3.5));
  }

  function lpScore(bortle) {
    if (bortle == null) return 50.0;
    return Math.max(0.0, Math.min(100.0, ((9 - bortle) / 8) * 100));
  }

  function aqScore(aqi) {
    if (aqi == null) return 50.0;
    if (aqi <= 50) return 100.0;
    if (aqi <= 100) return 80.0;
    if (aqi <= 150) return 60.0;
    if (aqi <= 200) return 40.0;
    return 20.0;
  }

  function moonEvents(daily) {
    const ev = [];
    for (const d of daily) {
      const mr = parseDt(d.moonrise);
      const ms = parseDt(d.moonset);
      if (mr) ev.push([mr, 'rise']);
      if (ms) ev.push([ms, 'set']);
    }
    ev.sort((a, b) => a[0] - b[0]);
    return ev;
  }

  function moonUpAt(t, events) {
    let rises = 0, sets = 0;
    for (const [et, k] of events) {
      if (et <= t) { if (k === 'rise') rises++; else sets++; }
    }
    return rises > sets;
  }

  function findBestWindow(nightHours, minDur = 2, maxDur = 8, minScore = 30.0) {
    if (!nightHours.length) return null;
    const sorted = nightHours.slice().sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
    const n = sorted.length;
    if (n < minDur) {
      let best = sorted[0];
      for (const h of sorted) if (h.score > best.score) best = h;
      return best.score < minScore ? null : [best.time, best.time, best.score];
    }
    let bestWindow = null, bestAvg = -1, bestLen = 0;
    const upper = Math.min(n, maxDur);
    for (let size = minDur; size <= upper; size++) {
      for (let i = 0; i <= n - size; i++) {
        const win = sorted.slice(i, i + size);
        const times = win.map((h) => parseDt(h.time));
        if (times.some((t) => t == null)) continue;
        let continuous = true;
        for (let j = 0; j < times.length - 1; j++) {
          if ((times[j + 1] - times[j]) / 1000 > 2 * 3600) { continuous = false; break; }
        }
        if (!continuous) continue;
        const avg = win.reduce((s, h) => s + h.score, 0) / win.length;
        if (avg < minScore) continue;
        if (avg > bestAvg + 0.5 || (Math.abs(avg - bestAvg) <= 0.5 && size > bestLen)) {
          bestAvg = avg;
          bestWindow = [win[0].time, win[win.length - 1].time, avg];
          bestLen = size;
        }
      }
    }
    return bestWindow;
  }

  function worstFactors(nightHours) {
    if (!nightHours.length) return [];
    const total = {}; let count = 0;
    for (const h of nightHours) {
      const bd = h.breakdown || {};
      for (const k of Object.keys(bd)) {
        if (bd[k] == null) continue;
        total[k] = (total[k] || 0) + bd[k];
      }
      count++;
    }
    if (!count) return [];
    const avg = {};
    for (const k of Object.keys(total)) avg[k] = total[k] / count;
    const worst = [];
    if ((avg.cloud == null ? 100 : avg.cloud) < 40) worst.push('云量过大');
    if ((avg.precipitation == null ? 100 : avg.precipitation) < 50) worst.push('降水频繁');
    if ((avg.moon == null ? 100 : avg.moon) < 40) worst.push('月光干扰强');
    if ((avg.humidity == null ? 100 : avg.humidity) < 40) worst.push('湿度偏高');
    if ((avg.wind == null ? 100 : avg.wind) < 40) worst.push('风力较大');
    if ((avg.night_sky == null ? 0 : avg.night_sky) < 50) worst.push('天光较亮');
    return worst.slice(0, 3);
  }

  function generateRecommendation(bestWindowInfo, nightHours) {
    if (!nightHours.length) return '🌅 当前为白天时段，请在日落后查看观星条件。';
    if (!bestWindowInfo) {
      const w = worstFactors(nightHours);
      return `⚠️ 今晚不适合观星（${w.length ? w.join('、') : '综合条件不佳'}），建议改日再试。`;
    }
    const [start, end, avg] = bestWindowInfo;
    const sd = parseDt(start), ed = parseDt(end);
    const hhmm = (d) => (d ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : '');
    const winHours = nightHours.filter((h) => h.time >= start && h.time <= end);
    let bestHour = winHours[0];
    for (const h of winHours) if (!bestHour || h.score > bestHour.score) bestHour = h;
    const bd = (bestHour && bestHour.breakdown) || {};

    const strengths = [], weaknesses = [];
    if ((bd.cloud || 0) >= 80) strengths.push('天空晴朗');
    if ((bd.moon || 0) >= 90) strengths.push('月光影响小');
    if ((bd.night_sky || 0) >= 85) strengths.push('天光条件好');
    if ((bd.precipitation || 0) >= 90) strengths.push('无降水');
    if ((bd.visibility || 0) >= 90) strengths.push('能见度佳');

    if ((bd.cloud == null ? 100 : bd.cloud) < 50) weaknesses.push('云量较多');
    if ((bd.precipitation == null ? 100 : bd.precipitation) < 60) weaknesses.push('有降水风险');
    if ((bd.moon == null ? 100 : bd.moon) < 50) weaknesses.push('月光干扰较大');
    if ((bd.night_sky || 0) < 60) weaknesses.push('天光较亮');
    if ((bd.humidity == null ? 100 : bd.humidity) < 50) weaknesses.push('湿度偏高');
    if ((bd.wind == null ? 100 : bd.wind) < 50) weaknesses.push('风力较大');
    const lpS = bd.light_pollution;
    if (lpS != null && lpS < 30) weaknesses.push('光污染严重');
    else if (lpS != null && lpS < 50) weaknesses.push('光污染明显');

    let trend = '';
    if (winHours.length >= 2) {
      const half = Math.floor(winHours.length / 2);
      const a = winHours.slice(0, half), b = winHours.slice(half);
      const avgA = a.reduce((s, h) => s + h.score, 0) / a.length;
      const avgB = b.reduce((s, h) => s + h.score, 0) / b.length;
      if (avgB - avgA > 8) trend = '，条件逐渐转好';
      else if (avgB - avgA < -8) trend = '，建议尽早观测';
    }

    const factorParts = [];
    if (strengths.length) factorParts.push(strengths.slice(0, 3).join('、'));
    if (weaknesses.length) factorParts.push('需注意' + weaknesses.slice(0, 3).join('、'));
    const factorText = factorParts.length ? factorParts.join('；') : '各项条件均衡';

    const severe = lpS != null && lpS < 30;
    let prefix;
    if (severe && avg >= 70) prefix = '🟡 今晚天气条件尚可，但光污染严重影响观测';
    else if (severe && avg >= 50) prefix = '🟠 今晚观星条件一般（光污染严重）';
    else if (avg >= 70) prefix = '✅ 今晚观星条件优秀';
    else if (avg >= 50) prefix = '🟡 今晚观星条件尚可';
    else if (avg >= 30) prefix = '🟠 今晚观星条件一般';
    else prefix = '🔴 今晚观星条件较差';

    return start === end
      ? `${prefix}，最佳时段约 ${hhmm(sd)}（${factorText}）${trend}。`
      : `${prefix}，推荐观测窗口 ${hhmm(sd)}–${hhmm(ed)}（${factorText}）${trend}。`;
  }

  /* ---- 单夜评分（对应 build_stargazing） ---- */
  function buildNight(lat, lon, elevation, dateStr, fc, aqi, bortleInfo) {
    const daily = fc.daily || [];
    const hourly = fc.hourly || [];
    const targetDay = daily.find((d) => String(d.time).slice(0, 10) === dateStr) || null;

    const sunset = targetDay ? parseDt(targetDay.sunset) : null;
    const nextDate = new Date(dateStr + 'T00:00:00');
    nextDate.setDate(nextDate.getDate() + 1);
    const nextStr = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}-${String(nextDate.getDate()).padStart(2, '0')}`;
    const nextDay = daily.find((d) => String(d.time).slice(0, 10) === nextStr) || null;
    const sunrise = nextDay ? parseDt(nextDay.sunrise) : null;

    const phase = targetDay ? targetDay.moon_phase : null;
    const illum = OM.moonIlluminationFromPhase(phase);
    const events = moonEvents(daily);

    let winStart, winEnd;
    if (sunset && sunrise) {
      winStart = new Date(sunset.getTime() - 30 * 60000);
      winEnd = new Date(sunrise.getTime() + 30 * 60000);
    } else {
      winStart = new Date(`${dateStr}T18:00:00`);
      winEnd = new Date(`${nextStr}T05:00:00`);
    }

    const bortle = bortleInfo ? bortleInfo.bortle : null;
    const lpLabel = bortleInfo ? bortleInfo.label : '未知';
    const hours = [];

    for (const p of hourly) {
      const t = parseDt(p.time);
      if (!t || t < winStart || t > winEnd) continue;

      const alt = sunAltitude(t, sunset, sunrise);
      const sNight = nightSkyScore(alt);
      const below = !moonUpAt(t, events);

      if (alt >= 0) {
        hours.push({
          time: p.time, score: 0.0, rating: '🔴 白天', level: 'daytime',
          cloud_cover: p.cloud_cover, visibility: p.visibility,
          humidity: p.relative_humidity_2m, wind_speed: p.wind_speed_10m,
          wind_gusts: p.wind_gusts_10m, precipitation: p.precipitation,
          moon_illumination: illum, moon_below_horizon: below,
          solar_altitude: Math.round(alt * 10) / 10, night_sky_score: 0.0,
          is_daytime: true,
          breakdown: {
            cloud: Math.round(cloudScore(p.cloud_cover) * 10) / 10,
            moon: Math.round(moonScore(illum, below, alt) * 10) / 10,
            night_sky: 0.0,
            precipitation: Math.round(precipScore(p.precipitation) * 10) / 10,
            light_pollution: null, visibility: null, humidity: null, wind: null, air_quality: null,
          },
        });
        continue;
      }

      const [sCloud, cloudInfo] = cloudByLayer(p.cloud_cover, p.cloud_cover_low, p.cloud_cover_mid, p.cloud_cover_high);
      const sMoon = moonScore(illum, below, alt);
      const sPrecip = precipScore(p.precipitation);
      const sLight = lpScore(bortle);
      const sVis = visScore(p.visibility);
      const sHum = humidityScore(p.relative_humidity_2m);
      const sWind = windScore(p.wind_gusts_10m, p.wind_speed_10m);
      const sAq = aqScore(aqi);
      const [sDew, dewInfo] = dewDepressionScore(p.temperature_2m, p.dew_point_2m);
      const sLi = liftedIndexScore(p.lifted_index);
      const sCape = capeScore(p.cape);

      let score = sCloud * W.cloud + sMoon * W.moon + sNight * W.night_sky
        + sPrecip * W.precipitation + sLight * W.light_pollution + sVis * W.visibility
        + sHum * W.humidity + sWind * W.wind + sAq * W.air_quality;

      if (p.precipitation != null) {
        if (p.precipitation >= 2.0) score *= 0.05;
        else if (p.precipitation >= 1.0) score *= 0.3;
        else if (p.precipitation >= 0.5) score *= 0.6;
      }
      score = Math.round(Math.max(0, Math.min(100, score)) * 10) / 10;
      const [rating, level] = ratingFor(score);

      hours.push({
        time: p.time, score, rating, level,
        cloud_cover: p.cloud_cover, visibility: p.visibility,
        humidity: p.relative_humidity_2m, wind_speed: p.wind_speed_10m,
        wind_gusts: p.wind_gusts_10m, precipitation: p.precipitation,
        moon_illumination: illum, moon_below_horizon: below,
        light_pollution_score: Math.round(sLight * 10) / 10,
        light_pollution_label: lpLabel, bortle,
        air_quality_score: Math.round(sAq * 10) / 10,
        solar_altitude: Math.round(alt * 10) / 10,
        night_sky_score: Math.round(sNight * 10) / 10,
        precipitation_score: Math.round(sPrecip * 10) / 10,
        is_daytime: false,
        breakdown: {
          cloud: Math.round(sCloud * 10) / 10,
          cloud_layers: cloudInfo,
          moon: Math.round(sMoon * 10) / 10,
          night_sky: Math.round(sNight * 10) / 10,
          precipitation: Math.round(sPrecip * 10) / 10,
          light_pollution: Math.round(sLight * 10) / 10,
          visibility: Math.round(sVis * 10) / 10,
          humidity: Math.round(sHum * 10) / 10,
          wind: Math.round(sWind * 10) / 10,
          air_quality: Math.round(sAq * 10) / 10,
          dew_depression: Math.round(sDew * 10) / 10,
          dew_info: dewInfo,
          lifted_index: Math.round(sLi * 10) / 10,
          cape: Math.round(sCape * 10) / 10,
        },
      });
    }

    const nightHours = hours.filter((h) => !h.is_daytime);
    let best = null;
    for (const h of nightHours) if (!best || h.score > best.score) best = h;
    const bestScore = best ? best.score : 0.0;
    const bestWindow = best ? best.time : null;

    const winInfo = findBestWindow(nightHours, 2);
    const recommendation = generateRecommendation(winInfo, nightHours);

    let summary;
    if (!hours.length) summary = '暂无该时段的预报数据。';
    else if (bestScore >= 70) summary = `当晚观星条件优秀，最佳时段 ${bestWindow}（评分 ${bestScore}）。`;
    else if (bestScore >= 50) summary = `当晚观星条件尚可，最佳时段 ${bestWindow}（评分 ${bestScore}）。`;
    else if (bestScore >= 30) summary = `当晚观星条件一般，最佳时段 ${bestWindow}（评分 ${bestScore}）。`;
    else summary = `当晚观星条件较差，最佳时段 ${bestWindow}（评分 ${bestScore}）。`;

    let winDur = 0;
    if (winInfo) {
      const ws = parseDt(winInfo[0]), we = parseDt(winInfo[1]);
      if (ws && we) winDur = Math.max(1, Math.round((we - ws) / 3600000) + 1);
    }

    const excellent = nightHours.filter((h) => h.score >= 70).length;
    const good = nightHours.filter((h) => h.score >= 50).length;
    const observable = nightHours.filter((h) => h.score >= 30).length;
    const avgScore = nightHours.length
      ? Math.round((nightHours.reduce((s, h) => s + h.score, 0) / nightHours.length) * 10) / 10
      : 0.0;

    return {
      date: dateStr,
      hours,
      best_window: bestWindow,
      best_score: bestScore,
      best_window_start: winInfo ? winInfo[0] : null,
      best_window_end: winInfo ? winInfo[1] : null,
      best_window_avg: winInfo ? Math.round(winInfo[2] * 10) / 10 : 0.0,
      best_window_duration: winDur,
      recommendation,
      summary,
      light_pollution_info: bortleInfo,
      air_quality_aqi: aqi,
      sunset: sunset ? sunset.toISOString() : null,
      sunrise: sunrise ? sunrise.toISOString() : null,
      stats: {
        excellent_hours: excellent, good_hours: good,
        observable_hours: observable, total_night_hours: nightHours.length,
        avg_score: avgScore,
      },
    };
  }

  function recommendReason(score, leadDays, rarity, isNew) {
    const parts = [];
    if (leadDays >= 2 && leadDays <= 5) parts.push(leadDays + ' 天后 · 宜规划行程');
    else if (leadDays >= 6) parts.push(leadDays + ' 天后 · 提前锁定');
    else if (leadDays <= 1) parts.push('晴夜临近·适合说走就走');
    if (isNew) parts.push('新出现晴夜');
    if (rarity >= 0.7) parts.push('近沪罕见通透夜空');
    else if (rarity >= 0.5) parts.push('江南难得晴夜');
    if (score >= 85) parts.push('观星条件极佳');
    else if (score >= 70) parts.push('观星条件良好');
    if (!parts.length) parts.push('综合夜空条件优越');
    return parts.slice(0, 3).join(' · ');
  }

  function secondWindow(days, primaryIdx, threshold = 55) {
    const windows = [];
    let cur = null;
    days.forEach((dd, i) => {
      const v = dd.score || 0;
      if (v >= threshold) {
        if (!cur) cur = { start: i, end: i, peak: v };
        else { cur.end = i; if (v > cur.peak) cur.peak = v; }
      } else if (cur) { windows.push(cur); cur = null; }
    });
    if (cur) windows.push(cur);
    if (!windows.length) return null;
    const primary = windows.find((w) => w.start <= primaryIdx && primaryIdx <= w.end);
    const others = windows.filter((w) => w !== primary);
    if (!others.length) return null;
    others.sort((a, b) => (b.peak - a.peak) || (b.start - a.start));
    const w2 = others[0];
    const d0 = String(days[w2.start].date || '').slice(0, 10);
    const d1 = String(days[w2.end].date || '').slice(0, 10);
    const label = d0 ? d0.slice(5) : '远期';
    return {
      date_start: d0, date_end: d1, lead_days: w2.start,
      score: Math.round(w2.peak), label,
      day_label: w2.start === 0 ? '今天' : (w2.start === 1 ? '明天' : label),
    };
  }

  function buildRecommendations(byId, ids, prevIds) {
    const recs = [];
    for (const cid of ids) {
      const r = byId[cid];
      if (!r) continue;
      const city = r.city;
      const dist = city.distance_km || 3000;
      let day = null, dayIdx = 99, bestSel = -1.0;
      r.days.forEach((dd, i) => {
        const v = dd.score || 0;
        if (v < 45) return;
        const sel = (v / 100.0) * 0.62 + planningScore(i) * 0.38;
        if (sel > bestSel) { bestSel = sel; day = dd; dayIdx = i; }
      });
      if (!day) continue;

      const score = day.score || 0;
      const quality = Math.min(1.0, score / 100.0);
      const planning = planningScore(dayIdx);
      const rarity = Math.max(0.0, 1.0 - dist / 2200.0);
      const recScore = Math.min(100, Math.round(100 * (REC_W.quality * quality
        + REC_W.planning * planning + REC_W.rarity * rarity)));

      const rawDate = day.date || '';
      const dayLabel = dayIdx === 0 ? '今天' : (dayIdx === 1 ? '明天' : String(rawDate).slice(5));
      const isNew = !prevIds.has(cid);
      const compactDays = r.days.slice(0, 14).map((dd) => ({
        date: String(dd.date || '').slice(0, 10),
        value: Math.round(dd.score || 0),
        level: dd.level || '',
        cloud: dd.cloud_cover,
        weather_code: dd.weather_code,
        temp_max: dd.temp_max,
        temp_min: dd.temp_min,
      }));

      recs.push({
        id: cid,
        name: city.name || cid,
        distance_km: dist,
        tags: city.tags || [],
        recommend_score: recScore,
        days: compactDays,
        score: Math.round(score),
        rating: day.rating || '',
        level: day.level || '',
        cloud_cover: day.cloud_cover,
        moon_illumination: day.moon_illumination,
        moon_phase_name: day.moon_phase_name,
        best_window_start: day.best_window_start,
        best_window_end: day.best_window_end,
        date: String(rawDate).slice(0, 10),
        day_label: dayLabel,
        lead_days: dayIdx,
        is_new: isNew,
        reason: recommendReason(score, dayIdx, rarity, isNew),
        second_window: secondWindow(r.days, dayIdx),
      });
    }
    recs.sort((a, b) => (b.recommend_score - a.recommend_score) || (b.score - a.score));
    recs.forEach((r, i) => { r.rank = i + 1; });
    return recs.slice(0, 8);
  }

  return { buildNight, ratingFor, buildRecommendations, planningScore, parseDt };
})();
