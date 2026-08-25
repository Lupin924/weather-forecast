/* ============================================
 * 卫星云图 / 台风追踪模块（iframe 注入版）
 *
 * 作用：在卫星云图页 (/satellite) 与台风追踪页 (/typhoon) 注入 Windy.com embed iframe
 *
 * 暴露 API：
 *   Satellite.init()                  - 绑定 tab 切换
 *   Satellite.renderSatellite(city)   - 渲染卫星云图
 *   Satellite.renderTyphoon(city)     - 渲染台风追踪
 * ============================================ */

(function () {
  'use strict';

  // ====== 日志系统（用于排查 iframe 加载问题）======
  const LOG_PREFIX = '[Windy iframe]';
  function logInfo(tag, msg, extra) {
    if (window.console && console.log) {
      if (extra !== undefined) {
        console.log(LOG_PREFIX + ' [' + tag + '] ' + msg, extra);
      } else {
        console.log(LOG_PREFIX + ' [' + tag + '] ' + msg);
      }
    }
  }
  function logWarn(tag, msg, extra) {
    if (window.console && console.warn) {
      if (extra !== undefined) {
        console.warn(LOG_PREFIX + ' [' + tag + '] ' + msg, extra);
      } else {
        console.warn(LOG_PREFIX + ' [' + tag + '] ' + msg);
      }
    }
  }
  function logError(tag, msg, extra) {
    if (window.console && console.error) {
      if (extra !== undefined) {
        console.error(LOG_PREFIX + ' [' + tag + '] ' + msg, extra);
      } else {
        console.error(LOG_PREFIX + ' [' + tag + '] ' + msg);
      }
    }
  }

  // ====== 工具函数 ======
  function validateLatLon(lat, lon) {
    if (typeof lat !== 'number' || typeof lon !== 'number') return false;
    if (isNaN(lat) || isNaN(lon)) return false;
    if (lat < -90 || lat > 90) return false;
    if (lon < -180 || lon > 180) return false;
    return true;
  }

  function escapeAttr(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function getCityCoord(city, key) {
    if (!city) return null;
    const v = city[key];
    if (v != null) return v;
    // 兼容 alt 命名
    if (key === 'lat') return city.latitude;
    if (key === 'lon') return city.longitude;
    return null;
  }

  // ====== iframe 加载状态机 ======
  const IFRAME_TIMEOUT_MS = 15000; // 15 秒超时

  function showIframeError(container, message, retryFn) {
    if (!container) return;
    container.classList.remove('iframe-loading');
    container.classList.add('iframe-error');
    container.innerHTML =
      '<div class="error-icon">&#x26a0;&#xfe0f;</div>' +
      '<div class="error-msg">' + escapeAttr(message) + '</div>' +
      '<button class="retry-btn" type="button">&#x1f504; &#x91cd;&#x8bd5;</button>';
    const btn = container.querySelector('.retry-btn');
    if (btn && retryFn) {
      btn.addEventListener('click', retryFn);
    }
  }

  /**
   * 注入 Windy embed iframe
   * @param {HTMLElement} container - 容器
   * @param {string} url - Windy embed URL
   * @param {string} tag - 日志标签（如 "satellite.clouds"）
   * @param {string} title - 用于屏幕阅读器与日志
   */
  function injectIframe(container, url, tag, title) {
    if (!container) {
      logError(tag, '容器元素不存在');
      return;
    }
    logInfo(tag, '开始加载 iframe', { title: title, url: url });

    // 1. 标记 loading 状态
    container.classList.remove('iframe-error');
    container.classList.add('iframe-loading');
    container.innerHTML = '<div class="spinner"></div><div class="loading-text">加载中…</div>';

    // 2. 启动超时定时器
    const startTime = Date.now();
    let settled = false;
    let timeoutTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      const elapsed = Date.now() - startTime;
      logError(tag, '⏰ iframe 加载超时（' + elapsed + 'ms）', { timeout_ms: IFRAME_TIMEOUT_MS });
      showIframeError(container, '加载超时（' + Math.round(IFRAME_TIMEOUT_MS / 1000) + '秒），请检查网络后重试', () => {
        injectIframe(container, url, tag, title);
      });
    }, IFRAME_TIMEOUT_MS);
    logInfo(tag, '⏳ 超时定时器已启动', { timeout_ms: IFRAME_TIMEOUT_MS });

    // 3. 创建 iframe DOM
    logInfo(tag, '🖼️ 正在创建 iframe 元素');
    const iframe = document.createElement('iframe');
    iframe.src = url;
    iframe.title = title || 'Windy embed';
    iframe.setAttribute('loading', 'lazy');
    iframe.setAttribute('referrerpolicy', 'no-referrer-when-downgrade');
    iframe.setAttribute('allow', 'geolocation; fullscreen');
    iframe.style.border = '0';
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.display = 'block';

    // 4. 监听加载事件
    iframe.addEventListener('load', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      const elapsed = Date.now() - startTime;
      logInfo(tag, '✅ iframe 加载成功', { elapsed_ms: elapsed });
      container.classList.remove('iframe-loading');
      container.classList.remove('iframe-error');
      // 清掉 loading 占位 DOM
      container.innerHTML = '';
      container.appendChild(iframe);
    });

    iframe.addEventListener('error', (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      const elapsed = Date.now() - startTime;
      logError(tag, '❌ iframe 加载失败', { elapsed_ms: elapsed, detail: (e && e.message) || 'unknown' });
      showIframeError(container, 'iframe 加载失败，请检查网络或稍后重试', () => {
        injectIframe(container, url, tag, title);
      });
    });

    // 5. 插入 DOM（先插入占位文本，再被 load 事件替换；这里我们直接挂 iframe）
    container.classList.remove('iframe-loading');
    container.classList.remove('iframe-error');
    container.innerHTML = '';
    container.appendChild(iframe);
    logInfo(tag, '✅ iframe DOM 已挂载，等待加载事件');
  }

  // ====== Windy URL 构造 ======
  function buildSatelliteUrl(lat, lon, overlay) {
    // overlay: clouds | wind | rain | temp | radar
    return 'https://embed.windy.com/embed2.html?lat=' + lat +
      '&lon=' + lon +
      '&detailLat=' + lat +
      '&detailLon=' + lon +
      '&width=650&height=450&zoom=5' +
      '&level=surface&overlay=' + encodeURIComponent(overlay) +
      '&product=ecmwf&menu=&message=&marker=&calendar=&pressure=&type=map&location=coordinates&detail=&metricWind=default&metricTemp=default&radarRange=-1';
  }

  function buildTyphoonUrl(lat, lon, zoom) {
    // 台风追踪使用 wind overlay 叠加
    const z = zoom || 4;
    return 'https://embed.windy.com/embed2.html?lat=' + lat +
      '&lon=' + lon +
      '&detailLat=' + lat +
      '&detailLon=' + lon +
      '&width=650&height=450&zoom=' + z +
      '&level=surface&overlay=wind' +
      '&product=ecmwf&menu=&message=&marker=&calendar=&pressure=&type=map&location=coordinates&detail=&metricWind=default&metricTemp=default&radarRange=-1';
  }

  // ====== 卫星云图渲染 ======
  function renderSatellite(city) {
    const tag = 'satellite';
    const container = document.getElementById('satelliteBody');
    if (!container) {
      logWarn(tag, '找不到 #satelliteBody 容器，可能不在卫星页');
      return;
    }
    if (!city) {
      logWarn(tag, '未传入城市对象');
      return;
    }
    const lat = getCityCoord(city, 'lat');
    const lon = getCityCoord(city, 'lon');
    if (!validateLatLon(lat, lon)) {
      logError(tag, '城市坐标无效', { lat: lat, lon: lon });
      showIframeError(container, '城市坐标无效，无法加载卫星云图', () => renderSatellite(city));
      return;
    }

    // 当前 overlay
    const activeTab = document.querySelector('#satelliteTabs .tab.active');
    const overlay = activeTab ? activeTab.dataset.overlay : 'clouds';
    logInfo(tag, '渲染卫星云图', { city: city.name, overlay: overlay, lat: lat, lon: lon });

    const url = buildSatelliteUrl(lat, lon, overlay);
    injectIframe(container, url, tag + '.' + overlay, (city.name || '') + ' · ' + overlay);
  }

  // ====== 台风追踪渲染 ======
  function renderTyphoon(city) {
    const tag = 'typhoon';
    const container = document.getElementById('typhoonBody');
    if (!container) {
      logWarn(tag, '找不到 #typhoonBody 容器，可能不在台风页');
      return;
    }
    if (!city) {
      logWarn(tag, '未传入城市对象');
      return;
    }

    // 判断当前激活的 tab：预设区域 vs 聚焦本地
    const activeTab = document.querySelector('#typhoonTabs .tab.active');
    const isLocate = activeTab && activeTab.id === 'typhoonLocateBtn';

    let lat, lon, zoom;
    if (isLocate) {
      lat = getCityCoord(city, 'lat');
      lon = getCityCoord(city, 'lon');
      zoom = 6;
      if (!validateLatLon(lat, lon)) {
        logError(tag, '本地坐标无效', { lat: lat, lon: lon });
        showIframeError(container, '当前城市坐标无效，无法聚焦本地', () => renderTyphoon(city));
        return;
      }
    } else {
      lat = activeTab ? parseFloat(activeTab.dataset.lat) : 20;
      lon = activeTab ? parseFloat(activeTab.dataset.lon) : 130;
      zoom = activeTab ? parseInt(activeTab.dataset.zoom, 10) : 3;
      if (!validateLatLon(lat, lon)) {
        logError(tag, '预设区域坐标无效', { lat: lat, lon: lon });
        showIframeError(container, '区域坐标无效', () => renderTyphoon(city));
        return;
      }
    }

    logInfo(tag, '渲染台风追踪', { city: city.name, lat: lat, lon: lon, zoom: zoom, mode: isLocate ? 'local' : 'region' });
    const url = buildTyphoonUrl(lat, lon, zoom);
    injectIframe(container, url, tag + '.' + (isLocate ? 'local' : 'region'), (city.name || '') + ' · 台风');
  }

  // ====== 初始化（绑定 tab 切换）======
  function init() {
    logInfo('init', 'Satellite 模块初始化');

    // 卫星 tab 切换
    const satTabs = document.getElementById('satelliteTabs');
    if (satTabs) {
      satTabs.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
          satTabs.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
          if (typeof API !== 'undefined' && API.currentCity) {
            renderSatellite(API.currentCity);
          }
        });
      });
    }

    // 台风 tab 切换
    const tyTabs = document.getElementById('typhoonTabs');
    if (tyTabs) {
      tyTabs.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
          tyTabs.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
          if (typeof API !== 'undefined' && API.currentCity) {
            renderTyphoon(API.currentCity);
          }
        });
      });
    }
  }

  // 暴露 API
  window.Satellite = {
    init: init,
    renderSatellite: renderSatellite,
    renderTyphoon: renderTyphoon,
  };

  logInfo('module', 'Satellite 模块已加载');
})();