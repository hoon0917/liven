// 환(環)과 막(膜)을 쓰는 전술 결투. 규칙은 data/duel.json, 설명은 lore/19_전술결투.md [초안]
// 싸우는 사람(fighter): { name, type, grade, hp, ron, ronMax, skill }
//   type: none | aura(막) | magic(환) | dual. 막의 겹 수와 환의 고리 수는 grade와 같다.
import { fill } from './text.js';

const pickOf = (rng, a) => a[Math.floor(rng() * a.length)];

export function makeFighter(name, type, grade, o = {}) {
  const g = type === 'none' ? 0 : grade;
  return { name, type, grade: g, hp: o.hp ?? 100, ron: o.ron ?? 0, ronMax: o.ronMax ?? o.ron ?? 0, skill: o.skill ?? 30, shells: [], rings: 0 };
}

function setup(f, D) {
  if (f.type === 'aura' || f.type === 'dual') f.shells = Array.from({ length: f.grade }, () => D.shell.durability);
  f.rings = 0;
  f.pendingInterrupt = false;
  return f;
}

export function legalMoves(f) {
  const m = ['duel_slash', 'duel_guard', 'duel_yield'];
  if ((f.type === 'aura' || f.type === 'dual') && f.shells.length && f.ron >= 3) m.push('duel_mend');
  if ((f.type === 'magic' || f.type === 'dual') && f.rings < f.grade && f.ron >= 2) m.push('duel_weave');
  if ((f.type === 'magic' || f.type === 'dual') && f.rings > 0) m.push('duel_cast');
  return m;
}

// 자동으로 고르는 수. 사람도 이 함수를 기본값으로 쓴다.
export function autoMove(f, foe, D, rng) {
  const legal = legalMoves(f);
  if (f.hp <= D.yieldHp && rng() < 0.5) return 'duel_yield';
  if (legal.includes('duel_cast') && (f.rings >= Math.min(f.grade, 2) || foe.hp <= D.ring.power[f.rings])) return 'duel_cast';
  if (legal.includes('duel_weave') && rng() < 0.7) return 'duel_weave';
  if (legal.includes('duel_mend') && f.shells[0] < D.shell.durability / 2 && rng() < 0.6) return 'duel_mend';
  if (f.hp < 40 && rng() < 0.3) return 'duel_guard';
  return 'duel_slash';
}

// 피해를 받는다: 바깥 막부터 닳고, 넘치면 몸에 닿는다.
function hit(f, dmg, D, notes, T) {
  let left = dmg;
  while (left > 0 && f.shells.length) {
    const s = f.shells[0];
    if (left >= s) { left -= s; f.shells.shift(); notes.push(fill(pickOf(() => 0, T.break), { b: f.name })); }
    else { f.shells[0] = s - left; left = 0; }
  }
  f.hp -= Math.round(left);
}

