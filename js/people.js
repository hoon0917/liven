// 인물: 지도자, 가문 수장, 이름난 강자, 영웅, 선지자, 무명회 사람들
import { pick, fill } from './text.js';

const AGE_SCALE = { race_human: 1, race_elf: 5.5, race_darkelf: 3.8, race_dwarf: 2.8, race_orc: 0.85 };

export function gradeLabel(p, grades) {
  if (!p.grade) return '';
  if (p.type === 'dual') return `${p.grade}등급 양방향 각성자`;
  return p.type === 'magic' ? `${grades.mage.levels[p.grade - 1]} 마법사` : `${grades.aura.levels[p.grade - 1]} 기사`;
}

export function makeGivenName(rng, names, nationId, raceId) {
  const pool = names.races[raceId] || names.cultures[names.nationCulture[nationId] || 'east'];
  return pick(rng, pool.a) + pick(rng, pool.b);
}

function pickRace(rng, nationDef) {
  let r = rng() * 100;
  for (const [rid, pct] of Object.entries(nationDef.races)) { r -= pct; if (r <= 0) return rid; }
  return 'race_human';
}

function traits(rng, names) {
  const a = pick(rng, names.traits).id;
  let b = pick(rng, names.traits).id;
  while (b === a) b = pick(rng, names.traits).id;
  return [a, b];
}

export function createPerson(state, data, rng, o) {
  const id = `p${state.nextPersonId++}`;
  const house = o.house ? state.houses[o.house] : null;
  const race = o.race || house?.race || pickRace(rng, data.nationById[o.nation]);
  const given = o.given || makeGivenName(rng, data.names, house?.nation || o.nation, race);
  const scale = AGE_SCALE[race] || 1;
  const age = Math.round((o.age ?? 40) * scale);
  const p = {
    id, given, name: house ? `${given} ${house.name}` : given,
    nation: o.nation, house: house?.id ?? null, race, role: o.role, title: o.title ?? null,
    type: o.type ?? 'none', grade: o.grade ?? 0, age, born: state.year - age,
    traits: o.traits || traits(rng, data.names), alive: true, hidden: !!o.hidden,
    origin: o.origin ?? null, job: o.job ?? null, stationedAt: o.stationedAt ?? null,
    side: o.side ?? null, deeds: [],
  };
  if (o.deed) p.deeds.push({ year: state.year, text: o.deed });
  state.persons[id] = p;
  return p;
}

export const deed = (state, p, text) => p.deeds.push({ year: state.year, text });

const lifespan = (data, p) => data.races[p.race].lifespan[1];

// ---------- 시작 인물 ----------
export function initPeople(state, data, rng) {
  state.persons = {};
  state.nextPersonId = 1;
  state.rulers = {};
  const T = data.names.rulerTitles;

  for (const h of Object.values(state.houses)) {
    const ruling = h.ruling;
    const p = createPerson(state, data, rng, {
      nation: h.nation, house: h.id, role: ruling ? 'ruler' : 'head',
      title: ruling ? T[h.nation] : `${h.name} 가문 수장`, age: 38 + rng() * 25,
      type: h.type, grade: 3 + (rng() < 0.4 ? 1 : 0),
    });
    h.head = p.id;
    if (ruling) state.rulers[h.nation] = p.id;
  }
  // 가문이 없는 섬나라의 지도자
  for (const n of data.nationsList) {
    if (state.rulers[n.id]) continue;
    const p = createPerson(state, data, rng, { nation: n.id, role: 'ruler', title: T[n.id], age: 40 + rng() * 20 });
    state.rulers[n.id] = p.id;
  }
  // 이름난 강자 (4~5등급)
  for (const [nid, n] of Object.entries(state.nations)) {
    const pools = [['mages', 'magic'], ['aura', 'aura']];
    let named = 0;
    for (const g of [4, 3]) {
      for (const [k, type] of pools) {
        const count = Math.min(g === 4 ? 2 : 2, Math.round(n[k][g]));
        for (let i = 0; i < count && named < 4; i++, named++) {
          const hs = Object.values(state.houses).filter((h) => h.nation === nid && h.type === type);
          if (!hs.length) continue;
          createPerson(state, data, rng, {
            nation: nid, house: pick(rng, hs).id, role: 'champion', type, grade: g + 1, age: g === 4 ? 50 + rng() * 15 : 30 + rng() * 20,
          });
        }
      }
    }
  }
  // 섬나라에 파견된 강자
  for (const pt of state.patrons) {
    const island = state.nations[pt.island];
    const type = island.dispatched.mage.some((x) => x > 0) && (pt.kind === 'house' || !island.dispatched.aura.some((x) => x > 0)) ? 'magic' : 'aura';
    const hs = Object.values(state.houses).filter((h) => h.nation === pt.patron && (pt.house ? h.id === pt.house : h.type === type));
    if (!hs.length) continue;
    const h = pick(rng, hs);
    const grade = pt.island === 'nation_quel' ? 3 : 4;
    const p = createPerson(state, data, rng, {
      nation: pt.patron, house: h.id, role: 'dispatched', type: h.type, grade, age: 35 + rng() * 15, stationedAt: pt.island,
    });
    pt.person = p.id;
  }
  // 무명회의 창시자 (연금술이 드러나기 전까지 숨은 인물)
  const f = data.world.factions[0].founder;
  const founder = createPerson(state, data, rng, {
    nation: 'nation_seradin', role: 'founder', given: f.name, race: f.race, age: state.year - f.bornYear,
    hidden: true, side: data.world.factions[0].name, origin: f.origin, traits: ['scholarly', 'cunning'],
    deed: `맹약력 ${data.world.factions[0].founded}년 ${data.world.factions[0].name}를 세웠다.`,
  });
  state.founder = founder.id;
}

