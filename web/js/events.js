/* 热点事件（流星雨 / 冰雪文旅），搬自 app/services/events.py */
const EVENTS = (() => {
  const METEOR_SHOWERS = [
    { id: 'quadrantids', title: '象限仪座流星雨', month: 1, day: 3, span: 1, peak: '每小时约 80 颗', note: '年初短促而强烈' },
    { id: 'lyrids', title: '天琴座流星雨', month: 4, day: 22, span: 1, peak: '每小时约 18 颗', note: '春季经典流星雨' },
    { id: 'perseids', title: '英仙座流星雨', month: 8, day: 12, span: 2, peak: '每小时约 60–100 颗', note: '夏季观星重头戏' },
    { id: 'orionids', title: '猎户座流星雨', month: 10, day: 21, span: 1, peak: '每小时约 20 颗', note: '哈雷彗星碎片' },
    { id: 'leonids', title: '狮子座流星雨', month: 11, day: 17, span: 2, peak: '每小时约 15 颗', note: '后半夜辐射点升高后更佳' },
    { id: 'geminids', title: '双子座流星雨', month: 12, day: 14, span: 2, peak: '每小时可达 100+ 颗', note: '全年最稳定的流星雨' },
  ];

  const SNOW_EVENTS = [
    { id: 'yabuli_open', title: '亚布力雪季开板', city: '亚布力', start: '2026-11-15', end: '2027-03-31', peak: '粉雪期到来', note: '国内顶级滑雪场开板' },
    { id: 'xuexiang_open', title: '雪乡正式开园', city: '雪乡', start: '2026-11-20', end: '2027-03-10', peak: '童话雪屋季开启', note: '预计 11 月下旬开园' },
    { id: 'iceworld_open', title: '哈尔滨冰雪大世界开园', city: '哈尔滨', start: '2026-12-20', end: '2027-02-28', peak: '全球最大冰雪乐园', note: '预计 12 月下旬开园' },
  ];

  const dayDiff = (a, b) => Math.round((a - b) / 86400000);

  function statusText(start, peak, ref) {
    if (start <= ref && ref <= peak) return ['进行中', dayDiff(peak, ref)];
    const days = dayDiff(peak, ref);
    if (days === 0) return ['今日极大', 0];
    if (days === 1) return ['明晚极大', 1];
    if (days > 1) return [days + ' 天后', days];
    return ['', days];
  }

  function iso(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function meteorItems(ref, windowDays) {
    const out = [];
    for (const yearOffset of [0, 1]) {
      const y = ref.getFullYear() + yearOffset;
      for (const m of METEOR_SHOWERS) {
        const peak = new Date(y, m.month - 1, m.day);
        const span = m.span || 1;
        const start = new Date(peak.getTime() - span * 86400000);
        const end = new Date(peak.getTime() + span * 86400000);
        const d = dayDiff(peak, ref);
        if (d < -3 || d > windowDays) continue;
        const [status, days] = statusText(start, peak, ref);
        out.push({
          id: `${m.id}-${y}`,
          mode: 'stargazing',
          icon: '🌠',
          title: m.title,
          desc: `${m.peak} · ${m.note}`,
          status,
          days_until: days,
          start: iso(start), end: iso(end), peak: iso(peak),
          active: start <= ref && ref <= end,
        });
      }
    }
    return out;
  }

  function snowItems(ref, windowDays) {
    const out = [];
    for (const e of SNOW_EVENTS) {
      const start = new Date(e.start + 'T00:00:00');
      const end = new Date(e.end + 'T00:00:00');
      if (end < ref || dayDiff(start, ref) > windowDays) continue;
      let [status, days] = statusText(start, start, ref);
      if (start <= ref && ref <= end) status = '进行中';
      out.push({
        id: e.id, mode: 'snow', icon: '❄️', title: e.title,
        desc: `${e.peak} · ${e.note}`, city: e.city,
        status, days_until: days,
        start: e.start, end: e.end, peak: e.start,
        active: start <= ref && ref <= end,
      });
    }
    return out;
  }

  function getEvents(mode, windowDays) {
    const wd = windowDays || 60;
    const ref = new Date();
    ref.setHours(0, 0, 0, 0);
    const items = mode === 'snow' ? snowItems(ref, wd) : meteorItems(ref, wd);
    items.sort((a, b) => {
      const urg = (x) => {
        const d = x.days_until;
        if (!x.active && d >= 0 && d <= 7) return [0, d];
        if (x.active) return [1, Math.abs(d)];
        return [2, d];
      };
      const ka = urg(a), kb = urg(b);
      return (ka[0] - kb[0]) || (ka[1] - kb[1]);
    });
    return items;
  }

  return { getEvents };
})();
