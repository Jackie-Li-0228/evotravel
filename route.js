// ============================================
// route.js - 路线优化（通勤时间 + 时间窗约束）
// ============================================

var RouteOptimizer = {
  AMAP_KEY: '94cd115ba02a97bb4f7ca90c3d7ccdc8',
  cache: {},

  // ---- 高德路线规划 API ----

  // 获取两点间驾车时间（秒）
  async getDriveDuration(from, to) {
    var ck = from.lng + ',' + from.lat + '->' + to.lng + ',' + to.lat;
    if (this.cache[ck]) return this.cache[ck];
    try {
      var url = 'https://restapi.amap.com/v3/direction/driving?origin=' +
        from.lng + ',' + from.lat + '&destination=' + to.lng + ',' + to.lat +
        '&key=' + this.AMAP_KEY + '&strategy=0'; // 最快路线
      var resp = await fetch(url);
      var data = await resp.json();
      if (data.route && data.route.paths && data.route.paths.length > 0) {
        var secs = parseInt(data.route.paths[0].duration);
        var dist = parseInt(data.route.paths[0].distance);
        var result = { seconds: secs, minutes: Math.round(secs / 60), meters: dist };
        this.cache[ck] = result;
        return result;
      }
    } catch (e) { console.warn('Drive API failed:', e); }
    // fallback: 直线距离估算（步行速度的3倍）
    var dist = this.haversine(from.lat, from.lng, to.lat, to.lng);
    var mins = Math.max(5, Math.round(dist / 500)); // 500m/min 驾车
    return { seconds: mins * 60, minutes: mins, meters: Math.round(dist) };
  },

  // 构建完整的时间矩阵（所有点之间的驾车时间）
  async buildTimeMatrix(locations) {
    var n = locations.length;
    var matrix = [];
    for (var i = 0; i < n; i++) {
      matrix[i] = [];
      for (var j = 0; j < n; j++) {
        if (i === j) { matrix[i][j] = { seconds: 0, minutes: 0, meters: 0 }; continue; }
        matrix[i][j] = await this.getDriveDuration(
          { lat: locations[i].lat, lng: locations[i].lng },
          { lat: locations[j].lat, lng: locations[j].lng }
        );
      }
    }
    return matrix;
  },

  // ---- 时间窗约束 ----
  // 每个地点有推荐时段（早/中/下/晚）和停留时长估算

  inferTimeWindow(name, originalTime) {
    // 从原始时间标签推断
    if (originalTime) {
      if (originalTime.includes('早') || originalTime.includes('晨') || originalTime.includes('上')) return 'morning';
      if (originalTime.includes('中')) return 'noon';
      if (originalTime.includes('下')) return 'afternoon';
      if (originalTime.includes('晚') || originalTime.includes('夜')) return 'evening';
    }
    // 从名称推断
    if (/餐|饭|面|楼|馆|小吃|火锅|烧烤|串|饼|粥/.test(name)) {
      if (/早|晨/.test(name)) return 'morning';
      if (/午|中/.test(name)) return 'noon';
      if (/晚|夜/.test(name)) return 'evening';
      return 'any_meal'; // 餐厅但不限定哪餐
    }
    if (/夜市|酒吧|灯光|夜景/.test(name)) return 'evening';
    if (/日出|晨/.test(name)) return 'morning';
    return 'any'; // 无特殊时间要求
  },

  // 估算停留时长（分钟）
  estimateStayDuration(name) {
    if (/餐|饭|面|楼|馆|小吃|火锅|烧烤|串|饼|粥|咖啡|茶/.test(name)) return 60;
    if (/博物馆|故宫|展览|美术馆/.test(name)) return 120;
    if (/公园|湖|山|景区|风景区|名胜/.test(name)) return 150;
    if (/寺|庙|塔|教堂/.test(name)) return 60;
    if (/街|路|巷|步道|古镇/.test(name)) return 90;
    if (/购物中心|商场|市场/.test(name)) return 60;
    return 90; // 默认1.5小时
  },

  // ---- 路线优化算法（支持住宿锚点 + 火车站起点/终点）----
  // homeBase: 住宿地坐标 {lat, lng}，每天从这出发、最后回这
  // options: { dayIndex, totalDays, trainStation: {lat, lng} }
  //   dayIndex: 当天是第几天（0-based）
  //   totalDays: 总共几天
  //   trainStation: 火车站坐标（第一天起点、最后一天终点）

  optimize(locations, timeMatrix, homeBase, homeBaseMatrix, options) {
    var n = locations.length;
    if (n <= 1) return { order: [0], schedule: this._buildSchedule([0], locations, timeMatrix) };

    var nodes = locations.map(function (loc, i) {
      return {
        index: i,
        name: loc.name,
        timeWindow: this.inferTimeWindow(loc.name, loc.time),
        stayMinutes: this.estimateStayDuration(loc.name)
      };
    }.bind(this));

    var slots = [
      { id: 'morning',   start: 0,   end: 270,  label: '上午' },
      { id: 'noon',      start: 270, end: 390,  label: '中午' },
      { id: 'afternoon', start: 390, end: 630,  label: '下午' },
      { id: 'evening',   start: 630, end: 840,  label: '晚上' },
      { id: 'any_meal',  start: 270, end: 840,  label: '用餐' },
      { id: 'any',       start: 0,   end: 840,  label: '灵活' }
    ];
    function getSlot(id) { return slots.find(function (s) { return s.id === id; }); }

    // 如果有住宿锚点，找到离住宿最近的点作为起点，离住宿最远的点安排在中间
    var route = [];
    var visited = {};

    if (homeBase && homeBaseMatrix) {
      // 从离住宿最近的点开始
      var bestStart = -1, bestDist = Infinity;
      for (var j = 0; j < n; j++) {
        if (homeBaseMatrix[j] && homeBaseMatrix[j].minutes < bestDist) {
          bestDist = homeBaseMatrix[j].minutes;
          bestStart = j;
        }
      }
      if (bestStart === -1) bestStart = 0;
      route.push(bestStart);
      visited[bestStart] = true;
    } else {
      route.push(0);
      visited[0] = true;
    }

    var currentTime = 0;

    for (var step = 1; step < n; step++) {
      var current = route[route.length - 1];
      var bestNext = -1, bestScore = Infinity;

      for (var j = 0; j < n; j++) {
        if (visited[j]) continue;
        var travel = timeMatrix[current][j].minutes;
        var arrival = currentTime + travel;
        var node = nodes[j];

        var slot = getSlot(node.timeWindow);
        var timeFit = 0;
        if (slot) {
          if (arrival + node.stayMinutes > slot.end + 60) timeFit += 500;
          else if (arrival > slot.end) timeFit += 300;
          else if (arrival < slot.start) timeFit += Math.min((slot.start - arrival) * 2, 200);
          var mid = (slot.start + slot.end) / 2;
          timeFit += Math.abs(arrival - mid) * 0.1;
        }

        // 住宿锚点约束：最后一个点尽量靠近住宿地
        var homePenalty = 0;
        if (homeBase && homeBaseMatrix && step === n - 1) {
          homePenalty = homeBaseMatrix[j].minutes * 2;
        }

        var score = travel + timeFit + homePenalty;
        if (score < bestScore) { bestScore = score; bestNext = j; }
      }

      if (bestNext === -1) break;
      route.push(bestNext);
      visited[bestNext] = true;
      currentTime += timeMatrix[current][bestNext].minutes + nodes[bestNext].stayMinutes;
    }

    // 2-opt
    var improved = true, iterations = 0;
    while (improved && iterations < 50) {
      improved = false; iterations++;
      for (var i = 1; i < route.length - 1; i++) {
        for (var k = i + 1; k < route.length; k++) {
          var newRoute = route.slice();
          var seg = newRoute.splice(i, k - i + 1).reverse();
          for (var s = 0; s < seg.length; s++) newRoute.splice(i + s, 0, seg[s]);
          var oldCost = this._routeCost(route, timeMatrix);
          var newCost = this._routeCost(newRoute, timeMatrix);
          if (newCost < oldCost * 0.9) { route = newRoute; improved = true; }
        }
      }
    }

    var schedule = this._buildSchedule(route, nodes, timeMatrix, homeBase, homeBaseMatrix, options);
    return { order: route, schedule: schedule };
  },

  _routeCost(route, matrix) {
    var cost = 0;
    for (var i = 0; i < route.length - 1; i++) cost += matrix[route[i]][route[i + 1]].minutes;
    return cost;
  },

  _buildSchedule(order, nodes, matrix, homeBase, homeBaseMatrix, options) {
    var schedule = [];
    var time = 0;
    var baseHour = 8;
    var dayIndex = (options && options.dayIndex !== undefined) ? options.dayIndex : -1;
    var totalDays = (options && options.totalDays) || 0;
    var trainStation = (options && options.trainStation) || null;

    // 第一天：从火车站出发（如果有的话）
    var isLastDay = (totalDays > 0 && dayIndex === totalDays - 1);

    // 如果有住宿地，加入从住宿出发的时间
    if (homeBase && homeBaseMatrix && order.length > 0) {
      var firstToHome = homeBaseMatrix[order[0]];
      if (firstToHome) {
        time += firstToHome.minutes;
      }
    }

    for (var i = 0; i < order.length; i++) {
      var idx = order[i];
      var node = nodes[idx];
      var prev = i > 0 ? order[i - 1] : null;
      var travelMin = prev !== null ? matrix[prev][idx].minutes : 0;
      time += travelMin;

      var hour = baseHour + Math.floor(time / 60);
      var min = time % 60;
      var timeStr = hour.toString().padStart(2, '0') + ':' + min.toString().padStart(2, '0');

      schedule.push({
        name: node.name, index: idx, arrivalTime: timeStr,
        travelMinutes: travelMin, stayMinutes: node.stayMinutes, totalTime: time
      });
      time += node.stayMinutes;
    }

    // 加上回住宿/火车站的时间
    if (homeBase && homeBaseMatrix && order.length > 0) {
      var lastToHome = homeBaseMatrix[order[order.length - 1]];
      if (lastToHome) {
        var retTime = time + lastToHome.minutes;
        var retHour = 8 + Math.floor(retTime / 60);
        var retMin = retTime % 60;
        // 最后一天：回火车站；其他天：回住宿地
        var retName = isLastDay ? '\uD83D\uDE82 \u524D\u5F80\u706B\u8F66\u7AD9\uFF08\u8FD4\u7A0B\uFF09' : '\uD83C\uDFE0 \u8FD4\u56DE\u4F4F\u5BBF\u5730';
        schedule.push({
          name: retName,
          index: -1,
          arrivalTime: retHour.toString().padStart(2, '0') + ':' + retMin.toString().padStart(2, '0'),
          travelMinutes: lastToHome.minutes, stayMinutes: 0, totalTime: retTime
        });
      }
    }

    return schedule;
  },

  // ---- Haversine 距离（米）----
  haversine(lat1, lng1, lat2, lng2) {
    var R = 6371000;
    var dLat = (lat2 - lat1) * Math.PI / 180;
    var dLng = (lng2 - lng1) * Math.PI / 180;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
};
