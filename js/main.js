import { renderMap, TYPE_LABEL, blobPoints, toPath } from './map.js';
import { generateMonsters, drawMonsters, makeRng, randomPoint } from './monsters.js';
import { createState, step, nationPower, relationStage, J } from './sim.js';
import { gradeLabel } from './people.js';
import { createGame } from './game.js';
import { seasonOf } from './player.js';

const panel = document.getElementById('panel');
const simbar = document.getElementById('simbar');
const legend = document.getElementById('legend');
const svg = document.getElementById('map');
const NS = 'http://www.w3.org/2000/svg';
const SNAPSHOT_KEY = 'liven-snapshot-v2';
const GAME_KEY = 'liven-game-v1';
const MODE_KEY = 'liven-mode';
const SPEEDS = [{ label: '1배', ms: 1400 }, { label: '2배', ms: 700 }, { label: '4배', ms: 300 }];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (v) => Math.round(v).toLocaleString('ko-KR');

const TYPE_TEXT = { ...TYPE_LABEL, revolution: '혁명 정부' };
const TYPE_COLOR = {
  knight: 'var(--knight)', magic: 'var(--magic)', coexist: 'var(--coexist)',
  mercenary: 'var(--mercenary)', none: 'var(--volcano)', revolution: 'var(--revolution)',
};
const BASE_CAT = {
  start: '세계', eruption: '자연', meteor: '자연', ron: '자연', cohort: '인물', famine: '자연', monster: '마물',
  alliance: '외교', battle: '전쟁', peace: '전쟁', war: '전쟁', revolution: '혁명', reclaim: '정치',
};
const FILTERS = ['전체', '이야기', '전쟁', '정치', '외교', '인물', '마물', '자연', '탐험', '혁명'];
const ROLE_TEXT = {
  ruler: '지도자', head: '가문 수장', champion: '이름난 강자', dispatched: '파견된 강자', hero: '양방향 각성자',
  commoner: '평민', prophet: '선지자', founder: '무명회 창시자', rebel: '무명회 봉기 지도자', noble: '귀족', prisoner: '갇힌 옛 수장', deposed: '폐위된 지도자',
};

