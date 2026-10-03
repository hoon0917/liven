// 지도 렌더링: data/regions.json과 data/places.json으로 고지도풍 SVG를 그린다.
// 땅 모양과 지형 기호, 마을 위치는 seed 기반이라 열 때마다 같은 모습이 된다.

const NS = 'http://www.w3.org/2000/svg';
const rad = (d) => (d * Math.PI) / 180;

function el(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 큰 굴곡(2~11차)에 잔물결(12~60차)을 더해 실제 해안처럼 들쭉날쭉하게 만든다
function profile(seed, jag) {
  const r = mulberry32(seed);
  const hs = [];
  for (let k = 2; k <= 11; k++) hs.push({ k, a: (r() * 2 - 1) * jag * (1.8 / k), p: r() * Math.PI * 2 });
  for (let k = 12; k <= 60; k += 1 + Math.floor(r() * 3)) hs.push({ k, a: (r() * 2 - 1) * (0.05 + jag * 0.12) / Math.pow(k, 0.75), p: r() * Math.PI * 2 });
  return (th) => {
    let v = 1;
    for (const h of hs) v += h.a * Math.sin(h.k * th + h.p);
    return v;
  };
}

export function blobPoints(m, scale = 1, steps = 360) {
  const f = profile(m.seed, m.jag);
  const pts = [];
  for (let i = 0; i < steps; i++) {
    const th = (i / steps) * Math.PI * 2;
    const rr = m.r * f(th) * scale;
    pts.push([m.cx + rr * Math.cos(th), m.cy + rr * Math.sin(th)]);
  }
  return pts;
}

function sectorPoints(parent, from, to, scale = 1) {
  const f = profile(parent.seed, parent.jag);
  const pts = [[parent.cx, parent.cy]];
  for (let d = from; d <= to + 0.001; d += 1) {
    const th = rad(d);
    const rr = parent.r * f(th) * scale;
    pts.push([parent.cx + rr * Math.cos(th), parent.cy + rr * Math.sin(th)]);
  }
  return pts;
}

export const toPath = (pts) =>
  pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('') + 'Z';

function inPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function bbox(pts) {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}
function distToSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

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
  // 땅의 얼룩 (손으로 칠한 듯한 질감)
  const blot = el('filter', { id: 'landTex', x: '-10%', y: '-10%', width: '120%', height: '120%' }, d);
  el('feTurbulence', { type: 'fractalNoise', baseFrequency: '0.035', numOctaves: '4', seed: '9', result: 'n' }, blot);
  el('feColorMatrix', { in: 'n', values: '0 0 0 0 0.35  0 0 0 0 0.28  0 0 0 0 0.18  0 0 0 0.22 0', result: 'c' }, blot);
  el('feComposite', { in: 'c', in2: 'SourceGraphic', operator: 'in', result: 't' }, blot);
  const m = el('feMerge', {}, blot);
  el('feMergeNode', { in: 'SourceGraphic' }, m); el('feMergeNode', { in: 't' }, m);
  const hatch = el('pattern', { id: 'hatch', width: '7', height: '7', patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, d);
  el('rect', { width: '7', height: '7', fill: 'var(--land)' }, hatch);
  el('line', { x1: '0', y1: '0', x2: '0', y2: '7', stroke: 'var(--volcano)', 'stroke-width': '2', 'stroke-opacity': '0.55' }, hatch);
  return d;
}

function makeClickable(node, r, onSelect) {
  node.classList.add('region');
  node.dataset.id = r.id;
  node.setAttribute('tabindex', '0');
  node.setAttribute('role', 'button');
  node.setAttribute('aria-label', r.name);
  el('title', {}, node).textContent = r.name;
  node.addEventListener('click', (e) => { if (!node.ownerSVGElement?.__dragged) onSelect(r.id); e.stopPropagation(); });
  node.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(r.id); }
  });
}

