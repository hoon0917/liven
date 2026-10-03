// 턴제 인물 모드: 한 턴 = 일주일. 52주가 지나면 세계가 1년 흐른다.
import { fill, pick, J } from './text.js';
import { createPerson, deed, personDies } from './people.js';
import { meetPerson, initLife, initPlaces, gearBonus, guardOf, addItem, setNemesis, growNemesis, socialize, weeklyLife, yearlyLife, recordLegend, syncRon, carry, itemOf } from './life.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const STATS = ['sword', 'lore', 'speech', 'stealth', 'survival'];

export function seasonOf(data, week) {
  return data.player.seasons.find((s) => week >= s.weeks[0] && week <= s.weeks[1]) || data.player.seasons[0];
}
const landmass = (regionId) => (regionId.startsWith('region_central') || regionId === 'region_volcano' ? 'central' : regionId);

function weighted(rng, items) {
  const total = items.reduce((s, x) => s + x[1], 0);
  let r = rng() * total;
  for (const x of items) { r -= x[1]; if (r <= 0) return x[0]; }
  return items[0][0];
}

// ---------- 인물 만들기 ----------
export function createPlayer(state, data, rng, places, o) {
  const P = data.player;
  const origin = P.origins[o.origin];
  const nDef = data.nationById[o.nation];
  // 시작 장소: 귀족은 가문 영지나 수도, 섬사람은 섬, 그 밖에는 마을
  const own = places.filter((p) => p.nation === o.nation);
  let start = own.find((p) => p.kind === 'town') || own[0];
  let house = null;
  if (o.origin === 'noble') {
    const hs = Object.values(state.houses).filter((h) => h.nation === o.nation && !h.exiled);
    house = o.house ? state.houses[o.house] : pick(rng, hs);
    start = places.find((p) => p.house === house?.id) || own.find((p) => p.kind === 'capital') || start;
  } else if (o.origin === 'islander') start = own.find((p) => p.kind === 'capital') || start;
  else if (o.origin === 'wanderer') start = pick(rng, places.filter((p) => p.kind !== 'capital'));

  // 그릇: 운으로 정해진다. 가문의 자제는 태교 덕분에 큰 그릇이 나올 확률이 높다
  const roll = rng();
  let size = o.origin === 'noble' ? 30 + Math.floor(rng() * 60) : roll < 0.72 ? Math.floor(rng() * 32) : roll < 0.93 ? 32 + Math.floor(rng() * 30) : 62 + Math.floor(rng() * 38);
  let dir;
  if (o.origin === 'noble' && house) dir = house.type === 'magic' ? 'magic' : 'aura';
  else dir = size >= 62 && rng() < 0.3 ? 'dual' : rng() < 0.5 ? 'magic' : 'aura';
  if (nDef.type === 'knight' && dir === 'magic' && o.origin === 'noble') dir = 'aura';
  const awakened = o.origin === 'noble' && size >= 40;

  const stats = { ...origin.stats };
  for (const k of STATS) stats[k] += Math.floor(rng() * 6);
  const p = {
    name: o.name, nation: o.nation, race: o.race, origin: o.origin, age: 17 + Math.floor(rng() * 5),
    place: start.id, hp: 100, fatigue: 0, coins: origin.coins, fame: 0, notoriety: 0, stats,
    vessel: { size, dir, known: o.origin === 'noble' }, awakened, grade: awakened ? 1 : 0, progress: 0,
    house: house?.id ?? null, affiliation: house ? 'house' : 'none', houseFavor: house ? 20 : 0,
    travel: null, encounter: null, journal: [], alive: true, flags: {}, npcRel: {}, weather: '맑음', startYear: state.year,
  };
  state.player = p;
  state.week = state.week || 1;
  p.ambition = o.ambition ? { id: o.ambition, done: null } : null;
  initPlaces(state, data, places);
  initLife(state, data, places, p);
  const person = createPerson(state, data, rng, {
    nation: o.nation, house: house?.id, role: 'player', race: o.race, given: o.name, age: p.age,
    job: origin.name, origin: `${nDef.name}의 ${start.name}`,
    type: awakened ? dir : 'none', grade: awakened ? 1 : 0,
  });
  person.age = p.age;
  p.personId = person.id;
  if (awakened) state.nations[o.nation][dir === 'magic' ? 'mages' : 'aura'][0] += 1;
  journal(state, `${origin.desc}`);
  if (o.origin === 'noble') journal(state, awakened ? `어릴 적 판정에서 그릇이 드러났다. ${house.name} 가문의 ${dir === 'magic' ? '마법' : '오러'}를 이어받았다.` : `어릴 적 판정에서 작은 그릇으로 드러났다. ${house.name} 가문의 실망한 눈빛을 기억한다.`);
  journal(state, `맹약력 ${state.year}년, ${start.name}에서 이야기가 시작된다.`);
  return p;
}

export function journal(state, text, extra = {}) {
  const p = state.player;
  p.journal.push({ year: state.year, week: state.week, text, ...extra });
  if (p.journal.length > 300) p.journal.shift();
}

function chronicle(state, text, w = 30) {
  const p = state.player;
  state.log.push({ year: state.year, kind: 'player', cat: '인물', text, ids: [p.nation], persons: [p.personId], w, head: w >= 60 ? text.split('.')[0] : undefined });
}

