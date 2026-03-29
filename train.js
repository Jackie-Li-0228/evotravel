// ============================================
// train.js - 12306 站点代码查询 + 列车查询
// ============================================

var TrainService = {
  // 站点代码缓存（cityName -> code）
  stationCache: {},

  // 常见站点代码预置（避免每次都请求 station_name.js）
  presetStations: {
    '北京': 'BJP', '北京西': 'BXP', '北京南': 'BNP', '北京北': 'VAP',
    '上海': 'SHH', '上海虹桥': 'AOH', '上海南': 'SNH', '上海西': 'SXO',
    '广州': 'GZQ', '广州南': 'IZQ', '广州东': 'GGQ',
    '深圳': 'SZQ', '深圳北': 'IOQ', '深圳东': 'BJQ',
    '杭州': 'HZH', '杭州东': 'HGH', '杭州南': 'XNH',
    '成都': 'CDW', '成都东': 'ICW', '成都南': 'CNW',
    '西安': 'XAY', '西安北': 'EAY',
    '南京': 'NJH', '南京南': 'NKH', '南京西': 'JNH',
    '武汉': 'WHN', '汉口': 'HKN', '武昌': 'WCN',
    '重庆': 'CQW', '重庆北': 'CUW', '重庆西': 'CXW',
    '苏州': 'SZH', '苏州北': 'OHH',
    '天津': 'TJP', '天津西': 'TXP', '天津南': 'TIP',
    '长沙': 'CSQ', '长沙南': 'CWQ',
    '青岛': 'QDK', '青岛北': 'QHK', '青岛西': 'QXK',
    '大连': 'DLT', '大连北': 'DFT',
    '厦门': 'XMS', '厦门北': 'XKS', '厦门高崎': 'XBS',
    '昆明': 'KMM', '昆明南': 'KOM',
    '丽江': 'LHM',
    '桂林': 'GXW', '桂林北': 'GBW',
    '三亚': 'SEQ', '海口': 'VUQ',
    '哈尔滨': 'HBB', '哈尔滨西': 'HXB', '哈尔滨东': 'VBB',
    '沈阳': 'SYT', '沈阳北': 'SBT', '沈阳南': 'SOT',
    '济南': 'JNK', '济南西': 'JGK', '济南东': 'UNK',
    '郑州': 'ZZF', '郑州东': 'ZAF', '郑州西': 'ZXF',
    '福州': 'FZS', '福州南': 'FYS',
    '合肥': 'HFH', '合肥南': 'ENH',
    '南昌': 'NCG', '南昌西': 'NXG',
    '贵阳': 'GIW', '贵阳北': 'KQW',
    '南宁': 'NNZ', '南宁东': 'NDZ',
    '石家庄': 'SJP', '太原': 'TYV', '兰州': 'LZJ', '银川': 'YCJ',
    '西宁': 'XNO', '呼和浩特': 'HHC', '乌鲁木齐': 'WAR',
    '洛阳': 'LYF', '开封': 'KFF',
    '大理': 'DLM', '张家界': 'ZQJ',
    '拉萨': 'LSO',
    '无锡': 'WTH', '宁波': 'NGH', '温州': 'RZH',
    '黄山': 'HKH', '敦煌': 'DHJ',
    '香港': 'XJA', '香港西九龙': 'XAJ'
  },

  // 获取站点代码
  async fetchStationCode(cityName) {
    // 1. 查预设
    if (this.presetStations[cityName]) {
      this.stationCache[cityName] = this.presetStations[cityName];
      return this.presetStations[cityName];
    }
    // 2. 查缓存
    if (this.stationCache[cityName]) {
      return this.stationCache[cityName];
    }
    // 3. 尝试从 12306 station_name.js 获取
    try {
      var resp = await fetch('https://kyfw.12306.cn/otn/resources/js/framework/station_name.js', {
        mode: 'no-cors'
      });
      // no-cors 模式下无法读取内容，直接跳过
    } catch (e) { /* ignore */ }

    // 4. 用高德 POI 搜索火车站，获取城市名后匹配
    try {
      var url = 'https://restapi.amap.com/v3/place/text?keywords=' +
        encodeURIComponent(cityName + '火车站') +
        '&types=150200&city=' + encodeURIComponent(cityName) +
        '&key=94cd115ba02a97bb4f7ca90c3d7ccdc8&offset=3';
      var resp = await fetch(url);
      if (resp.ok) {
        var data = await resp.json();
        if (data.pois && data.pois.length > 0) {
          var stationName = data.pois[0].name.replace(/火车站$/, '').trim();
          if (this.presetStations[stationName]) {
            this.stationCache[cityName] = this.presetStations[stationName];
            return this.presetStations[stationName];
          }
        }
      }
    } catch (e) { /* ignore */ }

    return null;
  },

  // 查询列车
  async queryTrains(fromCity, toCity, date) {
    var fromCode = await this.fetchStationCode(fromCity);
    var toCode = await this.fetchStationCode(toCity);
    if (!fromCode || !toCode) {
      return { error: '无法获取站点代码，城市：' + fromCity + ' → ' + toCity };
    }

    var dateStr = date;
    if (date instanceof Date) {
      dateStr = date.getFullYear() + '-' +
        String(date.getMonth() + 1).padStart(2, '0') + '-' +
        String(date.getDate()).padStart(2, '0');
    }

    var url = 'https://kyfw.12306.cn/otn/leftTicket/queryZ?' +
      'leftTicketDTO.train_date=' + dateStr +
      '&leftTicketDTO.from_station=' + fromCode +
      '&leftTicketDTO.to_station=' + toCode +
      '&purpose_codes=ADULT';

    try {
      var resp = await fetch(url);
      if (!resp.ok) {
        return { error: '列车查询暂时不可用（HTTP ' + resp.status + '），建议查看 12306 官网' };
      }
      var data = await resp.json();
      if (!data.data || !data.data.result) {
        return { error: '未查询到列车信息，建议查看 12306 官网' };
      }
      var map = data.data.map || {};
      var trains = data.data.result.map(function (item) {
        return TrainService.parseTrain(item, map);
      });
      return { trains: trains, fromCode: fromCode, toCode: toCode };
    } catch (e) {
      return { error: '列车查询失败（可能被 CORS 限制），建议查看 12306 官网：kyfw.12306.cn' };
    }
  },

  // 解析单条列车数据
  parseTrain(rawStr, stationMap) {
    var fields = rawStr.split('|');
    // 12306 返回字段索引：
    // 0: secretStr, 1: buttonTextInfo, 2: train_no, 3: station_train_code(车次号)
    // 4: start_station_telecode, 5: end_station_telecode,
    // 6: from_station_telecode, 7: to_station_telecode,
    // 8: start_time, 9: arrive_time, 10:历时,
    // 11: yp_info, 12: 车次日期...
    // 座位信息从 index 28 开始
    var trainCode = fields[3] || '';
    var fromStation = stationMap[fields[6]] || fields[6] || '';
    var toStation = stationMap[fields[7]] || fields[7] || '';
    var startTime = fields[8] || '';
    var arriveTime = fields[9] || '';
    var duration = fields[10] || '';
    var dateStr = fields[13] || '';

    // 座位价格（有票/无票）
    var seats = {};
    var seatLabels = {
      28: '商务座', 29: '特等座', 30: '一等座', 31: '二等座',
      32: '高级软卧', 33: '软卧', 34: '动卧',
      35: '硬卧', 36: '软座', 37: '硬座', 38: '无座'
    };
    Object.keys(seatLabels).forEach(function (idx) {
      var val = fields[idx];
      if (val && val !== '' && val !== '--' && val !== '无') {
        seats[seatLabels[idx]] = val;
      }
    });

    return {
      trainCode: trainCode,
      fromStation: fromStation,
      toStation: toStation,
      startTime: startTime,
      arriveTime: arriveTime,
      duration: duration,
      date: dateStr,
      seats: seats
    };
  },

  // 格式化列车信息为文本（给 GLM 或用户看）
  formatTrainsText(result, fromCity, toCity) {
    if (result.error) {
      return '🚄 ' + fromCity + ' → ' + toCity + '：' + result.error;
    }
    var trains = result.trains;
    if (!trains || trains.length === 0) {
      return '🚄 ' + fromCity + ' → ' + toCity + '：未查到列车信息，建议查看 12306';
    }
    var text = '🚄 ' + fromCity + ' → ' + toCity + ' 共 ' + trains.length + ' 趟列车：\n';
    // 最多显示前10趟
    var show = trains.slice(0, 10);
    show.forEach(function (t) {
      text += '- ' + t.trainCode + ' ' + t.startTime + '→' + t.arriveTime +
        '（' + t.duration + '）';
      var seatKeys = Object.keys(t.seats);
      if (seatKeys.length > 0) {
        text += ' [' + seatKeys.slice(0, 3).map(function (k) { return k + ':' + t.seats[k]; }).join(', ') + ']';
      }
      text += '\n';
    });
    if (trains.length > 10) {
      text += '...还有 ' + (trains.length - 10) + ' 趟\n';
    }
    return text;
  },

  // 生成列车卡片 HTML
  formatTrainsHTML(result, fromCity, toCity) {
    if (result.error) {
      return '<div class="train-card"><div class="train-card-header">🚄 ' + escapeHTML(fromCity) + ' → ' + escapeHTML(toCity) + '</div>' +
        '<div class="train-card-body"><p class="train-error">' + escapeHTML(result.error) + '</p></div></div>';
    }
    var trains = result.trains;
    if (!trains || trains.length === 0) {
      return '<div class="train-card"><div class="train-card-header">🚄 ' + escapeHTML(fromCity) + ' → ' + escapeHTML(toCity) + '</div>' +
        '<div class="train-card-body"><p>未查到列车信息</p></div></div>';
    }
    var html = '<div class="train-card"><div class="train-card-header">🚄 ' + escapeHTML(fromCity) + ' → ' + escapeHTML(toCity) +
      ' <span class="train-count">' + trains.length + ' 趟</span></div><div class="train-card-body"><table class="train-table">' +
      '<tr><th>车次</th><th>出发</th><th>到达</th><th>历时</th><th>余票</th></tr>';
    trains.slice(0, 8).forEach(function (t) {
      var seatInfo = Object.keys(t.seats).slice(0, 2).map(function (k) { return k + ':' + t.seats[k]; }).join(' ');
      html += '<tr><td class="train-code">' + escapeHTML(t.trainCode) + '</td>' +
        '<td>' + escapeHTML(t.startTime) + '</td>' +
        '<td>' + escapeHTML(t.arriveTime) + '</td>' +
        '<td>' + escapeHTML(t.duration) + '</td>' +
        '<td class="train-seats">' + escapeHTML(seatInfo || '--') + '</td></tr>';
    });
    html += '</table>';
    if (trains.length > 8) {
      html += '<p class="train-more">...还有 ' + (trains.length - 8) + ' 趟，建议查看 12306</p>';
    }
    html += '</div></div>';
    return html;
  }
};

// 全局 escapeHTML（第一个加载的模块定义，其他模块不重复定义）
if (typeof window.escapeHTML !== 'function') {
  window.escapeHTML = function(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; };
}