// ---------- 지형 기호 ----------
const G = {
  mountain(x, y, s, r) {
    const h = s * (0.9 + r() * 0.6), w = s * (0.8 + r() * 0.4);
    return { line: `M${x - w} ${y}L${x} ${y - h}L${x + w} ${y}`, shade: `M${x} ${y - h}L${x + w} ${y}L${x + w * 0.2} ${y}Z`, snow: h > s * 1.25 ? `M${x - w * 0.28} ${y - h * 0.72}L${x} ${y - h}L${x + w * 0.28} ${y - h * 0.72}L${x + w * 0.1} ${y - h * 0.62}L${x - w * 0.08} ${y - h * 0.7}Z` : '' };
  },
  hill(x, y, s) { return { line: `M${x - s} ${y}Q${x} ${y - s * 1.1} ${x + s} ${y}` }; },
  conifer(x, y, s) { return { fill: `M${x} ${y - s * 1.6}L${x + s * 0.6} ${y}L${x - s * 0.6} ${y}Z`, line: `M${x} ${y}L${x} ${y + s * 0.4}` }; },
  tree(x, y, s) { return { fill: `M${x - s * 0.7} ${y - s * 0.6}a${s * 0.7} ${s * 0.7} 0 1 1 ${s * 1.4} 0a${s * 0.7} ${s * 0.7} 0 1 1 ${-s * 1.4} 0`, line: `M${x} ${y}L${x} ${y + s * 0.6}` }; },
  palm(x, y, s) { return { line: `M${x} ${y + s * 0.5}Q${x + s * 0.2} ${y - s * 0.4} ${x} ${y - s}M${x} ${y - s}q${-s * 0.8} ${s * 0.1} ${-s} ${s * 0.6}M${x} ${y - s}q${s * 0.8} ${s * 0.1} ${s} ${s * 0.6}M${x} ${y - s}q${-s * 0.2} ${-s * 0.5} ${-s * 0.6} ${-s * 0.6}M${x} ${y - s}q${s * 0.2} ${-s * 0.5} ${s * 0.6} ${-s * 0.6}` }; },
  grass(x, y, s) { return { line: `M${x - s * 0.5} ${y}l${-s * 0.2} ${-s * 0.7}M${x} ${y}l0 ${-s * 0.9}M${x + s * 0.5} ${y}l${s * 0.2} ${-s * 0.7}` }; },
  dune(x, y, s) { return { line: `M${x - s * 1.2} ${y}q${s * 0.6} ${-s * 0.7} ${s * 1.2} 0q${s * 0.5} ${-s * 0.4} ${s * 1} 0` }; },
  dots(x, y, s, r) { let d = ''; for (let i = 0; i < 3; i++) { const a = r() * 6.28, q = r() * s; d += `M${x + Math.cos(a) * q} ${y + Math.sin(a) * q}h0.6`; } return { dot: d }; },
  swamp(x, y, s) { return { line: `M${x - s} ${y}h${s * 0.8}M${x + s * 0.2} ${y}h${s * 0.8}M${x - s * 0.5} ${y + s * 0.5}h${s * 1.0}M${x} ${y}l0 ${-s * 0.8}M${x + s * 0.35} ${y}l${s * 0.15} ${-s * 0.6}` }; },
  field(x, y, s, r) { const w = s * (1.4 + r()), h = s * (0.9 + r() * 0.6), a = r() < 0.5; let d = `M${x} ${y}h${w}v${h}h${-w}Z`; for (let i = 1; i < 4; i++) d += a ? `M${x + (w * i) / 4} ${y}v${h}` : `M${x} ${y + (h * i) / 4}h${w}`; return { thin: d }; },
  ice(x, y, s) { return { thin: `M${x - s} ${y}l${s * 2} 0M${x - s * 0.5} ${y - s * 0.6}l${s} ${s * 1.2}M${x + s * 0.5} ${y - s * 0.6}l${-s} ${s * 1.2}` }; },
  rock(x, y, s, r) { const pts = []; for (let i = 0; i < 5; i++) { const a = (i / 5) * 6.28 + r() * 0.5, q = s * (0.5 + r() * 0.5); pts.push([x + Math.cos(a) * q, y + Math.sin(a) * q * 0.7]); } return { line: toPath(pts) }; },
};

const STYLES = {
  mountain: [['mountain', 15, 7, 0.75], ['conifer', 26, 3.5, 0.25]],
  desert: [['dune', 17, 6, 0.55], ['dots', 14, 5, 0.35], ['rock', 40, 4, 0.1]],
  plains: [['field', 19, 5, 0.55], ['grass', 22, 4, 0.25], ['tree', 40, 3, 0.2]],
  forest: [['tree', 11, 4, 0.7], ['swamp', 26, 5, 0.3]],
  ice: [['ice', 15, 5, 0.6], ['mountain', 30, 6, 0.2], ['dots', 22, 4, 0.2]],
  taiga: [['conifer', 10, 4, 0.8], ['mountain', 34, 6, 0.2]],
  hills: [['hill', 15, 6, 0.45], ['field', 22, 4, 0.35], ['tree', 30, 3, 0.2]],
  jungle: [['palm', 12, 5, 0.45], ['tree', 12, 4, 0.45], ['swamp', 34, 5, 0.1]],
  grass: [['grass', 12, 4, 0.75], ['hill', 32, 6, 0.25]],
  rock: [['rock', 15, 5, 0.6], ['mountain', 28, 6, 0.3], ['dots', 22, 4, 0.1]],
};

