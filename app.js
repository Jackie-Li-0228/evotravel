// ============================================
// app.js - EvoTavern 旅行规划助手
// ============================================

(function () {
  'use strict';

  var chatMessages = document.getElementById('chat-messages');
  var userInput = document.getElementById('user-input');
  var btnSend = document.getElementById('btn-send');
  var btnClear = document.getElementById('btn-clear');
  var prefList = document.getElementById('pref-list');
  var historyList = document.getElementById('history-list');
  var prefCount = document.getElementById('pref-count');
  var historyCount = document.getElementById('history-count');

  // ---- Map (AMap) ----
  var map = null;
  var mapMarkers = [];
  var allPolylines = [];
  var hotelMarker = null;

  function initMap() {
    if (map) return;
    var el = document.getElementById('itinerary-map');
    if (!el) return;
    try {
      if (typeof AMap === 'undefined') return;
      map = new AMap.Map('itinerary-map', { zoom: 5, center: [120.15, 30.27], viewMode: '2D' });
    } catch (e) { console.warn('AMap init failed:', e); }
  }

  function clearMapData() {
    if (!map) return;
    map.remove(mapMarkers);
    mapMarkers = [];
    allPolylines.forEach(function (p) { map.remove(p); });
    allPolylines = [];
    if (hotelMarker) { map.remove(hotelMarker); hotelMarker = null; }
  }

  // ---- 按天显示地图 ----
  var dayColors = ['#4f46e5', '#dc2626', '#059669', '#d97706', '#7c3aed', '#db2777', '#0891b2'];
  var currentDayData = []; // [{day, locations, schedule}]
  var showingDay = -1; // -1 = 全部

  function showDayOnMap(dayIndex) {
    clearMapData();
    showingDay = dayIndex;
    updateDayTabs();
    if (!map || currentDayData.length === 0) return;

    // 显示住宿地标记
    var hotel = DataStore.getHotel();
    if (hotel) {
      hotelMarker = new AMap.Marker({
        position: [hotel.lng, hotel.lat],
        title: '🏨 ' + hotel.name,
        label: { content: '🏨 ' + hotel.name, direction: 'top' },
        icon: new AMap.Icon({ size: new AMap.Size(25, 34), imageOffset: new AMap.Pixel(0, 0) })
      });
      map.add(hotelMarker);
    }

    var allLocs = [];
    if (dayIndex === -1) {
      currentDayData.forEach(function (d, di) {
        allLocs = allLocs.concat(addDayMarkers(d.locations, di));
      });
    } else {
      allLocs = addDayMarkers(currentDayData[dayIndex].locations, dayIndex);
    }

    // 画住宿地到第一个点的虚线
    if (hotel && allLocs.length > 0) {
      var targetDay = dayIndex === -1 ? 0 : dayIndex;
      if (currentDayData[targetDay] && currentDayData[targetDay].locations.length > 0) {
        var firstLoc = currentDayData[targetDay].locations[0];
        var homeLine = new AMap.Polyline({
          path: [[hotel.lng, hotel.lat], [firstLoc.lng, firstLoc.lat]],
          strokeColor: '#f59e0b', strokeWeight: 2, strokeOpacity: 0.6, strokeStyle: 'dashed'
        });
        map.add(homeLine);
        allPolylines.push(homeLine);
      }
    }

    if (allLocs.length > 0) map.setFitView(mapMarkers, false, [50, 50, 50, 50]);
    document.getElementById('map-info').textContent =
      dayIndex === -1 ? '共 ' + allLocs.length + ' 个地点（全部）' :
      '第 ' + (dayIndex + 1) + ' 天 · ' + allLocs.length + ' 个地点';
  }

  function addDayMarkers(locations, dayIndex) {
    var color = dayColors[dayIndex % dayColors.length];
    var lnglats = [];
    locations.forEach(function (loc) {
      var marker = new AMap.Marker({
        position: [loc.lng, loc.lat], title: loc.name,
        label: { content: loc.name, direction: 'top' }
      });
      marker.on('click', function () {
        new AMap.InfoWindow({
          content: '<b style="color:' + color + '">第' + (dayIndex + 1) + '天</b> · <b>' + loc.name + '</b>' +
            (loc.arrivalTime ? '<br>预计 ' + loc.arrivalTime + ' 到达' : '') +
            (loc.travelMinutes ? '<br>通勤约 ' + loc.travelMinutes + ' 分钟' : ''),
          offset: new AMap.Pixel(0, -30)
        }).open(map, marker.getPosition());
      });
      mapMarkers.push(marker);
      lnglats.push([loc.lng, loc.lat]);
    });
    map.add(mapMarkers);
    if (lnglats.length > 1) {
      var polyline = new AMap.Polyline({
        path: lnglats, strokeColor: color, strokeWeight: 3, strokeOpacity: 0.8, strokeStyle: 'dashed'
      });
      map.add(polyline);
      allPolylines.push(polyline);
    }
    return locations;
  }

  function updateDayTabs() {
    var container = document.getElementById('day-tabs');
    if (!container) return;
    container.innerHTML = '';
    if (currentDayData.length <= 1) { container.style.display = 'none'; return; }
    container.style.display = 'flex';
    var allBtn = document.createElement('button');
    allBtn.className = 'day-tab' + (showingDay === -1 ? ' active' : '');
    allBtn.textContent = '全部';
    allBtn.onclick = function () { showDayOnMap(-1); };
    container.appendChild(allBtn);
    currentDayData.forEach(function (d, i) {
      var btn = document.createElement('button');
      btn.className = 'day-tab' + (showingDay === i ? ' active' : '');
      btn.textContent = '第 ' + (i + 1) + ' 天';
      btn.style.borderBottom = '3px solid ' + dayColors[i % dayColors.length];
      btn.onclick = function () { showDayOnMap(i); };
      container.appendChild(btn);
    });
  }

  // ---- Tab ----
  function switchTab(name) {
    document.querySelectorAll('.panel-tab').forEach(function (t) { t.classList.toggle('active', t.dataset.tab === name); });
    document.getElementById('tab-profile').style.display = name === 'profile' ? '' : 'none';
    document.getElementById('tab-map').style.display = name === 'map' ? '' : 'none';
    if (name === 'map') setTimeout(function () { initMap(); }, 150);
  }
  document.querySelectorAll('.panel-tab').forEach(function (tab) {
    tab.addEventListener('click', function () { switchTab(tab.dataset.tab); });
  });

  // ---- Init ----
  DataStore.init();
  loadChatHistory();
  refreshPreferencePanel();

  // ---- 对话日志（方便调试） ----
  var CHAT_LOG_KEY = 'evotavern_chat_log';

  function appendLog(role, text) {
    try {
      var logs = JSON.parse(localStorage.getItem(CHAT_LOG_KEY) || '[]');
      logs.push({ time: new Date().toISOString(), role: role, text: text });
      localStorage.setItem(CHAT_LOG_KEY, JSON.stringify(logs));
    } catch (e) { /* ignore */ }
  }

  function clearLog() {
    localStorage.removeItem(CHAT_LOG_KEY);
  }

  // ---- Events ----
  btnSend.addEventListener('click', handleSend);
  userInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  });
  btnClear.addEventListener('click', function () {
    if (confirm('确定要清除所有数据吗？')) {
      DataStore.clearAll(); chatMessages.innerHTML = ''; clearMapData(); clearLog();
      refreshPreferencePanel(); addSystemMessage('数据已清除，重新开始吧！');
    }
  });
  userInput.addEventListener('input', function () {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 120) + 'px';
  });

  // ============================================
  // ============================================
  // Core - handleSend
  // ============================================

  async function handleSend() {
    var text = userInput.value.trim();
    if (!text) return;
    userInput.value = '';
    userInput.style.height = 'auto';
    btnSend.disabled = true;

    appendMessage('user', text);
    DataStore.addUserMessage(text);
    DataStore.addChatMessage('user', text);

    // 一次 LLM 调用：提取意图、目的地、出发城市
    var info = await extractInfoWithLLM(text);
    if (info.destination) {
      DataStore.setDestination(info.destination);
      addSystemMessage('已更新目的地：' + info.destination);
    }
    if (info.departure) {
      DataStore.setDepartureCity(info.departure);
      addSystemMessage('已记住你的出发城市：' + info.departure);
    }
    var city = DataStore.getDestination();
    var depCity = DataStore.getDepartureCity();
    var intent = info.intent;
    console.log('[handleSend] intent=' + intent + ' city=' + city + ' depCity=' + depCity);

    // 后台提取偏好
    extractPreferences(text, DataStore.getUserMessages()).then(function (result) {
      if (result.new_preferences.length > 0) {
        DataStore.applyPreferences(result);
        refreshPreferencePanel();
        addSystemMessage('识别到 ' + result.new_preferences.length + ' 条新偏好，已更新');
      }
    });

    var typingEl = showTyping();
    try {
      if (intent === 'hotel') {
        // 酒店搜索
        await handleHotelSearch(text, city);
      } else if (intent === 'train') {
        // 列车查询
        await handleTrainQuery(text, city, depCity);
      } else if (intent === 'summary') {
        // 详细行程总结
        await handleSummary(text, city);
      } else if (intent === 'map') {
        // 切换到地图
        switchTab('map');
        setTimeout(function () { initMap(); if (map && currentDayData.length > 0) showDayOnMap(-1); }, 200);
        typingEl.remove();
        btnSend.disabled = false;
        return;
      } else {
        // 普通对话 + 行程规划
        await handleChatAndPlan(text, city, depCity);
      }
    } catch (err) {
      if (typingEl.parentNode) typingEl.remove();
      addSystemMessage('生成失败：' + err.message);
    }
    btnSend.disabled = false;
  }

  // ============================================
  // 意图处理器
  // ============================================

  // 酒店搜索
  async function handleHotelSearch(text, city) {
    if (!city) {
      var typing = document.querySelector('.typing-indicator');
      if (typing) typing.remove();
      appendMessage('ai', '请先告诉我你的旅行目的地，我才能推荐酒店哦～');
      return;
    }

    var result = await HotelService.searchHotels(city);
    var typing = document.querySelector('.typing-indicator');
    if (typing) typing.remove();

    if (result.error) {
      appendMessage('ai', '酒店搜索暂时不可用：' + result.error);
      return;
    }

    if (result.hotels.length === 0) {
      appendMessage('ai', '抱歉，没有找到合适的酒店。你可以试试更具体的区域名。');
      return;
    }

    // 渲染酒店卡片
    var div = document.createElement('div');
    div.className = 'message ai';
    var bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.innerHTML = HotelService.formatHotelsHTML(result);
    div.appendChild(bubble);
    chatMessages.appendChild(div);
    scrollToBottom();

    // 绑定选择酒店按钮
    setTimeout(function () {
      bubble.querySelectorAll('.btn-select-hotel').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var hotelName = btn.getAttribute('data-name');
          var hotelLat = parseFloat(btn.getAttribute('data-lat'));
          var hotelLng = parseFloat(btn.getAttribute('data-lng'));
          DataStore.setHotel({ name: hotelName, lat: hotelLat, lng: hotelLng, address: '' });
          addSystemMessage('已选择住宿：' + hotelName + '。后续行程将以此为住宿锚点！');
          // 更新按钮状态
          bubble.querySelectorAll('.btn-select-hotel').forEach(function (b) { b.disabled = true; b.textContent = '已选'; });
          btn.textContent = '✓ 已选为住宿地';
          btn.style.background = '#10b981';
          btn.style.color = '#fff';
          btn.style.borderColor = '#10b981';
        });
      });
    }, 100);

    DataStore.addChatMessage('assistant', HotelService.formatHotelsText(result));
  }

  // 列车查询
  async function handleTrainQuery(text, city, depCity) {
    if (!depCity && !city) {
      var typing = document.querySelector('.typing-indicator');
      if (typing) typing.remove();
      appendMessage('ai', '请先告诉我你从哪个城市出发，以及要去哪里～');
      return;
    }

    var fromCity = depCity || '';
    var toCity = city || '';

    // 如果用户提到了具体城市，尝试推断去程/回程
    var isReturn = /回程|返程|回去|回.*车/.test(text);
    if (isReturn && fromCity && toCity) {
      // 回程：目的地 → 出发城市
      var tmp = fromCity; fromCity = toCity; toCity = tmp;
    }

    if (!fromCity || !toCity) {
      var typing = document.querySelector('.typing-indicator');
      if (typing) typing.remove();
      appendMessage('ai', '我需要知道出发城市和目的地才能查列车～\n出发城市：' + (fromCity || '未知') + '\n目的地：' + (toCity || '未知'));
      return;
    }

    // 默认查明天
    var tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    var dateStr = tomorrow.getFullYear() + '-' +
      String(tomorrow.getMonth() + 1).padStart(2, '0') + '-' +
      String(tomorrow.getDate()).padStart(2, '0');

    var result = await TrainService.queryTrains(fromCity, toCity, dateStr);
    var typing = document.querySelector('.typing-indicator');
    if (typing) typing.remove();

    // 渲染列车卡片
    var div = document.createElement('div');
    div.className = 'message ai';
    var bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.innerHTML = TrainService.formatTrainsHTML(result, fromCity, toCity);
    div.appendChild(bubble);
    chatMessages.appendChild(div);
    scrollToBottom();

    DataStore.addChatMessage('assistant', TrainService.formatTrainsText(result, fromCity, toCity));
  }

  // 详细行程总结
  async function handleSummary(text, city) {
    if (currentDayData.length === 0) {
      var typing = document.querySelector('.typing-indicator');
      if (typing) typing.remove();
      appendMessage('ai', '还没有生成行程哦，先告诉我你的旅行需求吧～');
      return;
    }

    // 构建总结请求
    var summaryPrompt = '请为以下行程生成一份详细的行程总结文档，方便截图保存：\n\n';
    summaryPrompt += '目的地：' + city + '\n';

    var hotel = DataStore.getHotel();
    if (hotel) summaryPrompt += '住宿：' + hotel.name + '（' + (hotel.address || '') + '）\n';

    var depCity = DataStore.getDepartureCity();
    if (depCity) summaryPrompt += '出发城市：' + depCity + '\n';

    var travelDates = DataStore.getTravelDates();
    if (travelDates) summaryPrompt += '出行日期：' + (travelDates.start || '') + ' 至 ' + (travelDates.end || '') + '\n';

    summaryPrompt += '\n';
    for (var di = 0; di < currentDayData.length; di++) {
      var d = currentDayData[di];
      summaryPrompt += '### 第 ' + d.day + ' 天\n';
      d.locations.forEach(function (loc) {
        summaryPrompt += '- ' + loc.name;
        if (loc.arrivalTime) summaryPrompt += '（预计 ' + loc.arrivalTime + '）';
        if (loc.travelMinutes) summaryPrompt += '（通勤约' + loc.travelMinutes + '分钟）';
        summaryPrompt += '\n';
      });
      // 查通勤详情
      if (d.locations.length >= 2 && city) {
        for (var ti = 0; ti < Math.min(d.locations.length - 1, 3); ti++) {
          try {
            var from = d.locations[ti];
            var to = d.locations[ti + 1];
            var transit = await TransitService.getFullTransit(from.lng, from.lat, to.lng, to.lat, city);
            if (transit) {
              summaryPrompt += TransitService.formatFullTransitText(from.name, to.name, transit) + '\n';
            }
          } catch (e) { /* ignore */ }
        }
      }
      summaryPrompt += '\n';
    }

    // 去程列车
    if (depCity && city) {
      var startDate = travelDates ? travelDates.start : '';
      if (!startDate) {
        var tmr = new Date(); tmr.setDate(tmr.getDate() + 1);
        startDate = tmr.getFullYear() + '-' + String(tmr.getMonth() + 1).padStart(2, '0') + '-' + String(tmr.getDate()).padStart(2, '0');
      }
      try {
        var goTrains = await TrainService.queryTrains(depCity, city, startDate);
        summaryPrompt += '\n## 去程列车\n' + TrainService.formatTrainsText(goTrains, depCity, city) + '\n';
      } catch (e) { /* ignore */ }

      // 回程列车
      var endDate = travelDates ? travelDates.end : '';
      if (!endDate) {
        var endD = new Date(startDate);
        endD.setDate(endD.getDate() + currentDayData.length - 1);
        endDate = endD.getFullYear() + '-' + String(endD.getMonth() + 1).padStart(2, '0') + '-' + String(endD.getDate()).padStart(2, '0');
      }
      try {
        var backTrains = await TrainService.queryTrains(city, depCity, endDate);
        summaryPrompt += '\n## 回程列车\n' + TrainService.formatTrainsText(backTrains, city, depCity) + '\n';
      } catch (e) { /* ignore */ }
    }

    // 用总结专用 prompt
    var history = DataStore.getChatHistory();
    var apiResult = await callGLM(SUMMARY_SYSTEM_PROMPT, summaryPrompt, history);
    var plan = apiResult || '总结生成失败，请重试。';

    DataStore.addHistoryEntry({ request: text, plan: plan });
    DataStore.addChatMessage('assistant', plan);
    var typing = document.querySelector('.typing-indicator');
    if (typing) typing.remove();
    appendAIMessage(plan);
  }

  // 普通对话 + 行程规划
  // 从 GLM 回复中提取结构化地点列表（只有 GLM 输出 ## 📍 地点列表 时才触发）
  function extractLocationList(text) {
    // 找 ## 📍 地点列表 块
    var marker = '## 📍 地点列表';
    var idx = text.indexOf(marker);
    if (idx < 0) return [];
    var block = text.substring(idx + marker.length);
    // 截到下一个 ## 标题或文本结束
    var nextSection = block.indexOf('\n## ');
    if (nextSection >= 0) block = block.substring(0, nextSection);

    var locs = [];
    var lines = block.split('\n');
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      // 格式：1. 地点名 或 - 地点名
      var m = line.match(/^\d+\.\s+(.+)|^-\s+(.+)/);
      if (m) {
        var name = (m[1] || m[2] || '').trim();
        if (name && name.length > 1) {
          var timeM = line.match(/(上午|下午|傍晚|晚上|中午|早晨|早上)/);
          locs.push({ name: name, time: timeM ? timeM[1] : '' });
        }
      }
    }
    return locs;
  }

  async function handleChatAndPlan(text, city, depCity) {
    var plan = await smartPlanning(text, DataStore.getPreferences());
    DataStore.addHistoryEntry({ request: text, plan: plan });
    var typing = document.querySelector('.typing-indicator');
    if (typing) typing.remove();
    appendAIMessage(plan);

    // 只有 GLM 输出了结构化地点列表时才触发地图/路线规划
    var rawLocs = extractLocationList(plan);
    if (rawLocs.length >= 2) {
      await processItineraryPlan(plan, city);
    }
  }

  // ============================================
  // 行程处理（地点解析 → 路线优化 → 地图显示）
  // ============================================

  // 最大反馈循环次数
  var GEO_FEEDBACK_MAX_ROUNDS = 3;

  async function processItineraryPlan(plan, city, feedbackRound) {
    if (typeof feedbackRound === 'undefined') feedbackRound = 0;
    var rawLocs = extractLocationList(plan);
    if (rawLocs.length === 0) return;

    addSystemMessage('正在获取 ' + rawLocs.length + ' 个地点的坐标...');
    var result = await resolveLocations(rawLocs, city);
    var resolved = result.resolved;
    var mismatches = result.mismatches;

    if (resolved.length === 0) {
      addSystemMessage('未能获取到地点坐标');
      return;
    }

    // 如果有地点不在目标城市，让 GLM 重新推荐（结构化 JSON）
    if (mismatches.length > 0 && feedbackRound < GEO_FEEDBACK_MAX_ROUNDS) {
      var mismatchNames = mismatches.map(function(m) { return '「' + m.name + '」'; }).join('、');
      addSystemMessage('⚠️ 以下地点在' + city + '未找到，正在让AI重新推荐：' + mismatchNames);

      var replacements = await askLLMForReplacement(mismatches, city);
      // replacements: [{"original":"楼外楼","replacement":"知味观"}]
      var repMap = {};
      replacements.forEach(function(r) { if (r.original && r.replacement) repMap[r.original] = r.replacement; });

      // 对替换后的地点重新做地理编码
      var newMismatches = [];
      for (var mi = 0; mi < resolved.length; mi++) {
        var locName = resolved[mi].name;
        if (mismatches.some(function(m) { return m.name === locName; }) && repMap[locName]) {
          addSystemMessage('🔄 ' + locName + ' → ' + repMap[locName]);
          var nearRef = mi > 0 ? { lat: resolved[mi - 1].lat, lng: resolved[mi - 1].lng } : null;
          var newGeo = await geocodeLocation(repMap[locName], city, nearRef);
          if (newGeo && newGeo.inCity) {
            resolved[mi] = { name: repMap[locName], lat: newGeo.lat, lng: newGeo.lng, time: resolved[mi].time };
          } else {
            newMismatches.push({ name: repMap[locName] });
          }
        }
      }

      // 如果还有 mismatch，递归重试
      if (newMismatches.length > 0 && feedbackRound + 1 < GEO_FEEDBACK_MAX_ROUNDS) {
        mismatches = newMismatches;
        var retryReplacements = await askLLMForReplacement(newMismatches, city);
        var retryMap = {};
        retryReplacements.forEach(function(r) { if (r.original && r.replacement) retryMap[r.original] = r.replacement; });
        for (var ri = 0; ri < resolved.length; ri++) {
          if (retryMap[resolved[ri].name]) {
            var rNearRef = ri > 0 ? { lat: resolved[ri - 1].lat, lng: resolved[ri - 1].lng } : null;
            var retryGeo = await geocodeLocation(retryMap[resolved[ri].name], city, rNearRef);
            if (retryGeo && retryGeo.inCity) {
              addSystemMessage('🔄 ' + resolved[ri].name + ' → ' + retryMap[resolved[ri].name]);
              resolved[ri] = { name: retryMap[resolved[ri].name], lat: retryGeo.lat, lng: retryGeo.lng, time: resolved[ri].time };
            }
          }
        }
      }
    }

    if (mismatches.length > 0 && feedbackRound >= GEO_FEEDBACK_MAX_ROUNDS) {
      // 放弃了，提示用户
      var stillBad = mismatches.map(function(m) { return m.name; }).join('、');
      addSystemMessage('⚠️ 以下地点在' + city + '无法找到合适替代，已跳过：' + stillBad);
      // 从 resolved 中移除不在目标城市的地点
      resolved = resolved.filter(function(loc) {
        return !mismatches.some(function(m) { return m.name === loc.name; });
      });
    }

    // 按天分组
    var dayGroups = parseDaysFromPlan(plan, resolved);
    addSystemMessage('正在计算最优路线（' + dayGroups.length + ' 天）...');

    currentDayData = [];
    var allRouteInfo = '## 路线优化结果（请基于此重新安排行程）\n目的地：' + city + '\n注意：每天的起点是前一天的结束地点（住宿地），请保证天与天之间的连贯性。\n\n';

    // 获取酒店锚点 — 如果没有酒店就自动搜索并选择一个
    var hotel = DataStore.getHotel();
    if (!hotel && resolved.length > 0 && city) {
      addSystemMessage('正在搜索推荐酒店...');
      // 用所有地点的中心点搜索
      var centerLng = 0, centerLat = 0;
      resolved.forEach(function (l) { centerLng += l.lng; centerLat += l.lat; });
      centerLng /= resolved.length; centerLat /= resolved.length;
      var hotelResult = await HotelService.searchNearbyHotels(centerLng, centerLat, 5000, city);
      if (hotelResult.hotels && hotelResult.hotels.length > 0) {
        // 自动选第一个（评分/距离最优）
        hotel = hotelResult.hotels[0];
        DataStore.setHotel({ name: hotel.name, lat: hotel.lat, lng: hotel.lng, address: hotel.address });
        addSystemMessage('🏨 已自动选择住宿：' + hotel.name + '（你可以说"推荐酒店"更换）');
        // 显示酒店推荐列表供用户更换
        var hotelDiv = document.createElement('div');
        hotelDiv.className = 'message ai';
        var hotelBubble = document.createElement('div');
        hotelBubble.className = 'bubble';
        hotelBubble.innerHTML = '<p>已为你选择住宿：<b>' + escapeHTML(hotel.name) + '</b></p>' +
          '<p style="font-size:12px;color:#666">如需更换，说"推荐酒店"即可</p>';
        hotelDiv.appendChild(hotelBubble);
        chatMessages.appendChild(hotelDiv);
        scrollToBottom();
      }
    }
    var homeBase = hotel ? { lat: hotel.lat, lng: hotel.lng } : null;

    // 获取火车站坐标（用于第一天/最后一天）
    var trainStation = null;
    var depCity = DataStore.getDepartureCity();
    if (depCity && city) {
      try {
        var stationGeo = await geocodeLocation(city + '火车站', city);
        if (stationGeo) trainStation = stationGeo;
      } catch (e) { /* ignore */ }
    }

    for (var di = 0; di < dayGroups.length; di++) {
      var dayLocs = dayGroups[di];
      if (dayLocs.length === 0) continue;

      // 第一天：如果有火车站，起点从火车站开始
      if (di === 0 && trainStation && !homeBase) {
        homeBase = trainStation;
      }

      var timeMatrix = await RouteOptimizer.buildTimeMatrix(dayLocs);

      // 计算住宿地到各点的距离矩阵
      var homeBaseMatrix = null;
      if (homeBase) {
        homeBaseMatrix = [];
        for (var hi = 0; hi < dayLocs.length; hi++) {
          homeBaseMatrix[hi] = await RouteOptimizer.getDriveDuration(homeBase, dayLocs[hi]);
        }
      }

      var routeOptions = {
        dayIndex: di,
        totalDays: dayGroups.length,
        trainStation: trainStation
      };

      var optimized = RouteOptimizer.optimize(dayLocs, timeMatrix, homeBase, homeBaseMatrix, routeOptions);
      var orderedLocs = optimized.order.map(function (i) { return dayLocs[i]; });
      var schedule = optimized.schedule;

      orderedLocs.forEach(function (loc, li) {
        loc.arrivalTime = schedule[li].arrivalTime;
        loc.travelMinutes = schedule[li].travelMinutes;
        loc.stayMinutes = schedule[li].stayMinutes;
      });

      // 获取通勤详情（所有相邻地点对）
      var transitDetails = [];
      if (orderedLocs.length >= 2 && city) {
        addSystemMessage('正在查询第 ' + (di + 1) + ' 天通勤方案...');
        for (var ti = 0; ti < orderedLocs.length - 1; ti++) {
          try {
            var from = orderedLocs[ti];
            var to = orderedLocs[ti + 1];
            var transit = await TransitService.getFullTransit(from.lng, from.lat, to.lng, to.lat, city);
            if (transit && (transit.fastest || transit.taxi)) {
              transitDetails.push({ from: from.name, to: to.name, result: transit });
            }
          } catch (e) { /* ignore transit errors */ }
        }
      }

      currentDayData.push({ day: di + 1, locations: orderedLocs, schedule: schedule, transit: transitDetails });

      allRouteInfo += '### 第 ' + (di + 1) + ' 天\n';
      if (di === 0 && trainStation && depCity) {
        allRouteInfo += '🚄 从' + depCity + '乘火车到达' + city + '火车站出发\n';
      }
      if (homeBase) {
        if (hotel && di > 0) {
          allRouteInfo += '🏠 从住宿地【' + hotel.name + '】出发（约 ' + homeBaseMatrix[optimized.order[0]].minutes + ' 分钟到达第一个点）\n';
        } else if (di > 0) {
          allRouteInfo += '🏠 从住宿地出发（约 ' + homeBaseMatrix[optimized.order[0]].minutes + ' 分钟到达第一个点）\n';
        }
      }
      schedule.forEach(function (s, i) {
        if (s.index === -1) {
          allRouteInfo += s.name + '（' + s.arrivalTime + '，通勤约' + s.travelMinutes + '分钟）\n';
          return;
        }
        allRouteInfo += (i + 1) + '. ' + s.name +
          '（预计 ' + s.arrivalTime + ' 到达' +
          (s.travelMinutes > 0 ? '，通勤约' + s.travelMinutes + '分钟' : '') +
          '，建议停留' + s.stayMinutes + '分钟）\n';
      });

      // 加入通勤详情
      if (transitDetails.length > 0) {
        allRouteInfo += '\n**通勤方式：**\n';
        transitDetails.forEach(function (td) {
          allRouteInfo += TransitService.formatFullTransitText(td.from, td.to, td.result) + '\n';
        });
      }
      allRouteInfo += '\n';

      // 更新住宿锚点
      if (orderedLocs.length > 0) {
        if (hotel) {
          homeBase = { lat: hotel.lat, lng: hotel.lng };
        } else {
          var last = orderedLocs[orderedLocs.length - 1];
          homeBase = { lat: last.lat, lng: last.lng };
        }
      }
    }

    // 查询去程和回程列车
    if (depCity && city) {
      var travelDates = DataStore.getTravelDates();
      var startDate = travelDates ? travelDates.start : '';
      if (!startDate) {
        var tmr = new Date();
        tmr.setDate(tmr.getDate() + 1);
        startDate = tmr.getFullYear() + '-' + String(tmr.getMonth() + 1).padStart(2, '0') + '-' + String(tmr.getDate()).padStart(2, '0');
      }

      // 计算回程日期
      var endDate = travelDates ? travelDates.end : '';
      if (!endDate && dayGroups.length > 0) {
        var endD = new Date(startDate);
        endD.setDate(endD.getDate() + dayGroups.length - 1);
        endDate = endD.getFullYear() + '-' + String(endD.getMonth() + 1).padStart(2, '0') + '-' + String(endD.getDate()).padStart(2, '0');
      }

      // 先尝试 12306 API，但不管成功失败都让 GLM 规划列车
      var goTrainText = '';
      var backTrainText = '';
      
      addSystemMessage('正在查询列车信息...');
      try {
        var goTrains = await TrainService.queryTrains(depCity, city, startDate);
        goTrainText = TrainService.formatTrainsText(goTrains, depCity, city);
      } catch (e) {
        goTrainText = '实时查询失败';
      }

      if (endDate) {
        try {
          var backTrains = await TrainService.queryTrains(city, depCity, endDate);
          backTrainText = TrainService.formatTrainsText(backTrains, city, depCity);
        } catch (e) {
          backTrainText = '实时查询失败';
        }
      }

      // 不管 API 结果如何，都让 GLM 用自己的知识规划列车
      allRouteInfo += '## 跨城交通（重要！必须包含在行程中）\n';
      allRouteInfo += '用户从 ' + depCity + ' 出发，前往 ' + city + '。\n';
      allRouteInfo += '出发日期：' + startDate;
      if (endDate) allRouteInfo += '，返程日期：' + endDate;
      allRouteInfo += '\n\n';

      if (goTrainText.indexOf('暂时不可用') === -1 && goTrainText.indexOf('CORS') === -1 && goTrainText.indexOf('查询失败') === -1) {
        allRouteInfo += '### 去程参考（12306实时数据）\n' + goTrainText + '\n';
      } else {
        allRouteInfo += '### 去程（请根据你的知识推荐）\n';
        allRouteInfo += '请推荐 ' + depCity + ' → ' + city + ' 的高铁/动车班次（' + startDate + '），包含车次号、出发时间、到达时间、历时。\n\n';
      }

      if (endDate) {
        if (backTrainText.indexOf('暂时不可用') === -1 && backTrainText.indexOf('CORS') === -1 && backTrainText.indexOf('查询失败') === -1) {
          allRouteInfo += '### 回程参考（12306实时数据）\n' + backTrainText + '\n';
        } else {
          allRouteInfo += '### 回程（请根据你的知识推荐）\n';
          allRouteInfo += '请推荐 ' + city + ' → ' + depCity + ' 的高铁/动车班次（' + endDate + '），包含车次号、出发时间、到达时间、历时。\n\n';
        }
      }

      allRouteInfo += '\n行程要求：\n';
      allRouteInfo += '- 第一天必须从「' + depCity + '乘高铁到' + city + '」开始，第一步写明推荐的车次\n';
      allRouteInfo += '- 第一天的第一个活动地点应该在' + city + '火车站附近或从火车站出发\n';
      if (endDate) {
        allRouteInfo += '- 最后一天的最后一步应该是「从' + city + '乘高铁返回' + depCity + '」，写明推荐的车次\n';
      }
      allRouteInfo += '\n';
    }

    // 在路线信息中加入酒店信息
    if (hotel) {
      allRouteInfo += '## 住宿信息\n';
      allRouteInfo += '已选住宿：**' + hotel.name + '**（' + (hotel.address || '') + '）\n';
      allRouteInfo += '每天的行程应从住宿地出发，最后返回住宿地。\n\n';
    }

    // 收集通勤结果并显示通勤卡片
    var transitHtml = '';
    currentDayData.forEach(function (d) {
      if (d.transit && d.transit.length > 0) {
        d.transit.forEach(function (td) {
          if (td.result && (td.result.fastest || td.result.taxi)) {
            transitHtml += TransitService.formatTransitHTML(td.from, td.to, td.result);
          }
        });
      }
    });
    if (transitHtml) {
      var transitDiv = document.createElement('div');
      transitDiv.className = 'message ai';
      var transitBubble = document.createElement('div');
      transitBubble.className = 'bubble';
      transitBubble.innerHTML = transitHtml;
      transitDiv.appendChild(transitBubble);
      chatMessages.appendChild(transitDiv);
    }

    switchTab('map');
    setTimeout(function () {
      initMap();
      if (map) {
        showDayOnMap(-1);
        var totalLocs = currentDayData.reduce(function (s, d) { return s + d.locations.length; }, 0);
        addSystemMessage('已优化 ' + currentDayData.length + ' 天路线，共 ' + totalLocs + ' 个地点');
      }
    }, 300);
    scrollToBottom();
  }

  // ============================================
  // 地点解析 + 地理编码
  // ============================================
  var AMAP_KEY = '94cd115ba02a97bb4f7ca90c3d7ccdc8';
  var geoCache = {};

  // nearRef: 可选，{lat, lng} 参考坐标，优先选离此点最近的同城 POI
  async function geocodeLocation(name, city, nearRef) {
    var cacheKey = (city || '') + name + (nearRef ? '@' + nearRef.lat + ',' + nearRef.lng : '');
    if (geoCache[cacheKey]) return geoCache[cacheKey];

    // 1. POI 搜索（对景点更准确），取前10条结果
    try {
      var poiUrl = 'https://restapi.amap.com/v3/place/text?keywords=' +
        encodeURIComponent(name) +
        (city ? '&city=' + encodeURIComponent(city) : '') +
        '&key=' + AMAP_KEY + '&offset=10';
      var resp = await fetch(poiUrl);
      if (resp.ok) {
        var data = await resp.json();
        if (data && data.pois && data.pois.length > 0) {
          // 筛选目标城市的 POI
          var cityPois = [];
          if (city) {
            var cityNorm = city.replace(/市$/, '');
            for (var pi = 0; pi < data.pois.length; pi++) {
              var poiCity = (data.pois[pi].cityname || '').replace(/市$/, '');
              if (poiCity === cityNorm || poiCity.indexOf(cityNorm) >= 0 || cityNorm.indexOf(poiCity) >= 0) {
                cityPois.push(data.pois[pi]);
              }
            }
          }
          // 如果没有匹配城市的，fallback 到全部结果
          if (cityPois.length === 0) {
            cityPois = data.pois;
          }

          var picked = cityPois[0];
          var inCity = cityPois === data.pois ? false : true;

          // 如果有多个同城结果且有参考坐标，选最近的
          if (cityPois.length > 1 && nearRef) {
            var bestDist = Infinity;
            for (var ci = 0; ci < cityPois.length; ci++) {
              var cParts = cityPois[ci].location.split(',');
              if (cParts.length === 2) {
                var cLng = parseFloat(cParts[0]);
                var cLat = parseFloat(cParts[1]);
                var d = (cLat - nearRef.lat) * (cLat - nearRef.lat) + (cLng - nearRef.lng) * (cLng - nearRef.lng);
                if (d < bestDist) {
                  bestDist = d;
                  picked = cityPois[ci];
                }
              }
            }
          }

          var parts = picked.location.split(',');
          if (parts.length === 2) {
            var r = { lat: parseFloat(parts[1]), lng: parseFloat(parts[0]), inCity: inCity };
            geoCache[cacheKey] = r;
            return r;
          }
        }
      }
    } catch (e) { /* fallback */ }

    // 2. 地理编码 fallback
    try {
      var query = city ? city + name : name;
      var geoUrl = 'https://restapi.amap.com/v3/geocode/geo?address=' +
        encodeURIComponent(query) + '&key=' + AMAP_KEY;
      var resp = await fetch(geoUrl);
      if (resp.ok) {
        var data = await resp.json();
        if (data && data.geocodes && data.geocodes.length > 0) {
          var parts = data.geocodes[0].location.split(',');
          if (parts.length === 2) {
            var r = { lat: parseFloat(parts[1]), lng: parseFloat(parts[0]), inCity: true };
            geoCache[ck] = r;
            return r;
          }
        }
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  // 根据地点名猜测类型（用于让GLM替换同类型地点）
  // 判断是否是交通枢纽（不应触发 mismatch 替换）
  function isTransitHub(name) {
    return /(?:火车)?(?:南|北|东|西)?站$|机场$|航空/.test(name);
  }

  async function resolveLocations(locations, city) {
    var resolved = [];
    var mismatches = []; // 不在目标城市的地点
    for (var i = 0; i < locations.length; i++) {
      var loc = locations[i];
      // 用上一个已解析的地点作为参考点，优先选离它最近的分店
      var nearRef = resolved.length > 0 ? { lat: resolved[resolved.length - 1].lat, lng: resolved[resolved.length - 1].lng } : null;
      var geo = await geocodeLocation(loc.name, city, nearRef);
      if (geo) {
        resolved.push({ name: loc.name, lat: geo.lat, lng: geo.lng, time: loc.time || '' });
        // 交通枢纽不触发 mismatch 替换
        if (!geo.inCity && !isTransitHub(loc.name)) {
          mismatches.push({ name: loc.name });
        }
      } else {
        // 找不到坐标时，交通枢纽也不算 mismatch
        if (!isTransitHub(loc.name)) {
          mismatches.push({ name: loc.name });
        }
      }
    }
    return { resolved: resolved, mismatches: mismatches };
  }

  // ---- 城市提取 ----
  var KNOWN_CITIES = [
    '北京','上海','广州','深圳','杭州','成都','西安','南京','武汉','重庆',
    '苏州','天津','长沙','青岛','大连','厦门','昆明','丽江','桂林','三亚',
    '拉萨','哈尔滨','沈阳','济南','郑州','福州','合肥','南昌','贵阳','南宁',
    '海口','石家庄','太原','兰州','银川','西宁','呼和浩特','乌鲁木齐',
    '香港','澳门','台北','高雄','台中','无锡','宁波','温州',
    '洛阳','开封','大理','敦煌','张家界','凤凰','黄山','九寨沟',
    '西塘','乌镇','周庄','香格里拉','稻城','康定',
    '大阪','京都','东京','奈良','箱根','曼谷','清迈','普吉',
    '巴厘岛','首尔','釜山','济州岛','新加坡','吉隆坡','槟城',
    '罗马','巴黎','伦敦','巴塞罗那','柏林','布拉格','维也纳','威尼斯'
  ];

  // 一次 LLM 调用提取所有结构化信息：意图、目的地、出发城市
  async function extractInfoWithLLM(text) {
    var extractPrompt = '分析以下用户消息，提取结构化信息。\n\n' +
      '【意图识别】判断用户意图：\n' +
      '- hotel: 查酒店/住宿\n' +
      '- train: 查火车/高铁/车次\n' +
      '- summary: 要详细行程总结/截图保存\n' +
      '- map: 看地图/路线\n' +
      '- chat: 普通对话或行程规划（默认）\n\n' +
      '【城市提取】\n' +
      '- destination: 用户想去的目的地\n' +
      '- departure: 用户出发的城市\n' +
      '- 没提到的字段留空，城市名不带"市"\n\n' +
      '用户消息：' + text + '\n\n' +
      '只输出JSON：\n' +
      '{"intent":"chat","destination":"","departure":""}';

    try {
      var result = await callGLM('你是一个信息提取器。只输出JSON，不要解释。', extractPrompt, null);
      console.log('[extractInfoWithLLM] input:', text);
      console.log('[extractInfoWithLLM] LLM raw:', result);
      if (result) {
        var jsonMatch = result.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          var parsed = JSON.parse(jsonMatch[0]);
          return {
            intent: parsed.intent || 'chat',
            destination: (parsed.destination || '').replace(/市$/, '').trim(),
            departure: (parsed.departure || '').replace(/市$/, '').trim()
          };
        }
      }
    } catch (e) {
      console.error('extractInfoWithLLM failed:', e);
    }
    return { intent: 'chat', destination: '', departure: '' };
  }

  // guessLocType 也交给 LLM（用于地点不在目标城市时请求替换）
  async function askLLMForReplacement(mismatches, city) {
    var prompt = '我正在为用户规划' + city + '的旅行。以下地点在' + city + '找不到（可能不存在于该城市）：\n' +
      mismatches.map(function(m) { return '- ' + m.name; }).join('\n') +
      '\n\n请为每个地点推荐一个在' + city + '市内的同类型替代地点。\n\n' +
      '只输出JSON数组，不要解释：\n' +
      '[{"original":"原名","replacement":"替代名"}]';

    try {
      var result = await callGLM('你是旅行地点推荐专家。只输出JSON。', prompt, null);
      if (result) {
        var jsonMatch = result.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          return JSON.parse(jsonMatch[0]);
        }
      }
    } catch (e) {
      console.error('askLLMForReplacement failed:', e);
    }
    return [];
  }

  // 按天分组地点（从行程文本中解析）
  function parseDaysFromPlan(text, resolvedLocs) {
    // 先尝试从结构化地点列表解析（带天数标记）
    var marker = '## 📍 地点列表';
    var idx = text.indexOf(marker);
    if (idx >= 0) {
      var block = text.substring(idx + marker.length);
      var nextSection = block.indexOf('\n## ');
      if (nextSection >= 0) block = block.substring(0, nextSection);

      var days = [[]];
      var currentDay = 0;
      var lines = block.split('\n');
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!line) continue;
        // 匹配天数标记：### 第1天 或 Day 1
        var dayM = line.match(/^###\s*(?:第\s*(\d+)\s*天|Day\s*(\d+))/i);
        if (dayM) {
          var dayNum = parseInt(dayM[1] || dayM[2]) - 1;
          if (dayNum > currentDay) {
            currentDay = dayNum;
            if (!days[currentDay]) days[currentDay] = [];
          }
          continue;
        }
        // 匹配地点项：1. 地点名 或 - 地点名
        var itemM = line.match(/^\d+\.\s+(.+)|^-\s+(.+)/);
        if (itemM) {
          var name = (itemM[1] || itemM[2] || '').trim();
          var found = resolvedLocs.find(function (l) { return l.name === name; });
          if (found) {
            if (!days[currentDay]) days[currentDay] = [];
            days[currentDay].push(found);
          }
        }
      }
      var result = days.filter(function (d) { return d && d.length > 0; });
      if (result.length > 0) return result;
    }

    // Fallback: 从加粗文字解析（兼容旧格式）
    var days = [[]];
    var currentDay = 0;
    var lines = text.split('\n');
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (/^(?:###\s*)?(?:第\s*\d+\s*天|Day\s*\d+)/i.test(line)) {
        if (days[currentDay] && days[currentDay].length > 0) {
          currentDay++;
          days[currentDay] = [];
        }
        continue;
      }
      var boldM = line.match(/\*\*(.+?)\*\*/);
      if (boldM) {
        var name = boldM[1].replace(/[（(][\s\S]*$/, '').trim();
        var found = resolvedLocs.find(function (l) { return l.name === name; });
        if (found) {
          if (!days[currentDay]) days[currentDay] = [];
          days[currentDay].push(found);
        }
      }
    }
    return days.filter(function (d) { return d && d.length > 0; });
  }

  // ============================================
  // Chat Rendering
  // ============================================
  function appendMessage(role, text) {
    appendLog(role, text);
    var div = document.createElement('div');
    div.className = 'message ' + role;
    var bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = text;
    div.appendChild(bubble);
    chatMessages.appendChild(div);
    scrollToBottom();
  }

  function appendAIMessage(planText) {
    appendLog('ai', planText);
    var div = document.createElement('div');
    div.className = 'message ai';
    var bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.innerHTML = renderPlanVisual(planText);
    div.appendChild(bubble);
    chatMessages.appendChild(div);
    scrollToBottom();
  }

  function addSystemMessage(text) {
    var div = document.createElement('div');
    div.className = 'message ai';
    var bubble = document.createElement('div');
    bubble.className = 'bubble system-msg';
    bubble.textContent = text;
    div.appendChild(bubble);
    chatMessages.appendChild(div);
    scrollToBottom();
  }

  function showTyping() {
    var div = document.createElement('div');
    div.className = 'typing-indicator';
    div.innerHTML = '<span></span><span></span><span></span>';
    chatMessages.appendChild(div);
    scrollToBottom();
    return div;
  }

  function scrollToBottom() { chatMessages.scrollTop = chatMessages.scrollHeight; }

  function loadChatHistory() {
    var history = DataStore.getHistory();
    if (history.length === 0) { addWelcomeMessage(); return; }
    for (var i = 0; i < history.length; i++) {
      appendMessage('user', history[i].request);
      appendAIMessage(history[i].plan);
    }
  }

  function addWelcomeMessage() {
    var div = document.createElement('div');
    div.className = 'message ai';
    var bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.style.whiteSpace = 'pre-line';
    bubble.textContent = '你好！我是 EvoTavern 旅行规划助手。\n\n告诉我你想去哪里旅行，我会为你生成行程方案，还可以在地图上查看路线！\n\n你可以：\n- 描述旅行需求（如"我想去杭州玩3天"）\n- 查酒店（如"推荐杭州的酒店"）\n- 查列车（如"查北京到杭州的高铁"）\n- 生成详细总结（如"给我总结行程"）\n- 告诉我出发城市（如"我从北京出发"）\n\n直接告诉我你的想法——比如"不想去人多的地方"，我会自动学习你的偏好。';
    div.appendChild(bubble);
    chatMessages.appendChild(div);
  }

  // ============================================
  // Preference Panel
  // ============================================
  function refreshPreferencePanel() {
    var prefs = DataStore.getPreferences();
    var hist = DataStore.getHistory();
    prefCount.textContent = prefs.length;
    prefList.innerHTML = '';
    if (prefs.length === 0) {
      prefList.innerHTML = '<li class="exp-empty">暂无偏好，对话中自动积累</li>';
    } else {
      prefs.forEach(function (p) {
        var li = document.createElement('li');
        var pct = (p.confidence * 100).toFixed(0);
        var re = p.reinforced_count > 0 ? ' <span class="reinforced">x' + (p.reinforced_count + 1) + '</span>' : '';
        li.innerHTML = '<div class="pref-rule">' + escapeHTML(p.rule) + re + '</div>' +
          '<div class="pref-meta"><div class="confidence-bar"><div class="confidence-bar-fill" style="width:' + pct + '%"></div></div>' +
          '<span class="confidence">' + pct + '%</span></div>' +
          (p.source ? '<div class="exp-source">"' + escapeHTML(p.source) + '"</div>' : '');
        prefList.appendChild(li);
      });
    }
    historyCount.textContent = hist.length;
    historyList.innerHTML = '';
    if (hist.length === 0) {
      historyList.innerHTML = '<li class="exp-empty">暂无历史记录</li>';
    } else {
      hist.slice().reverse().forEach(function (h) {
        var li = document.createElement('li');
        var t = new Date(h.timestamp);
        li.innerHTML = '<div class="history-time">' + t.toLocaleDateString('zh-CN') + ' ' +
          t.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) + '</div>' +
          '<div class="history-preview">' + escapeHTML(h.request) + '</div>';
        historyList.appendChild(li);
      });
    }
  }

  // ============================================
  // Plan Visual
  // ============================================
  function renderPlanVisual(text) {
    var s = splitPlanSections(text);
    var html = '';
    if (s.strategy) html += planCard('strategy', '📋', '行程策略', markdownToHTML(s.strategy));
    if (s.itinerary) {
      var days = parseDays(s.itinerary);
      html += planCard('itinerary', '🗓️', '行程安排', days.length > 0 ? renderTimeline(days) : markdownToHTML(s.itinerary));
    }
    if (s.design) html += planCard('design', '💡', '设计说明', markdownToHTML(s.design));
    return html || markdownToHTML(text);
  }

  function planCard(cls, icon, title, body) {
    return '<div class="plan-card ' + cls + '-card"><div class="plan-card-header"><span class="plan-card-icon">' + icon + '</span> ' + title + '</div><div class="plan-card-body">' + body + '</div></div>';
  }

  function splitPlanSections(text) {
    var r = { strategy: '', itinerary: '', design: '' };
    var cur = 'unknown', buf = { strategy: [], itinerary: [], design: [], unknown: [] };
    text.split('\n').forEach(function (line) {
      var ln = line.trim();
      if (/^##\s*.*行程.*策略|^##\s*.*策略.*总结/i.test(ln)) { cur = 'strategy'; return; }
      if (/^##\s*.*行程.*安排|^##\s*.*日程|^##\s*.*详细.*行程/i.test(ln)) { cur = 'itinerary'; return; }
      if (/^##\s*.*设计.*说明|^##\s*.*说明|^##\s*.*经验/i.test(ln)) { cur = 'design'; return; }
      buf[cur].push(line);
    });
    r.strategy = buf.strategy.join('\n').trim();
    r.itinerary = buf.itinerary.join('\n').trim();
    r.design = buf.design.join('\n').trim();
    if (!r.strategy && !r.itinerary && !r.design) r.itinerary = buf.unknown.join('\n').trim();
    return r;
  }

  function parseDays(text) {
    var days = [], re = /(?:###\s*)?(?:第\s*(\d+)\s*天|Day\s*(\d+))\s*[：:：]?\s*\n([\s\S]*?)(?=(?:###\s*)?(?:第\s*\d+\s*天|Day\s*\d+)|$)/gi, m;
    while ((m = re.exec(text)) !== null) days.push({ day: parseInt(m[1] || m[2]), activities: parseActivities(m[3].trim()) });
    return days;
  }

  function parseActivities(text) {
    var acts = [], slot = null;
    text.split('\n').forEach(function (line) {
      var t = line.trim();
      if (!t || /^[-–—]{3,}$/.test(t)) return;
      var tm = t.match(/[-•*]?\s*\**((?:上午|下午|傍晚|晚上|中午|早晨|早上|夜间))\s*[：:：]?\s*\**(.*)/i);
      if (tm) { slot = tm[1]; var c = tm[2].replace(/\*\*/g, '').trim(); if (c) acts.push({ time: slot, content: c }); return; }
      var lm = t.match(/^[-•*]\s+(.*)/);
      if (lm) { acts.push({ time: slot, content: lm[1].replace(/\*\*/g, '') }); return; }
      var qm = t.match(/^>\s*(.*)/);
      if (qm) acts.push({ time: 'tip', content: qm[1] });
    });
    if (acts.length === 0 && text.trim()) {
      text.split('\n').filter(function (l) { return l.trim(); }).forEach(function (l) {
        acts.push({ time: null, content: l.replace(/^[-•*\d.]\s*/, '').replace(/\*\*/g, '') });
      });
    }
    return acts;
  }

  function renderTimeline(days) {
    var html = '<div class="timeline">';
    days.forEach(function (d) {
      html += '<div class="timeline-day"><div class="timeline-day-header"><div class="timeline-day-badge">第 ' + d.day + ' 天</div></div><div class="timeline-day-body">';
      d.activities.forEach(function (a) {
        if (a.time === 'tip') { html += '<div class="timeline-tip">💡 ' + inlineFormat(a.content) + '</div>'; }
        else { html += '<div class="timeline-activity">' + (a.time ? '<div class="timeline-time">' + timeIcon(a.time) + ' ' + a.time + '</div>' : '') + '<div class="timeline-content">' + inlineFormat(a.content) + '</div></div>'; }
      });
      html += '</div></div>';
    });
    return html + '</div>';
  }

  function timeIcon(t) {
    if (!t) return '📍';
    if (t.includes('早') || t.includes('晨')) return '🌅';
    if (t.includes('中')) return '🍽️';
    if (t.includes('下')) return '🌤️';
    if (t.includes('晚')) return '🌙';
    if (t.includes('上')) return '☀️';
    return '📍';
  }

  // ---- Markdown ----
  function markdownToHTML(md) {
    var html = '', inList = false, inQuote = false;
    md.split('\n').forEach(function (line) {
      var t = line.trim();
      if (t === '') { if (inList) { html += '</ul>'; inList = false; } if (inQuote) { html += '</blockquote>'; inQuote = false; } return; }
      if (/^---+$/.test(t)) { if (inList) { html += '</ul>'; inList = false; } html += '<hr>'; return; }
      if (t.startsWith('#### ')) { html += '<h4>' + inlineFormat(t.slice(5)) + '</h4>'; return; }
      if (t.startsWith('### ')) { html += '<h3>' + inlineFormat(t.slice(4)) + '</h3>'; return; }
      if (t.startsWith('## ')) { html += '<h2>' + inlineFormat(t.slice(3)) + '</h2>'; return; }
      if (t.startsWith('# ')) { html += '<h1>' + inlineFormat(t.slice(2)) + '</h1>'; return; }
      if (t.startsWith('> ')) { if (!inQuote) { html += '<blockquote>'; inQuote = true; } html += inlineFormat(t.slice(2)); return; }
      if (inQuote) { html += '</blockquote>'; inQuote = false; }
      if (/^[-*] /.test(t)) { if (!inList) { html += '<ul>'; inList = true; } html += '<li>' + inlineFormat(t.replace(/^[-*] /, '')) + '</li>'; return; }
      if (inList) { html += '</ul>'; inList = false; }
      html += '<p>' + inlineFormat(t) + '</p>';
    });
    if (inList) html += '</ul>';
    if (inQuote) html += '</blockquote>';
    return html;
  }

  function inlineFormat(t) {
    return t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>').replace(/`(.+?)`/g, '<code>$1</code>');
  }

  function escapeHTML(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

})();
