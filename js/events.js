// 사건 엔진: data/events.json의 확률·수치·문장으로 해마다 다양한 사건을 일으킨다.
import { fill, pick, J } from './text.js';
import { createPerson, deed, personDies, gradeLabel, newRuler, makeGivenName } from './people.js';

const between = (rng, a, b) => a + rng() * (b - a);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
function shuffle(rng, arr) {
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}

const aliveChampions = (state, nid) => Object.values(state.persons).filter((p) => p.alive && p.nation === nid && ['champion', 'hero'].includes(p.role) && !p.stationedAt);
const housesOf = (state, nid) => Object.values(state.houses).filter((h) => h.nation === nid && !h.exiled);

// ---------- 전투 기록 (sim.js에서 호출) ----------
export function battleLog(state, data, rng, ctx, wid, lid, gain) {
  const E = data.events.events;
  const champs = aliveChampions(state, wid);
  const x = gain.toFixed(1);
  if (champs.length && rng() < 0.45) {
    const c = pick(rng, champs);
    const pool = E.battle.championTexts.filter((t) => (c.type === 'magic' ? !t.includes('막이') : !t.includes('하늘에서')));
    deed(state, c, `${ctx.name(lid)}과의 싸움에서 공을 세웠다.`);
    ctx.log('battle', fill(pick(rng, pool), { n: ctx.name(wid), o: ctx.name(lid), p: c.name, g: gradeLabel(c, data.grades), x }), { ids: [wid, lid], persons: [c.id] });
  } else {
    ctx.log('battle', fill(pick(rng, E.battle.texts), { n: ctx.name(wid), o: ctx.name(lid), x }), { ids: [wid, lid] });
  }
  // 강자의 전사
  for (const [nid, other, chance] of [[lid, wid, 0.07], [wid, lid, 0.025]]) {
    const cs = aliveChampions(state, nid);
    if (!cs.length || rng() > chance) continue;
    const c = pick(rng, cs);
    personDies(state, data, rng, ctx, c, 'battle');
    deed(state, c, `${ctx.name(other)}과의 싸움에서 전사했다.`);
    ctx.log('championDeath', fill(pick(rng, E.championDeath.battleTexts), { n: ctx.name(nid), o: ctx.name(other), p: c.name, g: gradeLabel(c, data.grades) }),
      { ids: [nid, other], persons: [c.id], w: 30 });
  }
}

