// 전술 결투 규칙 점검: node tools/test-duel.mjs
import fs from 'fs';
import { makeFighter, runDuel } from '../js/duel.js';
const D = JSON.parse(fs.readFileSync(new URL('../data/duel.json', import.meta.url), 'utf8'));
let seed = 7; const rng = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const mk = (t, g) => makeFighter(`${t}${g}`, t, g, { ron: 20 + g * 15, skill: 30 + g * 8 });
const stats = {};
for (const [ta, tb] of [['aura', 'magic'], ['aura', 'aura'], ['magic', 'magic'], ['none', 'aura']]) {
  for (let ga = 1; ga <= 4; ga++) for (let gb = 1; gb <= 4; gb++) {
    let w = 0; const N = 400, rs = [];
    for (let i = 0; i < N; i++) {
      const a = ta === 'none' ? makeFighter('n', 'none', 0, { skill: 30 }) : mk(ta, ga);
      const r = runDuel(a, mk(tb, gb), D, rng);
      if (r.winner === 'a') w++; rs.push(r.rounds);
      if (![a.hp].every(Number.isFinite)) throw new Error('NaN');
    }
    stats[`${ta}${ga} vs ${tb}${gb}`] = `${Math.round((w / N) * 100)}% / ${(rs.reduce((s, x) => s + x, 0) / N).toFixed(1)}수`;
  }
}
for (const k of ['aura1 vs magic1', 'aura2 vs magic2', 'aura3 vs magic3', 'aura4 vs magic4', 'aura1 vs aura3', 'aura3 vs aura1', 'magic1 vs magic3', 'none1 vs aura1']) if (stats[k]) console.log(k, stats[k]);
console.log('오류 없음.');
// 한 수씩 고르는 결투(stepDuel)가 끝까지 정상으로 끝나는지
{
  const { beginDuel, stepDuel, legalMoves } = await import('../js/duel.js');
  for (let i = 0; i < 300; i++) {
    const s = beginDuel(mk(i % 2 ? 'aura' : 'magic', 1 + (i % 4)), mk('aura', 1 + (i % 3)), D);
    while (!s.done) { const m = legalMoves(s.a); stepDuel(s, m[Math.floor(rng() * m.length)], D, rng); if (s.round > D.maxRounds) throw new Error('수 초과'); }
    if (!s.winner || !Number.isFinite(s.a.hp)) throw new Error('step 결과 이상');
  }
  console.log('수 고르기 300판 정상.');
}
// 마물 상대 결투: 등급별 승률(수 고르기는 자동)
{
  const { monsterFighter, runDuel: run } = await import('../js/duel.js');
  const out = [];
  for (const [t, g] of [['none', 0], ['aura', 1], ['aura', 2], ['aura', 3], ['magic', 3], ['aura', 4], ['magic', 5]]) {
    for (let tier = 1; tier <= 5; tier++) {
      let w = 0; const N = 300;
      for (let i = 0; i < N; i++) {
        const me = t === 'none' ? makeFighter('나', 'none', 0, { skill: 40 }) : mk(t, g);
        const mon = monsterFighter({ name: '마물', tier }, D);
        const r = run(me, mon, D, rng);
        if (r.winner === 'a') w++;
        if (!Number.isFinite(me.hp) || !Number.isFinite(mon.hp)) throw new Error('NaN');
      }
      out.push(`${t}${g} vs ${tier}급 ${Math.round((w / N) * 100)}%`);
    }
  }
  console.log(out.join(' | '));
}