// ---------- 상황 판단 ----------
export function context(state, data, places) {
  const p = state.player;
  if (p && !p.inventory) initLife(state, data, places, p);
  if (!state.placeState) initPlaces(state, data, places);
  const place = places.find((x) => x.id === p.place);
  const nid = p.travel ? p.nation : place?.nation ?? p.nation;
  const n = state.nations[nid];
  const regionId = place?.regionId ?? data.nationById[nid].regionId;
  const atWar = state.wars.some((w) => w.a === nid || w.b === nid);
  const enemy = state.wars.find((w) => w.a === nid || w.b === nid);
  const monsters = state.monsters.filter((m) => m.regionId === regionId);
  const champions = Object.values(state.persons).filter((x) => x.alive && x.nation === nid && (x.role === 'champion' || x.role === 'hero') && !x.stationedAt);
  const ps = place ? state.placeState?.[place.id] : null;
  const here = place ? Object.values(state.persons).filter((x) => x.alive && x.place === place.id && x.role !== 'player') : [];
  return { p, place, nid, n, regionId, atWar, enemyId: enemy ? (enemy.a === nid ? enemy.b : enemy.a) : null, monsters, champions, ps, here };
}

function cond(c, state, data, cx) {
  const { p, place, n } = cx;
  if (c.startsWith('season:')) return seasonOf(data, state.week).name === c.slice(7);
  if (c.startsWith('weather:')) return p.weather === c.slice(8);
  if (c.startsWith('lore:')) return p.stats.lore >= +c.slice(5);
  if (c.startsWith('coins:')) return p.coins >= +c.slice(6);
  if (c.startsWith('houseFavor:')) return p.houseFavor >= +c.slice(11);
  switch (c) {
    case 'travel': return !!p.travel;
    case 'town': return !p.travel && (place?.kind === 'town' || place?.kind === 'seat');
    case 'capital': return !p.travel && place?.kind === 'capital';
    case 'port': return !p.travel && !!place?.port;
    case 'famine': return n.famine;
    case 'war': return cx.atWar;
    case 'legend': return !!state.legend;
    case 'monster': return cx.monsters.length > 0;
    case 'revealed': return state.alchemyRevealed;
    case 'prepHigh': return n.revolutionPrep >= 55 || state.alchemyRevealed;
    case 'nameless': return p.affiliation === 'nameless';
    case 'notNameless': return p.affiliation !== 'nameless';
    case 'famous': return p.fame >= 20;
    case 'notorious': return p.notoriety >= 15;
    case 'notHouse': return p.affiliation !== 'house';
    case 'houseMember': return p.affiliation === 'house' && !!p.house;
    case 'awakened': return p.awakened;
    case 'notAwakened': return !p.awakened;
    case 'bigVessel': return p.vessel.size >= 45;
    case 'poor': return p.coins < 5;
    case 'rich': return p.coins >= 60;
    case 'central': return landmass(cx.regionId) === 'central';
    case 'islander': return p.origin === 'islander';
    case 'island': return n.type === 'mercenary';
    case 'army': return p.affiliation === 'army';
    case 'hurt': return p.hp < 50;
    case 'champion': return cx.champions.length > 0;
    case 'prepReady': return cx.n.revolutionPrep >= 85 && cx.n.type !== 'revolution' && (p.flags.missions || 0) >= 6;
    case 'notTravel': return !p.travel;
    case 'mighty': return p.awakened && (p.grade >= 3 || p.vessel.dir === 'dual');
    case 'famous50': return p.fame >= 50;
    case 'stealthy': return p.stats.stealth >= 45 && (p.flags.missions || 0) >= 10;
    case 'nemesisHere': return p.nemesis?.kind === 'monster' && state.monsters.some((m) => m.id === p.nemesis.id && m.regionId === cx.regionId);
    case 'hasBanditNemesis': return p.nemesis?.kind === 'bandit';
    case 'hasLegend': return (state.legends || []).length > 0 && !p.travel;
    case 'market': return !p.travel && !!cx.ps?.facilities.includes('market');
    case 'smithy': return !p.travel && !!cx.ps?.facilities.includes('smithy');
    case 'courting': return !!p.family?.partner;
    case 'hasChild': return (p.family?.children || []).some((id) => state.persons[id]?.alive);
    default: return false;
  }
}

function check(state, data, stat, dc, rng) {
  const p = state.player;
  let v = p.stats[stat] ?? 0;
  if (stat === 'stealth') v += data_weatherBonus(p);
  if (p.awakened && stat === 'sword') v += p.grade * (p.ron?.cur > 10 ? 12 : 5);
  v += gearBonus(data, p, stat);
  if (p.vessel.size >= 45 && !p.awakened) v += 4; // 감이 좋다
  v -= p.fatigue > 70 ? 10 : 0;
  return v + rng() * 60 >= dc;
}
const data_weatherBonus = (p) => (p.weather === '안개' ? 10 : 0);