// 한 수. moves = [a의 수, b의 수]
export function playRound(a, b, moves, D, rng) {
  const T = D.texts, notes = [], F = [a, b];
  const guard = moves.map((m) => m === 'duel_guard');
  const yielded = moves.map((m) => m === 'duel_yield');
  // 막을 지키는 데 론이 든다. 론이 바닥나면 막이 사라진다.
  F.forEach((f) => {
    if (f.shells.length) {
      if (f.ron >= D.shell.ronPerRound) f.ron -= D.shell.ronPerRound;
      else { f.shells = []; notes.push(fill(T.tired[0], { a: f.name })); }
    }
  });
  // 1) 베기·막 다지기·고리 엮기
  F.forEach((f, i) => {
    const o = F[1 - i], m = moves[i];
    if (m === 'duel_slash') {
      let dmg = D.slash.base + f.skill / D.slash.skillDiv + rng() * 6;
      if (guard[1 - i]) dmg *= D.slash.guardCut;
      notes.push(fill(pickOf(rng, T.slash), { a: f.name }));
      hit(o, dmg, D, notes, T);
      if (o.rings > 0 && !guard[1 - i] && moves[1 - i] !== 'duel_cast' && rng() < D.ring.interruptChance) { o.rings -= D.ring.interruptLoss; notes.push(fill(T.interrupt[0], { a: o.name })); }
    } else if (m === 'duel_mend' && f.ron >= D.shell.mendCost && f.shells.length) {
      f.ron -= D.shell.mendCost;
      f.shells[0] = Math.min(D.shell.durability, f.shells[0] + D.shell.mendAmount);
      notes.push(fill(T.mend[0], { a: f.name }));
    } else if (m === 'duel_weave' && f.ron >= D.ring.weaveCost && f.rings < f.grade) {
      f.ron -= D.ring.weaveCost; f.rings += 1;
      notes.push(fill(T.weave[0], { a: f.name }));
    } else if (m === 'duel_guard') notes.push(fill(T.guard[0], { a: f.name }));
  });
  // 2) 술식 쏘기 (베기에 흐트러진 뒤 남은 고리로 쏜다)
  F.forEach((f, i) => {
    if (moves[i] !== 'duel_cast' || f.rings <= 0) return;
    const r = f.rings, cost = D.ring.castCost * r;
    f.rings = 0;
    if (f.ron < cost) { f.ron = 0; notes.push(fill(T.tired[0], { a: f.name })); return; }
    f.ron -= cost;
    notes.push(fill(T.cast[0], { a: f.name }));
    hit(F[1 - i], D.ring.power[Math.min(r, D.ring.power.length - 1)] * (guard[1 - i] ? 0.7 : 1), D, notes, T);
  });
  return { notes, yielded };
}

// 한 수씩 겨룬다(사람이 수를 고르는 화면용). 세션을 만들고 stepDuel로 한 수씩 진행한다.
export function beginDuel(a, b, D) {
  setup(a, D); setup(b, D);
  return { a, b, round: 0, log: [], done: false, winner: null, how: '' };
}

export function stepDuel(s, myMove, D, rng) {
  if (s.done) return s;
  const { a, b } = s;
  const r = s.round + 1;
  const mv = [legalMoves(a).includes(myMove) ? myMove : 'duel_slash', autoMove(b, a, D, rng, r)];
  const res = playRound(a, b, mv, D, rng);
  s.round = r;
  s.log.push({ round: r, moves: mv, notes: res.notes, hp: [Math.round(a.hp), Math.round(b.hp)] });
  if (res.yielded[0] || a.hp <= 0) { s.winner = 'b'; s.how = res.yielded[0] ? 'yield' : 'down'; }
  else if (res.yielded[1] || b.hp <= 0) { s.winner = 'a'; s.how = res.yielded[1] ? 'yield' : 'down'; }
  else if (r >= D.maxRounds) { s.winner = a.hp >= b.hp ? 'a' : 'b'; s.how = 'points'; }
  s.done = !!s.winner;
  return s;
}

// 끝까지 겨룬다. choose(f, foe, round)가 있으면 사람이 수를 고른다.
export function runDuel(a, b, D, rng, choose = {}) {
  setup(a, D); setup(b, D);
  const log = [];
  let winner = null, how = '';
  for (let r = 1; r <= D.maxRounds && !winner; r++) {
    const mv = [(choose.a || autoMove)(a, b, D, rng, r), (choose.b || autoMove)(b, a, D, rng, r)];
    const res = playRound(a, b, mv, D, rng);
    log.push({ round: r, moves: mv, notes: res.notes, hp: [Math.round(a.hp), Math.round(b.hp)] });
    if (res.yielded[0] || a.hp <= 0) { winner = 'b'; how = res.yielded[0] ? 'yield' : 'down'; }
    else if (res.yielded[1] || b.hp <= 0) { winner = 'a'; how = res.yielded[1] ? 'yield' : 'down'; }
  }
  if (!winner) { winner = a.hp >= b.hp ? 'a' : 'b'; how = 'points'; }
  return { winner, how, rounds: log.length, log };
}
