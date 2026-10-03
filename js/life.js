// 삶의 변수들: 장소의 장터, 물건과 장비, 론 잔량, 기억과 원수, 인연과 가족, 태교와 출산, 야망, 밝힌 지도, 전설과 대물림
// 설계도: lore/12_변수설계도.md
import { fill, pick, J } from './text.js';
import { createPerson, deed, makeGivenName } from './people.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const allItems = (data) => {
  const I = data.items;
  return [...I.goods, ...I.materials, ...I.equipment, ...I.consumables, ...I.alchemy, ...I.relics];
};
export const itemOf = (data, id) => allItems(data).find((x) => x.id === id);
const weekIndex = (state) => state.year * 52 + (state.week || 1);

// ---------- 장소 ----------
export function initPlaces(state, data, places) {
  state.placeState ??= {};
  for (const pl of places) {
    if (state.placeState[pl.id]) continue;
    const fac = data.player.facilities[pl.kind] || [];
    state.placeState[pl.id] = { facilities: fac, safety: pl.kind === 'capital' ? 70 : 55, drift: {}, stock: {} };
  }
}

// 장터에서 파는 물건: 장소 종류와 나라에 따라 다르다
export function marketItems(state, data, place) {
  if (!place) return [];
  const ps = state.placeState[place.id];
  if (!ps?.facilities.includes('market')) return [];
  const all = [...data.items.goods, ...data.items.materials, ...data.items.consumables, ...data.items.equipment];
  return all.filter((it) => {
    if (it.kind === 'material' && !(it.from || []).includes(place.nation) && place.kind !== 'capital') return false;
    if (it.from && it.kind !== 'goods' && it.kind !== 'material' && !it.from.includes(place.nation)) return false;
    if (place.kind === 'town' && ['weapon', 'armor'].includes(it.kind) && it.price > 25) return false;
    return true;
  });
}

export function priceAt(state, data, place, it, side = 'buy') {
  const n = state.nations[place.nation];
  let m = 1;
  if ((it.from || []).includes(place.nation)) m *= 0.6;
  if ((it.scarceIn || []).includes(place.nation)) m *= 1.7;
  if (it.food && n.famine) m *= 2;
  if (['weapon', 'armor'].includes(it.kind) && state.wars.some((w) => w.a === place.nation || w.b === place.nation)) m *= 1.5;
  if (place.kind === 'town') m *= 0.95;
  const ps = state.placeState[place.id];
  m *= 1 + (ps.drift[it.id] || 0);
  const stock = ps.stock[it.id] ?? 10;
  m *= stock <= 2 ? 1.3 : stock >= 16 ? 0.9 : 1;
  const base = Math.max(1, Math.round(it.price * m));
  return side === 'buy' ? base : Math.max(1, Math.round(base * 0.75));
}

// ---------- 인물의 새 변수 ----------
export function initLife(state, data, places, p) {
  p.inventory ??= { bread: 3 };
  p.equipment ??= { weapon: p.origin === 'noble' ? 'sword' : p.origin === 'wanderer' ? 'knife' : null, armor: null, tools: [] };
  p.ron ??= { cur: 0, max: 0 };
  p.memory ??= [];
  p.nemesis ??= null;
  p.family ??= { partner: null, love: 0, spouse: null, pregnant: null, children: [] };
  p.kills ??= 0;
  p.visitedCapitals ??= [];
  const here = places.find((x) => x.id === p.place);
  p.known ??= [...new Set([
    ...places.filter((x) => x.kind === 'capital').map((x) => x.id),
    ...places.filter((x) => x.nation === here?.nation).map((x) => x.id),
  ])];
  if (here?.kind === 'capital' && !p.visitedCapitals.includes(here.nation)) p.visitedCapitals.push(here.nation);
  syncRon(p);
}