// ---------- 효과 적용 ----------
function applyFx(state, data, rng, cx, fx) {
  const p = state.player;
  const out = [];
  for (const [k, v] of Object.entries(fx || {})) {
    if (STATS.includes(k)) p.stats[k] = clamp(p.stats[k] + v, 0, 100);
    else if (k === 'hp') p.hp = clamp(p.hp + (v < 0 ? Math.round(v * (1 - guardOf(data, p))) : v), -50, 100);
    else if (k === 'fatigue') p.fatigue = clamp(p.fatigue + v, 0, 100);
    else if (k === 'coins') p.coins = Math.max(0, p.coins + v);
    else if (k === 'coinsPct') p.coins = Math.max(0, Math.round(p.coins * (1 + v)));
    else if (k === 'fame') p.fame = Math.max(0, p.fame + v);
    else if (k === 'notoriety') p.notoriety = Math.max(0, p.notoriety + v);
    else if (k === 'prep') cx.n.revolutionPrep += v;
    else if (k === 'stab') cx.n.stability = clamp(cx.n.stability + v, 0, 100);
    else if (k === 'houseFavor') p.houseFavor = clamp(p.houseFavor + v, -50, 100);
    else if (k === 'progress' && p.awakened) p.progress += v;
    else if (k === 'npcRel' && cx.npc) p.npcRel[cx.npc.id] = (p.npcRel[cx.npc.id] || 0) + v;
    else if (k === 'slay' && cx.monster) state.monsters = state.monsters.filter((m) => m.id !== cx.monster.id);
    else if (k === 'rumor') out.push(rumorText(state, data, rng, cx));
    else if (k === 'travelFast' && p.travel) p.travel.done += 1;
    else if (k === 'join') out.push(join(state, data, rng, cx, v));
    else if (k === 'awaken') { const t = tryAwaken(state, data, rng, cx, v); if (t) out.push(t); }
    else if (k === 'giveItem') { addItem(p, v); out.push(`${J(itemOf(data, v).name, '을', '를')} 얻었다.`); }
    else if (k === 'giveRelic') { const r = pick(rng, data.items.relics); addItem(p, r.id); out.push(`${J(r.name, '을', '를')} 손에 넣었다.`); }
    else if (k === 'nemesis' && v === 'bandit') setNemesis(state, data, 'bandit', { id: 'bandit', name: '복면 무리의 두목' });
    else if (k === 'killNemesis' && p.nemesis) {
      if (p.nemesis.kind === 'monster') state.monsters = state.monsters.filter((m) => m.id !== p.nemesis.id);
      p.memory.push({ year: state.year, week: state.week, kind: 'revenge', text: `${J(p.nemesis.name, '을', '를')} 끝내 쓰러뜨렸다.` });
      chronicle(state, fill('{p:이} 오랜 원수 {n:을} 쓰러뜨렸다.', { p: p.name, n: p.nemesis.name }), 40);
      p.nemesis = null;
    }
    else if (k === 'nemesisGrow') growNemesis(state, data);
    // 세계를 움직이는 효과: 평소에는 작고, 결정적 순간에는 크다 (lore/12 10절)
    else if (k === 'warAid' && cx.atWar) { state.warAid ??= {}; state.warAid[cx.nid] = Math.min(100, (state.warAid[cx.nid] || 0) + v); }
    else if (k === 'forceUprising') { cx.n.revolutionPrep = Math.max(cx.n.revolutionPrep, 100); cx.n.forceUprising = p.personId; chronicle(state, fill('{n}의 무명회가 봉기를 결심했다. 그 앞에 {p:이} 섰다.', { n: data.nationById[cx.nid].name, p: p.name }), 70); }
    else if (k === 'houseLoyalty' && p.house) state.houses[p.house].loyalty = clamp(state.houses[p.house].loyalty + v, 0, 100);
    else if (k === 'houseInfluence' && p.house) state.houses[p.house].influence = clamp(state.houses[p.house].influence + v, 10, 100);
    else if (k === 'advise') {
      if (v === 'peace') for (const [key, val] of Object.entries(state.relations)) { if (key.split('|').includes(cx.nid) && val < 0) state.relations[key] = val + 6; }
      if (v === 'tax') { cx.n.stability = clamp(cx.n.stability + 5, 0, 100); cx.n.treasury -= 30; cx.n.revolutionPrep -= 5; }
      if (v === 'war') { cx.n.army += 0.5; cx.n.treasury -= 25; }
      chronicle(state, fill('{n}의 지도자가 {p}의 조언을 받아들였다.', { n: data.nationById[cx.nid].name, p: p.name }), 25);
    }
    else if (k === 'assassinate') {
      const r = state.persons[state.rulers[cx.nid]];
      if (r?.alive) {
        const ctx2 = { log: (kind, text, extra = {}) => state.log.push({ year: state.year, kind, text, ...extra }), name: (id) => data.nationById[id].name, admin: false };
        state.log.push({ year: state.year, kind: 'revolution', cat: '혁명', text: fill('{n}의 {t} {r:이} 한밤중에 살해되었다. 범인은 잡히지 않았다. 궁 안에서는 마법도 오러도 감지되지 않았다는 말이 돌았다.', { n: data.nationById[cx.nid].name, t: r.title, r: r.name }), ids: [cx.nid], persons: [r.id], w: 90, head: `${data.nationById[cx.nid].name}의 지도자가 쓰러진 해` });
        cx.n.stability = clamp(cx.n.stability - 15, 0, 100);
        personDies(state, data, rng, ctx2, r, 'assassination');
        p.memory.push({ year: state.year, week: state.week, kind: 'assassin', text: `${r.title} ${J(r.name, '을', '를')} 쓰러뜨렸다. 아무도 모른다.` });
      }
    }
    else if (k === 'loveUp' && p.family?.partner) p.family.love = clamp(p.family.love + v, 0, 100);
    else if (k === 'revealPlace' && v === 'legend') { const L = (state.legends || []).slice(-1)[0]; if (L?.place && !p.known.includes(L.place)) p.known.push(L.place); }
    else if (k === 'tip') { const it = pick(rng, data.items.goods); if (cx.ps) cx.ps.drift[it.id] = -0.2; out.push(`${it.name} 값이 오를 거라는 말을 들었다.`); }
  }
  if (p.hp < 15 && !p.awakened) { const t = tryAwaken(state, data, rng, cx, 2); if (t) out.push(t); }
  return out;
}

function join(state, data, rng, cx, what) {
  const p = state.player;
  if (what === 'army') {
    p.affiliation = 'army';
    journal(state, `${data.nationById[cx.nid].name}의 군대에 들어갔다.`);
    return '';
  }
  if (what === 'nameless') {
    p.affiliation = 'nameless';
    p.house = null;
    return '이제 나는 무명회의 사람이다. 이 사실은 누구에게도 말할 수 없다.';
  }
  if (what === 'house') {
    const hs = Object.values(state.houses).filter((h) => h.nation === cx.nid && !h.exiled);
    if (!hs.length) return '';
    const h = pick(rng, hs);
    p.house = h.id; p.affiliation = 'house'; p.houseFavor = 10;
    chronicle(state, fill('{p:이} {h} 가문의 객식구가 되었다.', { p: p.name, h: h.name }), 25);
    return '';
  }
  return '';
}

