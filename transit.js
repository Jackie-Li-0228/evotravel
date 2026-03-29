// ============================================
// transit.js - 详细通勤方式（高德公交换乘 API）
// ============================================

var TransitService = {
  AMAP_KEY: '94cd115ba02a97bb4f7ca90c3d7ccdc8',
  cache: {},

  // 公交换乘查询
  // strategy: 0=最快, 1=最经济, 2=最少换乘, 3=最少步行
  async queryTransit(fromLng, fromLat, toLng, toLat, city, strategy) {
    strategy = strategy || 0;
    var ck = fromLng + ',' + fromLat + '->' + toLng + ',' + toLat + '_' + strategy;
    if (this.cache[ck]) return this.cache[ck];

    var url = 'https://restapi.amap.com/v3/direction/transit/integrated?' +
      'origin=' + fromLng + ',' + fromLat +
      '&destination=' + toLng + ',' + toLat +
      '&city=' + encodeURIComponent(city) +
      '&strategy=' + strategy +
      '&nightflag=0' +
      '&key=' + this.AMAP_KEY +
      '&offset=3';

    try {
      var resp = await fetch(url);
      if (!resp.ok) return { error: '公交查询服务暂时不可用' };
      var data = await resp.json();
      if (!data.route || !data.route.transits || data.route.transits.length === 0) {
        return { error: '未找到公交路线', distance: data.route ? data.route.distance : 0 };
      }

      var distance = parseInt(data.route.distance) || 0;
      var plans = data.route.transits.map(function (transit) {
        var duration = parseInt(transit.duration) || 0;
        var walkDist = parseInt(transit.walk_distance) || 0;
        var cost = transit.cost || '';
        var segments = [];

        // 解析每个路段
        if (transit.segments) {
          transit.segments.forEach(function (seg) {
            var segment = {};

            // 步行段
            if (seg.walking && seg.walking.steps && seg.walking.steps.length > 0) {
              var walkSteps = seg.walking.steps;
              var walkDist2 = 0;
              walkSteps.forEach(function (ws) { walkDist2 += parseInt(ws.distance) || 0; });
              segment.walking = {
                distance: walkDist2,
                duration: Math.round(walkDist2 / 80), // 步行速度约80m/min
                instruction: walkSteps.map(function (ws) { return ws.instruction; }).join(' → ')
              };
            }

            // 公交/地铁段
            if (seg.bus && seg.bus.buslines && seg.bus.buslines.length > 0) {
              var busline = seg.bus.buslines[0];
              var departureStop = busline.departure_stop || {};
              var arrivalStop = busline.arrival_stop || {};
              var viaNum = busline.via_num || 0;

              segment.transit = {
                name: busline.name || '',
                type: busline.type || '',  // 地铁/公交
                departureStop: departureStop.name || '',
                arrivalStop: arrivalStop.name || '',
                viaStops: viaNum,
                duration: Math.round(parseInt(busline.duration) / 60) || 0
              };
            }

            segments.push(segment);
          });
        }

        return {
          duration: duration,
          durationMin: Math.round(duration / 60),
          walkDistance: walkDist,
          cost: cost,
          segments: segments
        };
      });

      var result = { plans: plans, distance: distance };
      this.cache[ck] = result;
      return result;
    } catch (e) {
      return { error: '公交查询失败: ' + e.message };
    }
  },

  // 打车估算（用高德驾车 API）
  async estimateTaxi(fromLng, fromLat, toLng, toLat) {
    try {
      var url = 'https://restapi.amap.com/v3/direction/driving?' +
        'origin=' + fromLng + ',' + fromLat +
        '&destination=' + toLng + ',' + toLat +
        '&key=' + this.AMAP_KEY +
        '&strategy=0';
      var resp = await fetch(url);
      if (!resp.ok) return null;
      var data = await resp.json();
      if (!data.route || !data.route.paths || data.route.paths.length === 0) return null;
      var path = data.route.paths[0];
      var dist = parseInt(path.distance) || 0;
      var dur = parseInt(path.duration) || 0;
      // 简单打车费估算：起步13元(3km) + 2.3元/km + 低速费
      var fare = 13;
      if (dist > 3000) {
        fare += Math.round((dist - 3000) / 1000 * 2.3);
      }
      if (dur > 600) { // 超过10分钟加等时费
        fare += Math.round((dur - 600) / 60 * 0.5);
      }
      return {
        distance: dist,
        distanceKm: (dist / 1000).toFixed(1),
        duration: dur,
        durationMin: Math.round(dur / 60),
        estimatedFare: fare
      };
    } catch (e) {
      return null;
    }
  },

  // 综合通勤方案（公交 + 打车）
  async getFullTransit(fromLng, fromLat, toLng, toLat, city) {
    var results = {};
    // 查多种公交策略
    var queries = [
      this.queryTransit(fromLng, fromLat, toLng, toLat, city, 0), // 最快
      this.queryTransit(fromLng, fromLat, toLng, toLat, city, 2)  // 最少换乘
    ];
    var responses = await Promise.all(queries);
    results.fastest = responses[0];
    results.leastTransfer = responses[1];

    // 打车估算
    results.taxi = await this.estimateTaxi(fromLng, fromLat, toLng, toLat);

    return results;
  },

  // 格式化通勤信息为文本
  formatTransitText(fromName, toName, transitResult) {
    var text = '🚇 ' + fromName + ' → ' + toName + '：\n';
    if (transitResult.error) {
      text += '  公交：' + transitResult.error + '\n';
      if (transitResult.distance) {
        text += '  距离约 ' + (parseInt(transitResult.distance) / 1000).toFixed(1) + ' km\n';
      }
      return text;
    }
    var plans = transitResult.plans;
    if (plans && plans.length > 0) {
      var best = plans[0];
      text += '  公交（约' + best.durationMin + '分钟';
      if (best.cost) text += '，¥' + best.cost;
      text += '）：';
      best.segments.forEach(function (seg) {
        if (seg.walking) {
          text += '步行' + seg.walking.distance + 'm → ';
        }
        if (seg.transit) {
          text += seg.transit.name + '（' + seg.transit.departureStop + '上车→' + seg.transit.arrivalStop + '下车）→ ';
        }
      });
      text = text.replace(/ → $/, '') + '\n';
    }
    return text;
  },

  // 格式化完整通勤方案为文本
  formatFullTransitText(fromName, toName, fullResult) {
    var text = '🚇 ' + fromName + ' → ' + toName + ' 通勤方案：\n';

    // 最快公交
    if (fullResult.fastest && !fullResult.fastest.error && fullResult.fastest.plans && fullResult.fastest.plans.length > 0) {
      var fast = fullResult.fastest.plans[0];
      text += '1️⃣ 最快（约' + fast.durationMin + '分钟）：';
      text += this.describeSegments(fast.segments) + '\n';
    }

    // 最少换乘
    if (fullResult.leastTransfer && !fullResult.leastTransfer.error && fullResult.leastTransfer.plans && fullResult.leastTransfer.plans.length > 0) {
      var lt = fullResult.leastTransfer.plans[0];
      text += '2️⃣ 少换乘（约' + lt.durationMin + '分钟）：';
      text += this.describeSegments(lt.segments) + '\n';
    }

    // 打车
    if (fullResult.taxi) {
      text += '🚕 打车（约' + fullResult.taxi.durationMin + '分钟，约¥' + fullResult.taxi.estimatedFare + '，' + fullResult.taxi.distanceKm + 'km）\n';
    }

    return text;
  },

  // 描述换乘步骤
  describeSegments(segments) {
    var parts = [];
    segments.forEach(function (seg) {
      if (seg.walking && seg.walking.distance > 0) {
        parts.push('步行' + seg.walking.distance + 'm');
      }
      if (seg.transit) {
        var s = seg.transit.name + '（' + seg.transit.departureStop + '→' + seg.transit.arrivalStop;
        if (seg.transit.viaStops > 0) s += '，' + seg.transit.viaStops + '站';
        s += '）';
        parts.push(s);
      }
    });
    return parts.join(' → ');
  },

  // 生成通勤卡片 HTML
  formatTransitHTML(fromName, toName, fullResult) {
    var html = '<div class="transit-card">' +
      '<div class="transit-card-header">🚇 ' + escapeHTML(fromName) + ' → ' + escapeHTML(toName) + '</div>' +
      '<div class="transit-card-body">';

    // 公交方案
    if (fullResult.fastest && !fullResult.fastest.error && fullResult.fastest.plans && fullResult.fastest.plans.length > 0) {
      var plan = fullResult.fastest.plans[0];
      html += '<div class="transit-plan"><div class="transit-plan-title">🚇 公交推荐（约' + plan.durationMin + '分钟）</div>';
      html += '<div class="transit-segments">';
      plan.segments.forEach(function (seg) {
        if (seg.walking && seg.walking.distance > 0) {
          html += '<div class="transit-segment walk">🚶 步行 ' + seg.walking.distance + 'm（约' + seg.walking.duration + '分钟）</div>';
        }
        if (seg.transit) {
          html += '<div class="transit-segment bus">' +
            '<span class="transit-line">' + escapeHTML(seg.transit.name) + '</span>' +
            ' ' + escapeHTML(seg.transit.departureStop) + ' → ' + escapeHTML(seg.transit.arrivalStop) +
            '（' + seg.transit.viaStops + '站，约' + seg.transit.duration + '分钟）</div>';
        }
      });
      html += '</div></div>';
    }

    // 打车
    if (fullResult.taxi) {
      html += '<div class="transit-plan"><div class="transit-plan-title">🚕 打车（约' + fullResult.taxi.durationMin + '分钟）</div>' +
        '<div class="transit-taxi">约 ¥' + fullResult.taxi.estimatedFare + ' · ' + fullResult.taxi.distanceKm + 'km</div></div>';
    }

    html += '</div></div>';
    return html;
  }
};

// escapeHTML 由 train.js 全局定义，此处无需重复
