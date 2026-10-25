export const LEVELS = ['N5', 'N4', 'N3', 'N2', 'N1'];
export const STUDY_LEVELS = { ja: LEVELS, en: ['A1', 'A2', 'B1'] };
export function levelsFor(language = 'ja') { assert(Object.hasOwn(STUDY_LEVELS, language), '학습 언어를 확인해 주세요.'); return STUDY_LEVELS[language]; }
export const AREAS = ['vocabulary', 'grammar', 'reading', 'listening'];
export const RATINGS = ['again', 'hard', 'good', 'easy'];
export const defaults = { level: 'N5', dailyMinutes: 25, ollamaUrl: 'http://127.0.0.1:11434', ollamaModel: '' };
export function assert(condition, message, status = 400) { if (!condition) throw Object.assign(new Error(message), { status }); }
export function validateSettings(input, language = 'ja') {
  assert(input && typeof input === 'object' && !Array.isArray(input), '설정 형식이 올바르지 않습니다.');
  assert(Object.keys(input).every(key => Object.hasOwn(defaults, key)), '알 수 없는 설정입니다.');
  const value = { ...defaults, level: levelsFor(language)[0], ...input };
  assert(levelsFor(language).includes(value.level), '목표 급수를 확인해 주세요.');
  assert(Number.isInteger(value.dailyMinutes) && value.dailyMinutes >= 5 && value.dailyMinutes <= 180, '하루 학습 시간은 5~180분입니다.');
  let url;
  try { url = new URL(value.ollamaUrl); } catch { assert(false, 'Ollama 주소가 올바르지 않습니다.'); }
  assert(['http:', 'https:'].includes(url.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash, 'Ollama는 로컬 주소만 연결할 수 있습니다.');
  assert(typeof value.ollamaModel === 'string' && value.ollamaModel.length <= 160, '모델 이름을 확인해 주세요.');
  value.ollamaUrl = url.origin;
  return value;
}
export function validateQuestion(q, language = 'ja') {
  assert(q && typeof q === 'object' && !Array.isArray(q), '문항 형식을 확인해 주세요.');
  const text = (x, max) => typeof x === 'string' && x.trim().length > 0 && x.length <= max;
  assert(text(q.id, 100) && /^[a-zA-Z0-9_-]+$/.test(q.id), '문항 ID가 올바르지 않습니다.');
  assert(levelsFor(language).includes(q.level) && AREAS.includes(q.area), '문항 급수 또는 영역이 올바르지 않습니다.');
  assert(text(q.prompt, 5000) && text(q.explanation, 10000), '문제와 해설을 입력해 주세요.');
  assert(Array.isArray(q.choices) && q.choices.length >= 2 && q.choices.length <= 8 && q.choices.every(c => text(c, 2000)), '선택지를 확인해 주세요.');
  assert(Number.isInteger(q.answerIndex) && q.answerIndex >= 0 && q.answerIndex < q.choices.length, '정답 번호를 확인해 주세요.');
  assert(Array.isArray(q.tags) && q.tags.length <= 30 && q.tags.every(t => text(t, 100)), '문항 태그를 확인해 주세요.');
  assert(text(q.source, 1000), '출처를 입력해 주세요.');
  for (const key of ['passage', 'reading']) assert(q[key] === undefined || (typeof q[key] === 'string' && q[key].length <= 20000), `${key} 형식이 올바르지 않습니다.`);
  return Object.fromEntries(['id', 'level', 'area', 'prompt', 'passage', 'choices', 'answerIndex', 'explanation', 'reading', 'tags', 'source'].filter(k => q[k] !== undefined).map(k => [k, q[k]]));
}
export function publicQuestion(q) { const { answerIndex, explanation, ...rest } = q; return rest; }
/** Compute spaced repetition dates; missed items reappear after ten minutes. */
export function schedule(previous, rating, now = new Date()) {
  assert(RATINGS.includes(rating), '복습 평가를 확인해 주세요.');
  const old = previous?.intervalDays || 0;
  const intervalDays = rating === 'again' ? 10 / 1440 : rating === 'hard' ? Math.max(1, old * 1.2) : rating === 'easy' ? Math.max(3, old * 2.8) : Math.max(1, old * 2);
  return { intervalDays: Math.min(180, intervalDays), dueAt: new Date(now.getTime() + Math.min(180, intervalDays) * 86400000).toISOString() };
}
