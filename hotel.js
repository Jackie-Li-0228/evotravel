// ============================================
// hotel.js - 酒店搜索 + 选择（高德 POI）
// ============================================

var HotelService = {
  AMAP_KEY: '94cd115ba02a97bb4f7ca90c3d7ccdc8',

  // 搜索酒店
  async searchHotels(city, filters) {
    var keywords = '酒店';
    if (filters && filters.keywords) keywords = filters.keywords;

    var url = 'https://restapi.amap.com/v3/place/text?' +
      'keywords=' + encodeURIComponent(keywords) +
      '&types=100000' +  // 酒店类型
      '&city=' + encodeURIComponent(city) +
      '&key=' + this.AMAP_KEY +
      '&offset=10' +
      '&extensions=all';

    // 如果有位置偏好，按中心点搜索
    if (filters && filters.center) {
      url += '&location=' + filters.center.lng + ',' + filters.center.lat;
    }

    try {
      var resp = await fetch(url);
      if (!resp.ok) return { error: '酒店搜索服务暂时不可用' };
      var data = await resp.json();
      if (!data.pois || data.pois.length === 0) {
        return { hotels: [] };
      }
      var hotels = data.pois.map(function (poi) {
        var loc = poi.location ? poi.location.split(',') : ['0', '0'];
        var photos = poi.photos && poi.photos.length > 0 ? poi.photos[0].url : '';
        return {
          id: poi.id,
          name: poi.name,
          address: poi.address || poi.pname + poi.cityname + poi.adname,
          lat: parseFloat(loc[1]),
          lng: parseFloat(loc[0]),
          tel: poi.tel || '',
          rating: poi.biz_ext && poi.biz_ext.rating ? poi.biz_ext.rating : '',
          price: poi.biz_ext && poi.biz_ext.cost ? poi.biz_ext.cost : '',
          photos: photos,
          type: poi.type || ''
        };
      });

      // 按评分/价格筛选
      if (filters) {
        if (filters.minPrice) {
          hotels = hotels.filter(function (h) {
            return !h.price || parseInt(h.price) >= filters.minPrice;
          });
        }
        if (filters.maxPrice) {
          hotels = hotels.filter(function (h) {
            return !h.price || parseInt(h.price) <= filters.maxPrice;
          });
        }
        if (filters.minRating) {
          hotels = hotels.filter(function (h) {
            return !h.rating || parseFloat(h.rating) >= filters.minRating;
          });
        }
      }

      return { hotels: hotels };
    } catch (e) {
      return { error: '酒店搜索失败: ' + e.message };
    }
  },

  // 在指定坐标附近搜索酒店
  async searchNearbyHotels(lng, lat, radius, city) {
    radius = radius || 3000;
    var url = 'https://restapi.amap.com/v3/place/around?' +
      'location=' + lng + ',' + lat +
      '&types=100000' +
      '&radius=' + radius +
      '&city=' + encodeURIComponent(city || '') +
      '&key=' + this.AMAP_KEY +
      '&offset=10' +
      '&extensions=all';

    try {
      var resp = await fetch(url);
      if (!resp.ok) return { error: '附近酒店搜索暂时不可用' };
      var data = await resp.json();
      if (!data.pois || data.pois.length === 0) {
        return { hotels: [] };
      }
      var hotels = data.pois.map(function (poi) {
        var loc = poi.location ? poi.location.split(',') : ['0', '0'];
        return {
          id: poi.id,
          name: poi.name,
          address: poi.address || '',
          lat: parseFloat(loc[1]),
          lng: parseFloat(loc[0]),
          tel: poi.tel || '',
          rating: poi.biz_ext && poi.biz_ext.rating ? poi.biz_ext.rating : '',
          price: poi.biz_ext && poi.biz_ext.cost ? poi.biz_ext.cost : '',
          distance: poi.distance ? parseInt(poi.distance) : 0,
          type: poi.type || ''
        };
      });
      return { hotels: hotels };
    } catch (e) {
      return { error: '附近酒店搜索失败: ' + e.message };
    }
  },

  // 格式化酒店列表为文本
  formatHotelsText(result) {
    if (result.error) return '🏨 ' + result.error;
    var hotels = result.hotels;
    if (!hotels || hotels.length === 0) return '🏨 未找到合适的酒店';
    var text = '🏨 推荐以下酒店：\n';
    hotels.forEach(function (h, i) {
      text += (i + 1) + '. **' + h.name + '**';
      if (h.rating) text += ' 评分:' + h.rating;
      if (h.price) text += ' 参考¥' + h.price + '/晚';
      if (h.distance) text += ' 距离' + h.distance + '米';
      text += '\n   地址:' + h.address;
      if (h.tel) text += ' 电话:' + h.tel;
      text += '\n';
    });
    return text;
  },

  // 生成酒店卡片 HTML
  formatHotelsHTML(result) {
    if (result.error) {
      return '<div class="hotel-card"><div class="hotel-card-header">🏨 酒店推荐</div>' +
        '<div class="hotel-card-body"><p>' + escapeHTML(result.error) + '</p></div></div>';
    }
    var hotels = result.hotels;
    if (!hotels || hotels.length === 0) {
      return '<div class="hotel-card"><div class="hotel-card-header">🏨 酒店推荐</div>' +
        '<div class="hotel-card-body"><p>未找到合适的酒店</p></div></div>';
    }
    var html = '<div class="hotel-card"><div class="hotel-card-header">🏨 酒店推荐</div>' +
      '<div class="hotel-card-body">';

    hotels.slice(0, 5).forEach(function (h, i) {
      html += '<div class="hotel-item" data-hotel-index="' + i + '">' +
        '<div class="hotel-item-name">' + escapeHTML(h.name) + '</div>' +
        '<div class="hotel-item-meta">';
      if (h.rating) html += '<span class="hotel-rating">⭐ ' + escapeHTML(h.rating) + '</span>';
      if (h.price) html += '<span class="hotel-price">¥' + escapeHTML(h.price) + '/晚</span>';
      if (h.distance) html += '<span class="hotel-distance">' + h.distance + 'm</span>';
      html += '</div>' +
        '<div class="hotel-item-addr">' + escapeHTML(h.address) + '</div>';
      if (h.tel) html += '<div class="hotel-item-tel">📞 ' + escapeHTML(h.tel) + '</div>';
      html += '<button class="btn-select-hotel" data-lat="' + h.lat + '" data-lng="' + h.lng + '" data-name="' + escapeHTML(h.name) + '">选为住宿地</button>';
      html += '</div>';
    });

    html += '</div></div>';
    return html;
  }
};

// escapeHTML 由 train.js 全局定义，此处无需重复