// ---------- 해마다: 나이, 죽음, 계승, 영웅의 성장 ----------
export function yearlyPeople(state, data, rng, ctx) {
  const E = data.events.events;
  for (const p of Object.values(state.persons)) {
    if (!p.alive) continue;
    p.age += 1;
    const L = lifespan(data, p);
    const base = p.age < L * 0.6 ? 0.004 : 0.004 + ((p.age - L * 0.6) / (L * 0.4)) ** 2 * 0.25;
    if (rng() < base) personDies(state, data, rng, ctx, p, 'natural');
  }
  // 영웅의 성장
  for (const p of Object.values(state.persons)) {
    if (!p.alive || p.type !== 'dual' || p.grade >= 5 || rng() > 0.25) continue;
    const n = state.nations[p.nation];
    n.mages[p.grade - 1] -= 1; n.aura[p.grade - 1] -= 1;
    p.grade += 1;
    n.mages[p.grade - 1] += 1; n.aura[p.grade - 1] += 1;
    const text = fill(pick(rng, E.hero.growTexts), { p: p.name, g: `${p.grade}등급` });
    deed(state, p, `${p.grade}등급에 올랐다.`);
    ctx.log('hero', text, { ids: [p.nation], persons: [p.id], w: 30 });
  }
}

export function personDies(state, data, rng, ctx, p, cause, extra = {}) {
  p.alive = false;
  p.died = state.year;
  const E = data.events.events;
  const nationName = ctx.name(p.nation);
  const notable = ['ruler', 'hero', 'founder', 'prophet', 'dispatched'].includes(p.role) || (p.role === 'champion' && p.grade >= 5);
  if (cause === 'natural' && notable) {
    const roleText = p.title || (p.role === 'founder' ? '무명회 창시자' : p.role === 'hero' ? '양방향 각성자' : p.role === 'prophet' ? '선지자' : gradeLabel(p, data.grades) || '사람');
    deed(state, p, `${p.age}세로 세상을 떠났다.`);
    if (!p.hidden || ctx.admin) {
      ctx.log('naturalDeath', fill(pick(rng, E.naturalDeath.texts), { n: nationName, role: roleText, p: p.name, x: p.age }),
        { ids: [p.nation], persons: [p.id], hidden: p.hidden, w: p.role === 'ruler' ? 25 : 12 });
    }
  }
  if (cause === 'natural' && !notable) deed(state, p, `${p.age}세로 세상을 떠났다.`);
  if (p.type === 'dual') {
    const n = state.nations[p.nation];
    n.mages[p.grade - 1] = Math.max(0, n.mages[p.grade - 1] - 1);
    n.aura[p.grade - 1] = Math.max(0, n.aura[p.grade - 1] - 1);
  }
  if (p.role === 'ruler' && state.rulers[p.nation] === p.id) succeed(state, data, rng, ctx, p.nation, p);
  else if (p.role === 'head' && p.house && state.houses[p.house].head === p.id) {
    const h = state.houses[p.house];
    const np = createPerson(state, data, rng, { nation: h.nation, house: h.id, role: 'head', title: `${h.name} 가문 수장`, age: 30 + rng() * 20, type: h.type, grade: 3 });
    h.head = np.id;
  } else if (p.role === 'founder') {
    const f = createPerson(state, data, rng, {
      nation: p.nation, role: 'founder', hidden: p.hidden, side: p.side, age: 35 + rng() * 15, traits: ['cunning', 'brave'],
      deed: `${p.name}의 뒤를 이어 무명회를 이끌게 되었다.`,
    });
    state.founder = f.id;
  }
}

