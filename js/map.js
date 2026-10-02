// 지도 렌더링: data/regions.json의 좌표 데이터로 SVG를 그린다.
// 땅 모양은 seed 기반으로 매번 같은 결과가 나오도록 생성한다.

const NS = 'http://www.w3.org/2000/svg';
const rad = (d) => (d * Math.PI) / 180;

function el(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

// 시드 고정 난수
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 각도 → 반지름 배율 (주기 함수라서 항상 닫힌 윤곽이 된다)
function profile(seed, jag) {
  const r = mulberry32(seed);
  const hs = [];
  for (let k = 2; k <= 11; k++) hs.push({ k, a: (r() * 2 - 1) * jag * (1.8 / k), p: r() * Math.PI * 2 });
  return (th) => {
    let v = 1;
    for (const h of hs) v += h.a * Math.sin(h.k * th + h.p);
    return v;
  };
}

export function blobPoints(m, scale = 1, steps = 180) {
  const f = profile(m.seed, m.jag);
  const pts = [];
  for (let i = 0; i < steps; i++) {
    const th = (i / steps) * Math.PI * 2;
    const rr = m.r * f(th) * scale;
    pts.push([m.cx + rr * Math.cos(th), m.cy + rr * Math.sin(th)]);
  }
  return pts;
}

function sectorPoints(parent, from, to) {
  const f = profile(parent.seed, parent.jag);
  const pts = [[parent.cx, parent.cy]];
  for (let d = from; d <= to + 0.001; d += 1.5) {
    const th = rad(d);
    const rr = parent.r * f(th);
    pts.push([parent.cx + rr * Math.cos(th), parent.cy + rr * Math.sin(th)]);
  }
  return pts;
}

export const toPath = (pts) =>
  pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('') + 'Z';

const TYPE_LABEL = {
  knight: '기사국가', magic: '마법국가', coexist: '공존국가', mercenary: '섬나라', none: '무주지',
};

function typeClass(r) {
  if (r.kind === 'volcano') return 't-volcano';
  if (r.kind === 'island_unexplored') return r.subtype === 'young' ? 't-young' : 't-harsh';
  return 't-' + (r.nationType || 'coexist');
}

function defs(svg) {
  const d = el('defs', {}, svg);

  const grad = el('radialGradient', { id: 'seaGrad', gradientUnits: 'userSpaceOnUse', cx: '600', cy: '600', r: '1100' }, d);
  el('stop', { offset: '0%', 'stop-color': 'var(--sea)' }, grad);
  el('stop', { offset: '100%', 'stop-color': 'var(--sea-deep)' }, grad);

  const grain = el('filter', { id: 'grain', filterUnits: 'userSpaceOnUse', x: '-3000', y: '-3000', width: '7200', height: '7200' }, d);
  el('feTurbulence', { type: 'fractalNoise', baseFrequency: '0.9', numOctaves: '3', seed: '4' }, grain);
  el('feColorMatrix', { values: '0 0 0 0 0.18  0 0 0 0 0.15  0 0 0 0 0.11  0 0 0 0.10 0' }, grain);

  const hatch = el('pattern', { id: 'hatch', width: '7', height: '7', patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, d);
  el('rect', { width: '7', height: '7', fill: 'var(--land)' }, hatch);
  el('line', { x1: '0', y1: '0', x2: '0', y2: '7', stroke: 'var(--volcano)', 'stroke-width': '2', 'stroke-opacity': '0.55' }, hatch);
}

function makeClickable(node, r, onSelect) {
  node.classList.add('region');
  node.dataset.id = r.id;
  node.setAttribute('tabindex', '0');
  node.setAttribute('role', 'button');
  node.setAttribute('aria-label', r.name);
  el('title', {}, node).textContent = r.name;
  node.addEventListener('click', () => onSelect(r.id));
  node.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(r.id); }
  });
}

function drawRidges(g, c, cfg) {
  const f = profile(c.seed, c.jag);
  for (const a of cfg.angles) {
    const th = rad(a);
    const r0 = c.r * cfg.from;
    const r1 = c.r * f(th) * cfg.to;
    const ux = Math.cos(th), uy = Math.sin(th);
    let d = '';
    let i = 0;
    for (let s = r0; s <= r1; s += 15, i++) {
      const jitter = Math.sin(i * 1.7 + a) * 3;
      const x = c.cx + ux * s - uy * jitter;
      const y = c.cy + uy * s + ux * jitter;
      const h = i % 3 === 0 ? 8 : 6;
      d += `M${(x - 7).toFixed(1)} ${(y + 4).toFixed(1)}L${x.toFixed(1)} ${(y - h).toFixed(1)}L${(x + 7).toFixed(1)} ${(y + 4).toFixed(1)}`;
    }
    el('path', { d, class: 'ridge' }, g);
  }
}