export function syncRon(p) {
  if (!p.awakened) { p.ron = { cur: 0, max: 0 }; return; }
  const max = Math.round(20 + p.vessel.size * 0.6 + p.grade * 15);
  if (p.ron.max !== max) { p.ron.cur = Math.min(max, p.ron.cur + (max - p.ron.max)); p.ron.max = max; }
}

export function carry(data, p) {
  let w = 0;
  for (const [id, q] of Object.entries(p.inventory)) w += (itemOf(data, id)?.weight ?? 0) * q;
  const cap = data.items.carryMax + (p.equipment.tools.includes('horse') ? 30 : 0);
  return { w, cap };
}

// 장비와 도구의 효과
export function gearBonus(data, p, stat) {
  let b = 0;
  const ids = [p.equipment.weapon, p.equipment.armor, ...p.equipment.tools].filter(Boolean);
  for (const id of ids) { const it = itemOf(data, id); if (it && it[stat]) b += it[stat]; }
  for (const [id, q] of Object.entries(p.inventory)) { const it = itemOf(data, id); if (q > 0 && it?.kind === 'relic' && it[stat]) b += it[stat]; }
  return b;
}
export const guardOf = (data, p) => (p.equipment.armor ? itemOf(data, p.equipment.armor)?.guard ?? 0 : 0);

export function addItem(p, id, q = 1) { p.inventory[id] = (p.inventory[id] || 0) + q; if (p.inventory[id] <= 0) delete p.inventory[id]; }

// ---------- 장터 거래 (턴을 쓰지 않는다) ----------
export function buy(state, data, place, id) {
  const p = state.player;
  const it = itemOf(data, id);
  const price = priceAt(state, data, place, it, 'buy');
  if (p.coins < price) return '돈이 모자란다.';
  const { w, cap } = carry(data, p);
  if (w + (it.weight || 0) > cap) return '짐이 너무 무겁다.';
  p.coins -= price;
  if (it.id === 'horse' || it.kind === 'tool') { if (!p.equipment.tools.includes(it.id)) p.equipment.tools.push(it.id); else addItem(p, it.id); }
  else addItem(p, it.id);
  const ps = state.placeState[place.id];
  ps.stock[id] = Math.max(0, (ps.stock[id] ?? 10) - 1);
  return `${J(it.name, '을', '를')} ${price}냥에 샀다.`;
}
export function sell(state, data, place, id) {
  const p = state.player;
  const it = itemOf(data, id);
  if (!p.inventory[id]) return '팔 물건이 없다.';
  const price = priceAt(state, data, place, it, 'sell');
  p.coins += price;
  addItem(p, id, -1);
  const ps = state.placeState[place.id];
  ps.stock[id] = (ps.stock[id] ?? 10) + 1;
  return `${J(it.name, '을', '를')} ${price}냥에 팔았다.`;
}
export function equip(state, data, id) {
  const p = state.player;
  const it = itemOf(data, id);
  if (!it || !p.inventory[id]) return '';
  const slot = it.kind === 'weapon' ? 'weapon' : it.kind === 'armor' ? 'armor' : null;
  if (!slot) return '';
  if (p.equipment[slot]) addItem(p, p.equipment[slot]);
  p.equipment[slot] = id;
  addItem(p, id, -1);
  return `${J(it.name, '을', '를')} 갖췄다.`;
}
export function useItem(state, data, id) {
  const p = state.player;
  const it = itemOf(data, id);
  if (!it || !p.inventory[id] || it.kind !== 'consumable') return '';
  addItem(p, id, -1);
  if (it.hp) p.hp = Math.min(100, p.hp + it.hp);
  if (it.fatigue) p.fatigue = clamp(p.fatigue + it.fatigue, 0, 100);
  if (it.meal) p.hp = Math.min(100, p.hp + 2);
  return `${J(it.name, '을', '를')} 썼다.`;
}
export function canCraft(state, data, r) {
  const p = state.player;
  if (r.nameless && p.affiliation !== 'nameless') return '무명회의 사람만 아는 배합이다.';
  if (p.stats.lore < r.lore) return `학식이 ${r.lore} 이상이어야 한다.`;
  for (const [id, q] of Object.entries(r.needs)) if ((p.inventory[id] || 0) < q) return `${J(itemOf(data, id).name, '이', '가')} 모자란다.`;
  return '';
}

