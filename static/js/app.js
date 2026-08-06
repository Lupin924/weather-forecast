// 主控逻辑：城市加载、事件绑定、并发拉取数据、渲染编排、加载进度
(function () {
  const $ = (id) => document.getElementById(id);
  let autoRefreshTimer = null;
  let currentLoadingCount = 0;
  let totalTasks = 9; // 增加了空气质量任务

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.add('hidden'), 3500);
  }

  function showNoData(message) {
    const banner = $('noDataBanner');
    const msg = $('noDataMessage');
    msg.textContent = message || '该城市暂无数据，请选择其他城市';
    banner.classList.remove('hidden');
    clearTimeout(banner._timer);
    banner._timer = setTimeout(() => banner.classList.add('hidden'), 5000);
  }

  function setUpdatedAt(meta) {
    $('updatedAt').textContent = '更新于 ' + new Date().toLocaleTimeString('zh-CN');
  }

  // --- 加载进度管理 ---
  function updateProgress(current, total) {
    const pct = (current / total) * 100;
    $('progressBar').style.width = pct + '%';
    $('progressLabel').textContent = `加载中 ${current}/${total}`;
    if (current >= total) {
      setTimeout(() => {
        $('progressLabel').classList.add('hidden');
      }, 500);
    }
  }

  function startLoading() {
    currentLoadingCount = 0;
    $('progressLabel').classList.remove('hidden');
    updateProgress(0, totalTasks);
  }

  function taskCompleted() {
    currentLoadingCount++;
    updateProgress(currentLoadingCount, totalTasks);
  }

  function setCardLoading(cardId, isLoading) {
    const card = $(cardId);
    if (!card) return;
    if (isLoading) {
      card.classList.add('loading');
    } else {
      card.classList.remove('loading');
    }
  }

  // 并发拉取所有端点，各分区独立渲染（单点失败不影响其它）
  async function loadAll() {
    startLoading();
    
    setCardLoading('nowCard', true);
    setCardLoading('astroCard', true);
    setCardLoading('airCard', true);
    setCardLoading('forecastCard', true);
    setCardLoading('hourlyCard', true);
    setCardLoading('stargazingCard', true);
    setCardLoading('multimodelCard', true);
    setCardLoading('historicalCard', true);
    setCardLoading('analysisCard', true);

    const tasks = [
      { key: 'now', fn: () => API.now(), render: r => { renderNow(r.data); setCardLoading('nowCard', false); }, cardId: 'nowCard' },
      { key: 'astro', fn: () => API.astronomy(), render: r => { renderAstronomy(r.data); setCardLoading('astroCard', false); }, cardId: 'astroCard' },
      { key: 'air', fn: () => API.airQuality(), render: r => { renderAirQuality(r.data); setCardLoading('airCard', false); }, cardId: 'airCard' },
      { key: 'forecast', fn: () => API.forecast(), render: r => { renderForecast(r.data); setCardLoading('forecastCard', false); }, cardId: 'forecastCard' },
      { key: 'hourly', fn: () => API.hourly(), render: r => { renderHourly(r.data, r.meta.sources); setCardLoading('hourlyCard', false); }, cardId: 'hourlyCard' },
      { key: 'sg', fn: () => API.stargazing(), render: r => { renderStargazing(r.data); setCardLoading('stargazingCard', false); }, cardId: 'stargazingCard' },
      { key: 'mm', fn: () => API.multimodel(), render: r => { renderMultimodel(r.data); setCardLoading('multimodelCard', false); }, cardId: 'multimodelCard' },
      { key: 'hist', fn: () => API.historical(), render: r => { Charts.historical(r.data.years); setCardLoading('historicalCard', false); }, cardId: 'historicalCard' },
      { key: 'ana', fn: () => API.analysis(), render: r => { renderAnalysis(r.data); setCardLoading('analysisCard', false); }, cardId: 'analysisCard' },
    ];

    const results = await Promise.allSettled(tasks.map(t => t.fn()));
    let okCount = 0;
    let failCount = 0;
    
    results.forEach((res, i) => {
      if (res.status === 'fulfilled') {
        try { 
          tasks[i].render(res.value); 
          okCount++; 
        } catch (e) { 
          console.error(tasks[i].key, e); 
          setCardLoading(tasks[i].cardId, false);
        }
      } else {
        console.error(tasks[i].key, res.reason);
        failCount++;
        setCardLoading(tasks[i].cardId, false);
      }
      taskCompleted();
    });
    
    setUpdatedAt();
    
    // 提示部分数据缺失
    if (failCount > 0 && failCount < tasks.length) {
      toast(`部分数据加载失败 (${failCount}/${tasks.length})，已显示可用数据`);
    } else if (okCount === 0) {
      showNoData('所有数据源加载失败，请检查网络或后端服务');
    }
  }

  // 仅刷新实况（定时）
  async function refreshNow() {
    try {
      const r = await API.now();
      renderNow(r.data);
      setUpdatedAt();
    } catch (e) { /* 静默 */ }
  }

  // 加载城市列表
  async function loadCities() {
    try {
      const r = await API.cities();
      const sel = $('citySelect');
      sel.innerHTML = '<option value="">-- 选择预设城市 --</option>' + 
        r.cities.map(c =>
          `<option value="${c.id}"${c.id === r.default ? ' selected' : ''}>${c.name}（${c.elevation_m}m）</option>`
        ).join('');
      
      // 保存默认城市名称
      if (r.default) {
        const defaultCity = r.cities.find(c => c.id === r.default);
        if (defaultCity) {
          API.currentCity = defaultCity.name;
        }
      }
    } catch (e) {
      toast('城市列表加载失败');
    }
  }

  // 城市搜索功能
  function initCitySearch() {
    const searchInput = $('citySearch');
    const searchResults = $('searchResults');
    let searchTimeout = null;
    let isComposing = false;  // 中文输入法组合状态

    async function doSearch(q) {
      if (!q) {
        searchResults.classList.add('hidden');
        searchResults.innerHTML = '';
        return;
      }
      
      try {
        const results = await API.searchCities(q);
        const preset = results.preset || [];
        const cmaMatch = results.cma_match;
        
        let html = '';
        
        if (preset.length === 0 && !cmaMatch) {
          html = '<div class="search-no-results">未找到匹配的城市，按 Enter 直接解析</div>';
        } else {
          // CMA 精确匹配优先显示
          if (cmaMatch) {
            const sourceLabel = cmaMatch.source === 'CMA_station' ? 'CMA 城市' : '匹配';
            const matchedBy = cmaMatch.matched_by || 'exact';
            const matchLabel = matchedBy === 'exact' ? '精确匹配' : '模糊匹配';
            html += '<div class="search-result-item" ' +
              'data-city-id="' + cmaMatch.id + '" ' +
              'data-city-name="' + encodeURIComponent(cmaMatch.name) + '" ' +
              'data-city-lat="' + cmaMatch.latitude + '" ' +
              'data-city-lon="' + cmaMatch.longitude + '" ' +
              'data-city-elev="' + (cmaMatch.elevation_m || 0) + '" ' +
              'data-city-source="' + (cmaMatch.source || 'cma') + '">' +
              '<div class="name">' + cmaMatch.name + ' <span class="source cma">' + sourceLabel + '</span> <span class="source preset">' + matchLabel + '</span></div>' +
              '<div class="desc">经纬度: ' + cmaMatch.latitude.toFixed(2) + ', ' + cmaMatch.longitude.toFixed(2) + (cmaMatch.cma_station_id ? ' · 站号: ' + cmaMatch.cma_station_id : '') + '</div>' +
            '</div>';
          }
          
          // 预设城市
          preset.forEach(c => {
            html += '<div class="search-result-item" ' +
              'data-city-id="' + c.id + '" ' +
              'data-city-name="' + encodeURIComponent(c.name) + '" ' +
              'data-city-lat="' + c.latitude + '" ' +
              'data-city-lon="' + c.longitude + '" ' +
              'data-city-elev="' + (c.elevation_m || 0) + '" ' +
              'data-city-source="preset">' +
              '<div class="name">' + c.name + ' <span class="source preset">预设城市</span></div>' +
              '<div class="desc">' + (c.desc || '') + ' · ' + c.elevation_m + 'm</div>' +
            '</div>';
          });
        }
        
        searchResults.innerHTML = html;
        searchResults.classList.remove('hidden');
        
        // 绑定点击事件
        searchResults.querySelectorAll('.search-result-item').forEach(item => {
          item.addEventListener('click', () => {
            const cityData = {
              id: item.dataset.cityId,
              name: decodeURIComponent(item.dataset.cityName),
              latitude: parseFloat(item.dataset.cityLat),
              longitude: parseFloat(item.dataset.cityLon),
              elevation_m: parseInt(item.dataset.cityElev),
              source: item.dataset.citySource,
            };
            selectCityFromSearch(cityData);
            searchResults.classList.add('hidden');
            searchInput.value = '';
          });
        });
        
      } catch (e) {
        console.error('搜索失败:', e);
        searchResults.innerHTML = '<div class="search-no-results">搜索服务暂不可用</div>';
        searchResults.classList.remove('hidden');
      }
    }

    function scheduleSearch() {
      if (isComposing) return;  // 中文输入法组合中不触发搜索
      const q = searchInput.value.trim();
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => doSearch(q), 300);
    }

    // 中文输入法事件
    searchInput.addEventListener('compositionstart', () => {
      isComposing = true;
    });
    searchInput.addEventListener('compositionend', () => {
      isComposing = false;
      scheduleSearch();
    });

    // 输入事件
    searchInput.addEventListener('input', () => {
      // 清空下拉选择（互锁）
      if ($('citySelect').value) {
        $('citySelect').value = '';
      }
      scheduleSearch();
    });

    // 点击外部关闭搜索结果
    document.addEventListener('click', (e) => {
      if (!searchResults.contains(e.target) && e.target !== searchInput) {
        searchResults.classList.add('hidden');
      }
    });
    
    // 输入回车直接解析城市
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const q = searchInput.value.trim();
        if (q) {
          resolveAndLoadCity(q);
        }
      }
    });
  }

  // 从搜索结果选择城市
  function selectCityFromSearch(cityData) {
    API.custom = null;
    $('customPanel').classList.add('hidden');
    
    // 记录当前城市名称
    API.currentCity = cityData.name;
    
    // 清空下拉选择（互锁）
    $('citySelect').value = '';
    
    // 预设城市直接使用 id
    if (cityData.id && !cityData.id.startsWith('cma_')) {
      API.cityId = cityData.id;
      toast('已切换至: ' + cityData.name);
      loadAll();
      return;
    }
    
    // CMA 城市，使用坐标
    API.cityId = cityData.id || 'custom';
    API.custom = {
      lat: cityData.latitude,
      lon: cityData.longitude,
      elev: cityData.elevation_m || 0,
      label: cityData.name
    };
    toast('已切换至: ' + cityData.name);
    loadAll();
  }

  // 解析城市名并加载
  async function resolveAndLoadCity(name) {
    try {
      const result = await API.resolveCity(name);
      if (result.success) {
        selectCityFromSearch(result.city);
      } else {
        showNoData('未找到城市 "' + name + '"，请检查拼写或尝试其他名称');
      }
    } catch (e) {
      showNoData('解析城市失败: ' + e.message);
    }
  }

  // 初始化浅色模式
  function initTheme() {
    const themeToggle = $('themeToggle');
    
    // 从 localStorage 读取主题偏好
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light') {
      document.body.classList.add('light-theme');
      themeToggle.textContent = '☀️';
    }
    
    themeToggle.addEventListener('click', () => {
      const isLight = document.body.classList.toggle('light-theme');
      themeToggle.textContent = isLight ? '☀️' : '🌙';
      localStorage.setItem('theme', isLight ? 'light' : 'dark');
      
      // 刷新图表以适应新主题
      Charts._refreshTheme();
    });
  }

  function bindEvents() {
    // 预设城市选择
    $('citySelect').addEventListener('change', (e) => {
      if (e.target.value) {
        API.cityId = e.target.value;
        API.custom = null;
        $('customPanel').classList.add('hidden');
        
        // 记录城市名称
        const selectedOption = e.target.options[e.target.selectedIndex];
        const cityName = selectedOption.text.split('（')[0];
        API.currentCity = cityName;
        
        // 清空搜索框（互锁）
        $('citySearch').value = '';
        $('searchResults').classList.add('hidden');
        $('searchResults').innerHTML = '';
        
        loadAll();
      }
    });

    // 日期选择
    $('datePicker').addEventListener('change', (e) => {
      API.date = e.target.value;
      loadAll();
    });

    // 刷新按钮
    $('refreshBtn').addEventListener('click', () => {
      toast('正在刷新…');
      loadAll();
    });

    // 自定义坐标
    $('customToggle').addEventListener('click', () => {
      $('customPanel').classList.toggle('hidden');
    });

    $('customApply').addEventListener('click', () => {
      const lat = parseFloat($('customLat').value);
      const lon = parseFloat($('customLon').value);
      const elev = parseInt($('customElev').value) || 0;
      if (isNaN(lat) || isNaN(lon)) { toast('请输入有效经纬度'); return; }
      API.custom = { lat, lon, elev, label: '自定义(' + lat + ',' + lon + ')' };
      API.cityId = 'custom';
      toast('已切换到自定义坐标');
      loadAll();
    });
  }

  async function init() {
    $('datePicker').value = API.date;
    
    // 初始化功能
    initTheme();
    initCitySearch();
    await loadCities();
    bindEvents();
    
    // 首次加载
    await loadAll();
    
    // 每 10 分钟自动刷新实况
    autoRefreshTimer = setInterval(refreshNow, 10 * 60 * 1000);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
