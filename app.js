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
  var mapRouteLine = null;

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
    if (mapRouteLine) { map.remove(mapRouteLine); mapRouteLine = null; }
  }

  function showLocationsOnMap(locations) {
    clearMapData();
    if (!locations || locations.length === 0) return;
    var lnglats = [];
    locations.forEach(function (loc) {
      var marker = new AMap.Marker({
        position: [loc.lng, loc.lat],
        title: loc.name,
        label: { content: loc.name, direction: 'top' }
      });
      marker.on('click', function () {
        new AMap.InfoWindow({
          content: '<b>' + loc.name + '</b>' + (loc.time ? '<br>' + loc.time : ''),
          offset: new AMap.Pixel(0, -30)
        }).open(map, marker.getPosition());
      });
      mapMarkers.push(marker);
      lnglats.push([loc.lng, loc.lat]);
    });
    map.add(mapMarkers);
    if (lnglats.length > 1) {
      mapRouteLine = new AMap.Polyline({
        path: lnglats, strokeColor: '#4f46e5', strokeWeight: 3, strokeOpacity: 0.7, strokeStyle: 'dashed'
      });
      map.add(mapRouteLine);
    }
    map.setFitView(mapMarkers, false, [50, 50, 50, 50]);
    document.getElementById('map-info').textContent = '\u5171 ' + locations.length + ' \u4e2a\u5730\u70b9';
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

  // ---- Events ----
  btnSend.addEventListener('click', handleSend);
  userInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  });
  btnClear.addEventListener('click', function () {
    if (confirm('\u786e\u5b9a\u8981\u6e05\u9664\u6240\u6709\u6570\u636e\u5417\uff1f')) {
      DataStore.clearAll(); chatMessages.innerHTML = ''; clearMapData();
      refreshPreferencePanel(); addSystemMessage('\u6570\u636e\u5df2\u6e05\u9664\uff0c\u91cd\u65b0\u5f00\u59cb\u5427\uff01');
    }
  });
  userInput.addEventListener('input', function () {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 120) + 'px';
  });

  // ============================================
  // Core
  // ============================================
  async function handleSend() {
    var text = userInput.value.trim();
    if (!text) return;
    userInput.value = '';
    userInput.style.height = 'auto';
    btnSend.disabled = true;

    appendMessage('user', text);
    DataStore.addUserMessage(text);

    // 提取并记住目的地
    var detected = extractCity(text);
    if (detected) DataStore.setDestination(detected);
    var city = DataStore.getDestination();

    // 后台提取偏好
    extractPreferences(text, DataStore.getUserMessages()).then(function (result) {
      if (result.new_preferences.length > 0) {
        DataStore.applyPreferences(result);
        refreshPreferencePanel();
        addSystemMessage('\u{1F9E0} \u8bc6\u522b\u5230 ' + result.new_preferences.length + ' \u6761\u65b0\u504f\u597d\uff0c\u5df2\u66f4\u65b0');
      }
    });

    var typingEl = showTyping();
    try {
      var plan = await smartPlanning(text, DataStore.getPreferences());
      DataStore.addHistoryEntry({ request: text, plan: plan });
      typingEl.remove();
      appendAIMessage(plan, text);

      var rawLocs = parseLocations(plan, city);
      if (rawLocs.length > 0) {
        addSystemMessage('\u{1F5FA}\uFE0F \u6b63\u5728\u83b7\u53d6 ' + rawLocs.length + ' \u4e2a\u5730\u70b9\u7684\u5750\u6807...');
        var resolved = await resolveLocations(rawLocs, city);
        if (resolved.length > 0) {
          switchTab('map');
          setTimeout(function () {
            initMap();
            if (map) {
              showLocationsOnMap(resolved);
              addSystemMessage('\u2705 \u5df2\u5728\u5730\u56fe\u4e0a\u6807\u8bb0 ' + resolved.length + ' \u4e2a\u5730\u70b9');
            }
          }, 300);
        } else {
          addSystemMessage('\u672a\u80fd\u83b7\u53d6\u5230\u5730\u70b9\u5750\u6807');
        }
      }
    } catch (err) {
      typingEl.remove();
      addSystemMessage('\u751f\u6210\u5931\u8d25\uff1a' + err.message);
    }
    btnSend.disabled = false;
  }

  // ============================================
  // 地点解析 + 地理编码
  // ============================================
  function parseLocations(text, city) {
    var locations = [];
    var seen = {};
    var lines = text.split('\n');
    for (var i = 0; i < lines.length; i++) {
      var t = lines[i].trim();
      if (!t) continue;
      var boldM = t.match(/\*\*(.+?)\*\*/);
      if (boldM) {
        var name = boldM[1].replace(/[（(][\s\S]*$/, '').trim();
        if (name && name.length > 1 && !seen[name]) {
          seen[name] = true;
          var timeM = t.match(/(上午|下午|傍晚|晚上|中午|早晨|早上)/);
          locations.push({ name: name, time: timeM ? timeM[1] : '' });
        }
      }
    }
    return locations;
  }

  var AMAP_KEY = '94cd115ba02a97bb4f7ca90c3d7ccdc8';
  var geoCache = {};

  async function geocodeLocation(name, city) {
    var ck = (city || '') + name;
    if (geoCache[ck]) return geoCache[ck];

    // 1. POI 搜索（对景点更准确）
    try {
      var poiUrl = 'https://restapi.amap.com/v3/place/text?keywords=' +
        encodeURIComponent(name) +
        (city ? '&city=' + encodeURIComponent(city) : '') +
        '&key=' + AMAP_KEY + '&offset=1';
      var resp = await fetch(poiUrl);
      if (resp.ok) {
        var data = await resp.json();
        if (data && data.pois && data.pois.length > 0) {
          var parts = data.pois[0].location.split(',');
          if (parts.length === 2) {
            var r = { lat: parseFloat(parts[1]), lng: parseFloat(parts[0]) };
            geoCache[ck] = r;
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
            var r = { lat: parseFloat(parts[1]), lng: parseFloat(parts[0]) };
            geoCache[ck] = r;
            return r;
          }
        }
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  async function resolveLocations(locations, city) {
    var resolved = [];
    for (var i = 0; i < locations.length; i++) {
      var loc = locations[i];
      var geo = await geocodeLocation(loc.name, city);
      if (geo) resolved.push({ name: loc.name, lat: geo.lat, lng: geo.lng, time: loc.time || '' });
    }
    return resolved;
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

  function extractCity(text) {
    for (var i = 0; i < KNOWN_CITIES.length; i++) {
      if (text.indexOf(KNOWN_CITIES[i]) !== -1) return KNOWN_CITIES[i];
    }
    return '';
  }

  // ============================================
  // Chat Rendering
  // ============================================
  function appendMessage(role, text) {
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
    bubble.textContent = '你好！我是 EvoTavern 旅行规划助手。\n\n告诉我你想去哪里旅行，我会为你生成行程方案，还可以在地图上查看路线！\n\n直接告诉我你的想法——比如"不想去人多的地方"，我会自动学习你的偏好。';
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
      prefList.innerHTML = '<li class="exp-empty">\u6682\u65e0\u504f\u597d\uff0c\u5bf9\u8bdd\u4e2d\u81ea\u52a8\u79ef\u7d2f</li>';
    } else {
      prefs.forEach(function (p) {
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
    historyCount.textContent = hist.length;
    historyList.innerHTML = '';
    if (hist.length === 0) {
      historyList.innerHTML = '<li class="exp-empty">\u6682\u65e0\u5386\u53f2\u8bb0\u5f55</li>';
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
