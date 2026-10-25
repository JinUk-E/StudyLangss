import { assert } from './validation.mjs';

/** Resolve speech from this account's stored material, never client-supplied text or paths. */
export function resolveSpeechSource(store, input) {
  assert(input && typeof input === 'object' && !Array.isArray(input), '음성 요청 형식을 확인해 주세요.');
  assert(Object.keys(input).every(key => ['entryId', 'questionId', 'part', 'voice'].includes(key)), '음성은 저장된 학습 자료로만 생성할 수 있습니다.');
  const entry = input.entryId !== undefined, question = input.questionId !== undefined;
  assert(entry !== question, '학습 자료 또는 문제 ID 하나를 선택해 주세요.');
  const id = entry ? input.entryId : input.questionId;
  assert(typeof id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(id), '학습 자료 ID를 확인해 주세요.');
  assert(input.voice === undefined || (typeof input.voice === 'string' && input.voice.length <= 200), '음성 선택을 확인해 주세요.');
  let text, language = store.language || 'ja';
  if (entry) {
    assert(['word', 'sentence', 'meaning'].includes(input.part), '단어·문장·뜻 음성을 선택해 주세요.');
    const row = store.db.prepare('SELECT json FROM practice_items WHERE id=?').get(id);
    assert(row, '학습 자료를 찾을 수 없습니다.', 404);
    const item = JSON.parse(row.json);
    assert(item.language === (store.language || 'ja'), '학습 자료의 언어를 확인해 주세요.');
    text = input.part === 'word' ? item.word : input.part === 'meaning' ? item.meaning : item.example;
    if (input.part === 'meaning') language = 'ko';
  } else {
    assert(['passage', 'explanation'].includes(input.part), '듣기 대본 또는 제출한 문제의 해설을 선택해 주세요.');
    const item = store.question(id);
    if (input.part === 'explanation') {
      assert(store.attempts().some(attempt => attempt.questionId === id), '답안을 제출한 뒤 해설을 들을 수 있습니다.', 409);
      text = item.explanation; language = 'ko';
    } else { assert(item.area === 'listening', '듣기 문제의 대본만 재생할 수 있습니다.'); text = item.passage; }
  }
  assert(typeof text === 'string' && text.trim() && text.length <= 2000, '음성으로 읽을 자료가 없거나 너무 깁니다.');
  return { text, voice: input.voice || undefined, language };
}

export function resolveChatSpeechSource(store, input) {
  assert(input && typeof input === 'object' && !Array.isArray(input) && Object.keys(input).every(key => ['messageId', 'language'].includes(key)), '음성은 저장된 스텔라 답변으로만 생성할 수 있습니다.');
  assert(typeof input.messageId === 'string' && /^[a-f0-9-]{36}$/.test(input.messageId), '답변 ID를 확인해 주세요.');
  assert(['auto', 'ko', 'ja'].includes(input.language || 'auto'), '한국어·일본어·자동 중 선택해 주세요.');
  const message = store.db.prepare('SELECT role,content,status FROM messages WHERE id=?').get(input.messageId);
  assert(message, '답변을 찾을 수 없습니다.', 404);
  assert(message.role === 'assistant' && message.status === 'complete', '완료된 스텔라 답변만 읽을 수 있습니다.', 409);
  assert(message.content?.trim() && message.content.length <= 2000, '답변 읽기는 2000자까지 지원합니다. 긴 답변은 더 짧게 요청해 주세요.');
  return { text: message.content, language: input.language || 'auto' };
}
