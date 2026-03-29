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
      current_destination: '',
      chat_history: [],  // {role, content} 格式的对话记录
      departure_city: '',  // 用户出发城市
      hotel: null,  // 选定的住宿地 {name, lat, lng, address}
      travel_dates: null  // 出行日期 {start: 'YYYY-MM-DD', end: 'YYYY-MM-DD'}
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

  // --- 对话历史（传给 GLM 的 messages 格式） ---
  getChatHistory: function () {
    return this._load().chat_history || [];
  },

  addChatMessage: function (role, content) {
    var data = this._load();
    if (!data.chat_history) data.chat_history = [];
    data.chat_history.push({ role: role, content: content });
    // 保留最近 100 条
    if (data.chat_history.length > 100) {
      data.chat_history = data.chat_history.slice(-100);
    }
    this._save(data);
  },

  clearAll: function () {
    localStorage.removeItem(STORAGE_KEY);
    this.init();
  },

  getAll: function () {
    return this._load();
  },

  // --- 出发城市 ---
  getDepartureCity: function () {
    return this._load().departure_city || '';
  },

  setDepartureCity: function (city) {
    if (!city) return;
    var data = this._load();
    data.departure_city = city;
    this._save(data);
  },

  // --- 住宿地 ---
  getHotel: function () {
    return this._load().hotel || null;
  },

  setHotel: function (hotel) {
    if (!hotel) return;
    var data = this._load();
    data.hotel = hotel;
    this._save(data);
  },

  clearHotel: function () {
    var data = this._load();
    data.hotel = null;
    this._save(data);
  },

  // --- 出行日期 ---
  getTravelDates: function () {
    return this._load().travel_dates || null;
  },

  setTravelDates: function (dates) {
    if (!dates) return;
    var data = this._load();
    data.travel_dates = dates;
    this._save(data);
  }
};
