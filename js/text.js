// 문장 도우미: 받침에 맞는 조사 붙이기, 템플릿 채우기

function lastHangul(w) {
  for (let i = w.length - 1; i >= 0; i--) {
    const c = w.charCodeAt(i);
    if (c >= 0xac00 && c <= 0xd7a3) return c;
    if (/[0-9A-Za-z]/.test(w[i])) return null;
  }
  return null;
}

export function hasBatchim(w) {
  const c = lastHangul(String(w));
  return c !== null && (c - 0xac00) % 28 !== 0;
}

const JOSA = {
  이: ['이', '가'], 을: ['을', '를'], 과: ['과', '와'], 은: ['은', '는'],
};

export function josa(w, kind) {
  if (kind === '으로') {
    const c = lastHangul(String(w));
    const jong = c === null ? 0 : (c - 0xac00) % 28;
    return jong === 0 || jong === 8 ? '로' : '으로';
  }
  const pair = JOSA[kind];
  return hasBatchim(w) ? pair[0] : pair[1];
}

export const J = (w, withB, withoutB) => w + (hasBatchim(w) ? withB : withoutB);

// "{n:이} {o}에 전쟁을" 같은 템플릿을 채운다
export function fill(tpl, vars) {
  return tpl.replace(/\{(\w+)(?::(이|을|과|은|으로))?\}/g, (_, key, j) => {
    const v = vars[key];
    if (v === undefined || v === null) return '';
    return j ? `${v}${josa(v, j)}` : String(v);
  });
}

export const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