function maxGrade(size) { return size >= 90 ? 5 : size >= 75 ? 4 : size >= 60 ? 3 : size >= 45 ? 2 : 1; }

function tryAwaken(state, data, rng, cx, k) {
  const p = state.player;
  if (p.awakened || p.vessel.size < 35) return null;
  if (rng() > (p.vessel.size / 100) * 0.16 * k) return null;
  p.awakened = true; p.grade = 1; p.progress = 0; p.vessel.known = true;
  const el = pick(rng, data.elements.list).name;
  const text = fill(data.player.awakenTexts[p.vessel.dir], { el });
  const n = state.nations[p.nation];
  if (p.vessel.dir === 'dual') { n.mages[0] += 1; n.aura[0] += 1; } else n[p.vessel.dir === 'magic' ? 'mages' : 'aura'][0] += 1;
  const person = state.persons[p.personId];
  if (person) { person.type = p.vessel.dir; person.grade = 1; person.role = p.vessel.dir === 'dual' ? 'hero' : 'player'; deed(state, person, '위기 속에서 그릇이 깨어났다.'); }
  if (p.vessel.dir === 'dual') chronicle(state, fill('{n}에서 {p:이} 마법과 오러를 함께 일으켰다. 가문들이 추측만 하던 양방향 그릇이 또 하나 깨어났다.', { n: data.nationById[cx.nid].name, p: p.name }), 85);
  else chronicle(state, fill('{n}의 {p:이} 위기 속에서 {t:을} 깨웠다. 가문 밖에서 일어난 드문 각성이었다.', { n: data.nationById[cx.nid].name, p: p.name, t: p.vessel.dir === 'magic' ? '마법' : '오러' }), 45);
  journal(state, text, { big: true });
  return text;
}

function rumorText(state, data, rng, cx) {
  const items = [];
  const recent = state.log.filter((l) => !l.hidden && l.year >= state.year - 1 && (l.w || 0) >= 15);
  if (recent.length) items.push(`사람들이 수군거린다. "${pick(rng, recent).text.split('. ')[0].replace(/\.$/, '')}."`);
  if (state.legend) items.push(`${data.nationById[state.legend.nation].name}에 ‘${state.legend.epithet}’라는 괴물이 산다는 이야기가 돈다.`);
  if (cx.atWar) items.push(`${data.nationById[cx.enemyId].name}과의 전쟁이 언제 끝날지 아무도 모른다고 한다.`);
  if (cx.n.revolutionPrep > 70 && !state.alchemyRevealed) items.push('밤마다 뒷골목에서 사람들이 모였다 흩어진다는 말이 있다.');
  const gap = state.year - state.lastEruption;
  if (gap >= 9) items.push('노인들이 이제 곧 화산이 깨어날 거라며 산모들을 걱정한다.');
  if (cx.monsters.length) items.push(fill('근처에 {m:이} 나타났다고 한다. 현상금이 걸렸다.', { m: pick(rng, cx.monsters).name }));
  return items.length ? pick(rng, items) : '별다른 소문은 없었다.';
}

// ---------- 행동 ----------
export function availableActions(state, data, places) {
  const cx = context(state, data, places);
  const { p, place } = cx;
  if (!p?.alive || p.encounter) return [];
  if (p.travel) return [{ id: 'continue', name: '계속 가기', enabled: true }, { id: 'rest', name: '길에서 쉬기', enabled: true }];
  const A = data.player.actions;
  const list = [];
  const add = (id, enabled = true, reason = '') => list.push({ id, name: A[id].name, desc: A[id].desc, enabled, reason });
  if (A.socialize) list.push({ id: 'socialize', name: A.socialize.name, desc: A.socialize.desc, enabled: true });
  add('work'); add('train'); add('study', p.coins >= 2, '돈이 모자란다'); add('rumor'); add('rest'); add('travel');
  add('hunt', cx.monsters.length > 0, '근처에 마물이 없다');
  if (place?.kind === 'seat' || place?.kind === 'capital') add('visitHouse', p.affiliation !== 'house', '이미 가문에 속해 있다');
  if (cx.n.revolutionPrep >= 40 || state.alchemyRevealed) add('seekNameless', p.affiliation !== 'nameless', '이미 무명회의 사람이다');
  if (p.affiliation === 'nameless' && cx.n.type !== 'revolution') add('mission');
  if (p.awakened) add('meditate');
  add('trade', p.coins >= 5, '밑천이 없다');
  add('steal');
  if (place?.kind === 'capital') add('petition', p.fame >= 20, '명성이 부족하다');
  add('donate', p.coins >= 10, '나눌 돈이 없다');
  if (cx.atWar || place?.nation === 'nation_merca') add('mercenary', p.affiliation !== 'army', '이미 군대에 있다');
  return list;
}

export function travelOptions(state, data, places) {
  const cx = context(state, data, places);
  const { p, place } = cx;
  if (!place) return [];
  return places.filter((x) => x.id !== place.id && (p.known || []).includes(x.id)).map((x) => {
    const sea = landmass(x.regionId) !== landmass(place.regionId);
    const d = Math.hypot(x.x - place.x, x.y - place.y);
    const horse = p.equipment?.tools.includes('horse') ? 1.4 : 1;
    const chart = p.equipment?.tools.includes('chart') ? 1 : 0;
    const weeks = Math.max(1, Math.ceil(sea ? d / 140 + 1 - chart : d / (55 * horse)));
    const fare = sea ? 6 + weeks * 2 : 0;
    const ok = !sea || (place.port && (x.port || places.some((q) => q.nation === x.nation && q.port)));
    return { place: x, weeks, fare, sea, ok, reason: !ok ? '항구에서만 바다를 건널 수 있다' : p.coins < fare ? '뱃삯이 모자란다' : '' };
  }).sort((a, b) => a.weeks - b.weeks);
}

