// 인물 모드 화면: 이번 주 · 소지품 · 장터 · 사람 · 기록
import { createPlayer, doAction, availableActions, resolveChoice, travelOptions, parseInput, seasonOf, context } from './player.js';
import { marketItems, priceAt, buy, sell, equip, useItem, itemOf, carry, canCraft, propose, setTaegyo, ambitionProgress, heirs, continueAsHeir, addItem } from './life.js';
import { makeRng } from './monsters.js';
import { J } from './text.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rng = makeRng(Math.floor(Math.random() * 1e9));
const TABS = [['week', '이번 주'], ['bag', '소지품'], ['market', '장터'], ['people', '사람'], ['record', '기록']];

export function createGame(api) {
  const { panel, data } = api;
  let last = null;
  let parsed = null;
  let tab = 'week';
  let note = '';
  const S = () => api.getState();
  const P = data.player;

  function showIntro() {
    panel.innerHTML = `
      <h1 class="world-name">리벤</h1>
      <p class="world-orig">Liven</p>
      <p class="intro-lead">재능이 지배하는 결핍의 세계. 어떻게 들어가시겠습니까?</p>
      <div class="intro-choices">
        <button type="button" class="intro-card" data-act="enterWatch"><strong>세계를 지켜보기</strong><span>열세 나라와 가문들의 역사가 흘러가는 것을 위에서 내려다본다.</span></button>
        <button type="button" class="intro-card" data-act="enterPlay"><strong>인물로 들어가기</strong><span>한 사람으로 태어나 일주일씩 살아간다. 그릇이 잠들어 있는지는 아무도 모른다.</span></button>
      </div>`;
    panel.querySelector('[data-act="enterWatch"]').addEventListener('click', () => api.setMode('watch'));
    panel.querySelector('[data-act="enterPlay"]').addEventListener('click', () => { api.setMode('game'); showCreate(); });
  }

  // ---------- 인물 만들기 ----------
  function showCreate(pre = {}) {
    const st = S();
    const nations = data.nationsList;
    const nid = pre.nation || 'nation_kalis';
    const nDef = data.nationById[nid];
    const hasHouses = Object.values(st.houses).some((h) => h.nation === nid && !h.exiled);
    const origins = Object.entries(P.origins).filter(([k]) => (k !== 'islander' || nDef.type === 'mercenary') && (k !== 'noble' || hasHouses));
    const origin = origins.some(([k]) => k === pre.origin) ? pre.origin : origins[0][0];
    const races = Object.entries(nDef.races).sort((a, b) => b[1] - a[1]);
    const race = races.some(([r]) => r === pre.race) ? pre.race : races[0][0];
    const houses = Object.values(st.houses).filter((h) => h.nation === nid && !h.exiled);
    const amb = pre.ambition || P.ambitions[0].id;
    panel.innerHTML = `
      <h2 class="region-name">인물 만들기</h2>
      <p class="hint">맹약력 ${st.year}년의 세계로 들어갑니다. 그릇의 크기와 방향은 운에 따라 정해지고, 평민이라면 본인도 알 수 없습니다.</p>
      <div class="form">
        <label>이름<input type="text" id="pcName" maxlength="12" value="${esc(pre.name || '')}" placeholder="예: 지훈"></label>
        <label>나라<select id="pcNation">${nations.map((n) => `<option value="${n.id}" ${n.id === nid ? 'selected' : ''}>${esc(n.name)} (${esc(api.typeText(st.nations[n.id].type))})</option>`).join('')}</select></label>
        <fieldset><legend>출신</legend>${origins.map(([k, o]) => `
          <label class="radio"><input type="radio" name="pcOrigin" value="${k}" ${k === origin ? 'checked' : ''}><span><strong>${esc(o.name)}</strong> ${esc(o.desc)}</span></label>`).join('')}</fieldset>
        <label>종족<select id="pcRace">${races.map(([r, pct]) => `<option value="${r}" ${r === race ? 'selected' : ''}>${esc(data.races[r].name)} (이 나라의 ${pct}%)</option>`).join('')}</select></label>
        ${origin === 'noble' ? `<label>가문<select id="pcHouse">${houses.map((h) => `<option value="${h.id}">${esc(h.name)} 가문 (${h.type === 'magic' ? '마법' : '오러'}, ${esc(h.seat)})</option>`).join('')}</select></label>` : ''}
        <label>야망<select id="pcAmbition">${P.ambitions.map((a) => `<option value="${a.id}" ${a.id === amb ? 'selected' : ''}>${esc(a.name)}: ${esc(a.desc)}</option>`).join('')}</select></label>
        <p class="race-note">${esc(data.races[race].ronTrait)}</p>
        <div class="btn-row">
          <button type="button" class="btn" data-act="random">운에 맡기기</button>
          <button type="button" class="btn btn-primary" data-act="start">이 인물로 시작</button>
        </div>
        <button type="button" class="linkish" data-act="back">시작 화면으로</button>
      </div>`;
    const read = () => ({
      name: panel.querySelector('#pcName').value.trim(), nation: panel.querySelector('#pcNation').value,
      origin: panel.querySelector('[name="pcOrigin"]:checked')?.value, race: panel.querySelector('#pcRace').value,
      house: panel.querySelector('#pcHouse')?.value, ambition: panel.querySelector('#pcAmbition').value,
    });
    panel.querySelector('#pcNation').addEventListener('change', () => showCreate({ ...read(), race: null }));
    panel.querySelectorAll('[name="pcOrigin"]').forEach((r) => r.addEventListener('change', () => showCreate(read())));
    panel.querySelector('#pcRace').addEventListener('change', () => showCreate(read()));
    panel.querySelector('[data-act="back"]').addEventListener('click', () => { api.setMode(null); showIntro(); });
    panel.querySelector('[data-act="random"]').addEventListener('click', () => {
      const n = nations[Math.floor(Math.random() * nations.length)];
      const pool = data.names.cultures[data.names.nationCulture[n.id]];
      showCreate({ nation: n.id, name: pool.a[Math.floor(Math.random() * pool.a.length)] + pool.b[Math.floor(Math.random() * pool.b.length)], origin: ['commoner', 'commoner', 'wanderer', 'noble', 'islander'][Math.floor(Math.random() * 5)], ambition: P.ambitions[Math.floor(Math.random() * P.ambitions.length)].id });
    });
    panel.querySelector('[data-act="start"]').addEventListener('click', () => {
      const o = read();
      if (!o.name) { panel.querySelector('#pcName').focus(); panel.querySelector('#pcName').classList.add('invalid'); return; }
      createPlayer(st, data, rng, api.places(), o);
      last = { texts: [] }; tab = 'week';
      api.focusPlayer();
      api.render();
    });
  }

  // ---------- 공통 머리 ----------
  const bar = (label, v, max, cls = '') => `<div class="stat-bar ${cls}"><span>${label}</span><span class="meter"><span style="width:${Math.max(0, Math.min(100, (v / max) * 100))}%"></span></span><span class="num">${Math.round(v)}</span></div>`;
  function vesselText(p) {
    if (p.awakened) {
      const label = p.vessel.dir === 'magic' ? `${p.grade}환 마법사` : p.vessel.dir === 'aura' ? `${p.grade}막 기사` : `${p.grade}등급 양방향 각성자`;
      return `${label} <span class="muted">(수련 ${Math.round(Math.min(100, (p.progress / (p.grade * 45)) * 100))}%)</span>`;
    }
    if (p.vessel.known) return '작은 그릇. 마법도 오러도 깨어나지 않는다.';
    return p.vessel.size >= 45 ? '알 수 없음. 가끔 이유 없이 예감이 맞는다.' : '알 수 없음';
  }
  function head(st, p, cx, places) {
    const season = seasonOf(data, st.week);
    const where = p.travel
      ? `${esc(places.find((x) => x.id === p.travel.from)?.name)}에서 ${esc(places.find((x) => x.id === p.travel.to)?.name)}로 가는 길 (${Math.floor(p.travel.done)}/${p.travel.weeks}주)`
      : `${esc(cx.place?.name)}, ${esc(data.nationById[cx.place?.nation]?.name)}`;
    const house = p.house ? st.houses[p.house] : null;
    const aff = p.affiliation === 'house' && house ? `${house.name} 가문 (호의 ${Math.round(p.houseFavor)})` : p.affiliation === 'nameless' ? '무명회 (비밀)' : p.affiliation === 'army' ? `${data.nationById[p.nation].name} 군대` : '없음';
    const fac = cx.ps?.facilities.map((f) => P.facilityNames[f]).join(', ');
    return `
      <div class="pc-head">
        <h2 class="region-name">${esc(p.name)}</h2>
        <p class="region-type">${esc(P.origins[p.origin].name)}, ${esc(data.races[p.race].name)}, ${p.age}세${p.parent ? `, ${esc(p.parent)}의 아이` : ''}</p>
        <p class="pc-where">${where}</p>
        <p class="pc-time">${esc(season.name)} · ${esc(p.weather)}${fac && !p.travel ? ` · ${esc(fac)}` : ''}</p>
      </div>
      <div class="pc-stats">
        ${bar('체력', p.hp, 100, p.hp < 30 ? 'danger' : '')}${bar('피로', p.fatigue, 100, p.fatigue > 70 ? 'danger' : '')}
        ${p.awakened ? bar('론', p.ron.cur, p.ron.max || 1, 'ron') : ''}
        <div class="pc-nums"><span>돈 <b>${Math.round(p.coins)}</b>냥</span><span>명성 <b>${Math.round(p.fame)}</b></span><span>악명 <b>${Math.round(p.notoriety)}</b></span></div>
        <div class="pc-skills">${Object.entries(P.statNames).map(([k, n]) => `<span>${esc(n)} <b>${Math.round(p.stats[k])}</b></span>`).join('')}</div>
        <dl class="facts pc-facts"><dt>그릇</dt><dd>${vesselText(p)}</dd><dt>소속</dt><dd>${esc(aff)}</dd>${p.nemesis ? `<dt>원수</dt><dd class="alert">${esc(p.nemesis.name)}</dd>` : ''}</dl>
      </div>
      <div class="tabs" role="tablist">${TABS.map(([k, n]) => `<button type="button" role="tab" class="tab ${tab === k ? 'is-on' : ''}" data-tab="${k}" aria-selected="${tab === k}">${n}</button>`).join('')}</div>
      ${note ? `<p class="note">${esc(note)}</p>` : ''}`;
  }

  // ---------- 이번 주 ----------
  function weekTab(st, p, cx, places) {
    if (p.encounter) {
      const def = P.encounters.find((e) => e.id === p.encounter.id);
      return `<div class="encounter"><p>${esc(p.encounter.text)}</p>
        <div class="choices">${def.choices.map((c, i) => `<button type="button" class="btn choice" data-choice="${i}">${esc(c.label)}${c.check ? ` <span class="muted">(${esc(P.statNames[c.check[0]])})</span>` : ''}${c.need?.coins ? ` <span class="muted">(${c.need.coins}냥)</span>` : ''}</button>`).join('')}</div></div>`;
    }
    const acts = availableActions(st, data, places);
    const travel = !p.travel ? travelOptions(st, data, places) : [];
    const lastHtml = last?.texts?.filter(Boolean).length ? `<div class="result">${last.texts.filter(Boolean).map((t) => `<p>${esc(t)}</p>`).join('')}</div>` : '';
    return `${lastHtml}
      <div class="actions">${acts.filter((a) => a.id !== 'travel').map((a) => `<button type="button" class="btn act" data-action="${a.id}" ${a.enabled ? '' : 'disabled'} title="${esc(a.enabled ? a.desc || '' : a.reason)}">${esc(a.name)}</button>`).join('')}</div>
      ${travel.length ? `<div class="travel-row"><select id="travelTo" aria-label="갈 곳">${travel.map((o) => `<option value="${o.place.id}" ${o.ok && p.coins >= o.fare ? '' : 'disabled'}>${esc(o.place.name)} (${esc(data.nationById[o.place.nation].name)}) · ${o.weeks}주${o.fare ? ` · 뱃삯 ${o.fare}냥` : ''}${o.reason ? ` · ${esc(o.reason)}` : ''}</option>`).join('')}</select><button type="button" class="btn" data-act="go">떠나기</button></div>
        <p class="muted small">가 본 적 있는 곳과 소문으로 들은 곳만 고를 수 있다. 수도는 누구나 안다.</p>` : ''}
      <form class="free" autocomplete="off"><label for="freeInput">직접 행동 쓰기</label>
        <div class="free-row"><input id="freeInput" type="text" maxlength="80" placeholder="예: 소금우물로 떠난다, 주막에서 노래를 부른다"><button type="submit" class="btn">행동</button></div></form>
      ${parsed ? `<div class="parsed">${parsed}</div>` : ''}
      <h3 class="section-title">일지</h3>
      <ol class="journal">${p.journal.slice(-12).reverse().map((j) => `<li class="${j.big ? 'big' : ''}"><span class="log-year">${j.year}년 ${j.week}주</span>${esc(j.text)}</li>`).join('')}</ol>`;
  }

  // ---------- 소지품 ----------
  function bagTab(st, p) {
    const { w, cap } = carry(data, p);
    const eq = p.equipment;
    const rows = Object.entries(p.inventory).filter(([, q]) => q > 0).map(([id, q]) => {
      const it = itemOf(data, id);
      if (!it) return '';
      const btn = it.kind === 'consumable' ? `<button type="button" class="btn sm" data-use="${id}">쓰기</button>`
        : ['weapon', 'armor'].includes(it.kind) ? `<button type="button" class="btn sm" data-equip="${id}">갖추기</button>` : '';
      return `<tr><td>${esc(it.name)}${it.note ? `<span class="muted small"> ${esc(it.note)}</span>` : ''}</td><td>${q}</td><td>${btn}</td></tr>`;
    }).join('');
    const recipes = data.items.recipes.filter((r) => !r.nameless || p.affiliation === 'nameless');
    return `
      <dl class="facts"><dt>무기</dt><dd>${esc(eq.weapon ? itemOf(data, eq.weapon).name : '맨손')}</dd><dt>갑옷</dt><dd>${esc(eq.armor ? itemOf(data, eq.armor).name : '없음')}</dd>
      <dt>도구</dt><dd>${esc(eq.tools.map((t) => itemOf(data, t).name).join(', ') || '없음')}</dd><dt>짐</dt><dd>${w} / ${cap}</dd></dl>
      ${rows ? `<table class="grades inv"><thead><tr><th>물건</th><th>수량</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="hint">가진 물건이 없다.</p>'}
      <h3 class="section-title">만들기</h3>
      <ul class="people-list">${recipes.map((r, i) => {
        const why = canCraft(st, data, r);
        const needs = Object.entries(r.needs).map(([id, q]) => `${itemOf(data, id).name} ${q}`).join(', ');
        return `<li><strong>${esc(itemOf(data, r.out).name)}</strong><span>${esc(needs)} · 학식 ${r.lore}</span><button type="button" class="btn sm" data-craft="${i}" ${why ? `disabled title="${esc(why)}"` : ''}>만들기</button></li>`;
      }).join('')}</ul>
      ${p.affiliation !== 'nameless' ? '<p class="muted small">무명회에 들어가면 연금술 배합을 배울 수 있다.</p>' : ''}`;
  }

  // ---------- 장터 ----------
  function marketTab(st, p, cx) {
    if (p.travel) return '<p class="hint">길 위에는 장터가 없다.</p>';
    const items = marketItems(st, data, cx.place);
    if (!items.length) { const near = api.places().filter((x) => x.nation === cx.place?.nation && st.placeState?.[x.id]?.facilities.includes('market')).map((x) => x.name); return `<p class="hint">${esc(cx.place?.name)}에는 장터가 없다.${near.length ? ` 이 나라에서는 ${esc(near.join(', '))}에 장터가 선다.` : ''}</p>`; }
    const kindName = { goods: '교역품', material: '재료', consumable: '소모품', weapon: '무기', armor: '갑옷', tool: '도구' };
    const rows = items.map((it) => {
      const b = priceAt(st, data, cx.place, it, 'buy'), s = priceAt(st, data, cx.place, it, 'sell');
      const own = p.inventory[it.id] || 0;
      const cls = b < it.price * 0.8 ? 'cheap' : b > it.price * 1.3 ? 'dear' : '';
      return `<tr class="${cls}"><td>${esc(it.name)} <span class="muted small">${kindName[it.kind] ?? ''}</span></td><td>${b}</td><td>${s}</td><td>${own || ''}</td>
        <td class="mk-btns"><button type="button" class="btn sm" data-buy="${it.id}" ${p.coins < b ? 'disabled' : ''}>사기</button><button type="button" class="btn sm" data-sell="${it.id}" ${own ? '' : 'disabled'}>팔기</button></td></tr>`;
    }).join('');
    const sellOnly = Object.keys(p.inventory).filter((id) => p.inventory[id] > 0 && !items.some((x) => x.id === id) && itemOf(data, id)?.price);
    return `
      <p class="muted small">이 나라에서 넉넉한 물건은 싸고, 부족한 물건은 비싸다. 기근이면 곡물이, 전쟁 중이면 무기가 비싸진다. 값은 매주 조금씩 바뀐다. 사고파는 데에는 한 주가 들지 않는다.</p>
      <table class="grades market"><thead><tr><th>물건</th><th>살 값</th><th>팔 값</th><th>가진 수</th><th></th></tr></thead><tbody>${rows}
      ${sellOnly.map((id) => { const it = itemOf(data, id); return `<tr><td>${esc(it.name)}</td><td>–</td><td>${priceAt(st, data, cx.place, it, 'sell')}</td><td>${p.inventory[id]}</td><td class="mk-btns"><button type="button" class="btn sm" data-sell="${id}">팔기</button></td></tr>`; }).join('')}</tbody></table>`;
  }

  // ---------- 사람 ----------
  function peopleTab(st, p, cx) {
    const fam = p.family;
    const partner = fam.partner ? st.persons[fam.partner] : null;
    const spouse = fam.spouse ? st.persons[fam.spouse] : null;
    const kids = fam.children.map((id) => st.persons[id]).filter(Boolean);
    const here = (cx.here || []).filter((q) => ['ruler', 'head', 'champion', 'hero', 'dispatched', 'prophet'].includes(q.role)).slice(0, 8);
    const label = (q) => q.title || (q.grade ? (q.type === 'magic' ? `${q.grade}환 마법사` : q.type === 'aura' ? `${q.grade}막 기사` : `${q.grade}등급 각성자`) : '');
    const pr = fam.pregnant;
    return `
      <h3 class="section-title">이곳의 이름난 사람</h3>
      ${p.travel ? '<p class="hint">길 위에서는 만날 사람이 없다.</p>' : here.length ? `<ul class="people-list meet">${here.map((q) => `<li>
        <button type="button" class="plink" data-person="${q.id}">${esc(q.name)}</button><span>${esc(label(q))}${p.npcRel[q.id] ? ` · 사이 ${p.npcRel[q.id] > 0 ? '+' : ''}${p.npcRel[q.id]}` : ''}${p.nemesis?.id === q.id ? ' · <b class="alert">원수</b>' : ''}</span>
        <span class="mk-btns"><button type="button" class="btn sm" data-meet="${q.id}" data-kind="talk">말 걸기</button><button type="button" class="btn sm" data-meet="${q.id}" data-kind="mentor">가르침 청하기</button>${q.grade ? `<button type="button" class="btn sm" data-meet="${q.id}" data-kind="duel">결투</button>` : ''}</span></li>`).join('')}</ul><p class="muted small">만남은 한 주를 쓴다. 이름난 사람들은 나라 안을 오가므로 다음 주엔 없을 수도 있다.</p>` : '<p class="hint">지금 이곳에 머무는 이름난 사람은 없다.</p>'}
      <h3 class="section-title">인연과 가족</h3>
      ${spouse ? `<p>배우자: <button type="button" class="plink" data-person="${spouse.id}">${esc(spouse.name)}</button>${spouse.alive ? '' : ' (세상을 떠남)'}</p>` : ''}
      ${partner ? `<div class="stat-bar"><span>정</span><span class="meter"><span style="width:${fam.love}%"></span></span><span class="num">${fam.love}</span></div>
        <p>마음에 둔 사람: <button type="button" class="plink" data-person="${partner.id}">${esc(partner.name)}</button></p>
        <div class="btn-row"><button type="button" class="btn sm" data-act="propose" ${fam.love < 40 ? 'disabled title="아직 정이 깊지 않다"' : ''}>청혼하기</button></div>` : !spouse ? '<p class="hint">아직 인연이 없다. 이번 주 탭의 "사람 사귀기"로 사람을 만날 수 있다.</p>' : ''}
      ${pr ? `<div class="encounter small-enc"><p>아이가 곧 태어난다. (${Math.max(0, pr.due - (st.year * 52 + st.week))}주 남음)</p>
        <p class="muted small">태교: ${pr.taegyo ? esc({ house: '가문의 비전', nature: '자연 속 휴양', taboo: '금기' }[pr.taegyo]) : '정하지 않음'}. 아이가 태어날 때 내가 있는 곳과 분화 시기도 그릇에 영향을 준다. 론이 어디에 내렸는지는 아무도 모른다.</p>
        <div class="choices"><button type="button" class="btn choice" data-taegyo="house">가문의 비전대로 힘을 일으킨다</button><button type="button" class="btn choice" data-taegyo="nature">사람 없는 자연 속에서 쉬게 한다</button><button type="button" class="btn choice" data-taegyo="taboo">마법과 오러를 함께 일으킨다 (금기)</button></div></div>` : ''}
      ${kids.length ? `<p>아이: ${kids.map((c) => `<button type="button" class="plink" data-person="${c.id}">${esc(c.name)}</button> (${c.age}세${c.alive ? '' : ', 세상을 떠남'})`).join(', ')}</p>` : ''}`;
  }

  // ---------- 기록 ----------
  function recordTab(st, p) {
    const ap = ambitionProgress(st, data, p);
    return `
      ${ap ? `<h3 class="section-title">야망</h3><p><strong>${esc(ap.a.name)}</strong> ${esc(ap.a.desc)}</p>${bar('진행', ap.v, ap.goal)}${p.ambition.done ? `<p class="note">맹약력 ${p.ambition.done}년에 이루었다.</p>` : ''}` : ''}
      <h3 class="section-title">기억</h3>
      ${p.memory.length ? `<ol class="journal">${p.memory.slice(-20).reverse().map((m) => `<li><span class="log-year">${m.year}년 ${m.week}주</span>${esc(m.text)}</li>`).join('')}</ol>` : '<p class="hint">아직 마음에 남은 일이 없다.</p>'}
      ${(st.legends || []).length ? `<h3 class="section-title">전해 오는 이야기</h3><ul class="notes">${st.legends.map((l) => `<li>${esc(l.name)} (맹약력 ${l.from}~${l.to}년). ${esc(l.summary)}. ${esc(l.placeName)}에 묻혔다.</li>`).join('')}</ul>` : ''}
      <p class="muted small">밟아 본 수도 ${p.visitedCapitals.length}곳 · 쓰러뜨린 상급 마물 ${p.kills}마리 · 알고 있는 장소 ${p.known.length}곳</p>`;
  }

  function showGame() {
    const st = S();
    const p = st.player;
    if (!p) return showCreate();
    const places = api.places();
    const cx = context(st, data, places);
    if (!p.alive) {
      const hs = heirs(st);
      panel.innerHTML = `<div class="epitaph"><p>${esc(p.name)}의 이야기는 여기서 끝났다.</p><p class="muted">맹약력 ${p.startYear}년에 시작해 ${st.year}년에 끝났다. ${p.age}세. 명성 ${Math.round(p.fame)}.</p></div>
        ${hs.length ? `<p>남은 아이가 있다. 아이가 열여섯이 될 때까지 세월이 흐른 뒤, 그 아이로 이어 갈 수 있다.</p><div class="btn-row">${hs.map((c) => `<button type="button" class="btn btn-primary" data-heir="${c.id}">${esc(c.name)}(${c.age}세)로 이어 가기</button>`).join('')}</div>` : ''}
        <div class="btn-row"><button type="button" class="btn" data-act="newChar">같은 세계에서 새 인물로</button><button type="button" class="btn" data-act="toWorld">세계 보기</button></div>`;
      panel.querySelectorAll('[data-heir]').forEach((b) => b.addEventListener('click', () => {
        continueAsHeir(st, data, rng, places, b.dataset.heir, api.hooks.worldStep);
        last = { texts: [] }; tab = 'week'; api.afterTurn();
      }));
      panel.querySelectorAll('[data-act="newChar"]').forEach((b) => b.addEventListener('click', () => { st.player = null; last = null; showCreate(); }));
      panel.querySelector('[data-act="toWorld"]').addEventListener('click', () => api.showWorld());
      return;
    }
    const body = tab === 'bag' ? bagTab(st, p) : tab === 'market' ? marketTab(st, p, cx) : tab === 'people' ? peopleTab(st, p, cx) : tab === 'record' ? recordTab(st, p) : weekTab(st, p, cx, places);
    panel.innerHTML = `${head(st, p, cx, places)}${p.encounter && tab !== 'week' ? '<p class="note">이번 주에 일이 생겼다. "이번 주" 탭을 확인하자.</p>' : ''}${body}
      <div class="btn-row foot"><button type="button" class="btn" data-act="toWorld">세계 지도와 연대기</button><button type="button" class="btn" data-act="save">저장</button><button type="button" class="btn" data-act="newChar">새 인물</button></div>`;
    note = '';

    const act = (fn) => { last = fn(); parsed = null; tab = 'week'; api.afterTurn(last); };
    const free = (msg) => { note = msg; api.afterTurn(); };
    panel.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; api.render(); }));
    panel.querySelectorAll('[data-action]').forEach((b) => b.addEventListener('click', () => act(() => doAction(st, data, rng, places, b.dataset.action, { hooks: api.hooks }))));
    panel.querySelectorAll('[data-choice]').forEach((b) => b.addEventListener('click', () => act(() => resolveChoice(st, data, rng, places, +b.dataset.choice))));
    panel.querySelector('[data-act="go"]')?.addEventListener('click', () => act(() => doAction(st, data, rng, places, 'travel', { to: panel.querySelector('#travelTo').value, hooks: api.hooks })));
    panel.querySelectorAll('[data-meet]').forEach((b) => b.addEventListener('click', () => act(() => doAction(st, data, rng, places, 'meet', { pid: b.dataset.meet, kind: b.dataset.kind, hooks: api.hooks }))));
    panel.querySelectorAll('[data-buy]').forEach((b) => b.addEventListener('click', () => free(buy(st, data, cx.place, b.dataset.buy))));
    panel.querySelectorAll('[data-sell]').forEach((b) => b.addEventListener('click', () => free(sell(st, data, cx.place, b.dataset.sell))));
    panel.querySelectorAll('[data-equip]').forEach((b) => b.addEventListener('click', () => free(equip(st, data, b.dataset.equip))));
    panel.querySelectorAll('[data-use]').forEach((b) => b.addEventListener('click', () => free(useItem(st, data, b.dataset.use))));
    panel.querySelectorAll('[data-craft]').forEach((b) => b.addEventListener('click', () => {
      const r = data.items.recipes.filter((x) => !x.nameless || p.affiliation === 'nameless')[+b.dataset.craft];
      if (canCraft(st, data, r)) return;
      for (const [id, q] of Object.entries(r.needs)) addItem(p, id, -q);
      addItem(p, r.out);
      p.fatigue = Math.min(100, p.fatigue + 10);
      free(`${J(itemOf(data, r.out).name, '을', '를')} 만들었다.`);
    }));
    panel.querySelector('[data-act="propose"]')?.addEventListener('click', () => free(propose(st, data, rng)));
    panel.querySelectorAll('[data-taegyo]').forEach((b) => b.addEventListener('click', () => free(setTaegyo(st, data, b.dataset.taegyo))));
    panel.querySelector('.free')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = panel.querySelector('#freeInput').value;
      const r = parseInput(text, st, data, places);
      if (!r) return;
      if (r.refuse) { last = { texts: [r.refuse] }; parsed = null; api.render(); return; }
      if (r.unknown) { parsed = `“${esc(text)}”를 어떻게 해야 할지 잘 모르겠다. 장소 이름이나 “일한다”, “사냥한다”, “낚시한다”, “장터에서 산다”처럼 다시 써 보자.`; api.render(); return; }
      if (r.action.startsWith('ui:')) { tab = { 'ui:market': 'market', 'ui:family': 'people', 'ui:craft': 'bag' }[r.action]; api.render(); return; }
      if (r.action === 'travel' && !r.to) { parsed = '어디로 갈지 장소 이름을 함께 써 주세요. 예: 하구성으로 떠난다'; api.render(); return; }
      if (r.action === 'travel' && !(p.known || []).includes(r.to)) { parsed = '그곳으로 가는 길을 아직 모른다. 소문을 듣거나 그 나라에 먼저 가 보자.'; api.render(); return; }
      const enabled = r.action.startsWith('flavor:') || r.action === 'travel' || availableActions(st, data, places).some((a) => a.id === r.action && a.enabled);
      if (!enabled) { last = { texts: [`지금 여기서는 그 행동을 할 수 없다. (${esc(P.actions[r.action]?.name ?? '')})`] }; api.render(); return; }
      act(() => doAction(st, data, rng, places, r.action, { to: r.to, hooks: api.hooks, free: text }));
      if (r.note) last.texts.unshift(r.note);
    });
    panel.querySelector('[data-act="toWorld"]')?.addEventListener('click', () => api.showWorld());
    panel.querySelector('[data-act="save"]')?.addEventListener('click', (e) => { e.target.textContent = api.save() ? '저장됨' : '저장 실패'; });
    panel.querySelectorAll('[data-act="newChar"]').forEach((b) => b.addEventListener('click', () => { st.player = null; last = null; showCreate(); }));
  }

  return { showIntro, showCreate, showGame };
}
