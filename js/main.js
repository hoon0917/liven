import { renderMap, TYPE_LABEL } from './map.js';
import { generateMonsters, drawMonsters, makeRng, randomPoint } from './monsters.js';
import { createState, step, nationPower, relationStage, J } from './sim.js';

const panel = document.getElementById('panel');
const simbar = document.getElementById('simbar');
const legend = document.getElementById('legend');
const svg = document.getElementById('map');
const SNAPSHOT_KEY = 'liven-snapshot';
const SPEEDS = [{ label: '1배', ms: 1200 }, { label: '2배', ms: 600 }, { label: '4배', ms: 250 }];

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (v) => Math.round(v).toLocaleString('ko-KR');

const TYPE_TEXT = { ...TYPE_LABEL, revolution: '혁명 정부' };
const TYPE_COLOR = {
  knight: 'var(--knight)', magic: 'var(--magic)', coexist: 'var(--coexist)',
  mercenary: 'var(--mercenary)', none: 'var(--volcano)', revolution: 'var(--revolution)',
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

function row(label, value) {
  if (value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)) return '';
  const v = Array.isArray(value) ? value.join(', ') : value;
  return `<dt>${label}</dt><dd>${esc(v)}</dd>`;
}

async function init() {
  let files;
  try {
    files = await Promise.all([
      'world', 'regions', 'monsters', 'races', 'grades', 'nations', 'relations', 'sim-rules', 'state-initial',
    ].map((f) => loadJSON(`data/${f}.json`)));
  } catch (err) {
    console.error(err);
    panel.innerHTML = `
      <h1 class="world-name">리벤</h1>
      <p class="error">데이터를 불러오지 못했습니다. index.html을 VS Code의 Live Server로 열었는지, data 폴더에 JSON 파일 9개가 모두 있는지 확인하세요.<br><small>${esc(err.message)}</small></p>`;
    return;
  }
  const [world, regionData, monsterCfg, races, grades, nations, relations, rules, stateInitial] = files;

  const regions = regionData.regions;
  const regionById = Object.fromEntries(regions.map((r) => [r.id, r]));
  const nationById = Object.fromEntries(nations.nations.map((n) => [n.id, n]));
  const nationByRegion = Object.fromEntries(nations.nations.map((n) => [n.regionId, n]));
  const tierOf = Object.fromEntries(monsterCfg.tiers.map((t) => [t.level, t]));
  const data = {
    rules, grades, relations, stateInitial,
    races: Object.fromEntries(races.races.map((r) => [r.id, r])),
    nationById, neighbors: nations.neighbors, patrons: nations.patrons,
  };

  // ---------- 지도 ----------
  const labels = {};
  for (const n of nations.nations) labels[n.regionId] = { main: n.name, sub: TYPE_TEXT[n.type] };
  let state;
  let view = { type: 'world' };
  let admin = false;
  let showMonsters = true;
  let timer = null;
  let speed = 0;

  const select = (id) => {
    if (state.monsters.some((m) => m.id === id)) view = { type: 'monster', id };
    else view = { type: 'region', id };
    render();
  };
  const map = renderMap(svg, regionData, select, labels);
  const labelZones = Object.entries(map.anchors)
    .filter(([id]) => labels[id] || id.startsWith('region_central'))
    .map(([, [x, y]]) => ({ x, y: y + 8, rx: 48, ry: 24 }));
  const pickable = regions.filter((r) => r.id !== 'continent_central' && map.polys[r.id]);

  const hooks = {
    pickRegion(rng) {
      const r = pickable[Math.floor(rng() * pickable.length)];
      const p = randomPoint(rng, map.polys[r.id]) || [r.map.cx, r.map.cy];
      return { regionId: r.id, regionName: nationByRegion[r.id]?.name ?? r.name, x: p[0], y: p[1] };
    },
    respawnMonsters(s, rng, fraction) {
      const keep = s.monsters.filter(() => rng() > fraction);
      const fresh = generateMonsters(monsterCfg, regionById, map.polys, Math.floor(rng() * 1e9), labelZones);
      const out = [...keep];
      fresh.forEach((m, i) => { if (out.length < fresh.length) out.push({ ...m, id: `m${s.year}_${i}` }); });
      s.monsters = out;
    },
  };

  function newWorld(seed) {
    state = createState(data, seed);
    hooks.respawnMonsters(state, makeRng(seed + 7), 1);
  }

  // ---------- 지도 위 시뮬레이션 표시 ----------
  const NS = 'http://www.w3.org/2000/svg';
  function drawOverlay() {
    // 국가 유형 색 (혁명이 성공하면 바뀐다)
    for (const [id, n] of Object.entries(state.nations)) {
      const regionId = nationById[id].regionId;
      svg.querySelectorAll(`[data-id="${regionId}"]`).forEach((elm) => {
        [...elm.classList].filter((c) => c.startsWith('t-')).forEach((c) => elm.classList.remove(c));
        elm.classList.add(`t-${n.type}`);
        elm.classList.toggle('at-war', state.wars.some((w) => w.a === id || w.b === id));
      });
    }
    for (const [id, n] of Object.entries(state.nations)) {
      const sub = svg.querySelector(`[data-label-sub="${nationById[id].regionId}"]`);
      if (sub) sub.textContent = TYPE_TEXT[n.type];
    }
    svg.querySelector('#overlay')?.remove();
    const g = document.createElementNS(NS, 'g');
    g.id = 'overlay';
    g.setAttribute('class', 'decor');
    for (const w of state.wars) {
      const [x1, y1] = map.anchors[nationById[w.a].regionId];
      const [x2, y2] = map.anchors[nationById[w.b].regionId];
      const line = document.createElementNS(NS, 'path');
      const mx = (x1 + x2) / 2 + (y2 - y1) * 0.15, my = (y1 + y2) / 2 - (x2 - x1) * 0.15;
      line.setAttribute('d', `M${x1} ${y1}Q${mx} ${my} ${x2} ${y2}`);
      line.setAttribute('class', 'war-line');
      g.appendChild(line);
    }
    for (const m of state.meteors) {
      const star = document.createElementNS(NS, 'path');
      const { x, y } = m, r = 9;
      star.setAttribute('d', `M${x} ${y - r}L${x + 2.5} ${y - 2.5}L${x + r} ${y}L${x + 2.5} ${y + 2.5}L${x} ${y + r}L${x - 2.5} ${y + 2.5}L${x - r} ${y}L${x - 2.5} ${y - 2.5}Z`);
      star.setAttribute('class', 'meteor');
      g.appendChild(star);
    }
    svg.insertBefore(g, svg.querySelector('rect[filter]'));
    const vol = svg.querySelector('[data-id="region_volcano"]');
    vol.classList.remove('erupting');
    if (state.flash === 'eruption') { void vol.getBoundingClientRect(); vol.classList.add('erupting'); }

    const mg = drawMonsters(svg, state.monsters, monsterCfg, select);
    mg.classList.toggle('is-hidden', !showMonsters);
  }

  // ---------- 범례 ----------
  function renderLegend() {
    const items = [
      ['', 'var(--knight)', '기사국가'], ['', 'var(--magic)', '마법국가'], ['', 'var(--coexist)', '공존국가'],
      ['', 'var(--mercenary)', '섬나라'], ['', 'var(--revolution)', '혁명 정부'], ['', 'var(--harsh)', '미개척 섬'],
      ['dashed', '', '알려지지 않은 섬'], ['hatched', '', '화산 무주지'], ['war', '', '전쟁 중'],
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

  // ---------- 패널 ----------
  const visibleLog = () => state.log.filter((l) => admin || !l.hidden);
  function logList(entries) {
    return `<ol class="chronicle">${entries.map((l) =>
      `<li class="log-${l.kind}${l.hidden ? ' log-hidden' : ''}"><span class="log-year">${esc(world.era.short)} ${l.year}년</span>${esc(l.text)}</li>`).join('')}</ol>`;
  }

  function showWorld() {
    const { era } = world;
    const v = rules.eruption;
    const gap = state.year - state.lastEruption;
    const next = gap < v.maxGap
      ? `${era.short} ${state.lastEruption + Math.max(v.minGap, gap + 1)}~${state.lastEruption + v.maxGap}년`
      : '언제든';
    const tagline = world.tagline?.status === 'confirmed' ? `<p class="tagline">${esc(world.tagline.text)}</p>` : '';
    const revCount = Object.values(state.nations).filter((n) => n.type === 'revolution').length;
    const recent = visibleLog().slice(-8).reverse();

    panel.innerHTML = `
      <h1 class="world-name">${esc(world.name)}</h1>
      <p class="world-orig">${esc(world.nameOriginal)}</p>
      ${tagline}
      <dl class="facts world-facts">
        <dt>마지막 분화</dt><dd>${esc(era.short)} ${state.lastEruption}년</dd>
        <dt>다음 분화 예상</dt><dd>${esc(next)}</dd>
        <dt>국가</dt><dd>${Object.keys(state.nations).length}개${revCount ? `, 그중 혁명 정부 ${revCount}개` : ''}</dd>
        <dt>진행 중인 전쟁</dt><dd>${state.wars.length ? state.wars.map((w) => `${J(nationById[w.a].name, '과', '와')} ${nationById[w.b].name}`).join(', ') : '없음'}</dd>
        <dt>지도 위 마물</dt><dd>${state.monsters.length}무리</dd>
        <dt>연금술</dt><dd>${state.alchemyRevealed ? '세상에 드러났다' : '아직 아무도 모른다'}</dd>
        ${admin ? `<dt>연금술 재료</dt><dd>${fmt(state.alchemyStock)} / 100</dd>` : ''}
      </dl>
      <h3 class="section-title">최근 연대기</h3>
      ${recent.length ? logList(recent) : '<p class="hint">아직 기록이 없습니다. 다음 해를 눌러 시간을 흘려 보세요.</p>'}
      <div class="btn-row">
        <button type="button" class="btn" data-act="chronicle">연대기 전체</button>
      </div>
      <h3 class="section-title">세계 관리</h3>
      <div class="btn-row">
        <button type="button" class="btn" data-act="save">지금 상태 저장</button>
        <button type="button" class="btn" data-act="load">저장한 상태 불러오기</button>
        <button type="button" class="btn" data-act="reset">처음부터 다시</button>
      </div>
      <label class="admin-toggle"><input type="checkbox" ${admin ? 'checked' : ''} data-act="admin">숨은 정보 보기 (혁명 준비도, 론 호수)</label>
      <p class="seed">시드 ${state.seed}. 주소 끝에 ?seed=${state.seed} 를 붙이면 같은 세계를 다시 볼 수 있습니다.</p>
      <p class="pending">종족, 국가, 관계, 시뮬레이션 수치는 모두 초안입니다.</p>
    `;
    panel.querySelector('[data-act="chronicle"]').addEventListener('click', () => { view = { type: 'chronicle' }; render(); });
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
    panel.innerHTML = `
      <button class="btn" type="button" data-act="back">세계 개요로</button>
      <h2 class="region-name">연대기</h2>
      ${logList(visibleLog().slice().reverse())}`;
    panel.querySelector('[data-act="back"]').addEventListener('click', () => { view = { type: 'world' }; render(); });
  }

  function regionFacts(r) {
    return `
      ${row('기후', r.climate)}
      ${row('지형', r.terrain)}
      ${row('넉넉한 것', r.abundant)}
      ${row('부족한 것', r.scarce)}
      ${row('위험', r.hazards)}`;
  }

  function showRegion(r) {
    const nDef = nationByRegion[r.id];
    const here = state.monsters.filter((m) => m.regionId === r.id);
    const monsterRow = here.length ? row('출몰 마물', here.map((m) => `${m.name}(${tierOf[m.tier].name})`)) : '';
    if (!nDef) {
      const typeText = r.kind === 'volcano' ? '아무도 살 수 없는 땅'
        : r.known === false ? '미개척 섬. 세계에 아직 알려지지 않았다' : '미개척 섬. 존재는 알려졌지만 접근이 어렵다';
      panel.innerHTML = `
        <button class="btn" type="button" data-act="back">세계 개요로</button>
        <h2 class="region-name">${esc(r.name)}</h2>
        <p class="region-type">${esc(typeText)}</p>
        <dl class="facts">${regionFacts(r)}${monsterRow}</dl>
        ${r.notes?.length ? `<ul class="notes">${r.notes.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}`;
    } else {
      const n = state.nations[nDef.id];
      const raceText = Object.entries(nDef.races).map(([rid, p]) => `${data.races[rid].name} ${p}%`).join(', ');
      const isIsland = n.type === 'mercenary';
      const gRows = [0, 1, 2, 3, 4].map((g) => {
        const m = isIsland ? n.dispatched.mage[g] : n.mages[g];
        const a = isIsland ? n.dispatched.aura[g] : n.aura[g];
        return `<tr><th>${g + 1}등급</th><td>${m >= 0.5 ? fmt(m) : '–'}</td><td>${a >= 0.5 ? fmt(a) : '–'}</td></tr>`;
      }).join('');
      const others = Object.keys(state.nations).filter((id) => id !== nDef.id).map((id) => {
        const k = nDef.id < id ? `${nDef.id}|${id}` : `${id}|${nDef.id}`;
        return { id, v: state.relations[k] };
      }).sort((a, b) => b.v - a.v);
      const wars = state.wars.filter((w) => w.a === nDef.id || w.b === nDef.id).map((w) => nationById[w.a === nDef.id ? w.b : w.a].name);
      const allies = state.alliances.filter((al) => al.a === nDef.id || al.b === nDef.id).map((al) => nationById[al.a === nDef.id ? al.b : al.a].name);
      const patrons = data.patrons.filter((p) => p.island === nDef.id).map((p) => p.desc);
      const nationLog = visibleLog().filter((l) => l.ids?.includes(nDef.id)).slice(-5).reverse();

      panel.innerHTML = `
        <button class="btn" type="button" data-act="back">세계 개요로</button>
        <h2 class="region-name">${esc(nDef.name)}</h2>
        <p class="region-type"><span class="swatch" style="background:${TYPE_COLOR[n.type]}"></span>${esc(TYPE_TEXT[n.type])}${n.type !== nDef.type ? ` (원래 ${esc(TYPE_TEXT[nDef.type])})` : ''}</p>
        <p class="polity">${n.type === 'revolution' ? '가문 체제가 무너지고 혁명 세력이 나라를 다스린다. ' : ''}${esc(nDef.polity)}</p>
        <dl class="facts">
          ${row('수도', nDef.capital)}
          ${row('종족', raceText)}
          <dt>인구</dt><dd>${fmt(n.pop)}만 명</dd>
          <dt>영토</dt><dd>${fmt(n.territory)} <span class="muted">(처음 100)</span></dd>
          <dt>안정도</dt><dd><span class="meter"><span style="width:${n.stability}%"></span></span>${fmt(n.stability)}</dd>
          <dt>국고</dt><dd>${fmt(n.treasury)}</dd>
          <dt>식량 자급</dt><dd>${fmt(n.food * 100)}%${n.famine ? ' <span class="alert">기근</span>' : ''}</dd>
          <dt>국력</dt><dd>${fmt(nationPower(n, data))}</dd>
          ${row('전쟁 중', wars)}
          ${row('동맹', allies)}
          ${admin ? `<dt>혁명 준비도</dt><dd>${fmt(n.revolutionPrep)} / ${rules.revolution.threshold}</dd>` : ''}
          ${monsterRow}
        </dl>
        <h3 class="section-title">${isIsland ? '파견받은 강자' : '재능자'}</h3>
        <table class="grades"><thead><tr><th></th><th>마법사</th><th>오러 기사</th></tr></thead><tbody>${gRows}</tbody></table>
        ${patrons.length ? `<ul class="notes">${patrons.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
        <h3 class="section-title">관계</h3>
        <ul class="relations">${others.map((o) =>
          `<li><span>${esc(nationById[o.id].name)}</span><span class="rel-stage">${esc(relationStage(o.v, relations.stages))}</span><span class="rel-value">${o.v > 0 ? '+' : ''}${fmt(o.v)}</span></li>`).join('')}</ul>
        ${nationLog.length ? `<h3 class="section-title">최근 기록</h3>${logList(nationLog)}` : ''}
        <h3 class="section-title">땅</h3>
        <dl class="facts">${regionFacts(r)}</dl>
        <ul class="notes">
          <li>${esc(nDef.economy)}</li>
          <li>${esc(nDef.diplomacy)}</li>
          <li>${esc(nDef.history)}</li>
        </ul>`;
    }
    panel.querySelector('[data-act="back"]').addEventListener('click', () => { view = { type: 'world' }; render(); });
  }

  function showMonster(m) {
    const t = tierOf[m.tier];
    const owner = nationByRegion[m.regionId];
    panel.innerHTML = `
      <button class="btn" type="button" data-act="back">세계 개요로</button>
      <h2 class="region-name">${esc(m.name)}</h2>
      <p class="region-type"><span class="tier-badge" style="background:${t.color}"></span>${esc(t.name)} 마물 (${m.tier}/5)</p>
      <dl class="facts">
        ${row('강함', t.desc)}
        ${row('본래 동물', m.base)}
        ${row('출몰 지역', owner?.name ?? regionById[m.regionId].name)}
      </dl>
      <ul class="notes">${m.traits.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>
      <p class="pending">대범람으로 변한 동물의 후손이다. 마물은 해마다 나타나고 사라진다.</p>`;
    panel.querySelector('[data-act="back"]').addEventListener('click', () => { view = { type: 'world' }; render(); });
  }

  function render() {
    renderSimbar();
    drawOverlay();
    map.setSelected(view.type === 'region' || view.type === 'monster' ? view.id : null);
    if (view.type === 'region') showRegion(regionById[view.id]);
    else if (view.type === 'monster') showMonster(state.monsters.find((m) => m.id === view.id));
    else if (view.type === 'chronicle') showChronicle();
    else showWorld();
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { view = { type: 'world' }; render(); }
  });

  newWorld(initialSeed());
  renderLegend();
  render();
}

init();