export function doAction(state, data, rng, places, id, arg = {}) {
  const cx = context(state, data, places);
  const { p, place } = cx;
  const A = data.player.actions;
  const texts = [];
  const pl = place?.name ?? '길';
  const say = (t) => texts.push(t);
  const gain = (stat, [lo, hi]) => { const g = lo + Math.floor(rng() * (hi - lo + 1)); p.stats[stat] = clamp(p.stats[stat] + g, 0, 100); return g; };

  switch (id) {
    case 'work': {
      const kind = place?.kind ?? 'road';
      const job = pick(rng, A.work.jobs[kind] || A.work.jobs.town);
      const wf = data.player.weatherFx[p.weather]?.work ?? 0;
      let pay = Math.round((A.work.pay[0] + rng() * (A.work.pay[1] - A.work.pay[0])) * (1 + wf) * (cx.n.famine ? 0.7 : 1) * (p.affiliation === 'house' ? 1.3 : 1));
      if (p.weather === '폭풍' && rng() < 0.4) { say(`${pl}에서 일하려 했지만 폭풍 때문에 일거리가 없었다.`); pay = 1; }
      else say(`${pl}에서 ${job}. ${pay}냥을 벌었다.`);
      p.coins += pay; p.fatigue += A.work.fatigue; gain('survival', [0, 1]);
      break;
    }
    case 'train': {
      const g = gain('sword', A.train.gain) + (place?.kind === 'seat' || p.affiliation === 'house' ? gain('sword', [0, 1]) : 0);
      say(pick(rng, [`해가 질 때까지 나무 기둥을 베었다. 검술이 ${g} 늘었다.`, `떠돌이 검객에게 동전 몇 닢을 주고 한 수 배웠다. 검술이 ${g} 늘었다.`, `손바닥이 터질 때까지 칼을 휘둘렀다. 검술이 ${g} 늘었다.`]));
      p.fatigue += A.train.fatigue;
      break;
    }
    case 'study': {
      const bonus = place?.kind === 'capital' || place?.kind === 'seat' ? 1 : 0;
      const g = gain('lore', A.study.gain) + bonus;
      p.stats.lore += bonus;
      p.coins -= A.study.cost;
      say(pick(rng, [`${pl}의 서고에서 오래된 연대기를 읽었다. 학식이 ${g} 늘었다.`, `떠돌이 학자에게 글을 배웠다. 학식이 ${g} 늘었다.`, `대범람 이전의 지명이 적힌 지도를 베껴 그렸다. 학식이 ${g} 늘었다.`]));
      p.fatigue += A.study.fatigue;
      break;
    }
    case 'rumor': {
      p.coins = Math.max(0, p.coins - 1);
      gain('speech', A.rumor.gain);
      say(`${pl}의 주막에서 귀를 기울였다. ${rumorText(state, data, rng, cx)}`);
      p.fatigue += A.rumor.fatigue;
      break;
    }
    case 'rest': {
      const r = A.rest.hp + (place?.kind === 'capital' ? 4 : 0);
      p.hp = Math.min(100, p.hp + r); p.fatigue = Math.max(0, p.fatigue + A.rest.fatigue);
      say(pick(rng, ['푹 잤다. 몸이 한결 가볍다.', '하루 종일 아무것도 하지 않았다. 그것만으로 충분했다.', '따뜻한 국 한 그릇과 긴 잠. 기운이 돌아왔다.']));
      break;
    }
    case 'continue': say('길을 재촉했다.'); break;
    case 'travel': {
      const opt = travelOptions(state, data, places).find((o) => o.place.id === arg.to);
      if (!opt || !opt.ok || p.coins < opt.fare) { say('그곳으로는 지금 갈 수 없다.'); return { texts, noTurn: true }; }
      p.coins -= opt.fare;
      p.travel = { from: place.id, to: opt.place.id, weeks: opt.weeks, done: 0, sea: opt.sea };
      p.affiliation = p.affiliation === 'army' ? 'none' : p.affiliation;
      say(opt.sea ? `${opt.fare}냥을 내고 배에 올랐다. ${opt.place.name}까지 ${opt.weeks}주가 걸린다.` : fill('{d:으로} 길을 나섰다. {w}주쯤 걸릴 것이다.', { d: opt.place.name, w: opt.weeks }));
      journal(state, texts[0]);
      return { texts, encounter: null, ...advanceWeek(state, data, rng, places, arg.hooks) };
    }
    case 'hunt': {
      const m = pick(rng, cx.monsters);
      const dc = 25 + m.tier * 15;
      let ronBonus = 0;
      if (p.awakened) { if (p.ron.cur >= 15) { p.ron.cur -= 15; ronBonus = p.grade * 18; } else ronBonus = p.grade * 5; }
      const power = p.stats.sword + gearBonus(data, p, 'sword') + gearBonus(data, p, 'hunt') + p.stats.survival * 0.3 + ronBonus + rng() * 60;
      p.fatigue += A.hunt.fatigue;
      if (power >= dc) {
        state.monsters = state.monsters.filter((x) => x.id !== m.id);
        const reward = m.tier * 6 + Math.floor(rng() * 6);
        p.coins += reward; p.fame += m.tier * 2; gain('sword', [1, 2]); gain('survival', [1, 2]);
        if (m.tier >= 3) p.kills = (p.kills || 0) + 1;
        if (p.nemesis?.id === m.id) { p.memory.push({ year: state.year, week: state.week, kind: 'revenge', text: `원수 ${J(m.name, '을', '를')} 쓰러뜨렸다.` }); p.nemesis = null; }
        say(`${m.name}의 굴을 찾아냈다. 긴 싸움 끝에 쓰러뜨렸다. 현상금 ${reward}냥과 명성을 얻었다.`);
        if (m.tier >= 3) chronicle(state, fill('{p:이} {m:을} 홀로 쓰러뜨렸다.', { p: p.name, m: m.name }), 25);
      } else {
        const dmg = Math.round((10 + m.tier * 9) * (1 - guardOf(data, p)));
        p.hp -= dmg;
        setNemesis(state, data, 'monster', { id: m.id, name: m.name, tier: m.tier, regionId: m.regionId });
        say(`${m.name}에게 덤볐다가 크게 당했다. 겨우 목숨만 건졌다.`);
        const t = tryAwaken(state, data, rng, cx, m.tier / 2 + 1);
        if (t) say(t);
      }
      break;
    }
    case 'visitHouse': {
      const h = place.kind === 'seat' ? state.houses[place.house] : Object.values(state.houses).find((x) => x.nation === place.nation && x.ruling);
      if (!h || h.exiled) { say('그 가문은 이미 이 땅에 없다.'); break; }
      const fits = p.awakened && (p.vessel.dir === 'dual' || (p.vessel.dir === 'magic') === (h.type === 'magic'));
      if (fits) {
        p.house = h.id; p.affiliation = 'house'; p.houseFavor = 25;
        say(`${h.name} 가문의 수장 앞에서 힘을 보였다. 수장은 나를 가문의 ${h.type === 'magic' ? '마법사' : '기사'}로 받아들였다.`);
        chronicle(state, fill('{p:이} {h} 가문에 들어갔다. 가문 밖에서 깨어난 그릇이 가문의 문장을 달았다.', { p: p.name, h: h.name }), 40);
      } else if (p.fame >= 15 || p.stats.sword >= 35) {
        p.house = h.id; p.affiliation = 'house'; p.houseFavor = 10;
        say(`${h.name} 가문이 나를 객식구로 받아들였다. 재능은 없어도 쓸모는 있다고 했다.`);
      } else {
        say(pick(rng, [`${h.name} 가문의 문지기는 나를 쳐다보지도 않았다.`, `${h.name} 가문의 집사가 '그릇도 이름도 없는 자는 받지 않는다'고 했다.`]));
        p.fatigue += 5;
      }
      break;
    }
    case 'seekNameless': {
      if (check(state, data, 'stealth', 45, rng) && check(state, data, 'speech', 35, rng)) {
        say('며칠을 헤맨 끝에 방앗간 뒤에서 두건 쓴 사람들을 만났다. 그들은 오래 나를 시험하더니 받아들였다.');
        say(join(state, data, rng, cx, 'nameless'));
        journal(state, '무명회에 들어갔다.', { secret: true });
      } else say('흔적은 있었지만 끝내 닿지 못했다. 누군가 나를 지켜보는 느낌만 남았다.');
      p.fatigue += 15;
      break;
    }
    case 'meditate': {
      const g = 8 + Math.floor(rng() * 10) + (p.affiliation === 'house' ? 5 : 0);
      p.progress += g; p.fatigue += A.meditate.fatigue;
      say(p.vessel.dir === 'magic' ? '고리를 엮고 푸는 연습을 반복했다.' : p.vessel.dir === 'aura' ? '막을 두르고 버티는 시간을 늘렸다.' : '두 갈래의 힘이 다투지 않도록 숨을 골랐다.');
      break;
    }
    case 'trade': {
      const ok = check(state, data, 'speech', 40, rng);
      const amt = 3 + Math.floor(rng() * 12);
      if (ok) { p.coins += amt; say(`${pl}의 물건을 싸게 사서 되팔았다. ${amt}냥이 남았다.`); }
      else { p.coins = Math.max(0, p.coins - Math.ceil(amt / 2)); say('흥정에서 밀렸다. 손해를 봤다.'); }
      gain('speech', [0, 1]);
      break;
    }
    case 'steal': {
      if (check(state, data, 'stealth', 45, rng)) { const g = 6 + Math.floor(rng() * 14); p.coins += g; p.notoriety += 2; gain('stealth', [1, 2]); say(`가문 하인의 돈주머니를 슬쩍했다. ${g}냥.`); }
      else { p.hp -= 12; p.notoriety += 5; say('붙잡혀 실컷 두들겨 맞았다. 얼굴이 알려졌다.'); }
      break;
    }
    case 'petition': {
      const r = state.persons[state.rulers[place.nation]];
      const now = state.year * 52 + state.week;
      if (now - (p.flags.lastPetition ?? -999) < 26) { say('성문지기가 얼굴을 알아보고 고개를 저었다. 같은 사람을 그렇게 자주 들여보내지는 않는다.'); break; }
      p.flags.lastPetition = now;
      if (check(state, data, 'speech', 50, rng)) { p.coins += 20; p.fame += 5; say(fill('{t} {r:을} 알현했다. 그는 내 이야기를 끝까지 들었고, 금화를 내렸다.', { t: r?.title ?? '지도자', r: r?.name ?? '' })); chronicle(state, fill('{p:이} {n}의 {t:을} 알현했다.', { p: p.name, n: data.nationById[place.nation].name, t: r?.title ?? '지도자' }), 20); }
      else say('성문 앞에서 사흘을 기다렸지만 들여보내 주지 않았다.');
      break;
    }
    case 'donate': {
      const recent = state.year * 52 + state.week - (p.flags.lastDonate ?? -99) < 8;
      p.flags.lastDonate = state.year * 52 + state.week;
      p.coins -= 10; p.fame += recent ? 0 : 3; cx.n.stability = clamp(cx.n.stability + 0.5, 0, 100);
      say(pick(rng, ['굶주린 아이들에게 빵을 사 주었다.', '과부의 밀린 집세를 대신 내 주었다.', '마을 우물을 고칠 돈을 보탰다.']));
      break;
    }
    case 'meet': {
      say(meetPerson(state, data, rng, arg.pid, arg.kind, (stat, dc) => check(state, data, stat, dc, rng)));
      p.fatigue += 8;
      break;
    }
    case 'mission': {
      p.flags.missions = (p.flags.missions || 0) + 1;
      if (check(state, data, 'stealth', 40, rng)) {
        cx.n.revolutionPrep += 1.5 + Math.random() * 1.5;
        p.coins += 3; gain('stealth', [0, 1]);
        say(pick(rng, ['밤새 전단을 붙이고 새벽에 돌아왔다.', '폭약 상자를 수레 밑에 숨겨 옮겼다.', '가문 기사들의 순찰 시간을 적어 넘겼다.', '새로 들어온 사람들에게 연락 방법을 가르쳤다.']) + ' 이 나라의 거리가 아주 조금 달라졌다.');
      } else {
        p.notoriety += 4; p.hp -= Math.round(12 * (1 - guardOf(data, p)));
        say('경비대의 눈에 띄었다. 겨우 빠져나왔지만 얼굴이 알려졌다.');
      }
      p.fatigue += A.mission.fatigue;
      break;
    }
    case 'socialize': {
      say(socialize(state, data, rng, place));
      p.fatigue += A.socialize.fatigue; gain('speech', [0, 1]);
      break;
    }
    case 'mercenary': {
      p.affiliation = 'army'; p.coins += 10;
      say('용병 계약서에 손도장을 찍었다. 선금 10냥을 받았다.');
      break;
    }
    default: {
      if (id.startsWith('flavor:')) {
        const F = data.player.flavor[id.slice(7)];
        if (!F) break;
        let o = pick(rng, F.outcomes);
        if (o.check && !check(state, data, o.check[0], o.check[1], rng)) o = F.outcomes.find((x) => !x.check) || o;
        say(`${fill(pick(rng, F.texts), { pl })} ${o.t}`);
        texts.push(...applyFx(state, data, rng, cx, o.fx).filter(Boolean));
      }
    }
  }
  if (arg.free) journal(state, `(직접 한 행동) ${arg.free}`);
  texts.forEach((t) => t && journal(state, t));
  return { texts, ...advanceWeek(state, data, rng, places, arg.hooks) };
}

