/* 轻量 SVG 图表：无外部依赖，浅色配色 */
const Charts = {
  /**
   * 多序列折线图
   * el: 容器；cfg: { labels:[...], series:[{label,color,values,min,max,unit}], height }
   */
  multiLine(el, cfg) {
    if (!el) return;
    const labels = cfg.labels || [];
    const series = (cfg.series || []).filter(s => s && s.values && s.values.length);
    if (!labels.length || !series.length) {
      el.innerHTML = '<div class="muted" style="padding:24px;text-align:center">暂无图表数据</div>';
      return;
    }
    const H = cfg.height || 190;
    const W = Math.max(320, el.clientWidth || 640);
    const pad = { l: 36, r: 14, t: 14, b: 26 };
    const iw = W - pad.l - pad.r;
    const ih = H - pad.t - pad.b;
    const n = labels.length;

    const xAt = i => pad.l + (n === 1 ? iw / 2 : (i * iw) / (n - 1));
    const yAt = (v, s) => {
      let min = s.min, max = s.max;
      if (min == null || max == null) {
        const vals = s.values.filter(v => v != null && !isNaN(v));
        min = Math.min(...vals); max = Math.max(...vals);
        if (max - min < 1e-6) { min -= 1; max += 1; }
        const padV = (max - min) * 0.15;
        min -= padV; max += padV;
      }
      const t = (v - min) / (max - min || 1);
      return pad.t + (1 - Math.max(0, Math.min(1, t))) * ih;
    };

    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="逐小时趋势图">`;
    // 网格 + 左侧 0-100 刻度（用于百分比序列参照）
    for (let g = 0; g <= 4; g++) {
      const y = pad.t + (g * ih) / 4;
      svg += `<line x1="${pad.l}" y1="${y}" x2="${W - pad.r}" y2="${y}" stroke="#eef1f7" stroke-width="1"/>`;
    }
    // x 轴标签（约 6 个）
    const step = Math.max(1, Math.ceil(n / 6));
    for (let i = 0; i < n; i += step) {
      svg += `<text x="${xAt(i)}" y="${H - 7}" text-anchor="middle" font-size="10" fill="#98a3b5">${labels[i]}</text>`;
    }
    // 序列
    series.forEach(s => {
      const pts = s.values.map((v, i) => v == null || isNaN(v) ? null : `${xAt(i).toFixed(1)},${yAt(v, s).toFixed(1)}`).filter(Boolean).join(' ');
      if (!pts) return;
      svg += `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" opacity="${s.opacity || 1}"/>`;
      // 每个数据点挂 tooltip
      s.values.forEach((v, i) => {
        if (v == null || isNaN(v)) return;
        svg += `<circle cx="${xAt(i).toFixed(1)}" cy="${yAt(v, s).toFixed(1)}" r="8" fill="transparent"><title>${labels[i]} · ${s.label} ${v}${s.unit || ''}</title></circle>`;
      });
    });
    svg += '</svg>';
    el.innerHTML = svg;
  },

  /** 简单的水平条形组（用于因子分解） */
  factorBars(el, factors) {
    if (!el || !factors) return;
    const labels = { temp: '气温', precip: '降水', snowfall: '降雪', humidity: '湿度', elevation: '海拔' };
    let h = '';
    for (const [k, v] of Object.entries(factors)) {
      const pct = Math.max(0, Math.min(100, Number(v) || 0));
      h += `<div style="display:flex;align-items:center;gap:8px;font-size:11px;margin:5px 0">
        <span style="width:34px;color:#8b97ab">${labels[k] || k}</span>
        <span style="flex:1;background:#edf1f7;border-radius:4px;height:6px;overflow:hidden">
          <i style="display:block;height:100%;width:${pct}%;background:linear-gradient(90deg,#6cc9e9,#2f92cf);border-radius:4px"></i>
        </span><b style="width:30px;text-align:right">${Math.round(pct)}</b></div>`;
    }
    el.innerHTML = h;
  },
};
