import { assert } from './validation.mjs';

/** Resolve speech from stored Japanese material, never client-supplied text or paths. */
export function resolveSpeechSource(store, input) {
  assert(input && typeof input === 'object' && !Array.isArray(input), '음성 요청 형식을 확인해 주세요.');
  assert(Object.keys(input).every(key => ['entryId', 'questionId', 'part', 'voice'].includes(key)), '음성은 저장된 학습 자료로만 생성할 수 있습니다.');
  const entry = input.entryId !== undefined, question = input.questionId !== undefined;
  assert(entry !== question, '학습 자료 또는 문제 ID 하나를 선택해 주세요.');
  const id = entry ? input.entryId : input.questionId;
  assert(typeof id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(id), '학습 자료 ID를 확인해 주세요.');
  assert(input.voice === undefined || (typeof input.voice === 'string' && input.voice.length <= 200), '음성 선택을 확인해 주세요.');
  let text;
  if (entry) {
    assert(['word', 'sentence'].includes(input.part), '단어 또는 문장 음성을 선택해 주세요.');
    const row = store.db.prepare('SELECT json FROM practice_items WHERE id=?').get(id);
    assert(row, '학습 자료를 찾을 수 없습니다.', 404);
    const item = JSON.parse(row.json);
    assert(item.language === 'ja', '현재 일본어 음성만 지원합니다.');
    text = input.part === 'word' ? item.word : item.example;
  } else {
    assert(input.part === 'passage', '듣기 대본을 선택해 주세요.');
    const item = store.question(id);
    assert(item.area === 'listening', '듣기 문제의 대본만 재생할 수 있습니다.');
    text = item.passage;
  }
  assert(typeof text === 'string' && text.trim() && text.length <= 2000, '음성으로 읽을 자료가 없거나 너무 깁니다.');
  return { text, voice: input.voice || undefined };
}