// ---------- 조우 ----------
function rollEncounter(state, data, rng, places) {
  const cx = context(state, data, places);
  const p = state.player;
  const chance = p.travel ? 0.5 : 0.32;
  if (rng() > chance) return null;
  const pool = data.player.encounters.filter((e) => e.when.every((c) => cond(c, state, data, cx)));
  if (!pool.length) return null;
  const total = pool.reduce((s, e) => s + e.w, 0);
  let r = rng() * total;
  let e = pool[0];
  for (const x of pool) { r -= x.w; if (r <= 0) { e = x; break; } }
  const vars = {
    pl: cx.place?.name ?? '길', n: data.nationById[cx.nid].name, o: cx.enemyId ? data.nationById[cx.enemyId].name : '',
    m: cx.monsters[0]?.name, h: p.house ? state.houses[p.house]?.name : pick(rng, Object.values(state.houses).filter((h) => h.nation === cx.nid).concat(Object.values(state.houses))).name,
    lm: state.legend ? `‘${state.legend.epithet}’` : '', npc: cx.champions.length ? pick(rng, cx.champions).name : '',
  };
  const text = fill(e.text.replace(/\[\[(\w+)\]\]/g, (_, k) => pick(rng, data.player.common[k] || [''])).replace(/\[\[(\w+)\]\]/g, (_, k) => pick(rng, data.player.common[k] || [''])), vars);
  return { id: e.id, text, vars, monsterId: cx.monsters[0]?.id ?? null, npcId: cx.champions.find((c) => c.name === vars.npc)?.id ?? null };
}

