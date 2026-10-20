# TTS 공통 계약

- Python service 127.0.0.1:8877. GET /health / POST /synthesize, Authorization Bearer64hex token. HTTP JSON input {text,language:'ko'|'ja'|'auto'} 외필드거절. WAV16bitmono24kHz/16MiB/180초이하. token·profile·model·instruction은client지정불가.
- profile한국어Sohee/일본어Ono_Anna, 고정styleVersion `stella-calm-v1`, segmentationVersion `ko-ja-v1`, protocolVersion1. modelId `mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-6bit`, modelRevision `1c6c0ff58c43afa8df571facde2efa077efd85e2`, mlx-audio0.6.0/Python3.12. 변경시캐시분리.
- health {protocolVersion:1,ready:boolean,state:'loading'|'ready'|'error',modelId,modelRevision,styleVersion,segmentationVersion,languages:['ko','ja'],speakers:{ko:'Sohee',ja:'Ono_Anna'}}. 민감한파일경로나본문반환금지. Node는계약일치검사후사용.
- 설정 root/data/tts/service.json은Python용, qwen.json은Node활성설정용. 각version1/token/modelId/modelRevision/styleVersion/segmentationVersion/protocolVersion/port8877, service설정만절대modelPath필드. Node경로 TTS_CONFIG_FILE 또는공통root/data/tts/qwen.json. helper의직접실행경로는로컬고정.
- Node createAppTts({root,cacheDir,namespace})가Qwen활성설정있으면Qwen선택, 없으면기존say유지. TTS_ENGINE=qwen강제선택시미설정오류, mac은명시복구. lib/tts.mjs의createTts에backend voices/generate/identity 경계를추가해기존큐/캐시/취소유지. synthesize(text,{voice,language='ja',accountId='owner',signal}), backend.generate({text,language,voice,signal,destination}). voices {available,voices:[{id:'stella-ja'|'stella-ko',name,language:'ja-JP'|'ko-KR'}],provider,state,error?}.
- 학습 POST /api/tts/audio: {entryId,part:'word'|'sentence'|'meaning',voice?} 또는 {questionId,part:'passage'|'explanation',voice?}. server자체언어결정. explanation은본인attempt후. 뜻ko,word/sentence/passageja.
- chat GET /api/chat/tts/voices; POST /api/chat/tts/audio {messageId,language:'auto'|'ko'|'ja'}; 저장본인completeassistant조회. streamingdone에messageId추가. 정적 /chat/speech.js는공통public/speech.js서빙.
- frontend 공통 createJapaneseSpeech호환유지+createSpeech({voicesUrl,audioUrl,kind:'study'|'chat'}) 또는옵션동등지원. 준비150초·언어payload/key포함. chat UI언어선택및저장완료후만읽기. 2천자초과/일부실패는완성재생처리하지않음.
- 두audio route는권한2초감시+응답직전검사+abort+private no-store. Node캐시는account/service/engine/model+profile/lang/text로분리.
- 설치 npm run setup-qwen-tts → helper환경/모델준비및LaunchAgent → npm run check-qwen-tts -- --activate 실제두샘플확인후Node활성설정원자저장. refresh는먼저기존Python종료확인. Mac출력샘플을들어보고그후앱재시작.
