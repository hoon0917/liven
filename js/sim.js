// 리벤 세계 시뮬레이션 엔진 (화면과 분리된 순수 로직)
import { initPeople, yearlyPeople, createPerson, deed, newRuler } from './people.js';
import { runEvents, battleLog, yearSummary } from './events.js';
import { runStory } from './story.js';
import { fill, pick } from './text.js';
// step(state, data, hooks) 한 번 = 1년. 모든 규칙 수치는 data/sim-rules.json에서 온다.

// ---------- 난수 (상태 안에 저장해 스냅샷으로 재현 가능) ----------
function rngFrom(state) {
  return () => {
    let a = (state.rngState = (state.rngState + 0x6d2b79f5) | 0);
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const between = (rng, a, b) => a + rng() * (b - a);
function normal(rng) {
  const u = Math.max(rng(), 1e-9), v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export { J } from './text.js';
import { J } from './text.js';

const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

// ---------- 조회 도우미 ----------
export function relationStage(v, stages) {
  for (const s of stages) if (v >= s.min) return s.name;
  return stages[stages.length - 1].name;
}

export function talentPower(n, weights) {
  let p = 0;
  for (let g = 0; g < 5; g++) {
    p += (n.mages[g] + n.aura[g] + n.dispatched.mage[g] + n.dispatched.aura[g]) * weights[g];
  }
  return p;
}

export function nationPower(n, data) {
  return talentPower(n, data.grades.powerWeights) + n.army * data.rules.war.armyPower;
}

function raceMix(nationDef, races, key) {
  let s = 0;
  for (const [rid, pct] of Object.entries(nationDef.races)) s += (pct / 100) * races[rid][key];
  return s;
}

function aptitudeShare(nationDef, races) {
  let m = 0, a = 0;
  for (const [rid, pct] of Object.entries(nationDef.races)) {
    m += (pct / 100) * races[rid].aptitude.magic;
    a += (pct / 100) * races[rid].aptitude.aura;
  }
  return { magic: m / (m + a), aura: a / (m + a) };
}

// ---------- 초기 상태 ----------
export function createState(data, seed) {
  const init = JSON.parse(JSON.stringify(data.stateInitial));
  const state = {
    year: init.year,
    lastEruption: init.lastEruption,
    alchemyRevealed: init.alchemyRevealed,
    alchemyStock: data.rules.revolution.materialStart,
    rngState: seed | 0,
    seed,
    nations: init.nations,
    relations: {},
    relationBase: {},
    wars: [],
    alliances: [],
    monsters: [],
    meteors: [],
    flash: null,
    log: [],
    houses: JSON.parse(JSON.stringify(Object.fromEntries(data.houses.map((h) => [h.id, h])))),
    patrons: JSON.parse(JSON.stringify(data.patrons)),
    colonies: {},
    known: {},
    islandNames: {},
    newIslands: [],
    legend: null,
    yearSummaries: {},
  };
  for (const [id, n] of Object.entries(state.nations)) {
    n.army0 = n.army;
    n.foodRefPop = n.pop;
    n.type = data.nationById[id].type;
    n.originalType = n.type;
    n.famine = false;
    n.food = n.foodBase;
    n.occupied = {};
  }
  for (const r of data.regionsList) if (r.kind === 'island_unexplored') state.known[r.id] = r.known !== false;
  for (const r of data.relations.nations) {
    const k = pairKey(r.pair[0], r.pair[1]);
    state.relations[k] = r.value;
    state.relationBase[k] = r.value;
  }
  initPeople(state, data, rngFrom(state));
  state.log.push({ year: state.year, kind: 'start', text: `기록이 시작되었다. 마지막 분화는 맹약력 ${state.lastEruption}년이었다. 리벤의 열세 나라는 서로를 경계하며 다음 분화를 기다린다.` });
  return state;
}

// ---------- 한 해 진행 ----------
export function step(state, data, hooks = {}) {
  const rng = rngFrom(state);
  const R = data.rules;
  const W = data.grades.powerWeights;
  const N = state.nations;
  const def = data.nationById;
  const name = (id) => def[id].name;
  const log = (kind, text, extra = {}) => state.log.push({ year: state.year, kind, text, ...extra });
  const atWar = (id) => state.wars.some((w) => w.a === id || w.b === id);
  const isLandPair = (a, b) => data.neighbors.land.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
  const isSeaPair = (a, b) => data.neighbors.sea.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
  const ctx = {
    log, name, admin: false,
    rel: (a, b) => state.relations[pairKey(a, b)],
    addRel: (a, b, d) => { const k = pairKey(a, b); state.relations[k] = clamp(state.relations[k] + d, -100, 100); },
    neighbors: (id) => Object.keys(N).filter((o) => o !== id && (isLandPair(id, o) || isSeaPair(id, o))),
    neighborPairs: () => [...data.neighbors.land, ...data.neighbors.sea],
    power: (id) => nationPower(N[id], data),
    pointIn: (regionId, r) => (hooks.pointIn ? hooks.pointIn(regionId, r) : null),
    colonizable: () => [
      ...data.regionsList.filter((r) => r.kind === 'island_unexplored' && state.known[r.id] && !state.colonies[r.id])
        .map((r) => ({ id: r.id, name: state.islandNames[r.id] || r.name })),
      ...state.newIslands.filter((i) => state.known[i.id] && !state.colonies[i.id]).map((i) => ({ id: i.id, name: state.islandNames[i.id] || i.name })),
    ],
    unknownIslands: () => [
      ...data.regionsList.filter((r) => r.kind === 'island_unexplored' && !state.known[r.id]).map((r) => ({ id: r.id })),
      ...state.newIslands.filter((i) => !state.known[i.id]).map((i) => ({ id: i.id })),
    ],
  };
  const rulerTraitMult = (id, m) => (state.persons[state.rulers[id]]?.traits || []).reduce((x, t) => x * (m[t] || 1), 1);

  state.year += 1;
  state.flash = null;
  for (const n of Object.values(N)) n.lostBattle = false;

  // 1. 화산 분화
  const gap = state.year - state.lastEruption;
  if (gap >= R.eruption.minGap && rng() < 1 / (R.eruption.maxGap - gap + 1)) {
    state.lastEruption = state.year;
    state.flash = 'eruption';
    log('eruption', pick(rng, ['중앙 대륙의 화산이 분화했다. 보이지 않는 론이 사방으로 흩어졌다. 각국과 가문이 서둘러 아이들을 낳게 한다.', '화산이 깨어났다. 하늘이 사흘 동안 잿빛이었다. 리벤의 모든 가문이 영지 곳곳으로 산모들을 보냈다.', '땅이 울리고 화산이 불을 뿜었다. 론이 어디에 내려앉았는지는 아무도 모른다. 모두가 아이들의 그릇에 희망을 건다.']), { w: 80, head: '화산이 깨어난 해' });
    for (const [id, n] of Object.entries(N)) {
      if (def[id].regionId.startsWith('region_central')) {
        n.stability -= R.eruption.centralStabilityHit;
        n.pop *= 1 - R.eruption.centralPopLoss;
      }
      n.cohorts.push({ born: state.year, source: '분화', size: n.pop * R.cohort.sizeRate * (n.territory / 100) });
    }
    if (hooks.respawnMonsters) hooks.respawnMonsters(state, rng, 1);
    if (hooks.spawnIsland && rng() < data.events.events.newIsland.chance) {
      const isl = hooks.spawnIsland(state, rng);
      if (isl) {
        state.newIslands.push({ ...isl, year: state.year });
        state.known[isl.id] = false;
        log('newIsland', pick(rng, data.events.events.newIsland.texts), { w: 30, head: '바다 밑에서 새 땅이 솟은 해' });
      }
    }
  }

  // 2. 유성과 론 호수 (론은 아무도 인지하지 못하므로 론 호수는 숨은 기록)
  if (rng() < R.meteor.chance && hooks.pickRegion) {
    const spot = hooks.pickRegion(rng);
    state.meteors.push({ ...spot, year: state.year });
    const owner = Object.keys(N).find((id) => def[id].regionId === spot.regionId);
    if (owner) {
      N[owner].cohorts.push({ born: state.year, source: '유성', size: N[owner].pop * R.meteor.cohortSizeRate });
      log('meteor', `${name(owner)} 땅에 유성이 떨어졌다. 그 해 근처에서 태어난 아이들에게 기대가 모인다.`, { ids: [owner] });
    } else {
      log('meteor', `${spot.regionName}에 유성이 떨어졌다. 그 땅에는 아무도 살지 않는다.`);
    }
  }
  state.meteors = state.meteors.filter((m) => state.year - m.year < R.meteor.markerYears);
  if (rng() < R.ronLake.chance) {
    const ids = Object.keys(N);
    const owner = ids[Math.floor(rng() * ids.length)];
    N[owner].cohorts.push({ born: state.year, source: '론 호수', size: N[owner].pop * R.ronLake.cohortSizeRate });
    log('ron', `${name(owner)}의 어느 호수에 론이 짙게 고였다. 아무도 알지 못한다.`, { hidden: true, ids: [owner] });
  }

  // 3. 특별 학생 세대의 그릇 판정 (같은 분화 세대는 한 줄로 묶어 기록)
  const verdicts = {};
  for (const [id, n] of Object.entries(N)) {
    const due = n.cohorts.filter((c) => c.born + R.cohort.judgeAfter === state.year);
    n.cohorts = n.cohorts.filter((c) => c.born + R.cohort.judgeAfter > state.year);
    for (const c of due) {
      const luck = Math.exp(normal(rng) * R.cohort.luckSigma);
      const total = c.size * 10000 * R.cohort.talentRate * luck;
      let target = id;
      if (n.type === 'mercenary') {
        const p = state.patrons.find((x) => x.island === id && x.kind === 'nation') || state.patrons.find((x) => x.island === id);
        if (!p) continue;
        target = p.patron;
      }
      const tn = N[target];
      const share = aptitudeShare(def[id], data.races);
      const kinds = tn.type === 'knight' ? { aura: 1 } : tn.type === 'magic' ? { mages: 1 } : tn.type === 'revolution' ? { mages: share.magic, aura: share.aura } : { mages: share.magic, aura: share.aura };
      let high = 0;
      for (const [k, s] of Object.entries(kinds)) {
        for (let g = 0; g < 5; g++) {
          const add = total * s * R.cohort.gradeDist[g] * Math.pow(luck, g * 0.25);
          tn[k][g] += add;
          if (g >= 3) high += add;
        }
      }
      const verdict = luck >= 1.6 ? 'good' : luck <= 0.6 ? 'bad' : 'plain';
      if (c.source === '분화') {
        const key = c.born;
        verdicts[key] ??= { good: [], bad: [], plain: [], high: 0, islands: [] };
        verdicts[key][verdict].push(name(id));
        verdicts[key].high += high;
        if (target !== id) verdicts[key].islands.push(`${name(id)}의 아이들은 ${name(target)}로`);
      } else if (verdict !== 'plain' || high >= 1) {
        const txt = verdict === 'good' ? '큰 그릇이 여럿 나왔다' : verdict === 'bad' ? '기대한 그릇은 나오지 않았다' : '쓸 만한 재능이 몇 나왔다';
        log('cohort', `${name(id)}의 맹약력 ${c.born}년 ${c.source} 세대가 그릇 판정을 받았다. ${txt}.`, { ids: [id] });
      }
    }
  }
  for (const [born, v] of Object.entries(verdicts)) {
    const parts = [`맹약력 ${born}년 분화 세대가 그릇 판정을 받았다.`];
    if (v.good.length) parts.push(`기대를 넘은 나라는 ${v.good.join(', ')}.`);
    if (v.bad.length) parts.push(`기대에 못 미친 나라는 ${v.bad.join(', ')}.`);
    if (v.high >= 1) parts.push(`세계 전체에서 4등급 이상의 재능이 ${Math.round(v.high)}명 나왔다.`);
    if (v.islands.length) parts.push(`섬나라 출신 중 큰 그릇은 파견국에 귀속되었다.`);
    log('cohort', parts.join(' '));
  }

  // 4. 경제, 식량, 인구, 안정도
  for (const [id, n] of Object.entries(N)) {
    const war = atWar(id);
    n.food = (n.foodBase + (n.colonyFood || 0)) * (n.territory / 100) * (n.foodRefPop / n.pop) + (n.foodMod || 0);
    n.foodMod = 0;
    let famine = false;
    if (n.food < 1) {
      const cost = (1 - n.food) * n.pop * R.economy.foodCost;
      if (n.treasury >= cost) n.treasury -= cost;
      else { famine = true; n.treasury -= Math.max(0, n.treasury); }
    }
    // 국고가 바닥을 오가며 기근이 해마다 켜졌다 꺼지는 경우가 많아, 시작만 기록하고 일정 기간 다시 기록하지 않는다
    if (famine && !n.famine && state.year - (n.famineLogged ?? -99) >= (R.famineLogCooldown ?? 5)) {
      log('famine', `${name(id)}에 기근이 들었다. 모자란 곡물을 사들일 돈이 바닥났다.`, { ids: [id] });
      n.famineLogged = state.year;
    }
    n.famine = famine;

    const income = n.pop * R.economy.taxPerPop * (0.5 + n.stability / 200) + n.trade * (war ? 0.6 : 1);
    const upkeep = talentPower(n, W) * R.economy.upkeepPerPower;
    n.treasury = Math.max(R.economy.debtFloor, n.treasury + income - upkeep);

    let rate = raceMix(def[id], data.races, 'popGrowth');
    if (famine) rate -= R.population.faminePopLoss;
    if (n.food > 1.2) rate += R.population.plentyBonus;
    if (war) rate -= R.population.warLoss;
    n.pop *= 1 + rate;

    let target = R.stability.target;
    if (famine) target += R.stability.famine;
    if (n.treasury < 0) target += R.stability.debt;
    if (war) target += R.stability.war;
    if (n.food > 1.1) target += R.stability.plenty;
    n.stability += (target - n.stability) * R.stability.drift + between(rng, -2, 2);
    n.army += (n.army0 - n.army) * 0.1;

    // 재능자의 은퇴·사망과 가문 태교로 인한 출생 (가문이 없는 나라는 출생이 없다)
    const births = n.type === 'mercenary' || n.type === 'revolution' ? 0 : R.talents.houseBirth;
    for (let g = 0; g < 5; g++) {
      n.mages[g] *= 1 - R.talents.attrition + births;
      n.aura[g] *= 1 - R.talents.attrition + births;
    }
  }

  // 5. 마물
  if (hooks.respawnMonsters && state.flash !== 'eruption') hooks.respawnMonsters(state, rng, R.monsters.replaceRate);
  const regionOwner = Object.fromEntries(Object.keys(N).map((id) => [def[id].regionId, id]));
  state.monsters = state.monsters.filter((m) => {
    const owner = regionOwner[m.regionId];
    if (!owner || m.legend || m.tier < 3 || rng() >= R.monsters.attackChance) return true;
    const n = N[owner];
    n.pop *= 1 - 0.001 * m.tier;
    n.stability -= 0.5 * m.tier;
    const p = talentPower(n, W);
    const slain = rng() < p / (p + Math.pow(m.tier, 3) * R.monsters.slayBase);
    if (m.tier >= R.monsters.minTierToLog) {
      log('monster', slain
        ? `${J(m.name, '이', '가')} ${J(name(owner), '을', '를')} 습격했으나 그 나라의 재능자들에게 쓰러졌다.`
        : `${J(m.name, '이', '가')} ${J(name(owner), '을', '를')} 습격했다. 막아 낼 자가 없었다.`, { ids: [owner] });
    }
    return !slain;
  });

  // 6. 관계 변화와 일시 동맹
  const RL = R.relations;
  const isLand = (a, b) => data.neighbors.land.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
  const isSea = (a, b) => data.neighbors.sea.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
  const enemiesOf = (id) => state.wars.filter((w) => w.a === id || w.b === id).map((w) => (w.a === id ? w.b : w.a));
  for (const k of Object.keys(state.relations)) {
    const [a, b] = k.split('|');
    let v = state.relations[k];
    v += between(rng, -RL.drift, RL.drift) + (state.relationBase[k] - v) * RL.reversion;
    if (isLand(a, b) && N[a].food < 1 && N[b].food < 1) v += RL.landFoodPressure;
    if (isLand(a, b) || isSea(a, b)) {
      if ((N[a].food < 1 && N[b].food > 1.1) || (N[b].food < 1 && N[a].food > 1.1)) v += RL.granaryEnvy;
    }
    const types = [N[a].type, N[b].type].sort().join();
    if (types === 'knight,magic') v += RL.typeClash;
    const ea = enemiesOf(a), eb = enemiesOf(b);
    if (ea.some((e) => eb.includes(e))) v += RL.commonEnemy;
    if (state.wars.some((w) => pairKey(w.a, w.b) === k)) v = Math.min(v, RL.warMax);
    state.relations[k] = clamp(v, -100, 100);
  }
  state.alliances = state.alliances.filter((al) => {
    const k = pairKey(al.a, al.b);
    if (state.year - al.since >= RL.allianceMaxYears || rng() < RL.allianceBreakChance || state.relations[k] < 20) {
      state.relations[k] = clamp(state.relations[k] + RL.allianceBreakPenalty, -100, 100);
      log('alliance', `${J(name(al.a), '과', '와')} ${name(al.b)}의 동맹이 깨졌다. 자원이 부족한 세계에서 오래가는 동맹은 없다.`, { ids: [al.a, al.b] });
      return false;
    }
    return true;
  });
  for (const [k, v] of Object.entries(state.relations)) {
    if (v < RL.allianceMin) continue;
    const [a, b] = k.split('|');
    if (state.alliances.some((al) => pairKey(al.a, al.b) === k)) continue;
    if (N[a].type === 'mercenary' || N[b].type === 'mercenary') continue;
    if (rng() < RL.allianceFormChance) {
      state.alliances.push({ a, b, since: state.year });
      log('alliance', `${J(name(a), '과', '와')} ${J(name(b), '이', '가')} 일시적인 동맹을 맺었다.`, { ids: [a, b] });
    }
  }

  // 7. 전쟁: 진행 중인 전쟁의 전투와 강화
  const WR = R.war;
  const patronHelp = (id) => state.patrons.filter((p) => p.island === id).reduce((s, p) => s + nationPower(N[p.patron], data) * WR.patronShare, 0);
  state.wars = state.wars.filter((w) => {
    const A = N[w.a], B = N[w.b];
    const ap = nationPower(A, data) * between(rng, 0.7, 1.3);
    const bp = (nationPower(B, data) * (WR.defenseBonus[w.b] || 1) + patronHelp(w.b)) * between(rng, 0.7, 1.3);
    const [win, lose, wid, lid] = ap >= bp ? [A, B, w.a, w.b] : [B, A, w.b, w.a];
    const gain = Math.min(between(rng, ...WR.territoryGain), Math.max(0, lose.territory - WR.territoryFloor));
    lose.territory -= gain;
    win.territory += gain;
    lose.lostBattle = true;
    // 빼앗긴 땅을 되찾는 것인지, 새로 점령하는 것인지 기록한다
    const back = Math.min(gain, win.occupied[lid] || 0);
    if (back > 0) { win.occupied[lid] -= back; if (win.occupied[lid] < 0.5) delete win.occupied[lid]; }
    if (gain - back > 0) lose.occupied[wid] = (lose.occupied[wid] || 0) + (gain - back);
    const loot = Math.min(Math.max(0, lose.treasury), gain * 5);
    lose.treasury -= loot; win.treasury += loot;
    lose.stability -= WR.stabilityLossLoser; win.stability += 2;
    for (const [n, loss] of [[win, WR.talentLossWinner], [lose, WR.talentLossLoser]]) {
      n.army *= 1 - WR.armyLoss;
      for (let g = 0; g < 5; g++) { n.mages[g] *= 1 - loss; n.aura[g] *= 1 - loss; }
    }
    w.lastWinner = wid;
    battleLog(state, data, rng, ctx, wid, lid, gain);

    const exhausted = A.stability < WR.exhaustion || B.stability < WR.exhaustion;
    if (exhausted || state.year - w.since >= WR.maxYears || rng() < WR.peaceChance) {
      state.relations[pairKey(w.a, w.b)] = WR.postWarRelation;
      log('peace', fill(pick(rng, ['{a:과} {b:이} 강화를 맺었다. 전쟁은 {x}년 동안 이어졌다.', '{a:과} {b}의 사절이 국경의 천막에서 만났다. {x}년의 전쟁이 끝났다.', '지친 {a:과} {b:이} 칼을 거두었다. {x}년 동안 흘린 피에 비해 얻은 것은 많지 않았다.']), { a: name(w.a), b: name(w.b), x: state.year - w.since + 1 }), { ids: [w.a, w.b], w: 35, head: `${J(name(w.a), '과', '와')} ${name(w.b)}의 전쟁이 끝난 해` });
      return false;
    }
    return true;
  });

  // 8. 전쟁: 새 선포 (관계 -70 이하인 이웃끼리만)
  for (const [k, v] of Object.entries(state.relations)) {
    if (v > RL.warMax) continue;
    let [a, b] = k.split('|');
    const land = isLand(a, b), sea = isSea(a, b);
    if (!land && !sea) continue;
    if (state.wars.some((w) => pairKey(w.a, w.b) === k)) continue;
    // 더 굶주렸거나 더 강한 쪽이 선포한다. 섬나라는 선포하지 않는다.
    const want = (id, other) => (N[id].food < 1 ? 1 : 0) + nationPower(N[id], data) / nationPower(N[other], data);
    if (want(b, a) > want(a, b)) [a, b] = [b, a];
    if (N[a].type === 'mercenary') continue;
    const ratio = nationPower(N[a], data) / (nationPower(N[b], data) + patronHelp(b));
    if (ratio < WR.minPowerRatio) continue;
    if (rng() < WR.declareChance * (land ? 1 : WR.seaFactor) * rulerTraitMult(a, { ambitious: 1.4, brave: 1.2, cruel: 1.2, cautious: 0.6, merciful: 0.6 })) {
      state.wars.push({ a, b, since: state.year });
      const why = N[a].food < 1 ? ' 굶주림이 칼을 들게 했다.' : '';
      const rp = state.persons[state.rulers[a]];
      log('war', fill(pick(rng, ['{a:이} {b}에 전쟁을 선포했다.', '{t} {p:이} 칼을 뽑았다. {a:이} {b:으로} 진군한다.', '{a}의 군기가 {b}의 국경을 넘었다. 전쟁이 시작되었다.']), { a: name(a), b: name(b), t: rp?.title, p: rp?.name }) + why,
        { ids: [a, b], persons: rp ? [rp.id] : [], w: 70, head: `${J(name(a), '과', '와')} ${name(b)}의 칼끝이 부딪힌 해` });
    }
  }

  // 9. 혁명 세력 (공개 전까지는 숨은 수치)
  const RV = R.revolution;
  // 연금술은 재료 기반이라 유한하다. 혁명 세력 전체가 쓰는 재료 비축량이 봉기의 횟수를 제한한다.
  state.alchemyStock = Math.min(100, state.alchemyStock + RV.materialRegen);
  for (const [id, n] of Object.entries(N)) {
    if (n.type === 'revolution') continue;
    n.revolutionPrep += RV.baseGrowth
      + Math.max(0, (60 - n.stability) / RV.stabilityFactor)
      + (n.type === 'knight' || n.type === 'magic' ? RV.exclusiveBonus : 0)
      + (n.famine ? RV.famineBonus : 0)
      + (n.type === 'mercenary' ? RV.islandBonus : 0)
      + (state.alchemyRevealed ? RV.revealedGrowthBonus : 0);
    if (n.revolutionPrep < RV.threshold || n.stability >= RV.stabilityMax || rng() >= RV.uprisingChance) continue;
    if (state.alchemyStock < RV.materialCost) continue;
    state.alchemyStock -= RV.materialCost;

    const first = !state.alchemyRevealed;
    const rev = n.revolutionPrep * RV.alchemyPowerPerPrep * between(rng, 0.7, 1.3);
    const gov = (talentPower(n, W) * RV.talentFactor + n.army * WR.armyPower + patronHelp(id)) * between(rng, 0.7, 1.3);
    const leader = createPerson(state, data, rng, { nation: id, role: 'rebel', side: '무명회', age: 25 + rng() * 20, job: pick(rng, data.names.commonerJobs) });
    deed(state, leader, `${name(id)}에서 무명회의 봉기를 이끌었다.`);
    const founder = state.persons[state.founder];
    if (first) {
      state.alchemyRevealed = true;
      if (founder) { founder.hidden = false; deed(state, founder, '세상에 이름이 알려졌다.'); }
      log('revolution', `${name(id)}에서 봉기가 일어났다. 재능 없는 자들이 정체를 알 수 없는 폭발하는 무기를 들었다. 마법으로도 그 근원을 읽어 낼 수 없었다. 세계가 처음으로 연금술을 목격했다.`, { ids: [id], persons: [leader.id], w: 100, head: `${name(id)}에서 연금술이 처음 세상에 드러난 해` });
      log('revolution', `봉기한 이들은 스스로를 무명회라 불렀다. 재능이라는 이름을 갖지 못한 자들의 모임. 그 뒤에는 ${founder ? J(founder.name, '이라는', '라는') : '이름 모를'} 창시자가 있다는 말이 퍼졌다.`, { ids: [id], persons: founder ? [founder.id] : [], w: 50 });
      for (const o of Object.values(N)) o.stability += RV.revealFear;
    } else {
      log('revolution', fill('{n}에서 무명회의 봉기가 일어났다. {p:이} 연금술 무기를 든 사람들을 이끌고 거리를 메웠다.', { n: name(id), p: leader.name }), { ids: [id], persons: [leader.id], w: 95, head: `${name(id)}에서 무명회가 일어선 해` });
    }
    if (rev > gov) {
      n.type = 'revolution';
      for (let g = 0; g < 5; g++) { n.mages[g] *= 0.5; n.aura[g] *= 0.5; }
      n.stability = 40;
      n.revolutionPrep = 0;
      for (const k of Object.keys(state.relations)) if (k.split('|').includes(id)) state.relations[k] = clamp(state.relations[k] - 20, -100, 100);
      for (const h of Object.values(state.houses)) if (h.nation === id) { h.exiled = true; h.ruling = false; }
      newRuler(state, data, rng, ctx, id, leader, data.names.rulerTitles.revolution);
      log('revolution', `혁명이 성공했다. ${name(id)}의 가문 체제가 무너지고, 재능자의 절반이 나라를 떠났다. ${J(leader.name, '이', '가')} 혁명 의장이 되었다.`, { ids: [id], persons: [leader.id], w: 100, head: `${name(id)}의 가문 체제가 무너진 해` });
    } else {
      n.revolutionPrep = RV.failReset;
      n.stability -= 10;
      leader.alive = false; leader.died = state.year; deed(state, leader, '봉기가 진압되어 처형되었다.');
      log('revolution', fill('{n}의 봉기가 진압되었다. {p:은} 성문 앞에서 처형되었고, 살아남은 무명회 사람들은 다시 숨어들었다.', { n: name(id), p: leader.name }), { ids: [id], persons: [leader.id], w: 70 });
    }
  }

  // 10. 인물과 사건
  yearlyPeople(state, data, rng, ctx);
  runEvents(state, data, rng, ctx);
  if (data.story) runStory(state, data, rng, ctx);

  for (const n of Object.values(N)) {
    n.stability = clamp(n.stability, 0, 100);
    n.revolutionPrep = clamp(n.revolutionPrep, 0, 150);
    n.treasury = Math.max(R.economy.debtFloor, n.treasury);
  }
  // 11. 올해의 요약
  state.yearSummaries[state.year] = yearSummary(state, data, rng, state.log.filter((l) => l.year === state.year));
  return state;
}