export function resolveChoice(state, data, rng, places, idx) {
  const p = state.player;
  const enc = p.encounter;
  const def = data.player.encounters.find((e) => e.id === enc.id);
  const ch = def.choices[idx];
  const cx = context(state, data, places);
  cx.monster = state.monsters.find((m) => m.id === enc.monsterId);
  cx.npc = state.persons[enc.npcId];
  if (ch.need?.coins && p.coins < ch.need.coins) return { texts: ['그럴 돈이 없다.'], noTurn: true };
  const ok = !ch.check || check(state, data, ch.check[0], ch.check[1], rng);
  const res = ok ? ch.ok : ch.no;
  const texts = [fill(res.t, enc.vars)];
  texts.push(...applyFx(state, data, rng, cx, res.fx).filter(Boolean));
  p.encounter = null;
  journal(state, `${enc.text} → ${ch.label}. ${texts.join(' ')}`);
  checkMilestones(state);
  checkDeath(state, data, places);
  return { texts };
}

// ---------- 한 주 흐르기 ----------
export function advanceWeek(state, data, rng, places, hooks) {
  const p = state.player;
  const out = { worldYear: false, arrived: null };
  // 날씨
  const season = seasonOf(data, state.week);
  p.weather = weighted(rng, season.weather);
  const wf = data.player.weatherFx[p.weather] || {};
  if (wf.hp) p.hp += wf.hp;
  if (wf.fatigue) p.fatigue += wf.fatigue;
  // 이동
  if (p.travel) {
    let step = 1 + (wf.travel || 0);
    if (p.travel.sea && wf.sea) step = Math.max(0, step + wf.sea);
    p.travel.done += Math.max(0.3, step);
    if (p.travel.done >= p.travel.weeks) {
      const dest = places.find((x) => x.id === p.travel.to);
      p.place = dest.id; p.travel = null;
      // 도착한 곳과 그 나라의 장소들이 지도에 밝혀진다
      for (const q of places.filter((x) => x.nation === dest.nation)) if (!p.known.includes(q.id)) p.known.push(q.id);
      if (dest.kind === 'capital' && !p.visitedCapitals.includes(dest.nation)) p.visitedCapitals.push(dest.nation);
      out.arrived = dest;
      journal(state, `${dest.name}에 도착했다.`);
    }
  }
  // 생활비와 피로
  const cx = context(state, data, places);
  const { w, cap } = carry(data, p);
  if (w > cap) { p.fatigue += 15; journal(state, '짐이 너무 무거워 걸음이 느려지고 몸이 상한다.'); }
  const cost = (cx.place?.kind === 'capital' || cx.place?.port ? 4 : 3) * (cx.n.famine ? 2 : 1) - (p.affiliation === 'house' ? 2 : 0) + (p.travel ? 1 : 0);
  if (p.affiliation === 'army') { p.coins += 3; if (!cx.atWar) { p.affiliation = 'none'; journal(state, '전쟁이 끝나 군대에서 풀려났다.'); } }
  if (p.coins >= cost) p.coins -= Math.max(0, cost);
  else if (p.inventory?.bread > 0) { p.inventory.bread -= 1; if (!p.inventory.bread) delete p.inventory.bread; journal(state, '돈이 없어 챙겨 둔 마른 빵으로 버텼다.'); }
  else { p.coins = 0; p.hp -= 6; journal(state, '먹을 것을 살 돈이 없어 굶었다.'); }
  if (p.fatigue > 80) p.hp -= 4;
  else if (p.fatigue < 30) p.hp = Math.min(100, p.hp + 2);
  p.fatigue = clamp(p.fatigue - 8, 0, 100);
  // 그릇의 성장
  if (p.awakened && p.progress >= p.grade * 45 && p.grade < maxGrade(p.vessel.size)) {
    p.progress = 0;
    const n = state.nations[p.nation];
    const ks = p.vessel.dir === 'dual' ? ['mages', 'aura'] : [p.vessel.dir === 'magic' ? 'mages' : 'aura'];
    for (const k of ks) { n[k][p.grade - 1] = Math.max(0, n[k][p.grade - 1] - 1); n[k][p.grade] += 1; }
    p.grade += 1;
    const label = p.vessel.dir === 'magic' ? `${p.grade}환` : p.vessel.dir === 'aura' ? `${p.grade}막` : `${p.grade}등급`;
    journal(state, `그릇이 한 겹 더 깊어졌다. 이제 ${label}이다.`, { big: true });
    if (p.grade >= 3) chronicle(state, fill('{p:이} {g}에 올랐다.', { p: p.name, g: label }), 30 + p.grade * 5);
    const person = state.persons[p.personId];
    if (person) person.grade = p.grade;
  }
  for (const t of weeklyLife(state, data, rng, places)) { journal(state, t, { big: true }); out.notes = [...(out.notes || []), t]; }
  syncRon(p);
  // 세계가 1년 흐른다
  state.week += 1;
  if (state.week > 52) {
    state.week = 1;
    p.age += 1;
    if (state.persons[p.personId]) state.persons[p.personId].age = p.age;
    yearlyLife(state);
    hooks?.worldStep?.();
    out.worldYear = true;
    journal(state, `한 해가 지났다. ${state.yearSummaries[state.year] ?? ''}`, { big: true });
  }
  // 이번 주의 조우
  if (p.alive && !p.encounter) p.encounter = rollEncounter(state, data, rng, places);
  checkMilestones(state);
  checkDeath(state, data, places);
  return out;
}