// ---------- 원수 ----------
export function setNemesis(state, data, kind, info) {
  const p = state.player;
  if (p.nemesis && p.nemesis.kind === kind && p.nemesis.id === info.id) { p.nemesis.losses += 1; return; }
  p.nemesis = { kind, losses: 1, since: state.year, ...info };
  p.memory.push({ year: state.year, week: state.week, kind: 'nemesis', text: `${info.name}에게 패했다.` });
}
export function growNemesis(state, data) {
  const p = state.player;
  const nm = p.nemesis;
  if (!nm) return;
  nm.losses += 1;
  if (nm.kind === 'monster') {
    const m = state.monsters.find((x) => x.id === nm.id);
    if (m && m.tier < 5) { m.tier += 1; nm.tier = m.tier; }
    if (m && !m.name.startsWith('‘')) { m.name = `‘${J(p.name, '을', '를')} 쓰러뜨린’ ${m.name}`; nm.name = m.name; }
  }
}

// ---------- 인연과 가족 ----------
export function socialize(state, data, rng, place) {
  const p = state.player;
  const F = data.player.family;
  const fam = p.family;
  if (fam.spouse) {
    const s = state.persons[fam.spouse];
    return `${J(s?.name ?? '배우자', '과', '와')} 함께 ${place.name}의 장터를 거닐었다.`;
  }
  if (!fam.partner || !state.persons[fam.partner]?.alive) {
    const hs = Object.values(state.houses).filter((h) => h.nation === place.nation && !h.exiled);
    const noble = hs.length && rng() < (p.fame >= 30 || p.origin === 'noble' ? 0.5 : 0.15);
    const b = createPerson(state, data, rng, {
      nation: place.nation, house: noble ? pick(rng, hs).id : null, role: noble ? 'noble' : 'commoner',
      age: Math.max(17, p.age - 3 + Math.floor(rng() * 7)), job: noble ? null : pick(rng, data.names.commonerJobs), origin: `${place.name}`,
    });
    b.place = place.id;
    fam.partner = b.id; fam.love = 10 + Math.floor(rng() * 10);
    p.memory.push({ year: state.year, week: state.week, kind: 'met', pid: b.id, text: `${place.name}에서 ${J(b.name, '을', '를')} 만났다.` });
    return fill(pick(rng, F.meet), { pl: place.name, where: pick(rng, F.where), b: b.name });
  }
  const b = state.persons[fam.partner];
  fam.love = clamp(fam.love + 6 + Math.floor(rng() * 8) + Math.floor(p.stats.speech / 20), 0, 100);
  return fill(pick(rng, F.grow), { b: b.name });
}
export function propose(state, data, rng) {
  const p = state.player;
  const F = data.player.family;
  const fam = p.family;
  const b = state.persons[fam.partner];
  if (!b) return '청혼할 사람이 없다.';
  if (fam.love >= 60 && rng() < 0.4 + fam.love / 200) {
    fam.spouse = b.id; fam.partner = null;
    deed(state, b, `${J(p.name, '과', '와')} 혼인했다.`);
    p.memory.push({ year: state.year, week: state.week, kind: 'married', pid: b.id, text: `${J(b.name, '과', '와')} 혼인했다.` });
    state.log.push({ year: state.year, kind: 'player', cat: '인물', text: fill('{p:과} {b:이} 혼인했다.', { p: p.name, b: b.name }), ids: [p.nation], persons: [p.personId, b.id], w: 25 });
    return fill(F.proposeOk, { b: b.name });
  }
  fam.love = clamp(fam.love - 8, 0, 100);
  return fill(F.proposeNo, { b: b.name });
}
export function setTaegyo(state, data, mode) {
  const p = state.player;
  const pr = p.family.pregnant;
  if (!pr) return '';
  if (mode === 'house' && !(p.awakened && p.affiliation === 'house')) return '가문의 비전을 알아야 한다. 가문에 속한 각성자만 할 수 있다.';
  if (mode === 'taboo' && !(p.vessel.dir === 'dual' && p.awakened)) return '마법과 오러를 함께 일으킬 수 있어야 한다.';
  pr.taegyo = mode;
  return data.player.family.taegyo[mode];
}