function scatterTerrain(layers, style, inside, box, seed) {
  const spec = STYLES[style];
  if (!spec) return;
  const r = mulberry32(seed);
  // 촘촘한 격자에 흔들림을 주고, 칸마다 확률로 기호를 고른다
  const step = Math.min(...spec.map((s) => s[1]));
  for (let y = box[1] + step / 2; y < box[3]; y += step) {
    for (let x = box[0] + step / 2; x < box[2]; x += step) {
      const px = x + (r() - 0.5) * step * 0.9, py = y + (r() - 0.5) * step * 0.9;
      if (!inside(px, py)) continue;
      let roll = r(), chosen = null;
      for (const s of spec) { roll -= s[3]; if (roll <= 0) { chosen = s; break; } }
      if (!chosen) continue;
      if (r() > step / chosen[1]) continue; // 간격이 넓은 기호는 덜 자주
      const g = G[chosen[0]](px, py, chosen[2], r);
      for (const [k, d] of Object.entries(g)) if (d) layers[k] += d;
    }
  }
}

// ---------- 정착지 기호 ----------
function settlementGlyph(g0, p) {
  const { x, y } = p;
  const g = el('g', { 'data-place': p.id }, g0);
  if (p.kind === 'capital') {
    el('circle', { cx: x, cy: y, r: 6.5, class: 'pl-capital-ring' }, g);
    el('path', { d: `M${x} ${y - 4.5}l1.3 3h3.2l-2.6 1.9 1 3.1-2.9-1.9-2.9 1.9 1-3.1-2.6-1.9h3.2z`, class: 'pl-capital' }, g);
  } else if (p.kind === 'seat') {
    el('path', { d: `M${x - 4} ${y + 3}v-5h1.5v1.5h1.5v-1.5h2v1.5h1.5v-1.5h1.5v5z`, class: 'pl-seat' }, g);
  } else if (p.kind === 'port') {
    el('path', { d: `M${x} ${y - 4}v8M${x - 3.5} ${y + 1.5}q3.5 4 7 0M${x - 2} ${y - 2.5}h4`, class: 'pl-port' }, g);
  } else {
    el('circle', { cx: x, cy: y, r: 2.4, class: 'pl-town' }, g);
  }
}