function checkMilestones(state) {
  const p = state.player;
  for (const t of [20, 50, 100]) {
    if (p.fame >= t && !p.flags[`fame${t}`]) {
      p.flags[`fame${t}`] = true;
      chronicle(state, t === 20 ? fill('{p:이}라는', { p: p.name }).replace(/이라는$|가라는$/, (m) => (m === '가라는' ? '라는' : '이라는')) + ` 이름이 장터에서 오르내리기 시작했다.` : t === 50 ? `${p.name}의 이름이 나라 밖까지 알려졌다.` : `${p.name}. 이제 리벤에서 그 이름을 모르는 사람은 드물다.`, 20 + t / 2);
    }
  }
}

function checkDeath(state, data, places) {
  const p = state.player;
  if (!p.alive || p.hp > 0) return;
  p.alive = false;
  const person = state.persons[p.personId];
  if (person) { person.alive = false; person.died = state.year; deed(state, person, '세상을 떠났다.'); }
  journal(state, `${p.name}의 이야기는 여기서 끝났다. ${p.age}세였다.`, { big: true });
  recordLegend(state, data, places || []);
  if (p.fame >= 15 || p.awakened) chronicle(state, fill('{p:이} {a}세로 세상을 떠났다.', { p: p.name, a: p.age }), 30);
}

// ---------- 직접 입력 해석 ----------
export function parseInput(text, state, data, places) {
  const t = text.trim();
  if (!t) return null;
  for (const f of data.player.forbidden) if (f.words.some((w) => t.includes(w))) return { refuse: f.text };
  const p = state.player;
  if (!p.awakened && /(마법|오러|술식|막을 두)/.test(t)) return { refuse: '아무리 집중해도 아무 일도 일어나지 않았다. 아직 깨어나지 않은 그릇은 대답하지 않는다.' };
  // 장소와 나라 이름
  const dest = places.filter((x) => t.includes(x.name)).sort((a, b) => b.name.length - a.name.length)[0]
    || (() => { const n = data.nationsList.find((x) => t.includes(x.name)); return n ? places.find((x) => x.nation === n.id && x.kind === 'capital') : null; })();
  const scored = data.player.intents.map((it) => ({ it, s: it.words.filter((w) => t.includes(w)).reduce((a, w) => a + w.length, 0) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
  if (dest && (scored[0]?.it.action === 'travel' || !scored.length)) return { action: 'travel', to: dest.id, note: fill('{d:으로} 떠나는 것으로 이해했다.', { d: dest.name }) };
  if (!scored.length) return { unknown: true };
  return { action: scored[0].it.action, alternatives: scored.slice(1, 3).map((x) => x.it.action) };
}
