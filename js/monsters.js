// 마물 생성기: data/monsters.json 규칙으로 지도를 열 때마다 마물을 임의 배치한다.
// 같은 시드를 넣으면 같은 결과가 나온다. (나중에 Firebase로 모두가 같은 세계를 보게 할 때 시드를 저장하면 된다)

const NS = 'http://www.w3.org/2000/svg';

export function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickWeighted(rng, items, weightOf = (x) => (x.weight ?? 1)) {
  const total = items.reduce((s, x) => s + weightOf(x), 0);
  let r = rng() * total;
  for (const x of items) {
    r -= weightOf(x);
    if (r <= 0) return x;
  }
  return items[items.length - 1];
}

function pointInPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function randomPoint(rng, pts, avoid = null, placed = []) {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  let fallback = null;
  for (let i = 0; i < 300; i++) {
    const x = minX + rng() * (maxX - minX);
    const y = minY + rng() * (maxY - minY);
    if (!pointInPoly(x, y, pts)) continue;
    if (avoid && Math.hypot(x - avoid.cx, y - avoid.cy) < avoid.r + 8) continue;
    if (!fallback) fallback = [x, y];
    const clear = placed.every((p) => (p.rx
      ? ((p.x - x) / p.rx) ** 2 + ((p.y - y) / p.ry) ** 2 > 1
      : Math.hypot(p.x - x, p.y - y) > 22));
    if (clear) return [x, y];
  }
  return fallback;
}

export function generateMonsters(cfg, regionsById, polys, seed, avoidZones = []) {
  const rng = makeRng(seed);
  const entries = Object.entries(cfg.regionHabitats).filter(([id]) => polys[id]);
  const [lo, hi] = cfg.count;
  const count = lo + Math.floor(rng() * (hi - lo + 1));
  const volcano = regionsById.region_volcano?.map;
  const out = [];

  for (let i = 0; i < count; i++) {
    const [regionId, rh] = pickWeighted(rng, entries, (e) => e[1].weight);
    const candidates = cfg.bases.filter((b) => b.habitats.includes('any') || b.habitats.some((h) => rh.habitats.includes(h)));
    if (!candidates.length) continue;
    const base = pickWeighted(rng, candidates, () => 1);

    const muts = [];
    const n = rng() < cfg.secondMutationChance ? 2 : 1;
    while (muts.length < n) {
      const m = pickWeighted(rng, cfg.mutations);
      if (!muts.includes(m)) muts.push(m);
    }

    let tier = base.tier + muts.reduce((s, m) => s + m.power, 0) + (rh.bonus || 0);
    tier = Math.max(1, Math.min(5, tier));

    const isSector = regionsById[regionId]?.map.shape === 'sector';
    const pos = randomPoint(rng, polys[regionId], isSector ? volcano : null, [...avoidZones, ...out]);
    if (!pos) continue;

    out.push({
      id: `monster_${i}`,
      name: `${muts[0].name} ${base.name}`,
      base: base.name,
      traits: muts.map((m) => m.desc),
      tier,
      regionId,
      x: pos[0],
      y: pos[1],
    });
  }
  return out;
}

export function drawMonsters(svg, monsters, cfg, onSelect) {
  svg.querySelector('#monsters')?.remove();
  const g = document.createElementNS(NS, 'g');
  g.id = 'monsters';
  const tierColor = Object.fromEntries(cfg.tiers.map((t) => [t.level, t.color]));
  const tierName = Object.fromEntries(cfg.tiers.map((t) => [t.level, t.name]));

  for (const m of monsters) {
    const s = 5 + m.tier * 1.6;
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', `M${m.x} ${m.y - s}L${m.x + s} ${m.y}L${m.x} ${m.y + s}L${m.x - s} ${m.y}Z`);
    p.setAttribute('fill', tierColor[m.tier]);
    p.setAttribute('class', 'monster');
    p.dataset.id = m.id;
    p.setAttribute('tabindex', '0');
    p.setAttribute('role', 'button');
    p.setAttribute('aria-label', `${m.name}, ${tierName[m.tier]}`);
    const title = document.createElementNS(NS, 'title');
    title.textContent = `${m.name} (${tierName[m.tier]})`;
    p.appendChild(title);
    p.addEventListener('click', () => onSelect(m.id));
    p.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(m.id); }
    });
    g.appendChild(p);
  }

  // 질감 레이어(마지막 rect) 바로 앞에 넣어 다른 요소 위에 보이게 한다
  const grain = svg.querySelector('rect[filter]');
  svg.insertBefore(g, grain);
  return g;
}