function drawRivers(g, c, cfg) {
  const f = profile(c.seed, c.jag);
  cfg.angles.forEach((a, idx) => {
    const th = rad(a);
    const r0 = c.r * cfg.from;
    const r1 = c.r * f(th) * cfg.to;
    const ux = Math.cos(th), uy = Math.sin(th);
    const pts = [];
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const s = r0 + (r1 - r0) * t;
      const off = Math.sin(t * Math.PI * 3 + idx) * 9 * (1 - t * 0.4);
      pts.push([c.cx + ux * s - uy * off, c.cy + uy * s + ux * off]);
    }
    const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('');
    el('path', { d, class: 'river' }, g);
  });
}

function drawLakes(g, c) {
  const rand = mulberry32(c.seed * 31);
  for (const mid of [270, 0, 90, 180]) {
    for (let k = 0; k < 2; k++) {
      const a = rad(mid + (rand() < 0.5 ? -1 : 1) * (18 + rand() * 12));
      const s = c.r * (0.42 + rand() * 0.3);
      el('ellipse', {
        cx: (c.cx + Math.cos(a) * s).toFixed(1),
        cy: (c.cy + Math.sin(a) * s).toFixed(1),
        rx: (4 + rand() * 5).toFixed(1),
        ry: (3 + rand() * 3).toFixed(1),
        class: 'lake',
      }, g);
    }
  }
}

function drawVolcanoCone(g, v) {
  const { cx, cy } = v;
  el('path', { d: `M${cx - 18} ${cy + 12}L${cx - 5} ${cy - 12}L${cx + 5} ${cy - 12}L${cx + 18} ${cy + 12}Z`, class: 'cone' }, g);
  el('path', {
    d: `M${cx - 2} ${cy - 15}c-6 -6 4 -10 -2 -17M${cx + 4} ${cy - 15}c6 -6 -3 -10 3 -18`,
    fill: 'none', stroke: 'var(--ink)', 'stroke-width': '1.2', 'stroke-linecap': 'round',
  }, g);
}

function drawCompass(svg) {
  const g = el('g', { class: 'compass', transform: 'translate(1110 104)' }, svg);
  el('circle', { r: '30', 'stroke-width': '1.2' }, g);
  el('line', { x1: '-40', y1: '0', x2: '40', y2: '0', 'stroke-width': '0.8' }, g);
  el('line', { x1: '0', y1: '-40', x2: '0', y2: '40', 'stroke-width': '0.8' }, g);
  el('polygon', { points: '0,-34 6,0 0,8 -6,0' }, g);
  el('text', { x: '0', y: '-46' }, g).textContent = '북';
}

function label(g, x, y, main, sub, id) {
  el('text', { x, y, class: 'label label-main' }, g).textContent = main;
  const t = el('text', { x, y: y + 20, class: 'label label-sub' }, g);
  t.textContent = sub || '';
  if (id) t.setAttribute('data-label-sub', id);
}

