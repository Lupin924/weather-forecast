/* ============================================
 * 卫星云图 / 台风追踪模块（FY-4B 真彩云图版）
 *
 * 说明：Windy.com embed 在境内常被网络策略阻断，已改为拉取国家卫星气象中心
 * (NSMC) 风云四号B星中国区域真彩合成云图（img.nsmc.org.cn，境内直连免密钥）。
 *
 * 暴露 API：
 *   Satellite.init()                - 绑定可选 tab 切换（兼容旧结构）
 *   Satellite.renderSatellite(city) - 渲染卫星云图
 *   Satellite.renderTyphoon(city)   - 渲染台风追踪（FY-4B 云图 + 官方路径入口）
 * ============================================ */

(function () {
  'use strict';

  const LOG_PREFIX = '[卫星云图]';
  function logInfo(tag, msg, extra) {
    if (window.console && console.log) {
      extra !== undefined
        ? console.log(LOG_PREFIX + ' [' + tag + '] ' + msg, extra)
        : console.log(LOG_PREFIX + ' [' + tag + '] ' + msg);
    }
  }
  function logError(tag, msg, extra) {
    if (window.console && console.error) {
      extra !== undefined
        ? console.error(LOG_PREFIX + ' [' + tag + '] ' + msg, extra)
        : console.error(LOG_PREFIX + ' [' + tag + '] ' + msg);
    }
  }

  // ====== 工具函数 ======
  function validateLatLon(lat, lon) {
    if (typeof lat !== 'number' || typeof lon !== 'number') return false;
    if (isNaN(lat) || isNaN(lon)) return false;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return false;
    return true;
  }

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getCityCoord(city, key) {
    if (!city) return null;
    if (city[key] != null) return city[key];
    if (key === 'lat') return city.latitude;
    if (key === 'lon') return city.longitude;
    return null;
  }

  // ====== 服务商切换（Windy 默认 / NSMC） ======
  const PROVIDER_KEY = 'weather-sat-provider';

  function getProvider() {
    return localStorage.getItem(PROVIDER_KEY) === 'nsmc' ? 'nsmc' : 'windy';
  }

  function setProvider(p) {
    localStorage.setItem(PROVIDER_KEY, p === 'nsmc' ? 'nsmc' : 'windy');
  }

  function detectPageType() {
    return document.getElementById('typhoonBody') ? 'typhoon' : 'satellite';
  }

  // ====== 云图容器状态 ======
  function showLoading(container) {
    if (!container) return;
    container.classList.remove('placeholder', 'fy4-error');
    container.innerHTML =
      '<div class="fy4-loading"><span class="spinner"></span>' +
      '<span class="loading-text">卫星云图加载中…</span></div>';
  }

  function showError(container, message) {
    if (!container) return;
    container.classList.remove('fy4-loading');
    container.classList.add('fy4-error');
    container.innerHTML =
      '<div class="error-icon">&#x26a0;&#xfe0f;</div>' +
      '<div class="error-text">' + escapeHtml(message) + '</div>' +
      '<button class="retry-btn" type="button">&#x1f504; 重试</button>' +
      '<a class="retry-link" href="https://www.nsmc.org.cn/nsmc/cn/image/index.html?id=FY4B_AGRI_IMG_REGI_GCLR_GLL" target="_blank" rel="noopener">前往国家卫星气象中心查看</a>';
    const btn = container.querySelector('.retry-btn');
    if (btn) {
      btn.addEventListener('click', () => {
        const city = (typeof API !== 'undefined') ? API.currentCity : null;
        if (city) loadProvider(container, city);
        else container.innerHTML = '<div class="loading-text">请选择城市后重试</div>';
      });
    }
  }

  function renderStage(container, meta, city, pageType) {
    const lat = getCityCoord(city, 'lat');
    const lon = getCityCoord(city, 'lon');
    const locLabel = (city && city.name) ? city.name : '';
    const coordLabel = (validateLatLon(lat, lon)) ? '(' + Number(lat).toFixed(2) + ', ' + Number(lon).toFixed(2) + ')' : '';

    container.classList.remove('fy4-loading', 'fy4-error', 'placeholder');
    container.innerHTML =
      '<div class="fy4-stage">' +
      '  <img src="' + escapeHtml(meta.url) + '" alt="FY-4B 真彩合成卫星云图" referrerpolicy="no-referrer" />' +
      '  <div class="fy4-chip fy4-time">&#x1f6f0;&#xfe0f; FY-4B 真彩 · ' + escapeHtml(meta.time_local || '') + '（北京时间）</div>' +
      (locLabel ? '<div class="fy4-chip fy4-loc">&#x1f4cd; ' + escapeHtml(locLabel) + ' ' + escapeHtml(coordLabel) + '</div>' : '') +
      '  <div class="fy4-credit">' + escapeHtml(meta.source || '国家卫星气象中心') + '</div>' +
      (pageType === 'typhoon'
        ? '<a class="fy4-typhoon-link" href="https://typhoon.nmc.cn/" target="_blank" rel="noopener">&#x1f300; 官方台风路径（中央气象台）</a>'
        : '') +
      '</div>';
  }

  async function loadFY4(container, city, pageType) {
    pageType = pageType || detectPageType();
    const tag = 'fy4.' + pageType;
    if (!container) { logError(tag, '容器缺失'); return; }
    showLoading(container);

    try {
      if (!(typeof API !== 'undefined' && API.satelliteFY4)) throw new Error('API 模块未加载');
      const meta = await API.satelliteFY4('china');
      if (!meta || !meta.url) throw new Error('未获取到云图地址');
      logInfo(tag, '获取到 FY-4B 云图', { url: meta.url, time: meta.time_local });

      // 预加载图片，成功后再渲染（避免瞬时空白）
      const img = new Image();
      img.onload = () => renderStage(container, meta, city, pageType);
      img.onerror = () => showError(container, '云图加载失败，可切换到 Windy 试试');
      img.referrerPolicy = 'no-referrer';
      img.src = meta.url;
    } catch (e) {
      logError(tag, '获取云图失败', e && e.message);
      showError(container, '云图加载失败：' + ((e && e.message) || '未知错误'));
    }
  }

  // ====== Windy 云图（默认服务商，需能访问 embed.windy.com） ======
  function loadWindy(container, city, pageType) {
    pageType = pageType || detectPageType();
    const tag = 'windy.' + pageType;
    const lat = getCityCoord(city, 'lat');
    const lon = getCityCoord(city, 'lon');
    if (!validateLatLon(lat, lon)) {
      logError(tag, '城市坐标无效');
      showError(container, '城市坐标无效，无法加载 Windy 云图');
      return;
    }
    const zoom = pageType === 'typhoon' ? 4 : 5;
    const src =
      'https://embed.windy.com/embed2.html?' +
      'lat=' + lat + '&lon=' + lon +
      '&detailLat=' + lat + '&detailLon=' + lon +
      '&width=1200&height=800&zoom=' + zoom +
      '&level=surface&overlay=clouds&product=ecmwf' +
      '&menu=&message=true&marker=true&calendar=now&pressure=&type=map' +
      '&location=coordinates&detail=true&metricWind=default&metricTemp=default&radarRange=-1';

    container.classList.remove('placeholder', 'fy4-error');
    container.innerHTML =
      '<div class="fy4-loading"><span class="spinner"></span>' +
      '<span class="loading-text">Windy 云图加载中…</span></div>' +
      '<iframe class="windy-frame" src="' + escapeHtml(src) +
      '" title="Windy 卫星云图" allowfullscreen loading="lazy"></iframe>';

    const frame = container.querySelector('.windy-frame');
    if (frame) {
      frame.addEventListener('load', () => {
        const loader = container.querySelector('.fy4-loading');
        if (loader) loader.remove();
      });
      // iframe 加载异常时提示切换 NSMC（境内直连）
      frame.addEventListener('error', () => {
        showError(container, 'Windy 云图加载失败，请切换为 NSMC（境内直连）');
      });
    }
    logInfo(tag, '已注入 Windy iframe', { zoom });
  }

  // ====== 按用户选择的服务商加载 ======
  function loadProvider(container, city) {
    if (!container) return;
    const pageType = detectPageType();
    if (getProvider() === 'nsmc') {
      loadFY4(container, city, pageType);
    } else {
      loadWindy(container, city, pageType);
    }
  }

  // ====== 服务商切换按钮绑定 ======
  function bindProviderSwitcher() {
    const group = document.getElementById('satProviderGroup');
    if (!group) return;
    const sync = () => {
      const current = getProvider();
      group.querySelectorAll('.tab').forEach((t) => {
        t.classList.toggle('active', t.dataset.provider === current);
      });
    };
    sync();
    group.querySelectorAll('.tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        const p = tab.dataset.provider;
        if (!p) return;
        setProvider(p);
        sync();
        const container = document.getElementById(detectPageType() === 'typhoon' ? 'typhoonBody' : 'satelliteBody');
        if (container && typeof API !== 'undefined' && API.currentCity) {
          loadProvider(container, API.currentCity);
        }
      });
    });
  }

  // ====== 卫星云图渲染 ======
  function renderSatellite(city) {
    const tag = 'satellite';
    const container = document.getElementById('satelliteBody');
    if (!container) { logError(tag, '找不到 #satelliteBody'); return; }
    if (!city) { logError(tag, '未传入城市对象'); showError(container, '未选择城市'); return; }
    loadProvider(container, city);
  }

  // ====== 台风追踪渲染 ======
  function renderTyphoon(city) {
    const tag = 'typhoon';
    const container = document.getElementById('typhoonBody');
    if (!container) { logError(tag, '找不到 #typhoonBody'); return; }
    if (!city) { logError(tag, '未传入城市对象'); showError(container, '未选择城市'); return; }
    loadProvider(container, city);
  }

  // ====== 初始化（绑定服务商切换；兼容旧式 tab 结构）======
  function init() {
    logInfo('init', 'Satellite 模块初始化');
    bindProviderSwitcher();
    const bindTab = (tabs, fn) => {
      if (!tabs) return;
      tabs.querySelectorAll('.tab').forEach((tab) => {
        tab.addEventListener('click', () => {
          tabs.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
          tab.classList.add('active');
          if (typeof API !== 'undefined' && API.currentCity) fn(API.currentCity);
        });
      });
    };
    bindTab(document.getElementById('satelliteTabs'), renderSatellite);
    bindTab(document.getElementById('typhoonTabs'), renderTyphoon);
  }

  // 暴露 API
  window.Satellite = {
    init: init,
    renderSatellite: renderSatellite,
    renderTyphoon: renderTyphoon,
    getProvider: getProvider,
    setProvider: setProvider,
  };

  logInfo('module', 'Satellite 模块已加载（Windy / NSMC 可切换）');
})();