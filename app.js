// ============================================
// app.js - 主要逻辑
// ============================================

(function () {
  'use strict';

  // ---- DOM refs ----
  const chatMessages = document.getElementById('chat-messages');
  const userInput = document.getElementById('user-input');
  const btnSend = document.getElementById('btn-send');
  const btnClear = document.getElementById('btn-clear');
  const prefList = document.getElementById('pref-list');
  const historyList = document.getElementById('history-list');
  const prefCount = document.getElementById('pref-count');
  const historyCount = document.getElementById('history-count');

  // ---- Map ----
  let map = null;
  let mapMarkers = [];
  let mapRouteLine = null;

  function initMap() {
    if (map) return;
    const mapEl = document.getElementById('itinerary-map');
    if (!mapEl) return;
    map = L.map('itinerary-map').setView([30.27, 120.15], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
      maxZoom: 18
    }).addTo(map);
  }

  function clearMapData() {
    if (!map) return;
    mapMarkers.forEach(m => map.removeLayer(m));
    mapMarkers = [];
    if (mapRouteLine) { map.removeLayer(mapRouteLine); mapRouteLine = null; }
  }

  function showLocationsOnMap(locations) {
    initMap();
    clearMapData();
    if (locations.length === 0) return;

    const latlngs = [];
    locations.forEach((loc, i) => {
      const marker = L.marker([loc.lat, loc.lng])
        .addTo(map)
        .bindPopup('<b>' + loc.name + '</b>' + (loc.time ? '<br>' + loc.time : ''));
      mapMarkers.push(marker);
      latlngs.push([loc.lat, loc.lng]);
    });

    if (latlngs.length > 1) {
      mapRouteLine = L.polyline(latlngs, {
        color: '#4f46e5', weight: 3, opacity: 0.7, dashArray: '8, 8'
      }).addTo(map);
    }

    map.fitBounds(L.latLngBounds(latlngs).pad(0.15));
    switchTab('map');
    document.getElementById('map-info').textContent = '共 ' + locations.length + ' 个地点，已标记在地图上';
  }

  // ---- Tab switching ----
  document.querySelectorAll('.panel-tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  function switchTab(tabName) {
    document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
    document.querySelector('.panel-tab[data-tab="' + tabName + '"]').classList.add('active');
    document.getElementById('tab-profile').style.display = tabName === 'profile' ? '' : 'none';
    document.getElementById('tab-map').style.display = tabName === 'map' ? '' : 'none';
    if (tabName === 'map' && map) setTimeout(() => map.invalidateSize(), 100);
  }

  // ---- Init ----
  DataStore.init();
  loadChatHistory();
  refreshPreferencePanel();

  initMap();

  initPanelTabs();

  initMapEventHandlers();

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
    const text = userInput.value.trim();
    if (!text) return;
    userInput.value = '';
    userInput.style.height = 'auto';
    btnSend.disabled = true;

    appendMessage('user', text);
    DataStore.addUserMessage(text);

    // 后台提取偏好
    extractPreferences(text, DataStore.getUserMessages()).then(function (result) {
      if (result.new_preferences.length > 0) {
        DataStore.applyPreferences(result);
        refreshPreferencePanel();
        addSystemMessage('🧠 识别到 ' + result.new_preferences.length + ' 条新偏好，已更新');
      }
    });

    const typingEl = showTyping();
    try {
      const plan = await smartPlanning(text, DataStore.getPreferences());
      DataStore.addHistoryEntry({ request: text, plan: plan });
      typingEl.remove();
      appendAIMessage(plan, text);

      const locations = parseLocations(plan);
      if (locations.length > 0) showLocationsOnMap(locations);
    } catch (err) {
      typingEl.remove();
      addSystemMessage('生成失败：' + err.message);
    }
    btnSend.disabled = false;
  }

  // ---- 解析地点坐标 ----
  function parseLocations(text) {
    const locations = [];
    // 中文全角括号和半角括号混合， ( and （
    const lines = text.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      // Match: name(30.2421,120.1487) or name（30.2421,120.1487）
      // 需要匹配中文和英文括号
      const m = trimmed.match(/^(?:[-•*]\s*)?(?:\d+\.\s*)?(?:上午|下午|傍晚|晚上|中午|早晨|早上)?\s*[:：:]?\s*(.+?)[(\uff08\u3000\uFF09|\uff09\uFF08\uff09)]?\s*(-?\d+\.?\d*)\s*[,\uff0\uFF0\u3000\uFF08\uFF09\u3000\uFF08\uFF08\uFF09\u3000\uFF0-\uff0\u3000\uFF08\uFF08\uFF09\u3000\uFF0\uFF0-\uff0\u3000\uFF08\uFF08\uFF09\u3000\uFF08\uFF08\uFF09\u3000\uFF0)]\s*(-?\d+\.?\d*)\s*[)\uff09\uFF0\u3000\uFF08\uFF09\u3000\uFF08\uFF08\uFF09\u3000\uFF0-\uff0\u3000\uFF08\uFF08\uFF09\u3000\uFF08\uFF08\uFF09\u3000\uFF0\uFF0-\uff0\u3000\uFF08\uFF08\uFF09\u3000\uFF08\uFF08\uFF09\u3000\uFF0)]/);
      if (!m) continue;
      const name = m[1].replace(/\*\*/g, '').trim();
      const lat = parseFloat(m[2]);
      const lng = parseFloat(m[3]);
      if (!name || isNaN(lat) || isNaN(lng)) continue;
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
      const timeM = trimmed.match(/(上午|下午|傍晚|晚上|中午|早晨|早上)/);
      locations.push({ name: name, lat: lat, lng: lng, time: timeM ? timeM[1] : '' });
    }
    return locations;
  }

  // ---- Chat Rendering ----

  function appendMessage(role, text) {
    const div = document.createElement('div');
    div.className = 'message ' + role;
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = text;
    div.appendChild(bubble);
    chatMessages.appendChild(div);
    scrollToBottom();
    return div;
  }

  function appendAIMessage(planText, requestText) {
    const div = document.createElement('div');
    div.className = 'message ai';
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.innerHTML = renderPlanVisual(planText);
    div.appendChild(bubble);

    const mapBtn = document.createElement('button');
    mapBtn.className = 'btn-map-view';
    mapBtn.textContent = '🗺️ 查看地图';
    mapBtn.addEventListener('click', function () {
      const locations = parseLocations(planText);
      if (locations.length > 0) showLocationsOnMap(locations);
      else addSystemMessage('未能识别到可标记的地点坐标');
    });
    div.appendChild(mapBtn);

    chatMessages.appendChild(div);
    scrollToBottom();
    return div;
  }

  function addSystemMessage(text) {
    const div = document.createElement('div');
    div.className = 'message ai';
    const bubble = document.createElement('div');
    bubble.className = 'bubble system-msg';
    bubble.textContent = text;
    div.appendChild(bubble);
    chatMessages.appendChild(div);
    scrollToBottom();
  }

  function showTyping() {
    const div = document.createElement('div');
    div.className = 'typing-indicator';
    div.innerHTML = '<span></span><span></span><span></span>';
    chatMessages.appendChild(div);
    scrollToBottom();
    return div;
  }

  function scrollToBottom() { chatMessages.scrollTop = chatMessages.scrollHeight; }

  // ---- History ----

  function loadChatHistory() {
    const history = DataStore.getHistory();
    if (history.length === 0) { addWelcomeMessage(); return; }
    for (const entry of history) {
      appendMessage('user', entry.request);
      appendAIMessage(entry.plan, entry.request);
    }
  }

  function addWelcomeMessage() {
    const div = document.createElement('div');
    div.className = 'message ai';
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.style.whiteSpace = 'pre-line';
    bubble.textContent = '你好！我是 EvoTavern 旅行规划助手。\n\n告诉我你想去哪里旅行，我会为你生成行程方案，还可以在地图上查看路线！\n\n直接告诉我你的想法——比如"不想去人多的地方"，我会自动学习你的偏好。';
    div.appendChild(bubble);
    chatMessages.appendChild(div);
  }

  // ---- Preference Panel ----

  function refreshPreferencePanel() {
    const preferences = DataStore.getPreferences();
    const history = DataStore.getHistory();

    prefCount.textContent = preferences.length;
    prefList.innerHTML = '';
    if (preferences.length === 0) {
      prefList.innerHTML = '<li class="exp-empty">暂无偏好，对话中自动积累</li>';
    } else {
      preferences.forEach(function (p) {
        const li = document.createElement('li');
        const pct = (p.confidence * 100).toFixed(0);
        const re = p.reinforced_count > 0 ? ' <span class="reinforced">\u00d7' + (p.reinforced_count + 1) + '</span>' : '';
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
      [...history].reverse().forEach(function (h) {
        const li = document.createElement('li');
        const time = new Date(h.timestamp);
        li.innerHTML = '<div class="history-time">' + time.toLocaleDateString('zh-CN') + ' ' +
          time.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) + '</div>' +
          '<div class="history-preview">' + escapeHTML(h.request) + '</div>';
        historyList.appendChild(li);
      });
    }
  }

  // ---- 行程可视化 ----

  function renderPlanVisual(text) {
    const sections = splitPlanSections(text);
    let html = '';
    if (sections.strategy) {
      html += '<div class="plan-card strategy-card"><div class="plan-card-header"><span class="plan-card-icon">📋</span> 行程策略</div>' +
        '<div class="plan-card-body">' + markdownToHTML(sections.strategy) + '</div></div>';
    }
    if (sections.itinerary) {
      const days = parseDays(sections.itinerary);
      html += '<div class="plan-card itinerary-card"><div class="plan-card-header"><span class="plan-card-icon">🗓️</span> 行程安排</div>' +
        '<div class="plan-card-body">' + (days.length > 0 ? renderTimeline(days) : markdownToHTML(sections.itinerary)) + '</div></div>';
    }
    if (sections.design) {
      html += '<div class="plan-card design-card"><div class="plan-card-header"><span class="plan-card-icon">💡</span> 设计说明</div>' +
        '<div class="plan-card-body">' + markdownToHTML(sections.design) + '</div></div>';
    }
    return html || markdownToHTML(text);
  }

  function splitPlanSections(text) {
    const result = { strategy: '', itinerary: '', design: '' };
    const lines = text.split('\n');
    let current = 'unknown';
    let buf = { strategy: [], itinerary: [], design: [], unknown: [] };
    for (const line of lines) {
      const ln = line.trim();
      if (/^##\s*.*行程.*策略|^##\s*.*策略.*总结/i.test(ln)) { current = 'strategy'; continue; }
      if (/^##\s*.*行程.*安排|^##\s*.*日程|^##\s*.*详细.*行程|^##\s*.*行程.*规划/i.test(ln)) { current = 'itinerary'; continue; }
      if (/^##\s*.*设计.*说明|^##\s*.*说明|^##\s*.*经验/i.test(ln)) { current = 'design'; continue; }
      buf[current].push(line);
    }
    result.strategy = buf.strategy.join('\n').trim();
    result.itinerary = buf.itinerary.join('\n').trim();
    result.design = buf.design.join('\n').trim();
    if (!result.strategy && !result.itinerary && !result.design) result.itinerary = buf.unknown.join('\n').trim();
    return result;
  }

  function parseDays(text) {
    const days = [];
    const regex = /(?:###\s*)?(?:第\s*(\d+)\s*天|Day\s*(\d+))\s*[：:：]?\s*\n([\s\S]*?)(?=(?:###\s*)?(?:第\s*\d+\s*天|Day\s*\d+)|$)/gi;
    let m;
    while ((m = regex.exec(text)) !== null) {
      days.push({ day: parseInt(m[1] || m[2]), activities: parseActivities(m[3].trim()) });
    }
    return days;
  }

  function parseActivities(text) {
    const acts = [];
    let slot = null;
    for (const line of text.split('\n')) {
      const t = line.trim();
      if (!t || /^[-–—]{3,}$/.test(t)) continue;
      const timeM = t.match(/[-•*]?\s*\**((?:上午|下午|傍晚|晚上|中午|早晨|早上|夜间))\s*[：:：]?\s*\**(.*)/i);
      if (timeM) { slot = timeM[1]; const c = timeM[2].replace(/\*\*/g, '').trim(); if (c) acts.push({ time: slot, content: c }); continue; }
      const listM = t.match(/^[-•*]\s+(.*)/);
      if (listM) { acts.push({ time: slot, content: listM[1].replace(/\*\*/g, '') }); continue; }
      const quoteM = t.match(/^>\s*(.*)/);
      if (quoteM) { acts.push({ time: 'tip', content: quoteM[1] }); }
    }
    if (acts.length === 0 && text.trim()) {
      text.split('\n').filter(l => l.trim()).forEach(l => {
        acts.push({ time: null, content: l.replace(/^[-•*\d.]\s*/, '').replace(/\*\*/g, '') });
      });
    }
    return acts;
  }

  function renderTimeline(days) {
    let html = '<div class="timeline">';
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
    const t = time.toLowerCase();
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
    const lines = md.split('\n');
    let html = '', inList = false, inQuote = false;
    for (const line of lines) {
      const t = line.trim();
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

  function escapeHTML(str) { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }

})();