function birth(state, data, rng, places) {
  const p = state.player;
  const pr = p.family.pregnant;
  const place = places.find((x) => x.id === p.place) || places.find((x) => x.nation === p.nation);
  const spouse = state.persons[p.family.spouse];
  // 그릇: 운이 기본이고, 태교와 분화 시기가 더해진다. 자연의 론이 닿으면 양방향이 된다.
  let size = Math.floor(rng() * 35);
  let dir = rng() < 0.5 ? 'magic' : 'aura';
  const afterEruption = state.year - state.lastEruption <= 1;
  if (pr.taegyo === 'house') { size += 25 + p.grade * 5; dir = p.vessel.dir === 'dual' ? dir : p.vessel.dir; }
  if (pr.taegyo === 'nature') size += Math.floor(rng() * 20);
  let natural = false;
  if (afterEruption && rng() < (pr.taegyo === 'nature' ? 0.12 : 0.05)) { natural = true; size = 70 + Math.floor(rng() * 30); dir = 'dual'; }
  if (pr.taegyo === 'taboo') { size = Math.max(size, 55 + Math.floor(rng() * 40)); if (rng() < 0.6) dir = 'dual'; }
  size = clamp(size, 0, 100);
  const given = makeGivenName(rng, data.names, p.nation, p.race);
  const c = createPerson(state, data, rng, { nation: p.nation, house: p.house, role: 'child', race: p.race, given, age: 0 });
  c.age = 0; c.born = state.year; c.place = place?.id;
  c.vessel = { size, dir, natural };
  p.family.children.push(c.id);
  p.family.pregnant = null;
  p.memory.push({ year: state.year, week: state.week, kind: 'child', pid: c.id, text: `${J(c.name, '이', '가')} 태어났다.` });
  const text = fill(data.player.family.birth, { pl: place?.name ?? '길 위', c: c.name });
  state.log.push({ year: state.year, kind: 'player', cat: '인물', text: fill('{p}의 아이 {c:이} {pl}에서 태어났다.', { p: p.name, c: c.name, pl: place?.name ?? '길 위' }), ids: [p.nation], persons: [p.personId, c.id], w: 25 });
  if (pr.taegyo === 'taboo') {
    // 금기를 어겼다: 세계가 반응한다
    for (const h of Object.values(state.houses)) h.loyalty = clamp(h.loyalty - 3, 0, 100);
    state.log.push({ year: state.year, kind: 'player', cat: '정치', text: fill('{p:이} 산모 곁에서 마법과 오러를 함께 일으켰다는 소문이 퍼졌다. 가문들이 금기로 여겨 온 일이었다. 대가문들이 서로를 의심하기 시작했다.', { p: p.name }), ids: [p.nation], persons: [p.personId], w: 70, head: '금기가 깨진 해' });
    p.notoriety += 20;
  }
  return text;
}

