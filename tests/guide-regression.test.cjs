const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const guidePath = path.resolve(__dirname, '..', 'qingdao-guide.html');

function loadGuide(storedValues = {}) {
  const html = fs.readFileSync(guidePath, 'utf8');
  const scriptMatch = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map(match => match[1])
    .find(script => script.includes('const dayData ='));
  assert.ok(scriptMatch, '应找到包含 dayData 的内嵌脚本');

  const elements = new Map();
  const context = {
    console,
    encodeURIComponent,
    setTimeout: () => 0,
    clearTimeout: () => {},
    location: { protocol: 'file:' },
    localStorage: {
      getItem: key => storedValues[key] ?? null,
      setItem: () => {},
    },
    document: {
      addEventListener: () => {},
      querySelectorAll: () => [],
      createElement: () => ({}),
      head: { appendChild: () => {} },
      body: { appendChild: () => {} },
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, { innerHTML: '', style: {} });
        return elements.get(id);
      },
    },
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(
    `${scriptMatch}\n;globalThis.__guide = { dayData, buildMapPois, renderItinerary, getHotelForCard, LS_HOTEL, HOTEL_SEARCH_KEY };`,
    context,
  );
  return { html, context, elements, guide: context.__guide };
}

test('每日行程卡片索引与地图 POI 索引逐项一致', () => {
  const { guide, elements } = loadGuide();

  guide.dayData.forEach((_, dayIndex) => {
    guide.renderItinerary(dayIndex);
    const rendered = elements.get('itinerary-content').innerHTML;
    const clickIndexes = [...rendered.matchAll(/onclick="focusPoi\(\d+,(\d+)\)"/g)]
      .map(match => Number(match[1]));
    const expected = guide.buildMapPois(dayIndex)
      .map((poi, index) => ({ poi, index }))
      .filter(({ poi }) => poi.kind === 'poi')
      .map(({ index }) => index);
    assert.equal(
      JSON.stringify(clickIndexes),
      JSON.stringify(expected),
      `DAY ${dayIndex + 1} 的卡片索引必须连续且对应地图标记`,
    );
  });
});

