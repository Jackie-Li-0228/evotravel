// ============================================
// data.js - 数据管理（localStorage CRUD）
// ============================================

var STORAGE_KEY = 'travel_agent_data';

var DataStore = {
  _defaultData: function () {
    return {
      preferences: [],
      history: [],
      all_user_messages: [],
      current_destination: ''
    };
  },

  init: function () {
    if (!localStorage.getItem(STORAGE_KEY)) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this._defaultData()));
    }
  },

  _load: function () {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || this._defaultData();
    } catch (e) {
      return this._defaultData();
    }
  },

  _save: function (data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  },

  // --- Preferences ---
  getPreferences: function () {
    return this._load().preferences;
  },

  addPreference: function (pref) {
    var data = this._load();
    var existing = data.preferences.find(function (p) {
      return p.rule === pref.rule || this._isSimilar(p.rule, pref.rule);
    }.bind(this));

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

  _isSimilar: function (a, b) {
    if (!a || !b) return false;
    var ka = a.replace(/[，。、！？\s]/g, '');
    var kb = b.replace(/[，。、！？\s]/g, '');
    if (ka.length === 0 || kb.length === 0) return false;
    var overlap = 0;
    for (var i = 0; i < ka.length; i++) {
      if (kb.indexOf(ka[i]) !== -1) overlap++;
    }
    return overlap / Math.min(ka.length, kb.length) > 0.6;
  },

  // --- 用户消息历史 ---
  getUserMessages: function () {
    return this._load().all_user_messages || [];
  },

  addUserMessage: function (msg) {
    var data = this._load();
    if (!data.all_user_messages) data.all_user_messages = [];
    data.all_user_messages.push(msg);
    this._save(data);
  },

  // --- 行程历史 ---
  getHistory: function () {
    return this._load().history;
  },

  addHistoryEntry: function (entry) {
    var data = this._load();
    data.history.push(Object.assign({ timestamp: new Date().toISOString() }, entry));
    this._save(data);
  },

  // --- 目的地记忆 ---
  getDestination: function () {
    return this._load().current_destination || '';
  },

  setDestination: function (city) {
    if (!city) return;
    var data = this._load();
    data.current_destination = city;
    this._save(data);
  },

  // --- 批量操作 ---
  applyPreferences: function (prefs) {
    if (prefs && prefs.new_preferences) {
      prefs.new_preferences.forEach(function (p) { this.addPreference(p); }.bind(this));
    }
  },

  clearAll: function () {
    localStorage.removeItem(STORAGE_KEY);
    this.init();
  },

  getAll: function () {
    return this._load();
  }
};