// ---------- 본체 ----------
export function renderMap(svg, data, onSelect, labels = {}, opts = {}) {
  svg.innerHTML = '';
  defs(svg);
  const [vx, vy, vw, vh] = data.meta.viewBox;
  const pad = 3000;
  el('rect', { x: vx - pad, y: vy - pad, width: vw + pad * 2, height: vh + pad * 2, fill: 'url(#seaGrad)' }, svg);

  const world = el('g', { id: 'world' }, svg);
  const gSea = el('g', { class: 'decor' }, world);
  const gWater = el('g', {}, world);
  const gLand = el('g', {}, world);
  const gTerrain = el('g', { class: 'decor terrain' }, world);
  const gRoads = el('g', { class: 'decor' }, world);
  const gDecor = el('g', { class: 'decor' }, world);
  const gPlaces = el('g', { class: 'decor places' }, world);
  const gLabel = el('g', { class: 'labels' }, world);

  const byId = Object.fromEntries(data.regions.map((r) => [r.id, r]));
  const central = byId.continent_central;
  const ridges = data.features.ridges;
  const ridgeSegs = ridges.angles.map((a) => {
    const th = rad(a), f = profile(central.map.seed, central.map.jag);
    return [central.map.cx + Math.cos(th) * central.map.r * ridges.from, central.map.cy + Math.sin(th) * central.map.r * ridges.from,
      central.map.cx + Math.cos(th) * central.map.r * f(th) * ridges.to, central.map.cy + Math.sin(th) * central.map.r * f(th) * ridges.to];
  });

  // 바다 이름과 물결선
  for (const s of opts.seas || []) el('text', { x: s.x, y: s.y, class: 'sea-label', 'font-size': s.size }, gSea).textContent = s.name.split('').join(' ');
  for (const r of data.regions) {
    if (r.map.shape !== 'blob') continue;
    const rings = r.subtype === 'young' ? [1.25] : [1.08, 1.17, 1.28];
    rings.forEach((s, i) => {
      el('path', { d: toPath(blobPoints(r.map, s, 200)), class: 'waterline', 'stroke-opacity': (0.6 - i * 0.17).toFixed(2), 'stroke-dasharray': r.subtype === 'young' ? '3 4' : 'none' }, gWater);
    });
  }

  // 땅
  el('path', { d: toPath(blobPoints(central.map)), class: 'land-base', filter: 'url(#landTex)' }, gLand);
  const polys = {}, shapes = {};
  for (const r of data.regions) {
    if (r.id === 'continent_central') continue;
    let node;
    if (r.map.shape === 'sector') {
      polys[r.id] = sectorPoints(byId[r.map.parent].map, r.map.from, r.map.to);
      shapes[r.id] = polys[r.id];
      node = el('path', { d: toPath(polys[r.id]), class: typeClass(r) + ' sector', 'fill-opacity': '0.55' }, gLand);
    } else if (r.map.shape === 'circle') {
      const { cx, cy, r: cr } = r.map;
      polys[r.id] = Array.from({ length: 48 }, (_, i) => { const th = (i / 48) * Math.PI * 2; return [cx + Math.cos(th) * (cr - 6), cy + Math.sin(th) * (cr - 6)]; });
      continue;
    } else {
      polys[r.id] = blobPoints(r.map, 0.9, 180);
      shapes[r.id] = blobPoints(r.map);
      node = el('path', { d: toPath(shapes[r.id]), class: typeClass(r), filter: 'url(#landTex)' }, gLand);
    }
    makeClickable(node, r, onSelect);
  }
  el('path', { d: toPath(blobPoints(central.map)), fill: 'none', stroke: 'var(--ink)', 'stroke-width': '1.8', 'pointer-events': 'none' }, gLand);

  // 지형 기호
  const layers = { line: '', shade: '', snow: '', fill: '', thin: '', dot: '' };
  const volcano = byId.region_volcano.map;
  for (const r of data.regions) {
    if (!r.terrainStyle || !polys[r.id]) continue;
    const inner = r.map.shape === 'sector' ? sectorPoints(central.map, r.map.from + 3, r.map.to - 3, 0.88) : blobPoints(r.map, 0.8, 120);
    const inside = (x, y) => inPoly(x, y, inner)
      && Math.hypot(x - volcano.cx, y - volcano.cy) > volcano.r + 18
      && (r.map.shape !== 'sector' || ridgeSegs.every((s) => distToSeg(x, y, ...s) > 14));
    scatterTerrain(layers, r.terrainStyle, inside, bbox(inner), (r.map.seed || 7) * 131 + r.id.length);
  }
  el('path', { d: layers.thin, class: 'tg-thin' }, gTerrain);
  el('path', { d: layers.fill, class: 'tg-fill' }, gTerrain);
  el('path', { d: layers.shade, class: 'tg-shade' }, gTerrain);
  el('path', { d: layers.line, class: 'tg-line' }, gTerrain);
  el('path', { d: layers.snow, class: 'tg-snow' }, gTerrain);
  el('path', { d: layers.dot, class: 'tg-dot' }, gTerrain);

  // 산맥 (X자로 뻗은 네 줄기)
  {
    const r = mulberry32(77);
    let line = '', shade = '', snow = '';
    for (const [x1, y1, x2, y2] of ridgeSegs) {
      const L = Math.hypot(x2 - x1, y2 - y1), ux = (x2 - x1) / L, uy = (y2 - y1) / L;
      for (let s = 0; s < L; s += 11 + r() * 4) {
        for (let k = -1; k <= 1; k++) {
          if (k !== 0 && r() < 0.6) continue;
          const off = k * 11 + (r() - 0.5) * 7;
          const size = (k === 0 ? 10 : 7) * (1 - (s / L) * 0.35);
          const g = G.mountain(x1 + ux * s - uy * off, y1 + uy * s + ux * off, size, r);
          line += g.line; shade += g.shade; snow += g.snow;
        }
      }
    }
    el('path', { d: shade, class: 'tg-shade' }, gDecor);
    el('path', { d: line, class: 'ridge' }, gDecor);
    el('path', { d: snow, class: 'tg-snow' }, gDecor);
  }

  // 강: 중앙 대륙의 네 줄기와 그 지류, 작은 대륙의 강
  function river(x0, y0, x1, y1, seed, width) {
    const r = mulberry32(seed);
    const pts = [];
    const L = Math.hypot(x1 - x0, y1 - y0), ux = (x1 - x0) / L, uy = (y1 - y0) / L;
    let off = 0;
    for (let t = 0; t <= 1.0001; t += 0.04) {
      off += (r() - 0.5) * 9; off *= 0.85;
      pts.push([x0 + (x1 - x0) * t - uy * off, y0 + (y1 - y0) * t + ux * off]);
    }
    let d = `M${pts[0][0]} ${pts[0][1]}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
      d += `Q${pts[i][0].toFixed(1)} ${pts[i][1].toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)}`;
    }
    el('path', { d, class: 'river', 'stroke-width': width }, gDecor);
    return pts;
  }
  {
    const f = profile(central.map.seed, central.map.jag);
    data.features.rivers.angles.forEach((a, i) => {
      const th = rad(a), c = central.map;
      const sx = c.cx + Math.cos(th) * c.r * 0.28, sy = c.cy + Math.sin(th) * c.r * 0.28;
      const ex = c.cx + Math.cos(th) * c.r * f(th) * 1.0, ey = c.cy + Math.sin(th) * c.r * f(th) * 1.0;
      const main = river(sx, sy, ex, ey, 300 + i, 2.6);
      for (const side of [-1, 1]) {
        const j = 5 + Math.floor(mulberry32(400 + i * 3 + side)() * 8);
        const [bx, by] = main[j];
        const ang = th + side * 0.7;
        river(bx + Math.cos(ang) * 42, by + Math.sin(ang) * 42, bx, by, 500 + i * 7 + side, 1.4);
      }
    });
    for (const r of data.regions) {
      if (r.kind !== 'continent' || r.id === 'continent_central' || r.terrainStyle === 'ice' || r.terrainStyle === 'rock') continue;
      const m = r.map, rr = mulberry32(m.seed * 13);
      const a = rr() * Math.PI * 2, fp = profile(m.seed, m.jag);
      river(m.cx - Math.cos(a) * m.r * 0.3, m.cy - Math.sin(a) * m.r * 0.3, m.cx + Math.cos(a) * m.r * fp(a) * 0.98, m.cy + Math.sin(a) * m.r * fp(a) * 0.98, m.seed * 17, 1.8);
    }
    // 서부의 소금 호수
    const rr = mulberry32(911);
    for (let i = 0; i < 4; i++) {
      const a = rad(150 + rr() * 60), s = central.map.r * (0.45 + rr() * 0.3);
      el('ellipse', { cx: (central.map.cx + Math.cos(a) * s).toFixed(1), cy: (central.map.cy + Math.sin(a) * s).toFixed(1), rx: 7 + rr() * 6, ry: 4 + rr() * 3, class: 'salt-lake' }, gDecor);
    }
  }

  // 화산 무주지
  const vNode = el('circle', { cx: volcano.cx, cy: volcano.cy, r: volcano.r, class: typeClass(byId.region_volcano) }, gDecor);
  vNode.style.pointerEvents = 'auto';
  makeClickable(vNode, byId.region_volcano, onSelect);
  {
    const { cx, cy } = volcano;
    const gV = el('g', { class: 'decor' }, world);
    const r = mulberry32(5);
    let lava = '';
    for (let i = 0; i < 7; i++) {
      const a = r() * Math.PI * 2, L = 22 + r() * 22;
      lava += `M${cx + Math.cos(a) * 10} ${cy + Math.sin(a) * 10}q${Math.cos(a + 0.5) * L * 0.5} ${Math.sin(a + 0.5) * L * 0.5} ${Math.cos(a) * L} ${Math.sin(a) * L}`;
    }
    el('path', { d: lava, class: 'lava' }, gV);
    el('path', { d: `M${cx - 20} ${cy + 13}L${cx - 6} ${cy - 13}L${cx + 6} ${cy - 13}L${cx + 20} ${cy + 13}Z`, class: 'cone' }, gV);
    el('path', { d: `M${cx - 6} ${cy - 13}q6 4 12 0`, fill: 'none', stroke: '#e0482a', 'stroke-width': '2' }, gV);
    el('path', { d: `M${cx - 2} ${cy - 16}c-6 -6 4 -10 -2 -17M${cx + 4} ${cy - 16}c6 -6 -3 -10 3 -18`, fill: 'none', stroke: 'var(--ink)', 'stroke-width': '1.2', 'stroke-linecap': 'round' }, gV);
  }

  // 정착지: 수도, 가문 영지, 마을, 항구
  const placeList = [];
  const labelPos = (r) => {
    const ma = { region_central_north: 270, region_central_east: 0, region_central_south: 90, region_central_west: 180 }[r.id];
    if (ma !== undefined) return [central.map.cx + Math.cos(rad(ma)) * central.map.r * 0.6, central.map.cy + Math.sin(rad(ma)) * central.map.r * 0.6];
    return [r.map.cx, r.map.cy];
  };
  if (opts.nations) {
    const used = [];
    const ok = (x, y, min) => used.every((u) => Math.hypot(u[0] - x, u[1] - y) > min);
    for (const n of opts.nations) {
      const r = byId[n.regionId];
      if (!r) continue;
      const rr = mulberry32(n.name.length * 977 + (r.map.seed || 3) * 31);
      const shape = shapes[r.id] || polys[r.id];
      const inner = r.map.shape === 'sector' ? sectorPoints(central.map, r.map.from + 6, r.map.to - 6, 0.82) : blobPoints(r.map, 0.72, 120);
      const box = bbox(inner);
      const isIsland = r.kind === 'island_nation';
      const pick = (min, test = () => true) => {
        for (let t = 0; t < 400; t++) {
          const x = box[0] + rr() * (box[2] - box[0]), y = box[1] + rr() * (box[3] - box[1]);
          if (!inPoly(x, y, inner) || Math.hypot(x - volcano.cx, y - volcano.cy) < volcano.r + 25) continue;
          if (r.map.shape === 'sector' && ridgeSegs.some((s) => distToSeg(x, y, ...s) < 16)) continue;
          if (!ok(x, y, isIsland ? 4 : min) || !test(x, y)) continue;
          if (!isIsland) { const [lx, ly] = labelPos(r); if (Math.abs(x - lx) < 48 && Math.abs(y - ly) < 26) continue; }
          used.push([x, y]);
          return [x, y];
        }
        return null;
      };
      const coastPick = () => {
        // 바깥쪽 해안에서 한 점을 고른다
        const cands = shape.filter((_, i) => i % 6 === 0).filter((p) => Math.hypot(p[0] - 600, p[1] - 600) > (r.map.shape === 'sector' ? 150 : 0));
        for (let t = 0; t < 60; t++) {
          const p = cands[Math.floor(rr() * cands.length)];
          const cx = r.map.cx ?? central.map.cx, cy = r.map.cy ?? central.map.cy;
          const x = p[0] + (cx - p[0]) * 0.06, y = p[1] + (cy - p[1]) * 0.06;
          if (ok(x, y, 22)) { used.push([x, y]); return [x, y]; }
        }
        return null;
      };
      const pl = opts.places?.[n.id] || {};
      const capPos = isIsland ? [r.map.cx, r.map.cy] : (pl.capitalPort ? coastPick() : pick(40)) || [r.map.cx, r.map.cy];
      placeList.push({ id: `place_${n.id}_capital`, name: n.capital, kind: 'capital', nation: n.id, regionId: r.id, x: capPos[0], y: capPos[1], port: !!pl.capitalPort || isIsland });
      for (const h of (opts.houses || []).filter((x) => x.nation === n.id && !x.ruling)) {
        const p = pick(40);
        if (p) placeList.push({ id: `place_${h.id}`, name: h.seat, kind: 'seat', nation: n.id, house: h.id, regionId: r.id, x: p[0], y: p[1] });
      }
      (pl.towns || []).forEach((t, i) => {
        const p = pick(34);
        if (p) placeList.push({ id: `place_${n.id}_town${i}`, name: t, kind: 'town', nation: n.id, regionId: r.id, x: p[0], y: p[1] });
      });
      if (pl.port) {
        const p = coastPick();
        if (p) placeList.push({ id: `place_${n.id}_port`, name: pl.port, kind: 'port', nation: n.id, regionId: r.id, x: p[0], y: p[1], port: true });
      }
    }
    // 길: 같은 나라 안에서 가까운 곳끼리 잇는다
    let roads = '';
    for (const n of opts.nations) {
      const ps = placeList.filter((p) => p.nation === n.id);
      const linked = [ps[0]];
      const rest = ps.slice(1);
      while (rest.length) {
        let best = null;
        for (const a of linked) for (const b of rest) { const d = Math.hypot(a.x - b.x, a.y - b.y); if (!best || d < best.d) best = { a, b, d }; }
        const { a, b } = best;
        const mx = (a.x + b.x) / 2 + (b.y - a.y) * 0.12, my = (a.y + b.y) / 2 - (b.x - a.x) * 0.12;
        roads += `M${a.x.toFixed(1)} ${a.y.toFixed(1)}Q${mx.toFixed(1)} ${my.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
        linked.push(b); rest.splice(rest.indexOf(b), 1);
      }
    }
    // 중앙 대륙 나라 사이의 고갯길
    const caps = Object.fromEntries(placeList.filter((p) => p.kind === 'capital').map((p) => [p.nation, p]));
    for (const [a, b] of opts.landPairs || []) {
      if (!caps[a] || !caps[b]) continue;
      roads += `M${caps[a].x.toFixed(1)} ${caps[a].y.toFixed(1)}Q${((caps[a].x + caps[b].x) / 2 + (600 - (caps[a].x + caps[b].x) / 2) * -0.4).toFixed(1)} ${((caps[a].y + caps[b].y) / 2 + (600 - (caps[a].y + caps[b].y) / 2) * -0.4).toFixed(1)} ${caps[b].x.toFixed(1)} ${caps[b].y.toFixed(1)}`;
    }
    el('path', { d: roads, class: 'road' }, gRoads);
    // 바닷길: 바다 이웃의 항구끼리
    let routes = '';
    const portOf = (nid) => placeList.find((p) => p.nation === nid && p.port);
    for (const [a, b] of opts.seaPairs || []) {
      const pa = portOf(a), pb = portOf(b);
      if (!pa || !pb) continue;
      const mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2;
      const dx = mx - 600, dy = my - 600, L = Math.hypot(dx, dy) || 1;
      routes += `M${pa.x.toFixed(1)} ${pa.y.toFixed(1)}Q${(mx + (dx / L) * 25).toFixed(1)} ${(my + (dy / L) * 25).toFixed(1)} ${pb.x.toFixed(1)} ${pb.y.toFixed(1)}`;
    }
    el('path', { d: routes, class: 'sea-route' }, gSea);
    for (const p of placeList) {
      settlementGlyph(gPlaces, p);
      el('text', { x: p.x + (p.kind === 'capital' ? 9 : 6), y: p.y + 3.5, class: `label pl-name pl-${p.kind}-name`, 'data-place': p.id }, gLabel).textContent = p.name;
    }
  }

  // 나라 이름표
  const midAngle = { region_central_north: 270, region_central_east: 0, region_central_south: 90, region_central_west: 180 };
  const anchors = {};
  const label = (x, y, main, sub, id) => {
    el('text', { x, y, class: 'label label-main' }, gLabel).textContent = main;
    const t = el('text', { x, y: y + 17, class: 'label label-sub' }, gLabel);
    t.textContent = sub || '';
    if (id) t.setAttribute('data-label-sub', id);
  };
  for (const r of data.regions) {
    const custom = labels[r.id];
    if (midAngle[r.id] !== undefined) {
      const a = rad(midAngle[r.id]), s = central.map.r * 0.6;
      const x = central.map.cx + Math.cos(a) * s, y = central.map.cy + Math.sin(a) * s;
      anchors[r.id] = [x, y - 6];
      label(x, y, custom?.main ?? r.name, custom?.sub ?? TYPE_LABEL[r.nationType], r.id);
    } else if (r.kind === 'continent' && r.id !== 'continent_central') {
      anchors[r.id] = [r.map.cx, r.map.cy];
      label(r.map.cx, r.map.cy + 6, custom?.main ?? r.name, custom?.sub, r.id);
    } else if (r.kind === 'island_nation') {
      anchors[r.id] = [r.map.cx, r.map.cy];
      el('text', { x: r.map.cx, y: r.map.cy + r.map.r + 18, class: 'label label-small' }, gLabel).textContent = custom?.main ?? r.name;
    } else if (r.map.cx !== undefined) {
      anchors[r.id] = [r.map.cx, r.map.cy];
    }
  }
  el('text', { x: volcano.cx, y: volcano.cy + volcano.r + 16, class: 'label label-sub' }, gLabel).textContent = '화산 무주지';

  // 나침반과 축척
  {
    const g = el('g', { class: 'compass', transform: 'translate(1110 104)' }, svg);
    el('circle', { r: '32', 'stroke-width': '1.2' }, g);
    el('circle', { r: '26', 'stroke-width': '0.6' }, g);
    for (let i = 0; i < 16; i++) { const a = (i / 16) * 6.28, l = i % 4 === 0 ? 42 : i % 2 === 0 ? 34 : 30; el('line', { x1: 0, y1: 0, x2: Math.cos(a) * l, y2: Math.sin(a) * l, 'stroke-width': i % 4 === 0 ? 0.9 : 0.5 }, g); }
    el('polygon', { points: '0,-38 5,0 0,6 -5,0' }, g);
    el('polygon', { points: '0,38 5,0 0,-6 -5,0', class: 'compass-s' }, g);
    el('text', { x: '0', y: '-48' }, g).textContent = '북';
    const sb = el('g', { class: 'scalebar', transform: 'translate(960 1150)' }, svg);
    for (let i = 0; i < 4; i++) el('rect', { x: i * 30, y: 0, width: 30, height: 5, class: i % 2 ? 'sb-light' : 'sb-dark' }, sb);
    el('text', { x: 0, y: -6, class: 'sb-text' }, sb).textContent = '0';
    el('text', { x: 120, y: -6, class: 'sb-text' }, sb).textContent = '일주일 걷는 거리';
  }

  el('rect', { x: vx - pad, y: vy - pad, width: vw + pad * 2, height: vh + pad * 2, filter: 'url(#grain)', 'pointer-events': 'none' }, svg);

  // ---------- 확대·축소와 이동 ----------
  const view = { x: vx, y: vy, w: vw, h: vh };
  const minW = 260, maxW = vw * 1.15;
  const apply = () => {
    svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);
    const z = vw / view.w;
    svg.classList.toggle('zoom-2', z >= 1.6);
    svg.classList.toggle('zoom-3', z >= 2.6);
  };
  const toSvg = (cx, cy) => {
    const rect = svg.getBoundingClientRect();
    const s = Math.max(view.w / rect.width, view.h / rect.height);
    const ox = (rect.width * s - view.w) / 2, oy = (rect.height * s - view.h) / 2;
    return [view.x - ox + (cx - rect.left) * s, view.y - oy + (cy - rect.top) * s, s];
  };
  const zoomAt = (px, py, factor) => {
    const nw = Math.min(maxW, Math.max(minW, view.w * factor));
    const k = nw / view.w;
    view.x = px - (px - view.x) * k; view.y = py - (py - view.y) * k;
    view.w = nw; view.h = nw * (vh / vw);
    apply();
  };
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const [px, py] = toSvg(e.clientX, e.clientY);
    zoomAt(px, py, e.deltaY > 0 ? 1.15 : 1 / 1.15);
  }, { passive: false });
  const pointers = new Map();
  let drag = null, pinch = null;
  svg.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    svg.__dragged = false;
    if (pointers.size === 1) drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), w: view.w }; drag = null; }
  });
  svg.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      const [px, py] = toSvg((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      zoomAt(px, py, (pinch.w * (pinch.d / d)) / view.w);
      svg.__dragged = true;
    } else if (drag) {
      const s = toSvg(0, 0)[2];
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) { svg.__dragged = true; svg.classList.add('dragging'); }
      view.x = drag.vx - dx * s; view.y = drag.vy - dy * s;
      apply();
    }
  });
  const end = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (!pointers.size) { drag = null; svg.classList.remove('dragging'); setTimeout(() => { svg.__dragged = false; }, 0); }
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);
  apply();

  return {
    polys, shapes, anchors, places: placeList,
    zoomBy(f) { zoomAt(view.x + view.w / 2, view.y + view.h / 2, f); },
    reset() { Object.assign(view, { x: vx, y: vy, w: vw, h: vh }); apply(); },
    focus(x, y, w = 420) { view.w = w; view.h = w * (vh / vw); view.x = x - w / 2; view.y = y - view.h / 2; apply(); },
    setSelected(id) {
      svg.querySelectorAll('.is-selected').forEach((n) => n.classList.remove('is-selected'));
      if (id) svg.querySelectorAll(`[data-id="${id}"]`).forEach((n) => n.classList.add('is-selected'));
    },
  };
}

export { TYPE_LABEL };