// ---------- 해마다 일어나는 사건들 ----------
export function runEvents(state, data, rng, ctx) {
  const E = data.events.events;
  const N = state.nations;
  const ids = Object.keys(N);
  const name = ctx.name;
  const ruler = (nid) => state.persons[state.rulers[nid]];
  const traitMult = (nid, mults) => (ruler(nid)?.traits || []).reduce((m, t) => m * (mults[t] || 1), 1);
  const minor = [];
  const queue = (fn) => minor.push(fn);

  // 가문 충성도의 흐름
  for (const h of Object.values(state.houses)) {
    if (h.exiled) continue;
    const n = N[h.nation];
    const rt = ruler(h.nation)?.traits || [];
    h.loyalty += (55 - h.loyalty) * 0.04 + between(rng, -2, 2)
      + (n.famine ? -2 : 0) + (n.lostBattle ? -3 : 0)
      + (rt.includes('honorable') ? 0.8 : 0) + (rt.includes('cruel') || rt.includes('greedy') ? -1.2 : 0);
    h.loyalty = clamp(h.loyalty, 0, 100);
    h.influence = clamp(h.influence + between(rng, -1, 1), 10, 100);
  }

  // 맹약 기념제 (10년마다)
  if (state.year % E.festival.every === 0) {
    for (const n of Object.values(N)) n.stability += E.festival.stability;
    ctx.log('festival', fill(pick(rng, E.festival.texts), { x: state.year }), { w: 20, head: `맹약 ${state.year}주년의 해` });
  }

  for (const nid of ids) {
    const n = N[nid];
    const def = data.nationById[nid];
    const tropical = ['nation_nelas', 'nation_tambur', 'nation_quel'].includes(nid);

    if (rng() < E.harvest.chance) queue(() => {
      n.foodMod = (n.foodMod || 0) + E.harvest.food; n.stability += E.harvest.stability;
      ctx.log('harvest', fill(pick(rng, E.harvest.texts), { n: name(nid) }), { ids: [nid], w: 8, head: `${name(nid)}의 곳간이 넘친 해` });
    });
    if (rng() < E.blight.chance) queue(() => {
      n.foodMod = (n.foodMod || 0) + E.blight.food; n.stability += E.blight.stability;
      ctx.log('blight', fill(pick(rng, E.blight.texts), { n: name(nid) }), { ids: [nid], w: 12 });
    });
    if (rng() < E.plague.chance * (tropical ? E.plague.tropicalMult : 1)) queue(() => {
      let loss = between(rng, ...E.plague.popLoss);
      const helpers = ids.filter((o) => o !== nid && ['nation_nelas', 'nation_tambur'].includes(o) && ctx.rel(o, nid) >= 0 && N[o].type !== 'revolution');
      n.stability += E.plague.stability;
      const persons = [];
      ctx.log('plague', fill(pick(rng, E.plague.texts), { n: name(nid), x: Math.round(loss * 100) }), { ids: [nid], w: 45, head: `역병이 ${J(name(nid), '을', '를')} 휩쓴 해` });
      if (helpers.length && rng() < 0.5) {
        const o = pick(rng, helpers);
        loss *= 0.5;
        ctx.addRel(o, nid, 12);
        ctx.log('aid', fill(pick(rng, E.plague.aidTexts), { n: name(nid), o: name(o) }), { ids: [nid, o], persons, w: 20 });
      }
      n.pop *= 1 - loss;
    });
    if (rng() < E.mine.chance && n.type !== 'mercenary') queue(() => {
      n.trade += Math.round(between(rng, ...E.mine.trade));
      ctx.log('mine', fill(pick(rng, E.mine.texts), { n: name(nid) }), { ids: [nid], w: 8 });
    });
    for (const [key, k, type] of [['magicDiscovery', 'mages', 'magic'], ['auraDiscovery', 'aura', 'aura']]) {
      const hs = housesOf(state, nid).filter((h) => h.type === type);
      if (!hs.length || rng() > E[key].chance) continue;
      queue(() => {
        const h = pick(rng, hs);
        for (let g = 3; g >= 0; g--) { const mv = n[k][g] * E[key].promote; n[k][g] -= mv; n[k][g + 1] += mv; }
        const el = data.elements.list.find((e) => e.id === h.specialty);
        ctx.log(key, fill(pick(rng, E[key].texts), { h: h.name, e: el ? el.name : '' }), { ids: [nid], w: 10 });
      });
    }
    const r = ruler(nid);
    if (r && rng() < E.reform.chance * traitMult(nid, E.reform.traitMult)) queue(() => {
      n.stability += E.reform.stability; n.revolutionPrep += E.reform.prep;
      for (const h of housesOf(state, nid)) h.loyalty -= 2;
      deed(state, r, '개혁을 단행했다.');
      ctx.log('reform', fill(pick(rng, E.reform.texts), { n: name(nid), t: r.title, p: r.name }), { ids: [nid], persons: [r.id], w: 25 });
    });
    if (r && rng() < E.tyranny.chance * traitMult(nid, E.tyranny.traitMult)) queue(() => {
      n.treasury += E.tyranny.treasury; n.stability += E.tyranny.stability; n.revolutionPrep += E.tyranny.prep;
      for (const h of housesOf(state, nid)) h.loyalty -= 5;
      deed(state, r, '폭정으로 원성을 샀다.');
      ctx.log('tyranny', fill(pick(rng, E.tyranny.texts), { n: name(nid), t: r.title, p: r.name }), { ids: [nid], persons: [r.id], w: 25 });
    });
    const hs = housesOf(state, nid);
    if (hs.length >= 2 && rng() < E.feud.chance) queue(() => {
      const [a, b] = shuffle(rng, [...hs]);
      const sh = between(rng, ...E.feud.influenceShift);
      a.influence += sh; b.influence -= sh; a.loyalty -= 3; b.loyalty -= 3;
      n.stability += E.feud.stability;
      const head = state.persons[a.head];
      ctx.log('feud', fill(pick(rng, E.feud.texts), { n: name(nid), h: a.name, h2: b.name, p: head?.name ?? a.name }), { ids: [nid], persons: head ? [head.id] : [], w: 15 });
    });

    // 가문 반란 (충성이 바닥나고 나라가 흔들릴 때)
    for (const h of hs) {
      const R = E.houseRebellion;
      if (h.ruling || h.loyalty > R.loyaltyMax || n.stability > R.stabilityMax || rng() > R.chance) continue;
      const head = state.persons[h.head];
      const total = hs.reduce((s, x) => s + x.influence, 0);
      const power = ctx.power(nid);
      const rebel = power * (h.influence / total) * between(rng, 0.8, 1.5);
      const loyal = (power - power * (h.influence / total)) * between(rng, 0.6, 1.1);
      const v = { n: name(nid), h: h.name, p: head?.name ?? h.name, t: data.names.rulerTitles[nid] };
      ctx.log('houseRebellion', fill(pick(rng, R.startTexts), v), { ids: [nid], persons: head ? [head.id] : [], w: 60, head: `${h.name} 가문이 ${name(nid)}에 반기를 든 해` });
      n.stability -= 8;
      if (rebel > loyal * 1.15 && head) {
        hs.forEach((x) => { x.ruling = false; });
        h.ruling = true; h.loyalty = 70;
        newRuler(state, data, rng, ctx, nid, head, data.names.rulerTitles[nid]);
        ctx.log('houseRebellion', fill(pick(rng, R.throneTexts), v), { ids: [nid], persons: [head.id], w: 75, head: `${h.name} 가문이 ${name(nid)}의 왕좌를 차지한 해` });
      } else if (rebel > loyal * 0.85) {
        const lost = Math.min(8, n.territory - 40);
        n.territory -= lost;
        n.occupied[`house:${h.id}`] = (n.occupied[`house:${h.id}`] || 0) + lost;
        h.loyalty = 10; h.seceded = true;
        ctx.log('houseRebellion', fill(pick(rng, R.secedeTexts), v), { ids: [nid], persons: head ? [head.id] : [], w: 65 });
      } else {
        h.influence = Math.max(10, h.influence - 20); h.loyalty = 50;
        if (head) {
          head.role = 'prisoner'; head.title = '갇힌 옛 수장'; deed(state, head, '반란에 실패해 갇혔다.');
          const nh = createPerson(state, data, rng, { nation: nid, house: h.id, role: 'head', title: `${h.name} 가문 수장`, age: 28 + rng() * 15, type: h.type, grade: 3 });
          h.head = nh.id;
        }
        ctx.log('houseRebellion', fill(pick(rng, R.crushTexts), v), { ids: [nid], persons: head ? [head.id] : [], w: 40 });
      }
      break;
    }

    // 떨어져 나간 가문 영지의 복귀
    for (const key of Object.keys(n.occupied)) {
      if (!key.startsWith('house:') || rng() > 0.08) continue;
      const h = state.houses[key.slice(6)];
      const amt = n.occupied[key];
      n.territory += amt; delete n.occupied[key];
      h.seceded = false; h.loyalty = 45;
      ctx.log('reclaim', `${h.name} 가문이 다시 ${name(nid)}의 깃발 아래로 돌아왔다. 떨어져 나갔던 골짜기들이 돌아왔다.`, { ids: [nid], w: 20 });
    }

    // 해적 (교역하는 바다의 나라)
    if (n.trade >= 8 && rng() < E.pirates.chance) queue(() => {
      const cs = aliveChampions(state, nid);
      if (cs.length && rng() < 0.35) {
        const c = pick(rng, cs);
        deed(state, c, '해적선을 불태웠다.');
        ctx.log('pirates', fill(pick(rng, E.pirates.heroTexts), { n: name(nid), p: c.name, g: gradeLabel(c, data.grades) }), { ids: [nid], persons: [c.id], w: 15 });
      } else {
        const x = Math.round(between(rng, ...E.pirates.treasuryLoss));
        n.treasury -= x;
        ctx.log('pirates', fill(pick(rng, E.pirates.texts), { n: name(nid), x }), { ids: [nid], w: 10 });
      }
    });

    // 비밀결사 적발 (무명회 세포)
    if (n.revolutionPrep >= E.cellCaught.prepMin && rng() < E.cellCaught.chance) queue(() => {
      n.revolutionPrep += E.cellCaught.prep; n.stability += E.cellCaught.stability;
      const texts = state.alchemyRevealed ? E.cellCaught.revealedTexts : E.cellCaught.texts;
      ctx.log('cellCaught', fill(pick(rng, texts), { n: name(nid) }), { ids: [nid], w: 20 });
    });

    // 개척 시도
    if (n.type !== 'revolution' && n.treasury > E.colonize.cost + 80 && rng() < E.colonize.chance) {
      const targets = ctx.colonizable();
      if (targets.length) queue(() => {
        const isl = pick(rng, targets);
        n.treasury -= E.colonize.cost;
        const ok = rng() < E.colonize.success + (E.colonize.navyBonus[nid] || 0);
        const v = { n: name(nid), i: isl.name };
        if (ok) {
          state.colonies[isl.id] = nid;
          state.known[isl.id] = true;
          n.territory += 3; n.colonyFood = (n.colonyFood || 0) + 0.03;
          ctx.log('colonize', fill(pick(rng, E.colonize.winTexts), v), { ids: [nid], w: 50, head: fill('{n:이} {i}에 깃발을 꽂은 해', v) });
        } else {
          ctx.log('colonize', fill(pick(rng, E.colonize.loseTexts), v), { ids: [nid], w: 12 });
        }
      });
    }
    // 탐험
    if (rng() < E.explore.chance) {
      const unknown = ctx.unknownIslands();
      if (unknown.length) queue(() => {
        const isl = pick(rng, unknown);
        state.known[isl.id] = true;
        const given = makeGivenName(rng, data.names, nid, 'race_human');
        state.islandNames[isl.id] = `${given}섬`;
        ctx.log('explore', fill(pick(rng, E.explore.texts), { n: name(nid), i: `${given}섬` }), { ids: [nid], w: 35, head: '지도에 새 섬이 오른 해' });
      });
    }
    // 신예 등장
    if (hs.length && rng() < E.championRise.chance) queue(() => {
      const h = pick(rng, hs);
      const grade = rng() < 0.15 ? 5 : 4;
      const c = createPerson(state, data, rng, { nation: nid, house: h.id, role: 'champion', type: h.type, grade, age: 22 + rng() * 10 });
      deed(state, c, `젊은 나이에 ${gradeLabel(c, data.grades)}에 올랐다.`);
      ctx.log('championRise', fill(pick(rng, E.championRise.texts), { n: name(nid), h: h.name, g: gradeLabel(c, data.grades), p: c.name }), { ids: [nid], persons: [c.id], w: 15 });
    });
    // 망명
    if (rng() < E.defection.chance) {
      const cs = aliveChampions(state, nid).filter((c) => c.house && state.houses[c.house].loyalty < 50 && c.traits.some((t) => ['ambitious', 'greedy', 'cunning'].includes(t)));
      const rivals = ctx.neighbors(nid).filter((o) => N[o].type !== 'mercenary' && N[o].type !== 'revolution' && ctx.rel(nid, o) < 0);
      if (cs.length && rivals.length) queue(() => {
        const c = pick(rng, cs);
        // 기사국가는 마법사를, 마법국가는 기사를 받아들이지 않는다
        const ok = rivals.filter((x) => !(N[x].type === 'knight' && c.type === 'magic') && !(N[x].type === 'magic' && c.type === 'aura'));
        if (!ok.length) return;
        const o = pick(rng, ok);
        const k = c.type === 'magic' ? 'mages' : 'aura';
        N[nid][k][c.grade - 1] = Math.max(0, N[nid][k][c.grade - 1] - 1);
        N[o][k][c.grade - 1] += 1;
        c.origin = `${name(nid)} ${state.houses[c.house].name} 가문`; c.nation = o; c.house = null; c.name = c.given;
        ctx.addRel(nid, o, E.defection.relation);
        deed(state, c, fill('가문을 등지고 {o:으로} 망명했다.', { o: name(o) }));
        ctx.log('defection', fill(pick(rng, E.defection.texts), { n: name(nid), o: name(o), p: c.name, g: gradeLabel(c, data.grades) }), { ids: [nid, o], persons: [c.id], w: 30 });
      });
    }
  }

  // 나라 사이의 사건
  const pairs = ctx.neighborPairs();
  for (const [a, b] of pairs) {
    if (N[a].type === 'revolution' && N[b].type === 'revolution') continue;
    const v = ctx.rel(a, b);
    if (v >= 10 && rng() < E.tradePact.chance) queue(() => {
      ctx.addRel(a, b, E.tradePact.relation); N[a].trade += E.tradePact.trade; N[b].trade += E.tradePact.trade;
      ctx.log('tradePact', fill(pick(rng, E.tradePact.texts), { n: name(a), o: name(b) }), { ids: [a, b], w: 15, head: `${J(name(a), '과', '와')} ${name(b)}의 길목이 붐빈 해` });
    });
    if (v < 0 && rng() < E.borderClash.chance) queue(() => {
      ctx.addRel(a, b, E.borderClash.relation);
      ctx.log('borderClash', fill(pick(rng, E.borderClash.texts), { n: name(a), o: name(b) }), { ids: [a, b], w: 12 });
    });
    const ha = housesOf(state, a), hb = housesOf(state, b);
    if (v >= 0 && ha.length && hb.length && rng() < E.marriage.chance) queue(() => {
      const h1 = pick(rng, ha), h2 = pick(rng, hb);
      const p1 = createPerson(state, data, rng, { nation: a, house: h1.id, role: 'noble', age: 20 + rng() * 6 });
      const p2 = createPerson(state, data, rng, { nation: b, house: h2.id, role: 'noble', age: 20 + rng() * 6 });
      deed(state, p1, `${p2.name}과 혼인했다.`); deed(state, p2, `${p1.name}과 혼인했다.`);
      ctx.addRel(a, b, E.marriage.relation);
      ctx.log('marriage', fill(pick(rng, E.marriage.texts), { n: name(a), o: name(b), h: h1.name, h2: h2.name, p: p1.name, p2: p2.name }),
        { ids: [a, b], persons: [p1.id, p2.id], w: 40, head: `${h1.name} 가문과 ${h2.name} 가문의 혼례가 열린 해` });
    });
  }
  // 첩자 (어느 나라 사이든)
  if (rng() < E.spy.chance * 4) queue(() => {
    const a = pick(rng, ids), others = ids.filter((x) => x !== a && ctx.rel(a, x) < 10);
    if (!others.length) return;
    const b = pick(rng, others);
    ctx.addRel(a, b, E.spy.relation);
    ctx.log('spy', fill(pick(rng, E.spy.texts), { n: name(a), o: name(b) }), { ids: [a, b], w: 15 });
  });
  // 파견 교체
  for (const pt of state.patrons.filter((x) => x.kind === 'nation')) {
    if (rng() > E.patronSwitch.chance) continue;
    const cands = ctx.neighbors(pt.island).filter((o) => o !== pt.patron && N[o].type !== 'mercenary' && N[o].type !== 'revolution' && ctx.rel(o, pt.island) >= -5);
    if (!cands.length) continue;
    queue(() => {
      const o = pick(rng, cands);
      const old = pt.patron;
      pt.patron = o;
      ctx.addRel(old, pt.island, -25); ctx.addRel(o, pt.island, 30); ctx.addRel(old, o, -10);
      ctx.log('patronSwitch', fill(pick(rng, E.patronSwitch.texts), { i: name(pt.island), n: name(o), o: name(old) }), { ids: [pt.island, o, old], w: 30 });
    });
  }
  // 구호 (기근에 든 이웃을 돕는다)
  for (const nid of ids) {
    if (!N[nid].famine) continue;
    const donors = ctx.neighbors(nid).filter((o) => N[o].food > 1.1 && N[o].treasury > 200 && ctx.rel(o, nid) >= 0);
    if (!donors.length || rng() > E.aid.chance) continue;
    const o = pick(rng, donors);
    N[o].treasury -= E.aid.amount; N[nid].treasury += E.aid.amount;
    ctx.addRel(o, nid, E.aid.relation);
    ctx.log('aid', fill(pick(rng, E.aid.texts), { n: name(nid), o: name(o) }), { ids: [nid, o], w: 35, head: `${J(name(o), '이', '가')} 굶주린 이웃에게 곡물을 보낸 해` });
  }

  // 세계 사건: 전설급 마물
  legendYear(state, data, rng, ctx);

  // 마물 대이동
  if (rng() < E.swarm.chance) queue(() => {
    const nid = pick(rng, ids.filter((x) => N[x].type !== 'mercenary'));
    const regionId = data.nationById[nid].regionId;
    const count = Math.round(between(rng, ...E.swarm.count));
    for (let i = 0; i < count; i++) {
      const m = makeMonster(state, data, rng, ctx, regionId, 2 + Math.floor(rng() * 2));
      if (m) state.monsters.push(m);
    }
    N[nid].stability += E.swarm.stability;
    ctx.log('swarm', fill(pick(rng, E.swarm.texts), { n: name(nid) }), { ids: [nid], w: 30 });
  });

  // 연금술 진보
  if (rng() < E.alchemyProgress.chance) queue(() => {
    state.alchemyStock = Math.min(100, state.alchemyStock + E.alchemyProgress.stock);
    const revealed = state.alchemyRevealed;
    ctx.log('alchemyProgress', pick(rng, revealed ? E.alchemyProgress.revealedTexts : E.alchemyProgress.hiddenTexts), { hidden: !revealed, w: revealed ? 15 : 0 });
  });

  // 양방향 각성 영웅
  if (rng() < E.hero.chance) queue(() => {
    const nid = pick(rng, ids);
    const job = pick(rng, data.names.commonerJobs), place = pick(rng, data.names.places);
    const p = createPerson(state, data, rng, { nation: nid, role: 'hero', type: 'dual', grade: 2, age: 16 + rng() * 10, job, origin: `${name(nid)}의 ${place}` });
    N[nid].mages[1] += 1; N[nid].aura[1] += 1;
    deed(state, p, '마법과 오러를 함께 깨웠다.');
    const v = { n: name(nid), place, job, p: p.name };
    ctx.log('hero', fill(pick(rng, E.hero.texts), v), { ids: [nid], persons: [p.id], w: 85, head: `아무도 몰랐던 양방향 그릇, ${J(p.name, '이', '가')} 깨어난 해` });
    ctx.log('hero', fill(pick(rng, E.hero.aftermathTexts), v), { ids: [nid], persons: [p.id], w: 5 });
    N[nid].stability -= 3;
    for (const o of ids) if (o !== nid) ctx.addRel(nid, o, -4);
  });
  // 영웅이 무명회와 손잡는 일
  if (state.alchemyRevealed) {
    for (const p of Object.values(state.persons)) {
      if (!p.alive || p.type !== 'dual' || p.side || N[p.nation].stability > 50 || rng() > 0.15) continue;
      p.side = '무명회';
      N[p.nation].revolutionPrep += 40;
      deed(state, p, '무명회와 손을 잡았다.');
      ctx.log('hero', fill(pick(rng, E.hero.joinRevTexts), { p: p.name }), { ids: [p.nation], persons: [p.id], w: 80, head: `${J(p.name, '이', '가')} 무명회와 손잡은 해` });
    }
  }
  // 선지자
  if (rng() < E.prophet.chance) queue(() => {
    const nid = pick(rng, ids);
    const job = pick(rng, data.names.commonerJobs), place = pick(rng, data.names.places);
    const p = createPerson(state, data, rng, { nation: nid, role: 'prophet', age: 30 + rng() * 30, job, origin: `${name(nid)}의 ${place}` });
    deed(state, p, '앞일을 내다보는 지혜로 이름을 얻었다.');
    if (rng() < 0.5) N[nid].stability += 3; else N[nid].revolutionPrep += 6;
    ctx.log('prophet', fill(pick(rng, E.prophet.texts), { n: name(nid), place, job, p: p.name }), { ids: [nid], persons: [p.id], w: 25 });
  });

  // 사소한 사건은 해마다 개수를 제한해 연대기가 넘치지 않게 한다
  shuffle(rng, minor).slice(0, data.events.maxMinorPerYear).forEach((fn) => fn());
}

