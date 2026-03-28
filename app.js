// ============================================
// app.js - EvoTavern 主逻辑
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

  // ---- Map state ----
  var map = null;
  var mapMarkers = [];
  var mapRouteLine = null;

  function initMap() {
    if (map) return;
    var el = document.getElementById('itinerary-map');
    if (!el) return;
    try {
      map = L.map('itinerary-map').setView([30.27, 120.15], 5);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap', maxZoom: 18
      }).addTo(map);
    } catch (e) { console.warn('Map init failed:', e); }
  }

  function clearMapData() {
    if (!map) return;
    mapMarkers.forEach(function (m) { map.removeLayer(m); });
    mapMarkers = [];
    if (mapRouteLine) { map.removeLayer(mapRouteLine); mapRouteLine = null; }
  }

  function showLocationsOnMap(locations) {
    if (!map) return;
    clearMapData();
    if (locations.length === 0) return;
    var latlngs = [];
    locations.forEach(function (loc) {
      var marker = L.marker([loc.lat, loc.lng]).addTo(map)
        .bindPopup('<b>' + loc.name + '</b>' + (loc.time ? '<br>' + loc.time : ''));
      mapMarkers.push(marker);
      latlngs.push([loc.lat, loc.lng]);
    });
    if (latlngs.length > 1) {
      mapRouteLine = L.polyline(latlngs, { color: '#4f46e5', weight: 3, opacity: 0.7, dashArray: '8,8' }).addTo(map);
    }
    map.fitBounds(L.latLngBounds(latlngs).pad(0.15));
    document.getElementById('map-info').textContent = '共 ' + locations.length + ' 个地点';
  }

  // ---- Tab switching ----
  function switchTab(tabName) {
    document.querySelectorAll('.panel-tab').forEach(function (t) { t.classList.remove('active'); });
    var active = document.querySelector('.panel-tab[data-tab="' + tabName + '"]');
    if (active) active.classList.add('active');
    var profileEl = document.getElementById('tab-profile');
    var mapEl = document.getElementById('tab-map');
    if (profileEl) profileEl.style.display = tabName === 'profile' ? '' : 'none';
    if (mapEl) mapEl.style.display = tabName === 'map' ? '' : 'none';
    if (tabName === 'map' && map) setTimeout(function () { map.invalidateSize(); }, 150);
  }

  document.querySelectorAll('.panel-tab').forEach(function (tab) {
    tab.addEventListener('click', function () { switchTab(tab.dataset.tab); });
  });

  // ---- Init ----
  DataStore.init();
  loadChatHistory();
  refreshPreferencePanel();

  // ---- Events ----
  btnSend.addEventListener('click', handleSend);
  userInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  });
  btnClear.addEventListener('click', function () {
    if (confirm('确定要清除所有数据吗？')) {
      DataStore.clearAll();
      chatMessages.innerHTML = '';
      clearMapData();
      refreshPreferencePanel();
      addSystemMessage('数据已清除，重新开始吧！');
    }
  });
  userInput.addEventListener('input', function () {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 120) + 'px';
  });

  // ---- Core ----
  async function handleSend() {
    var text = userInput.value.trim();
    if (!text) return;
    userInput.value = '';
    userInput.style.height = 'auto';
    btnSend.disabled = true;

    appendMessage('user', text);
    DataStore.addUserMessage(text);

    extractPreferences(text, DataStore.getUserMessages()).then(function (result) {
      if (result.new_preferences.length > 0) {
        DataStore.applyPreferences(result);
        refreshPreferencePanel();
        addSystemMessage('🧠 识别到 ' + result.new_preferences.length + ' 条新偏好，已更新');
      }
    });

    var typingEl = showTyping();
    try {
      var plan = await smartPlanning(text, DataStore.getPreferences());
      DataStore.addHistoryEntry({ request: text, plan: plan });
      typingEl.remove();
      appendAIMessage(plan, text);
      // 解析地点并地理编码
      var rawLocations = parseLocations(plan);
      if (rawLocations.length > 0) {
        addSystemMessage('🗺️ 正在获取 ' + rawLocations.length + ' 个地点的坐标...');
        var resolved = await resolveLocations(rawLocations);
        if (resolved.length > 0) {
          showLocationsOnMap(resolved);
          addSystemMessage('✅ 已在地图上标记 ' + resolved.length + ' 个地点，点击右侧「行程地图」查看');
        } else {
          addSystemMessage('未能获取到地点坐标');
        }
      }
    } catch (err) {
      typingEl.remove();
      addSystemMessage('生成失败：' + err.message);
    }
    btnSend.disabled = false;
  }

  // ---- Parse locations from plan text ----
  function parseLocations(text) {
    var locations = [];
    var lines = text.split('\n');
    for (var i = 0; i < lines.length; i++) {
      var t = lines[i].trim();
      if (!t) continue;
      // 优先匹配 **加粗地点名**
      var boldM = t.match(/\*\*(.+?)\*\*/);
      if (boldM) {
        var name = boldM[1].replace(/[（(（][\s\S]*$/, '').trim();
        var timeM = t.match(/(上午|下午|傍晚|晚上|中午|早晨|早上)/);
        if (name && name.length > 1) {
          locations.push({ name: name, time: timeM ? timeM[1] : '' });
        }
        continue;
      }
      // 兼容旧格式：地点名(纬度,经度)
      var coordM = t.match(/(.+?)[（(（(-?\d+\.?\d*)\s*[，,]\s*(-?\d+\.?\d*)\s*[）)]/);
      if (coordM) {
        var name = coordM[1].replace(/\*\*/g, '').replace(/[-•*]/g, '').trim();
        var lat = parseFloat(coordM[2]);
        var lng = parseFloat(coordM[3]);
        if (name && !isNaN(lat) && !isNaN(lng)) {
          locations.push({ name: name, lat: lat, lng: lng, time: timeM ? timeM[1] : '' });
        }
      }
    }
    return locations;
  }

  // ---- 地理编码：高德 API ----
  var AMAP_KEY = '94cd115ba02a97bb4f7ca90c3d7ccdc8';
  var geocodeCache = {};
  async function geocodeLocation(name) {
    if (geocodeCache[name]) return geocodeCache[name];
    try {
      var url = 'https://restapi.amap.com/v3/geocode/geo?address=' +
        encodeURIComponent(name) + '&key=' + AMAP_KEY;
      var resp = await fetch(url);
      if (resp.ok) {
        var data = await resp.json();
        if (data && data.geocodes && data.geocodes.length > 0) {
          var loc = data.geocodes[0].location;
          var parts = loc.split(',');
          if (parts.length === 2) {
            var result = { lat: parseFloat(parts[1]), lng: parseFloat(parts[0]) };
            geocodeCache[name] = result;
            return result;
          }
        }
      }
    } catch (e) {
      console.warn('Geocode failed for:', name, e);
    }
    return null;
  }

  async function resolveLocations(locations) {
    var resolved = [];
    for (var i = 0; i < locations.length; i++) {
      var loc = locations[i];
      if (loc.lat != null && loc.lng != null) {
        resolved.push(loc);
      } else {
        var geo = await geocodeLocation(loc.name);
        if (geo) {
          resolved.push({ name: loc.name, lat: geo.lat, lng: geo.lng, time: loc.time || '' });
        }
      }
    }
    return resolved;
  }

  // ---- Chat Rendering ----
  function appendMessage(role, text) {
    var div = document.createElement('div');
    div.className = 'message ' + role;
    var bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = text;
    div.appendChild(bubble);
    chatMessages.appendChild(div);
    scrollToBottom();
    return div;
  }

  function appendAIMessage(planText, requestText) {
    var div = document.createElement('div');
    div.className = 'message ai';
    var bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.innerHTML = renderPlanVisual(planText);
    div.appendChild(bubble);
    chatMessages.appendChild(div);
    scrollToBottom();
    return div;
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

  // ---- History ----
  function loadChatHistory() {
    var history = DataStore.getHistory();
    if (history.length === 0) { addWelcomeMessage(); return; }
    for (var i = 0; i < history.length; i++) {
      appendMessage('user', history[i].request);
      appendAIMessage(history[i].plan, history[i].request);
    }
  }
  function addWelcomeMessage() {
    var div = document.createElement('div');
    div.className = 'message ai';
    var bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.style.whiteSpace = 'pre-line';
    bubble.textContent = '你好！我是 EvoTavern 旅行规划助手。\n\n告诉我你想去哪里旅行，我会为你生成行程方案，。\还可以在地图上查看路线！\n\n直接告诉我你的想法——比如"不想去人多的地方"，我会自动学习你的偏好。';
    div.appendChild(bubble);
    chatMessages.appendChild(div);
  }

  // ---- Preference Panel ----
  function refreshPreferencePanel() {
    var preferences = DataStore.getPreferences();
    var history = DataStore.getHistory();

    prefCount.textContent = preferences.length;
    prefList.innerHTML = '';
    if (preferences.length === 0) {
      prefList.innerHTML = '<li class="exp-empty">暂无偏好，对话中自动积累</li>';
    } else {
      preferences.forEach(function (p) {
        var li = document.createElement('li');
        var pct = (p.confidence * 100).toFixed(0);
        var re = p.reinforced_count > 0 ? ' <span class="reinforced">\u00d7' + (p.reinforced_count + 1) + '</span>' : '';
        li.innerHTML = '<div class="pref-rule">' + escapeHTML(p.rule) + re + '</div>' +
          '<div class="pref-meta"><div class="confidence-bar"><div class="confidence-bar-fill" style="width:' + pct + '%"></div></div>' +
          '<span class="confidence">' + pct + '%</span></div>' +
          (p.source ? '<div class="exp-source">\u201c' + escapeHTML(p.source) + '\u201d</div>' : '');
        prefList.appendChild(li);
      });
    }
    historyCount.textContent = history.length;
    historyList.innerHTML = '';
    if (history.length === 0) {
      historyList.innerHTML = '<li class="exp-empty">暂无历史记录</li>';
    } else {
      history.slice().reverse().forEach(function (h) {
        var li = document.createElement('li');
        var time = new Date(h.timestamp);
        li.innerHTML =
          '<div class="history-time">' + time.toLocaleDateString('zh-CN') + ' ' +
            time.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) + '</div>' +
          '<div class="history-preview">' + escapeHTML(h.request) + '</div>';
        historyList.appendChild(li);
      });
    }
  }

  // ---- Plan Visual ----
  function renderPlanVisual(text) {
    var sections = splitPlanSections(text);
    var html = '';
    if (sections.strategy) {
      html += '<div class="plan-card strategy-card"><div class="plan-card-header"><span class="plan-card-icon">📋</span> 行程策略</div><div class="plan-card-body">' + markdownToHTML(sections.strategy) + '</div></div>';
    }
    if (sections.itinerary) {
      var days = parseDays(sections.itinerary);
      html += '<div class="plan-card itinerary-card"><div class="plan-card-header"><span class="plan-card-icon">🗓️</span> 行程安排</div><div class="plan-card-body">' + (days.length > 0 ? renderTimeline(days) : markdownToHTML(sections.itinerary)) + '</div></div>';
    }
    if (sections.design) {
      html += '<div class="plan-card design-card"><div class="plan-card-header"><span class="plan-card-icon">💡</span> 设计说明</div><div class="plan-card-body">' + markdownToHTML(sections.design) + '</div></div>';
    }
    return html || markdownToHTML(text);
  }

  function splitPlanSections(text) {
    var result = { strategy: '', itinerary: '', design: '' };
    var lines = text.split('\n');
    var current = 'unknown';
    var buf = { strategy: [], itinerary: [], design: [], unknown: [] };
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i].trim();
      if (/^##\s*.*行程.*策略|^##\s*.*策略.*总结/i.test(ln)) { current = 'strategy'; continue; }
      if (/^##\s*.*行程.*安排|^##\s*.*日程|^##\s*.*详细.*行程|^##\s*.*行程.*规划/i.test(ln)) { current = 'itinerary'; continue; }
      if (/^##\s*.*设计.*说明|^##\s*.*说明|^##\s*.*经验/i.test(ln)) { current = 'design'; continue; }
      buf[current].push(lines[i]);
    }
    result.strategy = buf.strategy.join('\n').trim();
    result.itinerary = buf.itinerary.join('\n').trim();
    result.design = buf.design.join('\n').trim();
    if (!result.strategy && !result.itinerary && !result.design) result.itinerary = buf.unknown.join('\n').trim();
    return result;
  }

  function parseDays(text) {
    var days = [];
    var regex = /(?:###\s*)?(?:第\s*(\d+)\s*天|Day\s*(\d+))\s*[：:：]?\s*\n([\s\S]*?)(?=(?:###\s*)?(?:第\s*\d+\s*天|Day\s*\d+)|$)/gi;
    var m;
    while ((m = regex.exec(text)) !== null) {
      days.push({ day: parseInt(m[1] || m[2]), activities: parseActivities(m[3].trim()) });
    }
    return days;
  }

  function parseActivities(text) {
    var acts = [];
    var slot = null;
    var lines = text.split('\n');
    for (var i = 0; i < lines.length; i++) {
      var t = lines[i].trim();
      if (!t || /^[-–—]{3,}$/.test(t)) continue;
      var timeM = t.match(/[-•*]?\s*\**((?:上午|下午|傍晚|晚上|中午|早晨|早上|夜间))\s*[：:：]?\s*\**(.*)/i);
      if (timeM) { slot = timeM[1]; var c = timeM[2].replace(/\*\*/g, '').trim(); if (c) acts.push({ time: slot, content: c }); continue; }
      var listM = t.match(/^[-•*]\s+(.*)/);
      if (listM) { acts.push({ time: slot, content: listM[1].replace(/\*\*/g, '') }); continue; }
      var quoteM = t.match(/^>\s*(.*)/);
      if (quoteM) acts.push({ time: 'tip', content: quoteM[1] });
    }
    if (acts.length === 0 && text.trim()) {
      text.split('\n').filter(function (l) { return l.trim(); }).forEach(function (l) {
        acts.push({ time: null, content: l.replace(/^[-•*\d.]\s*/, '').replace(/\*\*/g, '') });
      });
    }
    return acts;
  }

  function renderTimeline(days) {
    var html = '<div class="timeline">';
    days.forEach(function (day) {
      html += '<div class="timeline-day"><div class="timeline-day-header"><div class="timeline-day-badge">第 ' + day.day + ' 天</div></div><div class="timeline-day-body">';
      day.activities.forEach(function (act) {
        if (act.time === 'tip') {
          html += '<div class="timeline-tip">💡 ' + inlineFormat(act.content) + '</div>';
        } else {
          html += '<div class="timeline-activity">' +
            (act.time ? '<div class="timeline-time">' + getTimeIcon(act.time) + ' ' + act.time + '</div>' : '') +
            '<div class="timeline-content">' + inlineFormat(act.content) + '</div></div>';
        }
      });
      html += '</div></div>';
    });
    return html + '</div>';
  }

  function getTimeIcon(time) {
    if (!time) return '📍';
    var t = time.toLowerCase();
    if (t.includes('早') || t.includes('晨')) return '🌅';
    if (t.includes('中')) return '🍽️';
    if (t.includes('下')) return '🌤️';
    if (t.includes('傍晚')) return '🌇';
    if (t.includes('晚')) return '🌙';
    if (t.includes('上')) return '☀️';
    return '📍';
  }

  // ---- Markdown ----
  function markdownToHTML(md) {
    var lines = md.split('\n');
    var html = '', inList = false, inQuote = false;
    for (var i = 0; i < lines.length; i++) {
      var t = lines[i].trim();
      if (t === '') { if (inList) { html += '</ul>'; inList = false; } if (inQuote) { html += '</blockquote>'; inQuote = false; } continue; }
      if (/^---+$/.test(t)) { if (inList) { html += '</ul>'; inList = false; } html += '<hr>'; continue; }
      if (t.startsWith('#### ')) { html += '<h4>' + inlineFormat(t.slice(5)) + '</h4>'; continue; }
      if (t.startsWith('### ')) { html += '<h3>' + inlineFormat(t.slice(4)) + '</h3>'; continue; }
      if (t.startsWith('## ')) { html += '<h2>' + inlineFormat(t.slice(3)) + '</h2>'; continue; }
      if (t.startsWith('# ')) { html += '<h1>' + inlineFormat(t.slice(2)) + '</h1>'; continue; }
      if (t.startsWith('> ')) { if (!inQuote) { html += '<blockquote>'; inQuote = true; } html += inlineFormat(t.slice(2)); continue; }
      else if (inQuote) { html += '</blockquote>'; inQuote = false; }
      if (/^[-*] /.test(t)) { if (!inList) { html += '<ul>'; inList = true; } html += '<li>' + inlineFormat(t.replace(/^[-*] /, '')) + '</li>'; continue; }
      else if (inList) { html += '</ul>'; inList = false; }
      html += '<p>' + inlineFormat(t) + '</p>';
    }
    if (inList) html += '</ul>';
    if (inQuote) html += '</blockquote>';
    return html;
  }

  function inlineFormat(text) {
    return text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>').replace(/`(.+?)`/g, '<code>$1</code>');
  }

  function escapeHTML(str) { var d = document.createElement('div'); d.textContent = str; return d.innerHTML; }

})();
