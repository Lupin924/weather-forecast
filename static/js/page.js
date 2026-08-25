/* ============================================
 * 独立页面主控（satellite.html / typhoon.html）
 *
 * 功能：
 *  - 复用 satellite.js 的 iframe 注入逻辑
 *  - 加载城市列表，支持切换城市联动
 *  - 切换城市后自动刷新对应 iframe
 *  - 处理主题切换、返回等通用操作
 * ============================================ */

(function () {
  'use strict';

  // 判断当前页面类型（通过 DOM 元素 ID）
  function getPageType() {
    const satCard = document.getElementById('satelliteCard');
    const tyCard = document.getElementById('typhoonCard');
    if (satCard) return 'satellite';
    if (tyCard) return 'typhoon';
    return null;
  }

  // 加载城市列表并填充下拉框
  async function loadCityList() {
    try {
      const r = await API.cities();
      API._cities = r.cities;
      const sel = document.getElementById('citySelect');
      if (sel) {
        sel.innerHTML = '<option value="">-- 选择预设城市 --</option>' +
          r.cities.map(c =>
            '<option value="' + c.id + '"' + (c.id === r.default ? ' selected' : '') + '>' +
            c.name + '（' + c.elevation_m + 'm）</option>'
          ).join('');

        // 保存默认城市
        if (r.default) {
          const def = r.cities.find(c => c.id === r.default);
          if (def) {
            API.currentCity = def;
            updateCityInfo(def);
            refreshCurrentView();
          }
        }

        // 下拉框切换
        sel.addEventListener('change', onCitySelectChange);
      }
    } catch (e) {
      console.error('loadCityList error:', e);
      showToast('城市列表加载失败');
    }
  }

  // 下拉框切换处理
  function onCitySelectChange(e) {
    const cityId = e.target.value;
    if (!cityId) return;
    const city = (API._cities || []).find(c => c.id === cityId);
    if (!city) return;
    API.currentCity = city;
    updateCityInfo(city);
    refreshCurrentView();
  }

  // 更新顶部城市信息显示
  function updateCityInfo(city) {
    const el = document.getElementById('cityInfo');
    if (!el) return;
    if (!city) {
      el.textContent = '未选择城市';
      return;
    }
    const lat = city.latitude != null ? city.latitude : city.lat;
    const lon = city.longitude != null ? city.longitude : city.lon;
    el.innerHTML = '&#x1f4cd; <strong>' + escapeHtml(city.name || '') + '</strong> ' +
      '<span class="coord">(' + lat.toFixed(2) + ', ' + lon.toFixed(2) + ')</span>';
  }

  // 刷新当前视图（换城后调用）
  function refreshCurrentView() {
    const pageType = getPageType();
    const city = API.currentCity;
    if (!city || !pageType) return;
    if (pageType === 'satellite') {
      Satellite.renderSatellite(city);
    } else if (pageType === 'typhoon') {
      Satellite.renderTyphoon(city);
    }
  }

  // 初始化主题切换（从 localStorage 读取）
  function initTheme() {
    const saved = localStorage.getItem('weather-theme');
    if (saved === 'light') {
      document.body.classList.add('light');
    }
    const btn = document.getElementById('themeToggle');
    if (btn) {
      btn.addEventListener('click', () => {
        document.body.classList.toggle('light');
        const mode = document.body.classList.contains('light') ? 'light' : 'dark';
        localStorage.setItem('weather-theme', mode);
        btn.textContent = mode === 'light' ? '☀️' : '🌙';
      });
      btn.textContent = document.body.classList.contains('light') ? '☀️' : '🌙';
    }
  }

  // 返回上一页
  function initBack() {
    const btn = document.getElementById('backBtn');
    if (btn) {
      btn.addEventListener('click', () => {
        if (window.history.length > 1) {
          window.history.back();
        } else {
          window.location.href = '/';
        }
      });
    }
  }

  // 城市搜索（简化版，可选）
  function initSearch() {
    const input = document.getElementById('citySearch');
    const results = document.getElementById('searchResults');
    if (!input || !results) return;
    let timer = null;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      const q = input.value.trim();
      if (!q) {
        results.classList.add('hidden');
        return;
      }
      timer = setTimeout(async () => {
        try {
          const r = await API.searchCities(q);
          const items = (r.results || []).slice(0, 8);
          if (items.length === 0) {
            results.innerHTML = '<div class="no-results">未找到匹配城市</div>';
          } else {
            results.innerHTML = items.map(c =>
              '<div class="result-item" data-id="' + c.id + '">' +
              escapeHtml(c.name) + ' <span class="region">' + escapeHtml(c.region || '') + '</span>' +
              '</div>'
            ).join('');
            // 点击选项
            results.querySelectorAll('.result-item').forEach(item => {
              item.addEventListener('click', () => {
                const cityId = item.dataset.id;
                const city = (API._cities || []).find(c => c.id === cityId) || items.find(c => c.id === cityId);
                if (city) {
                  API.currentCity = city;
                  updateCityInfo(city);
                  refreshCurrentView();
                  // 同步下拉框
                  const sel = document.getElementById('citySelect');
                  if (sel) sel.value = cityId;
                }
                input.value = '';
                results.classList.add('hidden');
              });
            });
          }
          results.classList.remove('hidden');
        } catch (e) {
          console.error('search error:', e);
        }
      }, 250);
    });
  }

  // HTML 转义
  function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function showToast(msg) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.remove('hidden');
    setTimeout(() => t.classList.add('hidden'), 3000);
  }

  // 主入口
  async function init() {
    initTheme();
    initBack();
    initSearch();

    // 绑定 tab 切换事件（复用 satellite.js 的逻辑）
    if (typeof Satellite !== 'undefined') {
      Satellite.init();
    }

    // 加载城市列表并初始化首页
    await loadCityList();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