export function renderMap(svg, data, onSelect, labels = {}) {
  svg.innerHTML = '';
  defs(svg);

  const [vx, vy, vw, vh] = data.meta.viewBox;
  // 화면 비율이 달라도 가장자리에 띠가 생기지 않도록 바다와 질감을 넉넉히 깐다
  const pad = 3000;
  el('rect', { x: vx - pad, y: vy - pad, width: vw + pad * 2, height: vh + pad * 2, fill: 'url(#seaGrad)' }, svg);

  const gWater = el('g', {}, svg);
  const gLand = el('g', {}, svg);
  const gDecor = el('g', { class: 'decor' }, svg);
  const gLabel = el('g', {}, svg);

  const byId = Object.fromEntries(data.regions.map((r) => [r.id, r]));
  const central = byId.continent_central;

  // 물결선(해안을 따라 그리는 고지도식 수선)
  for (const r of data.regions) {
    if (r.map.shape !== 'blob') continue;
    const rings = r.subtype === 'young' ? [1.25] : [1.1, 1.22, 1.36];
    rings.forEach((s, i) => {
      el('path', {
        d: toPath(blobPoints(r.map, s)),
        class: 'waterline',
        'stroke-opacity': (0.6 - i * 0.17).toFixed(2),
        'stroke-dasharray': r.subtype === 'young' ? '3 4' : 'none',
      }, gWater);
    });
  }

  // 중앙 대륙 바탕
  el('path', { d: toPath(blobPoints(central.map)), class: 'land-base' }, gLand);

  // 지역 (폴리곤은 마물 배치 등에 쓰도록 모아 둔다)
  const polys = {};
  const shapes = {};
  for (const r of data.regions) {
    if (r.id === 'continent_central') continue;
    let node;
    if (r.map.shape === 'sector') {
      polys[r.id] = sectorPoints(byId[r.map.parent].map, r.map.from, r.map.to);
      shapes[r.id] = polys[r.id];
      node = el('path', { d: toPath(polys[r.id]), class: typeClass(r) + ' sector', 'fill-opacity': '0.8' }, gLand);
    } else if (r.map.shape === 'circle') {
      const { cx, cy, r: cr } = r.map;
      polys[r.id] = Array.from({ length: 48 }, (_, i) => {
        const th = (i / 48) * Math.PI * 2;
        return [cx + Math.cos(th) * (cr - 6), cy + Math.sin(th) * (cr - 6)];
      });
      continue; // 화산은 장식 위에 그린다
    } else {
      polys[r.id] = blobPoints(r.map, 0.9);
      shapes[r.id] = blobPoints(r.map);
      node = el('path', { d: toPath(blobPoints(r.map)), class: typeClass(r) }, gLand);
    }
    makeClickable(node, r, onSelect);
  }

  // 중앙 대륙 윤곽선을 지역 위에 다시 그어 경계를 선명하게
  el('path', { d: toPath(blobPoints(central.map)), fill: 'none', stroke: 'var(--ink)', 'stroke-width': '1.8', 'pointer-events': 'none' }, gLand);

  drawRivers(gDecor, central.map, data.features.rivers);
  drawLakes(gDecor, central.map);
  drawRidges(gDecor, central.map, data.features.ridges);

  // 화산 무주지
  const volcano = byId.region_volcano;
  const vNode = el('circle', { cx: volcano.map.cx, cy: volcano.map.cy, r: volcano.map.r, class: typeClass(volcano) }, svg);
  makeClickable(vNode, volcano, onSelect);
  const gCone = el('g', { class: 'decor' }, svg);
  drawVolcanoCone(gCone, volcano.map);

  // 라벨 (labels로 국가 이름 등을 넘기면 그것을 쓴다). 지역별 기준점도 모아 둔다.
  const midAngle = { region_central_north: 270, region_central_east: 0, region_central_south: 90, region_central_west: 180 };
  const shortName = { region_central_north: '북부', region_central_east: '동부', region_central_south: '남부', region_central_west: '서부' };
  const anchors = {};
  for (const r of data.regions) {
    const custom = labels[r.id];
    if (midAngle[r.id] !== undefined) {
      const a = rad(midAngle[r.id]);
      const s = central.map.r * 0.62;
      const x = central.map.cx + Math.cos(a) * s, y = central.map.cy + Math.sin(a) * s;
      anchors[r.id] = [x, y - 6];
      label(gLabel, x, y, custom?.main ?? shortName[r.id], custom?.sub ?? TYPE_LABEL[r.nationType], r.id);
    } else if (r.kind === 'continent' && r.id !== 'continent_central') {
      anchors[r.id] = [r.map.cx, r.map.cy];
      label(gLabel, r.map.cx, r.map.cy + 6, custom?.main ?? r.name.replace('작은 ', ''), custom?.sub, r.id);
    } else if (r.kind === 'island_nation') {
      anchors[r.id] = [r.map.cx, r.map.cy];
      el('text', { x: r.map.cx, y: r.map.cy + r.map.r + 20, class: 'label label-small' }, gLabel).textContent = custom?.main ?? r.name;
    } else if (r.map.shape === 'blob' || r.map.shape === 'circle') {
      anchors[r.id] = [r.map.cx, r.map.cy];
    }
  }
  el('text', { x: volcano.map.cx, y: volcano.map.cy + volcano.map.r + 18, class: 'label label-sub' }, svg).textContent = '화산 무주지';

  drawCompass(svg);

  // 고지도 질감
  el('rect', { x: vx - pad, y: vy - pad, width: vw + pad * 2, height: vh + pad * 2, filter: 'url(#grain)', 'pointer-events': 'none' }, svg);

  return {
    polys,
    shapes,
    anchors,
    setSelected(id) {
      svg.querySelectorAll('.is-selected').forEach((n) => n.classList.remove('is-selected'));
      if (id) svg.querySelectorAll(`[data-id="${id}"]`).forEach((n) => n.classList.add('is-selected'));
    },
  };
}

export { TYPE_LABEL };
