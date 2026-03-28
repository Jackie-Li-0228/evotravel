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
      refreshPreferencePanel();
      addSystemMessage('数据已清除，重新开始吧！');
    }
  });
  userInput.addEventListener('input', function () {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 120) + 'px';
  });

  // ---- Core: 每轮对话 ----

  async function handleSend() {
    const text = userInput.value.trim();
    if (!text) return;

    userInput.value = '';
    userInput.style.height = 'auto';
    btnSend.disabled = true;

    appendMessage('user', text);

    // 记录用户消息
    DataStore.addUserMessage(text);

    // 每轮都提取偏好（后台，不阻塞）
    const allMessages = DataStore.getUserMessages();
    extractPreferences(text, allMessages).then(function(result) {
      if (result.new_preferences.length > 0) {
        DataStore.applyPreferences(result);
        refreshPreferencePanel();
        const count = result.new_preferences.length;
        addSystemMessage('🧠 识别到 ' + count + ' 条新偏好，已更新经验库');
      }
    });

    // 生成行程
    const typingEl = showTyping();

    try {
      const preferences = DataStore.getPreferences();
      const plan = await smartPlanning(text, preferences);
      DataStore.addHistoryEntry({ request: text, plan: plan });
      typingEl.remove();
      appendAIMessage(plan, text);
    } catch (err) {
      typingEl.remove();
      addSystemMessage('生成失败：' + err.message);
    }

    btnSend.disabled = false;
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

  function scrollToBottom() {
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  // ---- History ----

  function loadChatHistory() {
    const history = DataStore.getHistory();
    if (history.length === 0) {
      addWelcomeMessage();
      return;
    }
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
    bubble.textContent = '你好！我是 EvoTavern 旅行规划助手。\n\n告诉我你想去哪里旅行，我会为你生成行程方案。\n\n对行程有任何想法直接说就好——比如"不想去人多的地方"、"节奏太赶了"，我会自动学习你的偏好，下次规划更懂你。';
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
        const reinforced = p.reinforced_count > 0 ? ' <span class="reinforced">×' + (p.reinforced_count + 1) + '</span>' : '';
        let html = '<div class="pref-rule">' + escapeHTML(p.rule) + reinforced + '</div>';
        html += '<div class="pref-meta">';
        html += '<div class="confidence-bar"><div class="confidence-bar-fill" style="width:' + pct + '%"></div></div>';
        html += '<span class="confidence">' + pct + '%</span>';
        html += '</div>';
        if (p.source) {
          html += '<div class="exp-source">"' + escapeHTML(p.source) + '"</div>';
        }
        li.innerHTML = html;
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
        const timeStr = time.toLocaleDateString('zh-CN') + ' ' + time.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        li.innerHTML =
          '<div class="history-time">' + timeStr + '</div>' +
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
      html += '<div class="plan-card strategy-card">';
      html += '<div class="plan-card-header"><span class="plan-card-icon">📋</span> 行程策略</div>';
      html += '<div class="plan-card-body">' + markdownToHTML(sections.strategy) + '</div>';
      html += '</div>';
    }

    if (sections.itinerary) {
      const days = parseDays(sections.itinerary);
      html += '<div class="plan-card itinerary-card">';
      html += '<div class="plan-card-header"><span class="plan-card-icon">🗓️</span> 行程安排</div>';
      html += '<div class="plan-card-body">';
      if (days.length > 0) {
        html += renderTimeline(days);
      } else {
        html += markdownToHTML(sections.itinerary);
      }
      html += '</div></div>';
    }

    if (sections.design) {
      html += '<div class="plan-card design-card">';
      html += '<div class="plan-card-header"><span class="plan-card-icon">💡</span> 设计说明</div>';
      html += '<div class="plan-card-body">' + markdownToHTML(sections.design) + '</div>';
      html += '</div>';
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
    if (!result.strategy && !result.itinerary && !result.design) {
      result.itinerary = buf.unknown.join('\n').trim();
    }
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
      if (quoteM) { acts.push({ time: 'tip', content: quoteM[1] }); continue; }
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
      html += '<div class="timeline-day">';
      html += '<div class="timeline-day-header"><div class="timeline-day-badge">第 ' + day.day + ' 天</div></div>';
      html += '<div class="timeline-day-body">';
      day.activities.forEach(function (act) {
        if (act.time === 'tip') {
          html += '<div class="timeline-tip">💡 ' + inlineFormat(act.content) + '</div>';
        } else {
          const icon = getTimeIcon(act.time);
          html += '<div class="timeline-activity">';
          if (act.time) html += '<div class="timeline-time">' + icon + ' ' + act.time + '</div>';
          html += '<div class="timeline-content">' + inlineFormat(act.content) + '</div>';
          html += '</div>';
        }
      });
      html += '</div></div>';
    });
    html += '</div>';
    return html;
  }

  function getTimeIcon(time) {
    if (!time) return '📍';
    const t = time.toLowerCase();
    if (t.includes('早') || t.includes('晨')) return '🌅';
    if (t.includes('上')) return '☀️';
    if (t.includes('中')) return '🍽️';
    if (t.includes('下')) return '🌤️';
    if (t.includes('傍晚')) return '🌇';
    if (t.includes('晚')) return '🌙';
    return '📍';
  }

  // ---- Markdown ----

  function markdownToHTML(md) {
    const lines = md.split('\n');
    let html = '';
    let inList = false;
    let inQuote = false;

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
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');
    text = text.replace(/`(.+?)`/g, '<code>$1</code>');
    return text;
  }

  function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

})();