test('腾讯地图脚本显式加载 service 搜索库', () => {
  const { html } = loadGuide();
  assert.match(html, /gljs\?v=1\.exp&libraries=service&key=/);
  assert.doesNotMatch(html, /mapStyleId:\s*["']style8["']/);
  assert.doesNotMatch(html, /location\.protocol\s*===\s*['"]file:['"]\)\s*\{\s*renderFallbackMap/);
  assert.doesNotMatch(html, /const paths = allPois\.map/);
});

test('唐岛湾使用国家湿地公园正式地点与腾讯坐标', () => {
  const { guide } = loadGuide();
  const poi = guide.dayData[0].pois.find(item => item.name === '青岛唐岛湾国家湿地公园');
  assert.ok(poi, 'DAY 1 应使用正式公园名称');
  assert.equal(poi.lat, 35.922932);
  assert.equal(poi.lng, 120.195555);
  assert.equal(guide.dayData[0].pois.some(item => item.name === '唐岛湾公园'), false);
});

test('黄岛三晚统一定位到青岛金沙滩希尔顿酒店', () => {
  const { guide } = loadGuide();
  const hotelDefs = [
    guide.dayData[0].hotelStart,
    guide.dayData[0].hotelEnd,
    guide.dayData[1].hotelStart,
    guide.dayData[1].hotelEnd,
    guide.dayData[2].hotelStart,
  ];
  for (const hotel of hotelDefs) {
    assert.equal(hotel.defaultName, '青岛金沙滩希尔顿酒店');
    assert.equal(hotel.lat, 35.957364);
    assert.equal(hotel.lng, 120.236896);
    assert.equal(hotel.poiId, '1595649670454075004');
    assert.equal(hotel.coordSystem, 'GCJ-02');
  }
});

test('老城两晚统一定位到青岛栈桥海景美居酒店', () => {
  const { guide } = loadGuide();
  const hotelDefs = [
    guide.dayData[2].hotelEnd,
    guide.dayData[3].hotelStart,
    guide.dayData[3].hotelEnd,
    guide.dayData[4].hotelStart,
  ];
  for (const hotel of hotelDefs) {
    assert.equal(hotel.defaultName, '青岛栈桥海景美居酒店');
    assert.equal(hotel.lat, 36.053922);
    assert.equal(hotel.lng, 120.30609);
    assert.equal(hotel.poiId, '2535493160864338784');
    assert.equal(hotel.coordSystem, 'GCJ-02');
  }
});

test('旧版酒店缓存不会覆盖已修正的默认坐标', () => {
  const oldPrefix = 'guide_hotel_';
  const stale = JSON.stringify({
    name: '旧酒店位置',
    lat: 35.952,
    lng: 120.26,
    address: '旧坐标',
  });
  const { guide } = loadGuide({ [`${oldPrefix}d1_start`]: stale });
  assert.notEqual(guide.LS_HOTEL, oldPrefix);
  const hotel = guide.getHotelForCard(guide.dayData[0].hotelStart);
  assert.equal(hotel.name, '青岛金沙滩希尔顿酒店');
  assert.equal(hotel.lat, 35.957364);
  assert.equal(hotel.lng, 120.236896);
});

test('每个地图点都保留腾讯 POI 核验来源，不再把泛化活动名称标成地点', () => {
  const { guide } = loadGuide();
  const bannedMappedNames = new Set([
    '金沙滩海鲜排档',
    '珠山农家菜',
    '唐岛湾南岸日落',
    '红树林度假世界晚餐',
    '地铁1号线 黄岛→青岛站',
    '栈桥·回澜阁',
    '劈柴院小吃',
    '天主教堂（圣弥厄尔）',
    '大学路网红墙',
    '团岛农贸市场海鲜加工',
    '八大关',
    '花石楼·公主楼',
    '大学路咖啡午餐',
    '信号山公园',
    '台东步行街夜市',
    '鲁迅公园·小青岛',
    '栈桥海鲜午餐',
    '青岛 → 胶东机场',
  ]);

  for (const day of guide.dayData) {
    for (const poi of day.pois.filter(item => !item.meta)) {
      assert.equal(bannedMappedNames.has(poi.name), false, `${poi.name} 不是可核验的正式地图点`);
      assert.match(poi.poiId, /^\d+$/, `${poi.name} 应保存腾讯 POI ID`);
      assert.ok(poi.address, `${poi.name} 应保存腾讯返回地址`);
      assert.equal(poi.coordSystem, 'GCJ-02');
      assert.equal(poi.source, '腾讯位置服务 WebService API');
      assert.equal(poi.verifiedAt, '2026-08-21');
      assert.equal(Number.isFinite(poi.lat), true);
      assert.equal(Number.isFinite(poi.lng), true);
    }
  }
});

test('地图路线使用腾讯规划的分段轨迹并提供长距离交通说明', () => {
  const { guide } = loadGuide();

  for (const [dayIndex, day] of guide.dayData.entries()) {
    assert.ok(Array.isArray(day.routePlan) && day.routePlan.length > 0, `DAY ${dayIndex + 1} 应有路线段`);
    for (const leg of day.routePlan) {
      assert.ok(Array.isArray(leg.path) && leg.path.length > 2, `${leg.fromName} → ${leg.toName} 应使用真实路线轨迹`);
      assert.ok(leg.distanceM > 0);
      assert.ok(leg.durationMin > 0);
      if (leg.distanceM > 1000) {
        assert.ok(leg.transportText, `${leg.fromName} → ${leg.toName} 超过 1km，应说明交通方式`);
      }
      if (leg.distanceM > 3000 && leg.mode === 'driving') {
        assert.ok(Number.isFinite(leg.taxiFareYuan), `${leg.fromName} → ${leg.toName} 超过 3km 且未采用公交，应给出打车价`);
      }
    }
  }
});