// ---------- 야망 ----------
export function ambitionProgress(state, data, p) {
  const a = data.player.ambitions.find((x) => x.id === p.ambition?.id);
  if (!a) return null;
  let v = 0;
  switch (a.id) {
    case 'grade': v = p.awakened ? p.grade : 0; break;
    case 'fame': v = p.fame; break;
    case 'rich': v = p.coins; break;
    case 'house': v = p.affiliation === 'house' ? p.houseFavor : 0; break;
    case 'explorer': v = p.visitedCapitals.length; break;
    case 'slayer': v = p.kills; break;
    case 'revolution': v = p.affiliation === 'nameless' && state.nations[p.nation].type === 'revolution' ? 1 : 0; break;
    case 'bloodline': v = p.family.children.some((id) => (state.persons[id]?.vessel?.size ?? 0) >= 60) ? 1 : 0; break;
    default: break;
  }
  return { a, v, goal: a.goal, ratio: Math.min(1, v / a.goal) };
}

// ---------- 매주 ----------
export function weeklyLife(state, data, rng, places) {
  const p = state.player;
  // 장터 물가의 흔들림과 물량 회복
  for (const ps of Object.values(state.placeState || {})) {
    for (const k of Object.keys(ps.drift)) ps.drift[k] = clamp(ps.drift[k] * 0.9 + (rng() - 0.5) * 0.06, -0.3, 0.5);
    if (rng() < 0.15) { const it = pick(rng, data.items.goods); ps.drift[it.id] = clamp((ps.drift[it.id] || 0) + (rng() - 0.4) * 0.4, -0.3, 0.6); }
    for (const k of Object.keys(ps.stock)) ps.stock[k] += ps.stock[k] < 10 ? 1 : ps.stock[k] > 10 ? -1 : 0;
  }
  // 세계 인물의 이동: 수장과 강자가 나라 안을 오간다
  for (const q of Object.values(state.persons)) {
    if (!q.alive || q.role === 'player') continue;
    if (!q.place || rng() < 0.04) {
      const opts = places.filter((x) => x.nation === (q.stationedAt || q.nation));
      if (!opts.length) continue;
      if (q.role === 'ruler') q.place = (opts.find((x) => x.kind === 'capital') || opts[0]).id;
      else if (q.role === 'head' && q.house) q.place = (places.find((x) => x.house === q.house) || pick(rng, opts)).id;
      else q.place = pick(rng, opts).id;
    }
  }
  if (!p?.alive) return [];
  const out = [];
  // 론 회복
  syncRon(p);
  if (p.awakened) p.ron.cur = Math.min(p.ron.max, p.ron.cur + Math.round(p.ron.max * (p.fatigue < 50 ? 0.25 : 0.12)));
  // 인연과 출산
  const fam = p.family;
  if (fam.partner && rng() < 0.1) fam.love = clamp(fam.love - 2, 0, 100);
  if (fam.spouse && !fam.pregnant && state.persons[fam.spouse]?.alive && p.age < 50 && rng() < 0.022) {
    fam.pregnant = { due: weekIndex(state) + 39, taegyo: null, since: weekIndex(state) };
    out.push(fill(data.player.family.conceive, { b: state.persons[fam.spouse].name }));
  }
  if (fam.pregnant && weekIndex(state) >= fam.pregnant.due) out.push(birth(state, data, rng, places));
  // 원수의 생존 확인
  if (p.nemesis?.kind === 'monster' && !state.monsters.some((m) => m.id === p.nemesis.id)) {
    p.memory.push({ year: state.year, week: state.week, kind: 'nemesisGone', text: `${p.nemesis.name}의 소식이 끊겼다.` });
    p.nemesis = null;
  }
  // 야망 달성
  const ap = ambitionProgress(state, data, p);
  if (ap && ap.ratio >= 1 && !p.ambition.done) {
    p.ambition.done = state.year;
    out.push(`오래 품어 온 꿈을 이루었다. ‘${ap.a.name}’.`);
    state.log.push({ year: state.year, kind: 'player', cat: '인물', text: fill('{p:이} 오래 품어 온 꿈을 이루었다. {a}.', { p: p.name, a: ap.a.desc.replace(/\.$/, '') }), ids: [p.nation], persons: [p.personId], w: 50 });
    p.fame += 10;
  }
  return out;
}

