// 조각 사건 엔진: data/story.json의 원형과 조각을 조합해 해마다 새로운 사건을 만든다.
// 몇 년에 걸쳐 이어지는 "이야기 줄기"도 여기서 진행한다.
import { fill, pick } from './text.js';
import { createPerson, deed, personDies, gradeLabel, newRuler } from './people.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function pickWeighted(rng, items, w) {
  const total = items.reduce((s, x) => s + w(x), 0);
  let r = rng() * total;
  for (const x of items) { r -= w(x); if (r <= 0) return x; }
  return items[items.length - 1];
}

// [[칸]]을 조각으로 채우고, 조각에 붙은 효과를 모은다
function resolve(tpl, slots, common, rng, fxOut) {
  return tpl.replace(/\[\[(\w+)\]\]/g, (_, key) => {
    const pool = slots?.[key] ?? common[key];
    if (!pool || !pool.length) return '';
    const item = pick(rng, pool);
    if (typeof item === 'string') return item;
    Object.assign(fxOut, item.fx || {});
    return item.t;
  }).replace(/\s+/g, ' ').trim();
}

export function runStory(state, data, rng, ctx) {
  const S = data.story;
  const N = state.nations;
  const def = data.nationById;
  state.threads ??= [];
  state.threadSeq ??= 1;

  // ---------- 도우미 ----------
  const housesOf = (nid) => Object.values(state.houses).filter((h) => h.nation === nid && !h.exiled);
  const alive = (nid, f = () => true) => Object.values(state.persons).filter((p) => p.alive && p.nation === nid && !p.stationedAt && f(p));
  const isChampion = (p) => p.role === 'champion' || p.role === 'hero';
  const lifespan = (p) => data.races[p.race].lifespan[1];
  const ruler = (nid) => state.persons[state.rulers[nid]];
  const regionOf = (nid) => def[nid].regionId;
  const monstersIn = (nid) => state.monsters.filter((m) => m.regionId === regionOf(nid) && !m.legend);
  const isSea = (a, b) => data.neighbors.sea.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
  const recentEnemies = (nid) => state.log.filter((l) => l.kind === 'peace' && l.year >= state.year - 3 && l.ids?.includes(nid)).map((l) => l.ids.find((x) => x !== nid)).filter(Boolean);
  const placeOf = (nid) => pick(rng, [...(S.places[nid] || []), ...S.places.generic]);

  function cond(c, nid) {
    const n = N[nid];
    if (c.startsWith('trait:')) return (ruler(nid)?.traits || []).includes(c.slice(6));
    switch (c) {
      case 'houses': return housesOf(nid).length >= 1;
      case 'houses2': return housesOf(nid).length >= 2;
      case 'unrest': return n.famine || n.stability < 50;
      case 'oldRuler': { const r = ruler(nid); return r && r.age > lifespan(r) * 0.55; }
      case 'hostileNeighbor': return ctx.neighbors(nid).some((o) => ctx.rel(nid, o) <= -20);
      case 'friendlyNeighbor': return ctx.neighbors(nid).some((o) => ctx.rel(nid, o) >= 15);
      case 'neighbor': return ctx.neighbors(nid).length > 0;
      case 'seaNeighbor': return ctx.neighbors(nid).some((o) => isSea(nid, o));
      case 'island': return n.type === 'mercenary';
      case 'recentPeace': return recentEnemies(nid).length > 0;
      case 'champion': return alive(nid, isChampion).length > 0;
      case 'champion2': return alive(nid, isChampion).length > 0 && [nid, ...ctx.neighbors(nid)].flatMap((x) => alive(x, isChampion)).length > 1;
      case 'magicChampion': return alive(nid, (p) => p.role === 'champion' && p.type === 'magic').length > 0;
      case 'auraChampion': return alive(nid, (p) => p.role === 'champion' && p.type === 'aura').length > 0;
      case 'oldChampion': return alive(nid, (p) => isChampion(p) && p.age > lifespan(p) * 0.6).length > 0;
      case 'monsterHere': return monstersIn(nid).length > 0;
      case 'river': return regionOf(nid).startsWith('region_central') || ['continent_3', 'continent_4'].includes(regionOf(nid));
      case 'coastal': return true;
      case 'afterEruption': return state.year - state.lastEruption <= 2;
      case 'central': return regionOf(nid).startsWith('region_central');
      case 'revealed': return state.alchemyRevealed;
      case 'notRevealed': return !state.alchemyRevealed;
      case 'coexistOrRevolution': return ['coexist', 'revolution', 'mercenary'].includes(n.type);
      default: return false;
    }
  }

  // 등장인물과 상대를 정한다. 조건이 맞지 않으면 null
  function bind(a, nid) {
    const v = { nid, n: def[nid].name, pl: placeOf(nid), persons: [] };
    const r = ruler(nid);
    if (r) { v.t = r.title; v.r = r.name; }
    const hs = housesOf(nid);
    // 상대
    switch (a.target) {
      case 'rivalHouse': if (hs.length < 2) return null; break;
      case 'hostile': { const os = ctx.neighbors(nid).filter((o) => ctx.rel(nid, o) <= -20); if (!os.length) return null; v.oid = pick(rng, os); break; }
      case 'friendly': { const os = ctx.neighbors(nid).filter((o) => ctx.rel(nid, o) >= 15); if (!os.length) return null; v.oid = pick(rng, os); break; }
      case 'neighbor': { const os = ctx.neighbors(nid); if (!os.length) return null; v.oid = pick(rng, os); break; }
      case 'seaNeighbor': { const os = ctx.neighbors(nid).filter((o) => isSea(nid, o)); if (!os.length) return null; v.oid = pick(rng, os); break; }
      case 'patron': { const p = state.patrons.find((x) => x.island === nid); if (!p) return null; v.oid = p.patron; break; }
      case 'recentEnemy': { const os = recentEnemies(nid); if (!os.length) return null; v.oid = pick(rng, os); break; }
      case 'monster': { const ms = monstersIn(nid); if (!ms.length) return null; v.mon = pick(rng, ms); v.m = v.mon.name; break; }
      case 'rivalChampion': break;
      default: break;
    }
    if (v.oid) v.o = def[v.oid].name;
    if (!v.mon && (a.when || []).includes('monsterHere')) { const ms = monstersIn(nid); if (!ms.length) return null; v.mon = pick(rng, ms); v.m = v.mon.name; }
    // 주인공
    let actor = null;
    const champs = (f) => alive(nid, (p) => isChampion(p) && f(p));
    switch (a.actor) {
      case 'ruler': actor = r; break;
      case 'head': {
        const cand = hs.filter((h) => !h.ruling && state.persons[h.head]?.alive && state.persons[h.head].id !== r?.id);
        if (!cand.length) return null;
        const h = pick(rng, cand); actor = state.persons[h.head]; v.house = h; break;
      }
      case 'champion': { const cs = champs(() => true); if (!cs.length) return null; actor = pick(rng, cs); break; }
      case 'magicChampion': { const cs = champs((p) => p.type === 'magic'); if (!cs.length) return null; actor = pick(rng, cs); break; }
      case 'auraChampion': { const cs = champs((p) => p.type === 'aura'); if (!cs.length) return null; actor = pick(rng, cs); break; }
      case 'oldChampion': { const cs = champs((p) => p.age > lifespan(p) * 0.6); if (!cs.length) return null; actor = pick(rng, cs); break; }
      case 'commoner': v.newActor = 'commoner'; break;
      case 'noble': if (!hs.length) return null; v.house = pick(rng, hs); v.newActor = 'noble'; break;
      default: break;
    }
    if (a.actor !== 'none' && !actor && !v.newActor) return null;
    v.actor = actor;
    if (!v.house && actor?.house) v.house = state.houses[actor.house];
    if (!v.house && hs.length) v.house = pick(rng, hs);
    if (a.target === 'rivalHouse' || hs.length >= 2) {
      const others = hs.filter((h) => h !== v.house);
      if (others.length) v.house2 = pick(rng, others);
    }
    if (a.target === 'rivalChampion') {
      const pool = [nid, ...ctx.neighbors(nid)].flatMap((x) => alive(x, isChampion)).filter((p) => p !== actor && (!actor || p.house !== actor.house));
      if (!pool.length) return null;
      v.bPerson = pick(rng, pool);
    }
    if (a.second === 'champion') {
      const cs = champs(() => true);
      if (!cs.length) return null;
      v.bPerson = pick(rng, cs);
    }
    if (a.opens === 'love') {
      const ohs = housesOf(v.oid);
      if (!ohs.length) return null;
      v.house2 = pick(rng, ohs);
      v.bNew = true;
    }
    return v;
  }

  // 새 인물은 사건이 실제로 일어날 때 만든다
  function materialize(v) {
    if (v.newActor === 'commoner') {
      const job = pick(rng, data.names.commonerJobs);
      v.actor = createPerson(state, data, rng, { nation: v.nid, role: 'commoner', age: 18 + rng() * 40, job, origin: `${v.n}의 ${v.pl}` });
    } else if (v.newActor === 'noble') {
      v.actor = createPerson(state, data, rng, { nation: v.nid, house: v.house.id, role: 'noble', age: 17 + rng() * 10 });
    }
    if (v.bNew) v.bPerson = createPerson(state, data, rng, { nation: v.oid, house: v.house2.id, role: 'noble', age: 17 + rng() * 10 });
    const a = v.actor, b = v.bPerson;
    if (a) {
      v.a = a.name;
      v.job = a.job;
      v.ad = a.role === 'ruler' ? a.title
        : a.role === 'head' ? `${state.houses[a.house]?.name ?? ''} 가문의 수장`
        : a.role === 'noble' ? `${state.houses[a.house]?.name ?? ''} 가문의 젊은 자제`
        : isChampion(a) ? `${def[a.nation].name}의 ${a.type === 'dual' ? '양방향 각성자' : gradeLabel(a, data.grades)}`
        : a.job || '사람';
      v.persons.push(a.id);
    }
    if (b) {
      v.b = b.name;
      v.bd = isChampion(b) ? `${def[b.nation].name}의 ${gradeLabel(b, data.grades)}` : b.role === 'noble' ? `${state.houses[b.house]?.name ?? ''} 가문의` : '';
      v.persons.push(b.id);
    }
    v.h = v.house?.name;
    v.h2 = v.house2?.name;
  }

  function applyFx(fx, v, threadType) {
    const L = S.allowed.limits;
    const lim = (k, x) => (L[k] !== undefined ? clamp(x, -L[k], L[k]) : x);
    const n = N[v.nid];
    for (const [k, raw] of Object.entries(fx)) {
      const x = typeof raw === 'number' ? lim(k, raw) : raw;
      switch (k) {
        case 'stab': n.stability += x; break;
        case 'prep': n.revolutionPrep += x; break;
        case 'treasury': n.treasury += x; break;
        case 'trade': n.trade = Math.max(0, n.trade + x); break;
        case 'oTrade': if (v.oid) N[v.oid].trade = Math.max(0, N[v.oid].trade + x); break;
        case 'rel': if (v.oid) ctx.addRel(v.nid, v.oid, x); break;
        case 'relNelas': if (v.nid !== 'nation_nelas') ctx.addRel(v.nid, 'nation_nelas', x); break;
        case 'loyalty': if (v.house) v.house.loyalty = clamp(v.house.loyalty + x, 0, 100); break;
        case 'influence': if (v.house) v.house.influence = clamp(v.house.influence + x, 10, 100); break;
        case 'rivalLoyalty': if (v.house2) v.house2.loyalty = clamp(v.house2.loyalty + x, 0, 100); break;
        case 'rivalInfluence': if (v.house2) v.house2.influence = clamp(v.house2.influence + x, 10, 100); break;
        case 'food': n.foodMod = (n.foodMod || 0) + x; break;
        case 'pop': n.pop *= 1 + x; break;
        case 'deed': if (v.actor) deed(state, v.actor, x); break;
        case 'deedB': if (v.bPerson) deed(state, v.bPerson, x); break;
        case 'promote': {
          const a = v.actor;
          if (!a || !a.grade || a.grade >= 5) break;
          const ks = a.type === 'magic' ? ['mages'] : a.type === 'aura' ? ['aura'] : a.type === 'dual' ? ['mages', 'aura'] : [];
          for (const kk of ks) { N[a.nation][kk][a.grade - 1] = Math.max(0, N[a.nation][kk][a.grade - 1] - 1); N[a.nation][kk][a.grade] += 1; }
          a.grade += 1;
          deed(state, a, `${a.type === 'dual' ? `${a.grade}등급` : gradeLabel(a, data.grades)}에 올랐다.`);
          break;
        }
        case 'killActor': if (v.actor?.alive) personDies(state, data, rng, ctx, v.actor, 'story'); break;
        case 'killB': if (v.bPerson?.alive) personDies(state, data, rng, ctx, v.bPerson, 'story'); break;
        case 'killTargetChampion': if (v.cPerson?.alive) { personDies(state, data, rng, ctx, v.cPerson, 'story'); deed(state, v.cPerson, '복수의 칼에 쓰러졌다.'); } break;
        case 'slayMonster': if (v.mon) state.monsters = state.monsters.filter((m) => m.id !== v.mon.id); break;
        case 'crownActor': if (v.actor) { if (v.house2) { Object.values(state.houses).forEach((h) => { if (h.nation === v.nid) h.ruling = false; }); v.house2.ruling = true; } newRuler(state, data, rng, ctx, v.nid, v.actor, data.names.rulerTitles[v.nid]); } break;
        case 'becomeChampion': if (v.actor && v.bPerson) {
          const a = v.actor; a.role = 'champion'; a.type = v.bPerson.type === 'magic' ? 'magic' : 'aura'; a.grade = x;
          N[a.nation][a.type === 'magic' ? 'mages' : 'aura'][x - 1] += 1;
          deed(state, a, `${gradeLabel(a, data.grades)}에 올랐다.`);
        } break;
        case 'defectActor': if (v.actor && v.oid) { v.actor.nation = v.oid; deed(state, v.actor, fill('{o:으로} 떠났다.', { o: def[v.oid].name })); } break;
        case 'joinNameless': if (v.actor) { v.actor.side = '무명회'; n.revolutionPrep += 4; } break;
        case 'thread': openThread(x, v); break;
        default: break;
      }
    }
    void threadType;
  }

  function logStory(text, v, cat, w, extra = {}) {
    ctx.log('story', fill(text, v), { cat, ids: [v.nid, v.oid].filter(Boolean), persons: v.persons, w, ...extra });
  }

  // ---------- 이야기 줄기 ----------
  function openThread(type, v, openText = true) {
    const T = S.threads[type];
    if (!T || state.threads.length >= S.maxThreads) return;
    const th = {
      id: state.threadSeq++, type, stage: 0, nid: v.nid, oid: v.oid ?? null,
      actor: v.actor?.id ?? null, b: v.bPerson?.id ?? null, house: v.house?.id ?? null, house2: v.house2?.id ?? null,
      pl: v.pl, y: v.y ?? null, started: state.year,
    };
    if (type === 'prophecy') th.y = state.year + 2 + Math.floor(rng() * 5);
    const g = T.stages[0].gap;
    th.next = g === 'untilY' ? th.y : state.year + g[0] + Math.floor(rng() * (g[1] - g[0] + 1));
    state.threads.push(th);
    if (openText) {
      const fx = {};
      const vv = { ...v, y: th.y };
      const text = resolve(T.open.text, T.open.slots, S.common, rng, fx);
      Object.assign(fx, T.open.fx || {});
      const hidden = T.hiddenUntilRevealed && !state.alchemyRevealed;
      logStory(text, vv, T.cat, 25, { hidden, thread: th.id });
      applyFx(fx, vv, type);
    }
  }

  function threadVars(th) {
    const a = th.actor ? state.persons[th.actor] : null;
    const b = th.b ? state.persons[th.b] : null;
    const v = {
      nid: th.nid, n: def[th.nid].name, oid: th.oid, o: th.oid ? def[th.oid].name : undefined,
      pl: th.pl, y: th.y, persons: [], actor: a, bPerson: b,
      house: th.house ? state.houses[th.house] : null, house2: th.house2 ? state.houses[th.house2] : null,
    };
    const r = ruler(th.nid);
    if (r) { v.t = r.title; v.r = r.name; }
    materialize(v);
    return v;
  }

  function advanceThreads() {
    for (const th of [...state.threads]) {
      if (th.next > state.year) continue;
      const T = S.threads[th.type];
      const stage = T.stages[th.stage];
      const v = threadVars(th);
      const done = () => { state.threads = state.threads.filter((x) => x !== th); };
      if (v.actor && !v.actor.alive && th.type !== 'relic' && th.type !== 'debt') { done(); continue; }
      const fx = {};
      let text = resolve(stage.text, stage.slots, S.common, rng, fx);
      Object.assign(fx, stage.fx || {});
      const last = th.stage === T.stages.length - 1;
      if (stage.outcomes) {
        let o;
        if (T.check === 'eruption') o = state.lastEruption === th.y ? stage.outcomes.hit : stage.outcomes.miss;
        else {
          let pool = stage.outcomes;
          if (pool.some((x) => x.fx?.killTargetChampion)) {
            const targets = th.oid ? alive(th.oid, isChampion) : [];
            if (targets.length) { v.cPerson = pick(rng, targets); v.c = v.cPerson.name; v.persons.push(v.cPerson.id); }
            else pool = pool.filter((x) => !x.fx?.killTargetChampion);
          }
          o = pick(rng, pool);
        }
        text = `${text} ${o.t}`;
        Object.assign(fx, o.fx || {});
      }
      const hidden = T.hiddenUntilRevealed && !state.alchemyRevealed && !fx.reveal;
      logStory(text, v, T.cat, last ? 45 : 20, {
        hidden, thread: th.id,
        head: last && !hidden ? fill(`{a}의 ${T.name} 이야기가 매듭지어진 해`, v) : undefined,
      });
      applyFx(fx, v, th.type);
      if (last) { done(); continue; }
      th.stage += 1;
      const g = T.stages[th.stage].gap;
      th.next = g === 'untilY' ? th.y : state.year + g[0] + Math.floor(rng() * (g[1] - g[0] + 1));
    }
  }

  // 복수: 올해 전사한 강자가 있으면 혈육이 맹세한다
  function triggerRevenge() {
    for (const l of state.log.filter((x) => x.year === state.year && x.kind === 'championDeath')) {
      if (rng() > 0.6) continue;
      const fallen = state.persons[l.persons?.[0]];
      if (!fallen || !fallen.house) continue;
      const oid = l.ids.find((x) => x !== fallen.nation);
      if (!oid) continue;
      const h = state.houses[fallen.house];
      const kin = createPerson(state, data, rng, { nation: fallen.nation, house: h.id, role: 'champion', type: fallen.type, grade: 3, age: 19 + rng() * 8 });
      N[fallen.nation][fallen.type === 'magic' ? 'mages' : 'aura'][2] += 1;
      const v = { nid: fallen.nation, n: def[fallen.nation].name, oid, o: def[oid].name, pl: placeOf(fallen.nation), persons: [], actor: kin, bPerson: fallen, house: h };
      materialize(v);
      openThread('revenge', v);
    }
  }

  // ---------- 해마다 ----------
  advanceThreads();
  triggerRevenge();

  const [lo, hi] = S.perYear;
  const count = lo + Math.floor(rng() * (hi - lo + 1));
  const nids = Object.keys(N);
  const archs = S.archetypes;
  let made = 0;
  for (let tries = 0; tries < 40 && made < count; tries++) {
    const a = pickWeighted(rng, archs, (x) => x.w ?? 1);
    if (a.opens && (state.threads.length >= S.maxThreads || (a.opens === 'prophecy' && state.threads.some((t) => t.type === 'prophecy')))) continue;
    const nid = pick(rng, nids);
    if (!(a.when || []).every((c) => cond(c, nid))) continue;
    const v = bind(a, nid);
    if (!v) continue;
    materialize(v);
    if (a.opens) { openThread(a.opens, v); made++; continue; }
    const fx = {};
    const text = resolve(a.text, a.slots, S.common, rng, fx);
    Object.assign(fx, a.fx || {});
    logStory(text, v, a.cat, 18);
    applyFx(fx, v);
    made++;
  }
}