// ---------- 마물 하나 만들기 ----------
export function makeMonster(state, data, rng, ctx, regionId, tier, forceStrong = false) {
  const cfg = data.monsterCfg;
  const rh = cfg.regionHabitats[regionId];
  if (!rh) return null;
  const bases = cfg.bases.filter((b) => b.habitats.includes('any') || b.habitats.some((h) => rh.habitats.includes(h)));
  const muts = forceStrong ? cfg.mutations.filter((m) => m.power >= 2) : cfg.mutations;
  const base = pick(rng, bases), mut = pick(rng, muts);
  const pos = ctx.pointIn(regionId, rng);
  if (!pos) return null;
  return {
    id: `m${state.year}_${Math.floor(rng() * 1e6)}`, name: `${mut.name} ${base.name}`, base: base.name,
    traits: [mut.desc], tier, regionId, x: pos[0], y: pos[1],
  };
}

function legendYear(state, data, rng, ctx) {
  const E = data.events.events.legendMonster;
  const N = state.nations;
  const L = state.legend;
  if (!L) {
    if (rng() > E.chance) return;
    const cands = Object.keys(N).filter((x) => N[x].type !== 'mercenary');
    const nid = pick(rng, cands);
    const regionId = data.nationById[nid].regionId;
    const m = makeMonster(state, data, rng, ctx, regionId, 5, true);
    if (!m) return;
    const ep = pick(rng, data.names.legendEpithets);
    m.legend = true; m.epithet = ep; m.name = `‘${ep}’ ${m.name}`;
    state.monsters.push(m);
    state.legend = { monsterId: m.id, nation: nid, epithet: ep, since: state.year, base: m.base };
    const v = { n: ctx.name(nid), m: m.name.replace(`‘${ep}’ `, ''), ep, epq: `‘${ep}’` };
    ctx.log('legendMonster', fill(pick(rng, E.appearTexts), v), { ids: [nid], w: 60, head: fill('{epq:이} 나타난 해', v) });
    return;
  }
  const mon = state.monsters.find((m) => m.id === L.monsterId);
  if (!mon) { state.legend = null; return; }
  const nid = L.nation;
  const v = { n: ctx.name(nid), ep: L.epithet, epq: `‘${L.epithet}’` };
  // 날뛰기
  N[nid].pop *= 0.995; N[nid].stability -= 2;
  if (rng() < 0.4) ctx.log('legendMonster', fill(pick(rng, E.rampageTexts), v), { ids: [nid], w: 10 });
  if (rng() > E.huntChance) return;
  // 토벌: 주인 나라와 사이좋은 이웃이 함께 나선다
  const party = [nid, ...ctx.neighbors(nid).filter((o) => N[o].type !== 'mercenary' && ctx.rel(nid, o) >= 10)].slice(0, 4);
  const champs = party.flatMap((x) => aliveChampions(state, x));
  const p = Math.min(0.85, 0.25 + champs.length * 0.06 + party.length * 0.05);
  if (rng() < p && champs.length) {
    const top = champs.sort((a, b) => b.grade - a.grade).slice(0, 3);
    const slayer = pick(rng, top);
    state.monsters = state.monsters.filter((m) => m.id !== mon.id);
    state.legend = null;
    deed(state, slayer, fill('{epq:을} 쓰러뜨렸다.', v));
    if (slayer.grade < 5 && slayer.type !== 'none') {
      const k = slayer.type === 'magic' ? ['mages'] : slayer.type === 'aura' ? ['aura'] : ['mages', 'aura'];
      for (const kk of k) { N[slayer.nation][kk][slayer.grade - 1] = Math.max(0, N[slayer.nation][kk][slayer.grade - 1] - 1); N[slayer.nation][kk][slayer.grade] += 1; }
      slayer.grade += 1;
    }
    for (const a of party) for (const b of party) if (a < b) ctx.addRel(a, b, 10);
    N[nid].stability += 6;
    const nlist = party.map((x) => ctx.name(x)).join(', ');
    ctx.log('legendMonster', fill(pick(rng, E.huntWinTexts), { ...v, p: slayer.name, n: ctx.name(slayer.nation), nlist }),
      { ids: party, persons: [slayer.id], w: 90, head: fill('{p:이} {epq:을} 쓰러뜨린 해', { p: slayer.name, epq: v.epq }) });
  } else {
    let fallen = null;
    if (champs.length && rng() < 0.5) { fallen = pick(rng, champs); personDies(state, data, rng, ctx, fallen, 'monster'); deed(state, fallen, `${v.epq} 토벌 중 쓰러졌다.`); }
    N[nid].stability -= 4;
    ctx.log('legendMonster', fill(pick(rng, E.huntLoseTexts.filter((t) => fallen || !t.includes('{p'))), { ...v, p: fallen?.name }),
      { ids: party, persons: fallen ? [fallen.id] : [], w: 35 });
  }
}

// ---------- 한 해 요약 ----------
export function yearSummary(state, data, rng, entries) {
  const visible = entries.filter((e) => !e.hidden && e.head);
  visible.sort((a, b) => (b.w || 0) - (a.w || 0));
  if (!visible.length) {
    const big = entries.filter((e) => !e.hidden && (e.w || 0) >= 20).sort((a, b) => b.w - a.w)[0];
    return big ? `${big.text.split('.')[0]}.` : pick(rng, data.events.summary.quiet);
  }
  const heads = [...new Set(visible.map((e) => e.head))].slice(0, 2);
  return heads.length === 2 ? `${heads[0]}. 그리고 ${heads[1]}.` : `${heads[0]}.`;
}