// 해가 바뀔 때: 아이들이 자란다
export function yearlyLife(state) {
  const p = state.player;
  for (const id of p?.family?.children || []) { const c = state.persons[id]; if (c?.alive) c.age += 1; }
}

// ---------- 죽음 이후 ----------
export function recordLegend(state, data, places) {
  const p = state.player;
  const place = places.find((x) => x.id === p.place);
  state.legends ??= [];
  const deedsText = p.awakened ? `${p.vessel.dir === 'dual' ? '양방향 각성자' : p.vessel.dir === 'magic' ? `${p.grade}환 마법사` : `${p.grade}막 기사`}였고` : '재능 없이 살았고';
  state.legends.push({
    name: p.name, from: p.startYear, to: state.year, place: place?.id ?? null, placeName: place?.name ?? '어느 길 위',
    fame: Math.round(p.fame), summary: `${deedsText}, 명성 ${Math.round(p.fame)}을 남겼다`,
  });
}
export function heirs(state) {
  const p = state.player;
  return (p?.family?.children || []).map((id) => state.persons[id]).filter((c) => c?.alive);
}
export function continueAsHeir(state, data, rng, places, childId, worldStep) {
  const old = state.player;
  const c = state.persons[childId];
  // 아이가 열여섯이 될 때까지 세월이 흐른다
  while (c.age < 16) { worldStep(); c.age += 1; }
  const np = {
    name: c.given, nation: old.nation, race: c.race, origin: old.house ? 'noble' : 'commoner', age: c.age,
    place: old.place && places.some((x) => x.id === old.place) ? old.place : places.find((x) => x.nation === old.nation).id,
    hp: 100, fatigue: 0, coins: Math.round(old.coins / 2), fame: Math.round(old.fame / 5), notoriety: 0,
    stats: { sword: 10, lore: 12, speech: 12, stealth: 10, survival: 12 },
    vessel: { size: c.vessel?.size ?? 10, dir: c.vessel?.dir ?? 'aura', known: !!old.house },
    awakened: !!old.house && (c.vessel?.size ?? 0) >= 40, grade: 0, progress: 0,
    house: old.house, affiliation: old.house ? 'house' : 'none', houseFavor: old.house ? 15 : 0,
    travel: null, encounter: null, journal: [], alive: true, flags: {}, npcRel: {}, weather: '맑음', startYear: state.year,
    inventory: { ...old.inventory }, equipment: { ...old.equipment, tools: [...old.equipment.tools] },
    known: [...old.known], memory: [{ year: state.year, week: state.week, kind: 'heir', text: `${old.name}의 아이로 길을 이어받았다.` }],
    nemesis: old.nemesis, family: { partner: null, love: 0, spouse: null, pregnant: null, children: [] }, kills: 0, visitedCapitals: [...old.visitedCapitals],
    ambition: old.ambition && !old.ambition.done ? { ...old.ambition } : null, personId: c.id, parent: old.name,
  };
  if (np.awakened) np.grade = 1;
  c.role = 'player';
  state.player = np;
  syncRon(np);
  np.journal.push({ year: state.year, week: state.week, text: `${old.name}의 아이 ${np.name}. 부모가 남긴 이름과 빚과 원수를 함께 물려받았다.`, big: true });
  if (np.nemesis) np.journal.push({ year: state.year, week: state.week, text: `${np.nemesis.name}. 부모를 쓰러뜨린 그 이름을 잊지 않았다.` });
  return np;
}