async function loadJSON(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} (${res.status})`);
  return res.json();
}

const newSeed = () => Math.floor(Math.random() * 1e9);
function initialSeed() {
  const q = new URLSearchParams(location.search).get('seed');
  return q && /^\d+$/.test(q) ? Number(q) : newSeed();
}

function row(label, value, raw = false) {
  if (value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)) return '';
  const v = Array.isArray(value) ? value.join(', ') : value;
  return `<dt>${label}</dt><dd>${raw ? v : esc(v)}</dd>`;
}

async function init() {
  const FILES = ['world', 'regions', 'monsters', 'races', 'grades', 'nations', 'relations', 'sim-rules', 'state-initial',
    'houses', 'names', 'events', 'elements', 'story', 'places', 'player', 'items'];
  let files;
  try {
    files = await Promise.all(FILES.map((f) => loadJSON(`data/${f}.json`)));
  } catch (err) {
    console.error(err);
    panel.innerHTML = `
      <h1 class="world-name">리벤</h1>
      <p class="error">데이터를 불러오지 못했습니다. data 폴더에 JSON 파일 ${FILES.length}개가 모두 있는지 확인하세요.<br><small>${esc(err.message)}</small></p>`;
    return;
  }
  const [world, regionData, monsterCfg, races, grades, nations, relations, rules, stateInitial, houses, names, events, elements, story, placesData, playerData, items] = files;

  const regionById = Object.fromEntries(regionData.regions.map((r) => [r.id, r]));
  const nationById = Object.fromEntries(nations.nations.map((n) => [n.id, n]));
  const nationByRegion = Object.fromEntries(nations.nations.map((n) => [n.regionId, n]));
  const tierOf = Object.fromEntries(monsterCfg.tiers.map((t) => [t.level, t]));
  const elementOf = Object.fromEntries(elements.list.map((e) => [e.id, e]));
  const traitName = Object.fromEntries(names.traits.map((t) => [t.id, t.name]));
  const catOf = (kind) => events.events[kind]?.cat ?? BASE_CAT[kind] ?? '세계';
  const catOfEntry = (l) => l.cat ?? catOf(l.kind);
  const data = {
    rules, grades, relations, stateInitial, world, names, events, elements, monsterCfg, story, player: playerData, items,
    races: Object.fromEntries(races.races.map((r) => [r.id, r])),
    nationById, nationsList: nations.nations, regionsList: regionData.regions,
    neighbors: nations.neighbors, patrons: nations.patrons, houses: houses.houses,
  };

  // ---------- 지도 ----------
  const labels = {};
  for (const n of nations.nations) labels[n.regionId] = { main: n.name, sub: TYPE_TEXT[n.type] };
  let state;
  let view = { type: 'world' };
  let filter = '전체';
  let chronicleYears = 40;
  let admin = false;
  let showMonsters = true;
  let timer = null;
  let speed = 0;

  const select = (id) => {
    if (state.monsters.some((m) => m.id === id)) view = { type: 'monster', id };
    else view = { type: 'region', id };
    render();
  };
  const map = renderMap(svg, regionData, select, labels, {
    seas: placesData.seas, places: placesData.nations, nations: nations.nations, houses: houses.houses,
    landPairs: nations.neighbors.land, seaPairs: nations.neighbors.sea,
  });
  // 확대·축소 단추
  const zoomUi = document.createElement('div');
  zoomUi.className = 'zoom-ui';
  zoomUi.innerHTML = '<button type="button" aria-label="확대">+</button><button type="button" aria-label="축소">−</button><button type="button" aria-label="전체 보기">⤢</button>';
  const [zin, zout, zreset] = zoomUi.querySelectorAll('button');
  zin.addEventListener('click', () => map.zoomBy(1 / 1.4));
  zout.addEventListener('click', () => map.zoomBy(1.4));
  zreset.addEventListener('click', () => map.reset());
  svg.parentElement.appendChild(zoomUi);
  const pickable = regionData.regions.filter((r) => r.id !== 'continent_central' && map.polys[r.id]);
  const volcanoMap = regionById.region_volcano.map;
  const labelZones = Object.entries(map.anchors)
    .filter(([id]) => labels[id] || id.startsWith('region_central'))
    .map(([, [x, y]]) => ({ x, y: y + 8, rx: 48, ry: 24 }));

  // 점령지 빗금 무늬 (점령한 쪽의 국가 색)
  const defs = svg.querySelector('defs');
  for (const [k, color] of Object.entries({ ...TYPE_COLOR, house: 'var(--ink)' })) {
    const pat = document.createElementNS(NS, 'pattern');
    pat.setAttribute('id', `occ-${k}`); pat.setAttribute('width', '9'); pat.setAttribute('height', '9');
    pat.setAttribute('patternUnits', 'userSpaceOnUse'); pat.setAttribute('patternTransform', 'rotate(-35)');
    pat.innerHTML = `<rect width="9" height="9" fill="none"/><line x1="0" y1="0" x2="0" y2="9" stroke="${color}" stroke-width="4"/>`;
    defs.appendChild(pat);
  }

  // 새로 솟은 섬은 지역 목록에 덧붙여 다른 섬처럼 다룬다
  function registerNewIslands() {
    for (const isl of state.newIslands) {
      if (!map.polys[isl.id]) {
        map.polys[isl.id] = blobPoints(isl, 0.9);
        map.shapes[isl.id] = blobPoints(isl);
        map.anchors[isl.id] = [isl.cx, isl.cy];
      }
      regionById[isl.id] = {
        id: isl.id, name: '이름 없는 섬', kind: 'island_unexplored', subtype: 'new', map: isl,
        terrain: '분화 뒤 바다 밑에서 솟아오른 젊은 땅', hazards: ['불안정한 지반'],
        notes: [`맹약력 ${isl.year}년 분화 뒤에 솟아올랐다.`],
      };
    }
  }

  const hooks = {
    pickRegion(rng) {
      const r = pickable[Math.floor(rng() * pickable.length)];
      const p = randomPoint(rng, map.polys[r.id]) || [r.map.cx, r.map.cy];
      return { regionId: r.id, regionName: nationByRegion[r.id]?.name ?? r.name, x: p[0], y: p[1] };
    },
    respawnMonsters(s, rng, fraction) {
      const keep = s.monsters.filter((m) => m.legend || rng() > fraction);
      const fresh = generateMonsters(monsterCfg, regionById, map.polys, Math.floor(rng() * 1e9), labelZones);
      const out = [...keep];
      fresh.forEach((m, i) => { if (out.length < fresh.length) out.push({ ...m, id: `m${s.year}_${i}` }); });
      s.monsters = out;
    },
    pointIn(regionId, rng) {
      const poly = map.polys[regionId];
      if (!poly) return null;
      const avoid = regionById[regionId]?.map.shape === 'sector' ? volcanoMap : null;
      return randomPoint(rng, poly, avoid, labelZones);
    },
    spawnIsland(s, rng) {
      const blobs = [...regionData.regions.filter((r) => r.map.cx !== undefined).map((r) => ({ x: r.map.cx, y: r.map.cy, r: r.map.r * (r.id === 'continent_central' ? 1.2 : 1.15) })),
        ...s.newIslands.map((i) => ({ x: i.cx, y: i.cy, r: i.r }))];
      for (let t = 0; t < 80; t++) {
        const a = rng() * Math.PI * 2, d = 270 + rng() * 300, r = 13 + rng() * 9;
        const x = 600 + Math.cos(a) * d, y = 600 + Math.sin(a) * d;
        if (x < 40 || y < 40 || x > 1160 || y > 1160) continue;
        if (blobs.every((b) => Math.hypot(b.x - x, b.y - y) > b.r + r + 28)) {
          return { id: `island_new_${s.year}_${t}`, name: '이름 없는 섬', cx: Math.round(x), cy: Math.round(y), r: Math.round(r), seed: Math.floor(rng() * 1e6), jag: 0.32 };
        }
      }
      return null;
    },
  };

  function newWorld(seed) {
    state = createState(data, seed);
    hooks.respawnMonsters(state, makeRng(seed + 7), 1);
  }

  const personName = (pid) => state.persons[pid]?.name ?? '';
  const islandName = (id) => state.islandNames[id] || regionById[id]?.name || '섬';

  // ---------- 지도 위 시뮬레이션 표시 ----------
  function drawBand(g, pts, from, toward, frac, patternId, idx) {
    const dx = toward[0] - from[0], dy = toward[1] - from[1];
    const L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
    const proj = pts.map((p) => p[0] * ux + p[1] * uy);
    const max = Math.max(...proj), min = Math.min(...proj);
    const cut = max - Math.min(0.85, frac) * (max - min);
    const bx = ux * cut, by = uy * cut, px = -uy, py = ux, F = 3000;
    const clip = document.createElementNS(NS, 'clipPath');
    clip.setAttribute('id', `occclip-${idx}`);
    clip.innerHTML = `<path d="${toPath(pts)}"/>`;
    g.appendChild(clip);
    const poly = document.createElementNS(NS, 'polygon');
    const c = [[bx + px * F, by + py * F], [bx - px * F, by - py * F], [bx - px * F + ux * F, by - py * F + uy * F], [bx + px * F + ux * F, by + py * F + uy * F]];
    poly.setAttribute('points', c.map((p) => p.join(',')).join(' '));
    poly.setAttribute('fill', `url(#${patternId})`);
    poly.setAttribute('clip-path', `url(#occclip-${idx})`);
    poly.setAttribute('class', 'occupied');
    g.appendChild(poly);
  }

  function drawOverlay() {
    registerNewIslands();
    // 국가 색과 라벨
    for (const [id, n] of Object.entries(state.nations)) {
      const regionId = nationById[id].regionId;
      svg.querySelectorAll(`.region[data-id="${regionId}"]`).forEach((elm) => {
        [...elm.classList].filter((c) => c.startsWith('t-')).forEach((c) => elm.classList.remove(c));
        elm.classList.add(`t-${n.type}`);
        elm.classList.toggle('at-war', state.wars.some((w) => w.a === id || w.b === id));
      });
      const sub = svg.querySelector(`[data-label-sub="${regionId}"]`);
      if (sub) sub.textContent = TYPE_TEXT[n.type];
    }
    // 개척된 섬과 알려진 섬
    for (const r of regionData.regions.filter((x) => x.kind === 'island_unexplored')) {
      const elm = svg.querySelector(`.region[data-id="${r.id}"]`);
      if (!elm) continue;
      [...elm.classList].filter((c) => c.startsWith('t-')).forEach((c) => elm.classList.remove(c));
      const owner = state.colonies[r.id];
      elm.classList.add(owner ? `t-${state.nations[owner].type}` : state.known[r.id] ? 't-harsh' : 't-young');
      elm.classList.toggle('colony', !!owner);
    }

    svg.querySelector('#overlay')?.remove();
    svg.querySelector('#newislands')?.remove();
    const g = document.createElementNS(NS, 'g');
    g.id = 'overlay';
    g.setAttribute('class', 'decor');
    const gi = document.createElementNS(NS, 'g');
    gi.id = 'newislands';

    // 새로 솟은 섬
    for (const isl of state.newIslands) {
      const water = document.createElementNS(NS, 'path');
      water.setAttribute('d', toPath(blobPoints(isl, 1.3)));
      water.setAttribute('class', 'waterline');
      water.setAttribute('stroke-dasharray', '3 4');
      gi.appendChild(water);
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', toPath(blobPoints(isl)));
      const owner = state.colonies[isl.id];
      p.setAttribute('class', `region new-island ${owner ? `t-${state.nations[owner].type} colony` : state.known[isl.id] ? 't-harsh' : 't-young'}`);
      p.dataset.id = isl.id;
      p.setAttribute('tabindex', '0');
      p.setAttribute('role', 'button');
      p.setAttribute('aria-label', islandName(isl.id));
      p.addEventListener('click', () => select(isl.id));
      p.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(isl.id); } });
      gi.appendChild(p);
    }
    // 개척지 이름표
    for (const [rid, owner] of Object.entries(state.colonies)) {
      const a = map.anchors[rid];
      const r = regionById[rid];
      if (!a || !r) continue;
      const t = document.createElementNS(NS, 'text');
      t.setAttribute('x', a[0]); t.setAttribute('y', a[1] + (r.map.r || 18) + 16);
      t.setAttribute('class', 'label label-colony');
      t.textContent = `${nationById[owner].name} 개척지`;
      g.appendChild(t);
    }
    // 점령지 빗금
    let idx = 0;
    for (const [id, n] of Object.entries(state.nations)) {
      const regionId = nationById[id].regionId;
      const pts = map.shapes[regionId];
      const from = map.anchors[regionId];
      if (!pts || !from) continue;
      for (const [key, amt] of Object.entries(n.occupied || {})) {
        if (amt < 0.5) continue;
        let toward, pat;
        if (key.startsWith('house:')) {
          const dx = from[0] - 600, dy = from[1] - 600, L = Math.hypot(dx, dy) || 1;
          toward = [from[0] + (dx / L) * 100, from[1] + (dy / L) * 100];
          pat = 'occ-house';
        } else {
          toward = map.anchors[nationById[key].regionId];
          pat = `occ-${state.nations[key].type}`;
        }
        drawBand(g, pts, from, toward, amt / 100, pat, idx++);
      }
    }
    // 전쟁선
    for (const w of state.wars) {
      const [x1, y1] = map.anchors[nationById[w.a].regionId];
      const [x2, y2] = map.anchors[nationById[w.b].regionId];
      const line = document.createElementNS(NS, 'path');
      const mx = (x1 + x2) / 2 + (y2 - y1) * 0.15, my = (y1 + y2) / 2 - (x2 - x1) * 0.15;
      line.setAttribute('d', `M${x1} ${y1}Q${mx} ${my} ${x2} ${y2}`);
      line.setAttribute('class', 'war-line');
      g.appendChild(line);
    }
    // 유성
    for (const m of state.meteors) {
      const star = document.createElementNS(NS, 'path');
      const { x, y } = m, r = 9;
      star.setAttribute('d', `M${x} ${y - r}L${x + 2.5} ${y - 2.5}L${x + r} ${y}L${x + 2.5} ${y + 2.5}L${x} ${y + r}L${x - 2.5} ${y + 2.5}L${x - r} ${y}L${x - 2.5} ${y - 2.5}Z`);
      star.setAttribute('class', 'meteor');
      g.appendChild(star);
    }
    const grain = svg.querySelector('rect[filter]');
    svg.insertBefore(gi, grain);
    svg.insertBefore(g, grain);

    const vol = svg.querySelector('[data-id="region_volcano"]');
    vol.classList.remove('erupting');
    if (state.flash === 'eruption') { void vol.getBoundingClientRect(); vol.classList.add('erupting'); }

    // 인물 모드: 아직 모르는 장소는 흐리게
    const known = mode === 'game' && state.player?.known ? new Set(state.player.known) : null;
    svg.querySelectorAll('[data-place]').forEach((e) => e.classList.toggle('pl-unknown', !!known && !known.has(e.dataset.place)));
    // 내 인물의 위치
    const pl = state.player;
    if (mode === 'game' && pl?.alive) {
      const P = (id) => map.places.find((x) => x.id === id);
      let x, y;
      if (pl.travel) {
        const a = P(pl.travel.from), b = P(pl.travel.to);
        const t = Math.min(1, pl.travel.done / pl.travel.weeks);
        x = a.x + (b.x - a.x) * t; y = a.y + (b.y - a.y) * t;
        const path = document.createElementNS(NS, 'path');
        path.setAttribute('d', `M${a.x} ${a.y}L${b.x} ${b.y}`);
        path.setAttribute('class', 'player-path');
        g.appendChild(path);
      } else { const here = P(pl.place); x = here?.x; y = here?.y; }
      if (x !== undefined) {
        const mk = document.createElementNS(NS, 'g');
        mk.setAttribute('class', 'player-marker');
        mk.innerHTML = `<circle cx="${x}" cy="${y}" r="9" class="pm-ring"/><circle cx="${x}" cy="${y}" r="4" class="pm-dot"/><path d="M${x} ${y - 9}v-14l9 4-9 4" class="pm-flag"/>`;
        g.appendChild(mk);
      }
    }
    const mg = drawMonsters(svg, state.monsters, monsterCfg, select);
    mg.classList.toggle('is-hidden', !showMonsters);
  }

  // ---------- 범례 ----------
  function renderLegend() {
    const items = [
      ['', 'var(--knight)', '기사국가'], ['', 'var(--magic)', '마법국가'], ['', 'var(--coexist)', '공존국가'],
      ['', 'var(--mercenary)', '섬나라'], ['', 'var(--revolution)', '혁명 정부'], ['', 'var(--harsh)', '미개척 섬'],
      ['dashed', '', '알려지지 않은 섬'], ['hatched', '', '화산 무주지'], ['war', '', '전쟁 중'], ['occ', '', '점령당한 땅'],
    ];
    const scale = monsterCfg.tiers.map((t) => `<span style="background:${t.color}" title="${esc(t.name)}"></span>`).join('');
    legend.innerHTML = items.map(([cls, color, text]) =>
      `<div class="legend-item"><span class="swatch ${cls}" style="${color ? `background:${color}` : ''}"></span>${text}</div>`).join('') +
      `<label class="legend-toggle"><input type="checkbox" id="toggleMonsters" ${showMonsters ? 'checked' : ''}>마물 표시<span class="tier-scale" aria-hidden="true">${scale}</span></label>`;
    legend.querySelector('#toggleMonsters').addEventListener('change', (e) => {
      showMonsters = e.target.checked;
      svg.querySelector('#monsters')?.classList.toggle('is-hidden', !showMonsters);
    });
  }

  // ---------- 조작 막대 ----------
  function renderSimbar() {
    if (mode === 'game' && state.player) {
      const season = seasonOf(data, state.week || 1);
      simbar.innerHTML = `
        <div class="sim-year"><span class="sim-year-value">${esc(world.era.short)} ${state.year}년</span><span class="sim-week">${esc(season.name)} · ${state.week}주째</span></div>
        <div class="sim-controls">
          <button type="button" class="btn ${view.type === 'game' ? 'is-on' : ''}" data-act="me">내 인물</button>
          <button type="button" class="btn ${view.type !== 'game' ? 'is-on' : ''}" data-act="world">세계</button>
        </div>`;
      simbar.querySelector('[data-act="me"]').addEventListener('click', () => { view = { type: 'game' }; render(); });
      simbar.querySelector('[data-act="world"]').addEventListener('click', () => { view = { type: 'world' }; render(); });
      return;
    }
    simbar.innerHTML = `
      <div class="sim-year"><span class="sim-year-value">${esc(world.era.short)} ${state.year}년</span></div>
      <div class="sim-controls">
        <button type="button" class="btn" data-act="step">다음 해</button>
        <button type="button" class="btn" data-act="play">${timer ? '정지' : '자동 진행'}</button>
        <button type="button" class="btn" data-act="speed">${SPEEDS[speed].label}</button>
      </div>`;
    simbar.querySelector('[data-act="step"]').addEventListener('click', () => { stop(); advance(); });
    simbar.querySelector('[data-act="play"]').addEventListener('click', () => (timer ? stop() : play()));
    simbar.querySelector('[data-act="speed"]').addEventListener('click', () => {
      speed = (speed + 1) % SPEEDS.length;
      if (timer) { stop(); play(); } else renderSimbar();
    });
  }

  function advance() {
    step(state, data, hooks);
    if (view.type === 'monster' && !state.monsters.some((m) => m.id === view.id)) view = { type: 'world' };
    render();
  }
  function play() { timer = setInterval(advance, SPEEDS[speed].ms); renderSimbar(); }
  function stop() { clearInterval(timer); timer = null; renderSimbar(); }

  // ---------- 연대기 ----------
  const visible = (l) => admin || !l.hidden;
  function linkify(entry) {
    let text = esc(entry.text);
    const tokens = [];
    for (const pid of entry.persons || []) {
      const p = state.persons[pid];
      if (!p || (p.hidden && !admin)) continue;
      const nm = esc(p.name);
      if (!text.includes(nm)) continue;
      text = text.replace(nm, `\u0001${tokens.length}\u0002`);
      tokens.push(`<button type="button" class="plink" data-person="${pid}">${nm}</button>`);
    }
    for (const nid of entry.ids || []) {
      const nm = esc(nationById[nid]?.name);
      if (!nm || !text.includes(nm)) continue;
      text = text.replace(nm, `\u0001${tokens.length}\u0002`);
      tokens.push(`<button type="button" class="nlink" data-nation="${nid}">${nm}</button>`);
    }
    return text.replace(/\u0001(\d+)\u0002/g, (_, i) => tokens[+i]);
  }
  function entryHtml(l) {
    const cat = catOfEntry(l);
    return `<li class="cat-${esc(cat)}${l.hidden ? ' log-hidden' : ''}${(l.w || 0) >= 60 ? ' log-major' : ''}${l.thread ? ' log-thread' : ''}"><span class="log-cat">${esc(cat)}${l.thread ? ' · 이야기' : ''}</span>${linkify(l)}</li>`;
  }
  function chronicleHtml(entries, { years = Infinity, showSummary = true } = {}) {
    const byYear = new Map();
    for (const l of entries) {
      if (!byYear.has(l.year)) byYear.set(l.year, []);
      byYear.get(l.year).push(l);
    }
    const ys = [...byYear.keys()].sort((a, b) => b - a).slice(0, years);
    return ys.map((y) => {
      const list = byYear.get(y).slice().sort((a, b) => (b.w || 0) - (a.w || 0));
      const sum = showSummary && state.yearSummaries[y] ? `<p class="year-summary">${esc(state.yearSummaries[y])}</p>` : '';
      return `<section class="year-block"><h4 class="year-head">${esc(world.era.short)} ${y}년</h4>${sum}<ol class="chronicle">${list.map(entryHtml).join('')}</ol></section>`;
    }).join('');
  }

  // ---------- 패널: 세계 ----------
  function showWorld() {
    const { era } = world;
    const v = rules.eruption;
    const gap = state.year - state.lastEruption;
    const next = gap < v.maxGap ? `${era.short} ${state.lastEruption + Math.max(v.minGap, gap + 1)}~${state.lastEruption + v.maxGap}년` : '언제든';
    const tagline = world.tagline?.status === 'confirmed' ? `<p class="tagline">${esc(world.tagline.text)}</p>` : '';
    const revCount = Object.values(state.nations).filter((n) => n.type === 'revolution').length;
    const summary = state.yearSummaries[state.year];
    const notable = Object.values(state.persons).filter((p) => p.alive && (!p.hidden || admin) &&
      (p.role === 'hero' || p.role === 'founder' || p.role === 'prophet' || (p.role === 'champion' && p.grade >= 5))).slice(0, 8);
    const legendM = state.legend ? state.monsters.find((m) => m.id === state.legend.monsterId) : null;
    const recent = state.log.filter((l) => visible(l) && l.year >= state.year - 1);

    panel.innerHTML = `
      <h1 class="world-name">${esc(world.name)}</h1>
      <p class="world-orig">${esc(world.nameOriginal)}</p>
      ${tagline}
      ${summary ? `<div class="year-card"><span class="year-card-label">${esc(era.short)} ${state.year}년의 리벤</span><p>${esc(summary)}</p></div>` : ''}
      <dl class="facts world-facts">
        <dt>마지막 분화</dt><dd>${esc(era.short)} ${state.lastEruption}년</dd>
        <dt>다음 분화 예상</dt><dd>${esc(next)}</dd>
        <dt>국가</dt><dd>${Object.keys(state.nations).length}개${revCount ? `, 그중 혁명 정부 ${revCount}개` : ''}</dd>
        <dt>진행 중인 전쟁</dt><dd>${state.wars.length ? state.wars.map((w) => esc(`${J(nationById[w.a].name, '과', '와')} ${nationById[w.b].name}`)).join(', ') : '없음'}</dd>
        <dt>개척지</dt><dd>${Object.keys(state.colonies).length}곳</dd>
        <dt>연금술</dt><dd>${state.alchemyRevealed ? '세상에 드러났다' : '아직 아무도 모른다'}</dd>
        ${admin ? `<dt>연금술 재료</dt><dd>${fmt(state.alchemyStock)} / 100</dd>` : ''}
      </dl>
      ${legendM ? `<div class="alert-card"><strong>${esc(J(legendM.name, '이', '가'))}</strong> ${esc(J(nationById[state.legend.nation].name, '을', '를'))} 위협하고 있다. 맹약력 ${state.legend.since}년부터.</div>` : ''}
      ${notable.length ? `<h3 class="section-title">주목할 인물</h3><ul class="people-list">${notable.map((p) =>
        `<li><button type="button" class="plink" data-person="${p.id}">${esc(p.name)}</button><span>${esc(p.role === 'champion' ? gradeLabel(p, grades) : ROLE_TEXT[p.role])}, ${esc(nationById[p.nation].name)}</span></li>`).join('')}</ul>` : ''}
      <h3 class="section-title">최근 연대기</h3>
      ${recent.length ? chronicleHtml(recent, { years: 2, showSummary: false }) : '<p class="hint">아직 기록이 없습니다. 다음 해를 눌러 시간을 흘려 보세요.</p>'}
      <div class="btn-row"><button type="button" class="btn" data-act="chronicle">연대기 전체</button></div>
      ${mode === 'game' ? '' : '<div class="btn-row"><button type="button" class="btn btn-primary" data-act="enterGame">인물로 들어가기</button></div>'}
      <h3 class="section-title">세계 관리</h3>
      <div class="btn-row">
        <button type="button" class="btn" data-act="save">지금 상태 저장</button>
        <button type="button" class="btn" data-act="load">저장한 상태 불러오기</button>
        <button type="button" class="btn" data-act="reset">처음부터 다시</button>
      </div>
      <label class="admin-toggle"><input type="checkbox" ${admin ? 'checked' : ''} data-act="admin">숨은 정보 보기 (혁명 준비도, 무명회, 론 호수)</label>
      <p class="seed">시드 ${state.seed}. 주소 끝에 ?seed=${state.seed} 를 붙이면 같은 세계를 다시 볼 수 있습니다.</p>
      <p class="pending">종족, 국가, 가문, 사건, 시뮬레이션 수치는 모두 초안입니다.</p>
    `;
    panel.querySelector('[data-act="chronicle"]').addEventListener('click', () => { view = { type: 'chronicle' }; render(); });
    panel.querySelector('[data-act="enterGame"]')?.addEventListener('click', () => { stop(); game_enter(); });
    panel.querySelector('[data-act="save"]').addEventListener('click', (e) => {
      try { localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(state)); e.target.textContent = `${era.short} ${state.year}년 저장됨`; }
      catch { e.target.textContent = '저장하지 못했습니다'; }
    });
    panel.querySelector('[data-act="load"]').addEventListener('click', (e) => {
      try {
        const raw = localStorage.getItem(SNAPSHOT_KEY);
        if (!raw) { e.target.textContent = '저장한 상태가 없습니다'; return; }
        stop(); state = JSON.parse(raw); view = { type: 'world' }; render();
      } catch { e.target.textContent = '불러오지 못했습니다'; }
    });
    panel.querySelector('[data-act="reset"]').addEventListener('click', () => { stop(); newWorld(newSeed()); view = { type: 'world' }; render(); });
    panel.querySelector('[data-act="admin"]').addEventListener('change', (e) => { admin = e.target.checked; render(); });
  }

  function showChronicle() {
    const entries = state.log.filter((l) => visible(l) && (filter === '전체' || catOfEntry(l) === filter || (filter === '이야기' && l.thread)));
    const totalYears = new Set(entries.map((l) => l.year)).size;
    panel.innerHTML = `
      <button class="btn" type="button" data-act="back">세계 개요로</button>
      <h2 class="region-name">연대기</h2>
      <div class="filters" role="group" aria-label="분류">${FILTERS.map((f) =>
        `<button type="button" class="chip${f === filter ? ' is-on' : ''}" data-filter="${f}">${f}</button>`).join('')}</div>
      ${entries.length ? chronicleHtml(entries, { years: chronicleYears, showSummary: filter === '전체' }) : '<p class="hint">이 분류에 해당하는 기록이 아직 없습니다.</p>'}
      ${totalYears > chronicleYears ? '<div class="btn-row"><button type="button" class="btn" data-act="more">더 오래된 기록 보기</button></div>' : ''}`;
    panel.querySelector('[data-act="back"]').addEventListener('click', () => { view = { type: 'world' }; render(); });
    panel.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => { filter = b.dataset.filter; chronicleYears = 40; render(); }));
    panel.querySelector('[data-act="more"]')?.addEventListener('click', () => { chronicleYears += 40; render(); });
  }

  // ---------- 패널: 지역과 나라 ----------
  function regionFacts(r) {
    return `${row('기후', r.climate)}${row('지형', r.terrain)}${row('넉넉한 것', r.abundant)}${row('부족한 것', r.scarce)}${row('위험', r.hazards)}`;
  }
  const personLink = (p) => `<button type="button" class="plink" data-person="${p.id}">${esc(p.name)}</button>`;

  function showRegion(r) {
    const nDef = nationByRegion[r.id];
    const here = state.monsters.filter((m) => m.regionId === r.id);
    const monsterRow = here.length ? row('출몰 마물', here.map((m) => `${m.name}(${m.legend ? '전설급' : tierOf[m.tier].name})`)) : '';
    if (!nDef) {
      const owner = state.colonies[r.id];
      const known = state.known[r.id] !== false;
      const title = r.kind === 'island_unexplored' ? (known || admin ? islandName(r.id) : '이름 없는 섬') : r.name;
      const typeText = r.kind === 'volcano' ? '아무도 살 수 없는 땅'
        : owner ? `${nationById[owner].name}의 개척지`
        : known ? '미개척 섬. 존재는 알려졌지만 아직 아무도 정착하지 못했다' : '미개척 섬. 세계에 아직 알려지지 않았다';
      panel.innerHTML = `
        <button class="btn" type="button" data-act="back">세계 개요로</button>
        <h2 class="region-name">${esc(title)}</h2>
        <p class="region-type">${owner ? `<span class="swatch" style="background:${TYPE_COLOR[state.nations[owner].type]}"></span>` : ''}${esc(typeText)}</p>
        <dl class="facts">${regionFacts(r)}${monsterRow}</dl>
        ${r.notes?.length ? `<ul class="notes">${r.notes.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}`;
    } else {
      showNation(nDef, r, monsterRow);
    }
    panel.querySelector('[data-act="back"]').addEventListener('click', () => { view = { type: 'world' }; render(); });
  }

  function showNation(nDef, r, monsterRow) {
    const n = state.nations[nDef.id];
    const raceText = Object.entries(nDef.races).map(([rid, p]) => `${data.races[rid].name} ${p}%`).join(', ');
    const isIsland = n.type === 'mercenary';
    const ruler = state.persons[state.rulers[nDef.id]];
    const gRows = [0, 1, 2, 3, 4].map((g) => {
      const m = isIsland ? n.dispatched.mage[g] : n.mages[g];
      const a = isIsland ? n.dispatched.aura[g] : n.aura[g];
      return `<tr><th>${grades.mage.levels[g]} / ${grades.aura.levels[g]}</th><td>${m >= 0.5 ? fmt(m) : '–'}</td><td>${a >= 0.5 ? fmt(a) : '–'}</td></tr>`;
    }).join('');
    const others = Object.keys(state.nations).filter((id) => id !== nDef.id).map((id) => {
      const k = nDef.id < id ? `${nDef.id}|${id}` : `${id}|${nDef.id}`;
      return { id, v: state.relations[k] };
    }).sort((a, b) => b.v - a.v);
    const wars = state.wars.filter((w) => w.a === nDef.id || w.b === nDef.id).map((w) => nationById[w.a === nDef.id ? w.b : w.a].name);
    const allies = state.alliances.filter((al) => al.a === nDef.id || al.b === nDef.id).map((al) => nationById[al.a === nDef.id ? al.b : al.a].name);
    const patrons = state.patrons.filter((p) => p.island === nDef.id);
    const hs = Object.values(state.houses).filter((h) => h.nation === nDef.id);
    const champs = Object.values(state.persons).filter((p) => p.alive && p.nation === nDef.id && ['champion', 'hero', 'dispatched'].includes(p.role) && (!p.hidden || admin))
      .sort((a, b) => b.grade - a.grade);
    const stationed = Object.values(state.persons).filter((p) => p.alive && p.stationedAt === nDef.id);
    const occupied = Object.entries(n.occupied || {}).filter(([, v]) => v >= 0.5).map(([k, v]) =>
      `${k.startsWith('house:') ? `${state.houses[k.slice(6)].name} 가문(독립)` : nationById[k].name} ${fmt(v)}`);
    const colonies = Object.entries(state.colonies).filter(([, o]) => o === nDef.id).map(([rid]) => islandName(rid));
    const nationLog = state.log.filter((l) => visible(l) && l.ids?.includes(nDef.id)).slice(-8);

    panel.innerHTML = `
      <button class="btn" type="button" data-act="back">세계 개요로</button>
      <h2 class="region-name">${esc(nDef.name)} <span class="orig">${esc(nDef.nameOriginal)}</span></h2>
      <p class="region-type"><span class="swatch" style="background:${TYPE_COLOR[n.type]}"></span>${esc(TYPE_TEXT[n.type])}${n.type !== nDef.type ? ` (원래 ${esc(TYPE_TEXT[nDef.type])})` : ''}</p>
      <p class="polity">${n.type === 'revolution' ? '가문 체제가 무너지고 무명회가 나라를 다스린다. ' : ''}${esc(nDef.polity)}</p>
      ${ruler ? `<div class="ruler-card"><span class="ruler-title">${esc(ruler.title)}</span>${personLink(ruler)}<span class="muted">${ruler.age}세, ${ruler.traits.map((t) => traitName[t]).join('·')}</span></div>` : ''}
      <dl class="facts">
        ${row('수도', nDef.capital)}
        ${row('종족', raceText)}
        <dt>인구</dt><dd>${fmt(n.pop)}만 명</dd>
        <dt>영토</dt><dd>${fmt(n.territory)} <span class="muted">(처음 100)</span></dd>
        ${row('빼앗긴 땅', occupied)}
        ${row('개척지', colonies)}
        <dt>안정도</dt><dd><span class="meter"><span style="width:${n.stability}%"></span></span>${fmt(n.stability)}</dd>
        <dt>국고</dt><dd>${fmt(n.treasury)}</dd>
        <dt>식량 자급</dt><dd>${fmt(n.food * 100)}%${n.famine ? ' <span class="alert">기근</span>' : ''}</dd>
        <dt>국력</dt><dd>${fmt(nationPower(n, data))}</dd>
        ${row('전쟁 중', wars)}
        ${row('동맹', allies)}
        ${admin ? `<dt>혁명 준비도</dt><dd>${fmt(n.revolutionPrep)} / ${rules.revolution.threshold}</dd>` : ''}
        ${monsterRow}
      </dl>
      ${hs.length ? `<h3 class="section-title">대가문</h3><ul class="house-list">${hs.map((h) => {
        const head = state.persons[h.head];
        const spec = h.type === 'magic' ? `${elementOf[h.specialty]?.name ?? ''} 마법` : '오러';
        const status = h.exiled ? '망명' : h.seceded ? '독립' : h.ruling ? '지배 가문' : '';
        return `<li><div class="house-top"><strong>${esc(h.name)}</strong><span class="muted">${esc(spec)}${status ? `, ${status}` : ''}</span></div>
          <div class="house-motto">“${esc(h.motto)}” · ${esc(h.seat)}</div>
          <div class="house-meta">수장 ${head ? personLink(head) : '–'}</div>
          <div class="house-bars"><span>세력</span><span class="meter"><span style="width:${h.influence}%"></span></span><span>충성</span><span class="meter loyal"><span style="width:${h.loyalty}%"></span></span></div></li>`;
      }).join('')}</ul>` : ''}
      ${champs.length || stationed.length ? `<h3 class="section-title">이름난 강자</h3><ul class="people-list">${[...champs, ...stationed].map((p) =>
        `<li>${personLink(p)}<span>${esc(p.role === 'hero' ? `${p.grade}등급 양방향 각성자` : gradeLabel(p, grades))}${p.stationedAt ? `, ${esc(nationById[p.stationedAt].name)} 파견` : ''}</span></li>`).join('')}</ul>` : ''}
      <h3 class="section-title">${isIsland ? '파견받은 강자 수' : '재능자'}</h3>
      <table class="grades"><thead><tr><th></th><th>마법사</th><th>오러 기사</th></tr></thead><tbody>${gRows}</tbody></table>
      ${patrons.length ? `<ul class="notes">${patrons.map((p) => `<li>${esc(p.house ? `${nationById[p.patron].name}의 ${state.houses[p.house]?.name} 가문이` : J(nationById[p.patron].name, '이', '가'))} 강자를 파견하고 있다.</li>`).join('')}</ul>` : ''}
      <h3 class="section-title">관계</h3>
      <ul class="relations">${others.map((o) =>
        `<li><button type="button" class="nlink" data-nation="${o.id}">${esc(nationById[o.id].name)}</button><span class="rel-stage">${esc(relationStage(o.v, relations.stages))}</span><span class="rel-value">${o.v > 0 ? '+' : ''}${fmt(o.v)}</span></li>`).join('')}</ul>
      ${nationLog.length ? `<h3 class="section-title">최근 기록</h3>${chronicleHtml(nationLog, { years: 6, showSummary: false })}` : ''}
      <h3 class="section-title">땅</h3>
      <dl class="facts">${regionFacts(r)}</dl>
      <ul class="notes"><li>${esc(nDef.economy)}</li><li>${esc(nDef.diplomacy)}</li><li>${esc(nDef.history)}</li></ul>`;
  }

  // ---------- 패널: 인물 ----------
  function showPerson(p) {
    const house = p.house ? state.houses[p.house] : null;
    const spec = house?.type === 'magic' ? elementOf[house.specialty]?.name : null;
    const typeText = p.type === 'dual' ? `${p.grade}등급 양방향 각성자` : p.grade ? gradeLabel(p, grades) : '재능 없음';
    panel.innerHTML = `
      <button class="btn" type="button" data-act="back">세계 개요로</button>
      <h2 class="region-name">${esc(p.name)}</h2>
      <p class="region-type">${esc(p.title || ROLE_TEXT[p.role] || '')}${p.alive ? '' : ` (맹약력 ${p.died}년 사망)`}</p>
      <dl class="facts">
        <dt>나라</dt><dd><button type="button" class="nlink" data-nation="${p.nation}">${esc(nationById[p.nation].name)}</button></dd>
        ${house ? `<dt>가문</dt><dd>${esc(house.name)} 가문${spec ? ` (${esc(spec)})` : ''}</dd>` : ''}
        ${row('출신', p.origin)}
        ${row('직업', p.job)}
        ${row('종족', data.races[p.race].name)}
        <dt>나이</dt><dd>${p.age}세${p.alive ? '' : '에 세상을 떠남'}</dd>
        ${row('재능', typeText)}
        ${row('성격', p.traits.map((t) => traitName[t]))}
        ${row('소속', p.side)}
      </dl>
      ${house ? `<p class="house-motto">“${esc(house.motto)}”</p>` : ''}
      <h3 class="section-title">행적</h3>
      ${p.deeds.length ? `<ol class="deeds">${p.deeds.map((d) => `<li><span class="log-year">${esc(world.era.short)} ${d.year}년</span>${esc(d.text)}</li>`).join('')}</ol>` : '<p class="hint">아직 기록된 행적이 없습니다.</p>'}`;
    panel.querySelector('[data-act="back"]').addEventListener('click', () => { view = { type: 'world' }; render(); });
  }

  function showMonster(m) {
    const t = tierOf[m.tier];
    const owner = nationByRegion[m.regionId];
    panel.innerHTML = `
      <button class="btn" type="button" data-act="back">세계 개요로</button>
      <h2 class="region-name">${esc(m.name)}</h2>
      <p class="region-type"><span class="tier-badge" style="background:${t.color}"></span>${m.legend ? '전설급 마물' : `${esc(t.name)} 마물 (${m.tier}/5)`}</p>
      <dl class="facts">
        ${row('강함', m.legend ? '여러 나라의 강자가 함께 나서야 쓰러뜨릴 수 있다.' : t.desc)}
        ${row('본래 동물', m.base)}
        ${row('출몰 지역', owner?.name ?? islandName(m.regionId))}
      </dl>
      <ul class="notes">${m.traits.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>
      <p class="pending">대범람으로 변한 동물의 후손이다. 마물은 해마다 나타나고 사라진다.</p>`;
    panel.querySelector('[data-act="back"]').addEventListener('click', () => { view = { type: 'world' }; render(); });
  }

  // 패널 안의 인물·나라 링크
  panel.addEventListener('click', (e) => {
    const pl = e.target.closest('[data-person]');
    if (pl) { view = { type: 'person', id: pl.dataset.person }; render(); panel.scrollTop = 0; return; }
    const nl = e.target.closest('[data-nation]');
    if (nl) { view = { type: 'region', id: nationById[nl.dataset.nation].regionId }; render(); panel.scrollTop = 0; }
  });

  let lastViewKey = '';
  function render() {
    if (!mode) { renderSimbar(); drawOverlay(); game.showIntro(); return; }
    if (mode === 'game' && !state.player) { renderSimbar(); drawOverlay(); game.showCreate(); return; }
    if (mode === 'game' && view.type === 'game') { renderSimbar(); drawOverlay(); map.setSelected(null); game.showGame(); lastViewKey = 'game'; return; }
    renderSimbar();
    drawOverlay();
    map.setSelected(view.type === 'region' || view.type === 'monster' ? view.id : null);
    const key = `${view.type}:${view.id ?? ''}`;
    const keepScroll = key === lastViewKey ? panel.scrollTop : 0;
    if (view.type === 'region' && regionById[view.id]) showRegion(regionById[view.id]);
    else if (view.type === 'monster') showMonster(state.monsters.find((m) => m.id === view.id));
    else if (view.type === 'person' && state.persons[view.id]) showPerson(state.persons[view.id]);
    else if (view.type === 'chronicle') showChronicle();
    else { view = { type: 'world' }; showWorld(); }
    panel.scrollTop = keepScroll;
    lastViewKey = key;
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { view = { type: mode === 'game' && state.player ? 'game' : 'world' }; render(); }
  });

  // ---------- 인물 모드 ----------
  let mode = null;
  const game_enter = () => { mode = 'game'; try { localStorage.setItem(MODE_KEY, 'game'); } catch { /* */ } view = { type: 'game' }; render(); };
  try { mode = localStorage.getItem(MODE_KEY); } catch { mode = null; }
  const saveGame = () => { try { localStorage.setItem(GAME_KEY, JSON.stringify(state)); return true; } catch { return false; } };
  const game = createGame({
    panel, data,
    getState: () => state,
    places: () => map.places,
    typeText: (t) => TYPE_TEXT[t],
    hooks: { ...hooks, worldStep: () => step(state, data, hooks) },
    setMode(m) {
      mode = m;
      try { m ? localStorage.setItem(MODE_KEY, m) : localStorage.removeItem(MODE_KEY); } catch { /* 저장 불가 환경 */ }
      view = { type: m === 'game' ? 'game' : 'world' };
      if (m !== 'game') render();
    },
    focusPlayer() {
      const p = state.player;
      const here = map.places.find((x) => x.id === p?.place);
      if (here) map.focus(here.x, here.y, 520);
      view = { type: 'game' };
    },
    render: () => render(),
    afterTurn() { saveGame(); view = { type: 'game' }; render(); },
    showWorld() { view = { type: 'world' }; render(); },
    save: saveGame,
  });

  let saved = null;
  if (mode === 'game') { try { saved = JSON.parse(localStorage.getItem(GAME_KEY) || 'null'); } catch { saved = null; } }
  if (saved?.player) { state = saved; view = { type: 'game' }; }
  else newWorld(initialSeed());
  if (mode === 'game') view = { type: 'game' };
  renderLegend();
  render();
  if (mode === 'game' && state.player) game.showGame();
}

init();
