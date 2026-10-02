// data/story.json 검사기
// 사용법: node tools/validate-story.mjs
// 조각이나 사건을 추가한 뒤 반드시 실행한다. 오류가 0개여야 반영할 수 있다.
import fs from 'fs';

const path = new URL('../data/story.json', import.meta.url);
let S;
try { S = JSON.parse(fs.readFileSync(path, 'utf8')); }
catch (e) { console.error('JSON 형식 오류:', e.message); process.exit(1); }

const errors = [], warns = [];
const A = S.allowed;
const CATS = ['정치', '외교', '인물', '마물', '자연', '탐험', '혁명', '세계'];
// 확정 설정과 어긋나는 표현 (발견되면 경고)
const FORBIDDEN = [/론을\s*(느끼|느꼈|감지|보았|보고|읽어)/, /론이\s*보이/, /양방향\s*아이를\s*(만들었|만들어 냈)/, /신의\s*(뜻|벌|은총)/];

function strings(o, out = []) {
  if (typeof o === 'string') out.push(o);
  else if (Array.isArray(o)) o.forEach((x) => strings(x, out));
  else if (o && typeof o === 'object') {
    if (typeof o.t === 'string') out.push(o.t);
    for (const [k, v] of Object.entries(o)) if (k !== 't' && k !== 'fx') strings(v, out);
  }
  return out;
}
function checkText(where, s) {
  for (const m of s.matchAll(/\{(\w+)(?::([^}]+))?\}/g)) {
    if (!A.placeholders.includes(m[1])) errors.push(`${where}: 모르는 자리표시 {${m[1]}}`);
    if (m[2] && !['이', '을', '과', '은', '으로'].includes(m[2])) errors.push(`${where}: 지원하지 않는 조사 {${m[1]}:${m[2]}}`);
  }
  for (const re of FORBIDDEN) if (re.test(s)) warns.push(`${where}: 확정 설정과 어긋날 수 있는 표현 → "${s.slice(0, 40)}…"`);
}
function checkFx(where, fx) {
  if (!fx) return;
  for (const [k, v] of Object.entries(fx)) {
    if (!A.fx.includes(k)) { errors.push(`${where}: 허용되지 않은 효과 ${k}`); continue; }
    if (typeof v === 'number' && A.limits[k] !== undefined && Math.abs(v) > A.limits[k]) warns.push(`${where}: ${k}=${v} 가 한도 ${A.limits[k]}를 넘어 잘린다`);
    if (k === 'thread' && !S.threads[v]) errors.push(`${where}: 없는 이야기 줄기 ${v}`);
  }
}
function walkFx(where, o) {
  if (Array.isArray(o)) o.forEach((x, i) => walkFx(`${where}[${i}]`, x));
  else if (o && typeof o === 'object') {
    if (o.fx) checkFx(where, o.fx);
    for (const [k, v] of Object.entries(o)) if (k !== 'fx' && typeof v === 'object') walkFx(`${where}.${k}`, v);
  }
}

const ids = new Set();
for (const a of S.archetypes) {
  const w = `원형 ${a.id}`;
  if (!a.id) errors.push('id 없는 원형이 있다');
  if (ids.has(a.id)) errors.push(`${w}: id 중복`);
  ids.add(a.id);
  if (!CATS.includes(a.cat)) errors.push(`${w}: 분류 ${a.cat}는 ${CATS.join(', ')} 중 하나여야 한다`);
  for (const c of a.when || []) if (!A.when.includes(c)) errors.push(`${w}: 모르는 조건 ${c}`);
  if (!A.actor.includes(a.actor)) errors.push(`${w}: 모르는 주인공 ${a.actor}`);
  if (!A.target.includes(a.target)) errors.push(`${w}: 모르는 상대 ${a.target}`);
  if (a.opens) { if (!S.threads[a.opens]) errors.push(`${w}: 없는 이야기 줄기 ${a.opens}`); continue; }
  if (!a.text) { errors.push(`${w}: text 없음`); continue; }
  for (const m of a.text.matchAll(/\[\[(\w+)\]\]/g)) if (!a.slots?.[m[1]] && !S.common[m[1]]) errors.push(`${w}: 칸 [[${m[1]}]]에 해당하는 조각이 없다`);
  strings([a.text, a.slots]).forEach((s) => checkText(w, s));
  walkFx(w, a.slots); checkFx(w, a.fx);
}
for (const [id, t] of Object.entries(S.threads)) {
  const w = `줄기 ${id}`;
  if (!CATS.includes(t.cat)) errors.push(`${w}: 분류 오류`);
  if (!t.open?.text) errors.push(`${w}: 시작 문장 없음`);
  if (!Array.isArray(t.stages) || !t.stages.length) errors.push(`${w}: 단계 없음`);
  strings(t).forEach((s) => checkText(w, s));
  walkFx(w, t);
  if (t.trigger === 'arch' && !S.archetypes.some((a) => a.opens === id) && !JSON.stringify(S.archetypes).includes(`"thread":"${id}"`) && !JSON.stringify(S.archetypes).includes(`"thread": "${id}"`))
    warns.push(`${w}: 이 줄기를 여는 원형이 없다`);
}
for (const [k, v] of Object.entries(S.common)) strings(v).forEach((s) => checkText(`공통 ${k}`, s));

const count = (o) => (typeof o === 'string' ? 1 : Array.isArray(o) ? o.reduce((s, x) => s + count(x), 0) : o && typeof o === 'object' ? ('t' in o ? 1 : Object.entries(o).filter(([k]) => k !== 'fx').reduce((s, [, x]) => s + count(x), 0)) : 0);
console.log(`원형 ${S.archetypes.length}개, 이야기 줄기 ${Object.keys(S.threads).length}개, 조각 ${count(S.common) + count(S.places) + S.archetypes.reduce((s, a) => s + count(a.slots || {}), 0) + count(S.threads)}개`);
warns.forEach((w) => console.log('경고:', w));
errors.forEach((e) => console.log('오류:', e));
console.log(errors.length ? `오류 ${errors.length}개. 고친 뒤 다시 실행하세요.` : '오류 없음.');
process.exit(errors.length ? 1 : 0);