function succeed(state, data, rng, ctx, nid, old) {
  const E = data.events.events.succession;
  const T = data.names.rulerTitles;
  const n = state.nations[nid];
  const title = n.type === 'revolution' ? T.revolution : T[nid];
  const houses = Object.values(state.houses).filter((h) => h.nation === nid && !h.exiled);
  let text, persons = [], np;

  if (!houses.length || n.type === 'revolution') {
    np = createPerson(state, data, rng, { nation: nid, role: 'ruler', title, age: 40 + rng() * 15, side: n.type === 'revolution' ? '무명회' : null });
    text = fill('{n}의 새 {t:으로} {p:이} 뽑혔다.', { n: ctx.name(nid), t: title, p: np.name });
  } else {
    const ruling = houses.find((h) => h.ruling) || houses[0];
    const rival = houses.filter((h) => h !== ruling).sort((a, b) => b.influence - a.influence)[0];
    let winner = ruling;
    let dispute = false;
    if (rival && rival.influence > ruling.influence * 0.95 && rng() < 0.5) {
      dispute = true;
      winner = rng() < rival.influence / (rival.influence + ruling.influence) ? rival : ruling;
    }
    if (winner !== ruling) { ruling.ruling = false; winner.ruling = true; }
    // 새 지도자는 가문의 현 수장이 잇는다
    const head = state.persons[winner.head];
    if (head && head.alive && head.id !== old.id) { np = head; np.role = 'ruler'; np.title = title; }
    else np = createPerson(state, data, rng, { nation: nid, house: winner.id, role: 'ruler', title, age: 35 + rng() * 20, type: winner.type, grade: 3 });
    const newHead = createPerson(state, data, rng, { nation: nid, house: winner.id, role: 'head', title: `${winner.name} 가문 수장`, age: 30 + rng() * 15, type: winner.type, grade: 3 });
    winner.head = np.id;
    void newHead;
    if (dispute) {
      const loser = winner === ruling ? rival : ruling;
      loser.loyalty = Math.max(0, loser.loyalty - 15);
      n.stability -= 8;
      text = fill(pick(rng, E.disputeTexts), { n: ctx.name(nid), t: title, h: ruling.name, h2: rival.name, p: np.name });
    } else {
      text = fill(pick(rng, E.texts), { n: ctx.name(nid), t: title, h: winner.name, p: np.name });
    }
  }
  persons = [np.id];
  deed(state, np, `${ctx.name(nid)}의 ${title} 자리에 올랐다.`);
  state.rulers[nid] = np.id;
  ctx.log('succession', text, { ids: [nid], persons, w: 55, head: fill('{n}에 새 {t:이} 선 해', { n: ctx.name(nid), t: title }) });
}

export function newRuler(state, data, rng, ctx, nid, person, title) {
  const old = state.persons[state.rulers[nid]];
  if (old && old.alive) { old.role = 'deposed'; old.title = `폐위된 ${old.title}`; deed(state, old, '자리에서 쫓겨났다.'); }
  person.role = 'ruler';
  person.title = title;
  state.rulers[nid] = person.id;
  deed(state, person, `${ctx.name(nid)}의 ${title} 자리에 올랐다.`);
}