// ---------- 세계의 인물과 만나기 ----------
export function meetPerson(state, data, rng, pid, kind, checkFn) {
  const p = state.player;
  const q = state.persons[pid];
  if (!q || !q.alive) return '그 사람은 이제 이곳에 없다.';
  p.npcRel[pid] = p.npcRel[pid] || 0;
  const remember = (k, text, d) => { p.npcRel[pid] += d; p.memory.push({ year: state.year, week: state.week, kind: k, pid, text }); };
  const label = q.title || (q.grade ? `${q.type === 'magic' ? `${q.grade}환 마법사` : q.type === 'aura' ? `${q.grade}막 기사` : '각성자'}` : '');
  if (kind === 'talk') {
    if (checkFn('speech', 30 + (q.role === 'ruler' ? 25 : q.role === 'head' ? 15 : 5))) {
      remember('talk', `${J(q.name, '과', '와')} 이야기를 나눴다.`, 10);
      if (q.role === 'head' && p.npcRel[pid] >= 25 && p.affiliation !== 'house' && p.fame >= 10 && q.house) {
        p.house = q.house; p.affiliation = 'house'; p.houseFavor = 15;
        return `${label} ${J(q.name, '이', '가')} 나를 마음에 들어 했다. ${state.houses[q.house].name} 가문의 객식구로 받아 주겠다고 했다.`;
      }
      return pick(rng, [`${label} ${J(q.name, '이', '가')} 뜻밖에 오래 이야기를 들어 주었다.`, `${J(q.name, '과', '와')} 세상 이야기를 나눴다. 그는 나를 기억하겠다고 했다.`, `${J(q.name, '이', '가')} 웃으며 어깨를 두드렸다.`]);
    }
    remember('snub', `${J(q.name, '이', '가')} 나를 외면했다.`, -3);
    return `${J(q.name, '은', '는')} 나를 흘끗 보고는 지나쳤다.`;
  }
  if (kind === 'mentor') {
    const fits = p.awakened && q.grade > p.grade && (p.vessel.dir === 'dual' || q.type === p.vessel.dir);
    if (!fits) return p.awakened ? `${J(q.name, '은', '는')} 가르칠 것이 없다고 했다. 길이 다르거나, 이미 나와 비슷한 경지다.` : `${J(q.name, '이', '가')} 고개를 저었다. '깨어나지 않은 그릇에게 가르칠 것은 없다.'`;
    if (checkFn('speech', 40 - Math.min(20, p.npcRel[pid]))) {
      p.progress += 30; remember('mentor', `${J(q.name, '에게', '에게')} 가르침을 받았다.`.replace('에게에게', '에게'), 8);
      deed(state, q, `${J(p.name, '을', '를')} 가르쳤다.`);
      return `${J(q.name, '이', '가')} 한 주 동안 곁에서 가르쳐 주었다. 그릇이 한결 깊어진 느낌이다.`;
    }
    remember('mentorNo', `${J(q.name, '이', '가')} 가르침을 거절했다.`, -2);
    return `${J(q.name, '은', '는')} 아직 나를 믿지 못하겠다고 했다.`;
  }
  if (kind === 'duel') {
    const dc = 35 + (q.grade || 1) * 10;
    if (checkFn('sword', dc)) {
      p.fame += 5 + (q.grade || 1) * 2;
      remember('duelWin', `${J(q.name, '과', '와')}의 결투에서 이겼다.`, -10);
      deed(state, q, `${J(p.name, '에게', '에게')} 결투에서 졌다.`.replace('에게에게', '에게'));
      state.log.push({ year: state.year, kind: 'player', cat: '인물', text: fill('{p:이} {q:과}의 결투에서 이겼다.', { p: p.name, q: `${label} ${q.name}` }), ids: [q.nation], persons: [p.personId, q.id], w: 30 });
      return `${J(q.name, '의', '의')} 칼이 땅에 떨어졌다. 구경꾼들이 숨을 삼켰다.`.replace('의의', '의');
    }
    p.hp -= Math.round(30 * (1 - guardOf(data, p)));
    remember('duelLose', `${J(q.name, '과', '와')}의 결투에서 졌다.`, -15);
    setNemesis(state, data, 'person', { id: q.id, name: q.name });
    return `${J(q.name, '의', '의')} 일격에 쓰러졌다. 그가 내려다보며 이름을 물었다.`.replace('의의', '의');
  }
  return '';
}
