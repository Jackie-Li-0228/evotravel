// ============================================
// data.js - 数据管理（localStorage CRUD）
// ============================================

const STORAGE_KEY = 'travel_agent_data';

const DataStore = {
  _defaultData() {
    return {
      preferences: [],
      history: [],
      all_user_messages: []
    };
  },

  init() {
    if (!localStorage.getItem(STORAGE_KEY)) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this._defaultData()));
    }
  },

  _load() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || this._defaultData();
    } catch {
      return this._defaultData();
    }
  },

  _save(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  },

  // --- Preferences ---
  // 每条: { rule, confidence, source, created_at, reinforced_count }

  getPreferences() {
    return this._load().preferences;
  },

  addPreference(pref) {
    const data = this._load();
    const existing = data.preferences.find(p =>
      p.rule === pref.rule || this._isSimilar(p.rule, pref.rule)
    );

    if (existing) {
      existing.confidence = Math.min(1.0, existing.confidence + 0.08);
      existing.reinforced_count = (existing.reinforced_count || 0) + 1;
      if (pref.source && (!existing.source || pref.source.length > existing.source.length)) {
        existing.source = pref.source;
      }
    } else {
      data.preferences.push({
        rule: pref.rule,
        confidence: pref.confidence || 0.5,
        source: pref.source || '',
        created_at: new Date().toISOString(),
        reinforced_count: 0
      });
    }
    this._save(data);
  },

  _isSimilar(a, b) {
    if (!a || !b) return false;
    const ka = a.replace(/[，。、！？\s]/g, '');
    const kb = b.replace(/[，。、！？\s]/g, '');
    if (ka.length === 0 || kb.length === 0) return false;
    let overlap = 0;
    for (const c of ka) { if (kb.includes(c)) overlap++; }
    return overlap / Math.min(ka.length, kb.length) > 0.6;
  },

  // --- 用户消息历史 ---

  getUserMessages() {
    return this._load().all_user_messages || [];
  },

  addUserMessage(msg) {
    const data = this._load();
    if (!data.all_user_messages) data.all_user_messages = [];
    data.all_user_messages.push(msg);
    this._save(data);
  },

  // --- 行程历史 ---

  getHistory() {
    return this._load().history;
  },

  addHistoryEntry(entry) {
    const data = this._load();
    data.history.push({ ...entry, timestamp: new Date().toISOString() });
    this._save(data);
  },

  updateLastHistoryFeedback(feedback, extracted) {
    const data = this._load();
    if (data.history.length > 0) {
      const last = data.history[data.history.length - 1];
      last.feedback = feedback;
      last.extracted = extracted;
      this._save(data);
    }
  },

  // --- 批量操作 ---

  applyPreferences(prefs) {
    if (prefs && prefs.new_preferences) {
      prefs.new_preferences.forEach(p => this.addPreference(p));
    }
  },

  clearAll() {
    localStorage.removeItem(STORAGE_KEY);
    this.init();
  },

  getAll() {
    return this._load();
  }
};
