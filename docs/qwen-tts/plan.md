# 한국어·일본어 Qwen3-TTS 적용 제안

2026-10-20 · main-codex · L — Mac 모델 실행·서비스 계약·개인 대화 음성 접근 추가.

사용자 요청: Qwen3-TTS 한국어/일본어, 차분하고 부드러운 스텔라, 팀 검토, Mac 설치 안내, Git 푸시. 영어/중국어 학습 콘텐츠 확장은 포함하지 않는다.

## 사용자 흐름

- 일본어 단어·예문·듣기는 기존 재생/속도/반복/중지 버튼을 유지한다.
- 단어 뜻·정답 제출 후 해설은 한국어로 읽을 수 있게 한다. 제출 전 정답·해설을 음성으로 유출하지 않는다.
- 완료된 본인 스텔라 답변에 읽기/중지 버튼과 한국어·일본어·자동 언어 선택을 제공한다. 자동은 문자 구간을 나누는 보조 기능이며 혼합·한자·영문 정확도를 보장하지 않는다. 수동 언어 선택이 가능하다.
- 모든 음성은 Mac 합성 → 인증된 웹 응답 → 폰 재생. 설치가 안 됐거나 모델이 준비 중이면 이유를 표시한다. 자동으로 음성을 재생하지 않는다.

## 실행 구조

- Qwen3-TTS 1.7B CustomVoice 양자화 MLX 모델 하나를 Mac Python 서비스가 상주시킨다. 고정 loopback 127.0.0.1:8877, 고정 공유 토큰, 임의 모델·경로·목소리복제·원격 URL 입력 금지. 별도 org.starlightforge.tts 사용자 LaunchAgent.
- Node의 공통 adapter는 학습·채팅 모두 사용. cache/dedupe/큐/중지/시간 제한/WAV검증을 보존한다. 기존 say는 명시적인 복구 엔진으로 남기고 정상 Qwen 설정 중 장애를 몰래 say로 대체하지 않는다.
- 토큰·설정 data/tts/qwen.json은 Git 제외·mode600. Python venv와 모델 cache는 app data/밖에 두어 업데이트 백업을 과도하게 키우지 않는다. 버전 고정 requirements·모델 revision·실행 프로토콜 확인. Python service는 HTTP 응답만 만들고 운영 DB/캐시를 직접 쓰지 않는다.
- Python은 한 번에 하나만 생성, 추가 동시 요청은 명시적으로 busy. Node도 제한된 큐. 모델은 startup에 로드하고 ready일 때만 생성. 실행 중 GPU취소가 즉시 끝난다고 보장하지 않는다. 입력/출력·생성 tokens·요청시간을 제한하고 과부하를 표시한다.
- 스텔라 profile은 한국어 Sohee / 일본어 Ono_Anna. 앱에서 임의 instruct를 받지 않고 차분한 속도, 부드러운 음색, 명료한 발음, 과장된 감정 억제의 고정 지시를 전달한다. 같은 사람의 음색 유지까지 보장하지 않는다.

## 접근·자료 보호

- 학습 API는 저장된 본인 자료 ID+부분만 받는다. 언어는 서버가 정한다. 한국어 해설은 본인 풀이 이력이 있어야 한다.
- chat API는 본인 저장소의 완료된 assistant message ID만 받는다. 사용자 메시지·미완성·다른 계정·임의 text/path/URL/instruct는 차단한다. TTS 권한은 study/chat 기존 권한과 동일하다.
- 본문·음성은 no-store·비공개. cache namespace는 계정과 서비스별 분리. 요청 종료·화면 이동·권한 회수는 Node 대기/생성/응답을 중단한다. Python에 이미 넘어간 연산은 잠시 남을 수 있다.
- 서비스 token/header/config 경로는 브라우저에 노출하지 않는다. 직접 Python 포트는 포트포워딩/Nginx에 등록하지 않는다.

## 배포와 검증

- Mac 설치 스크립트는 macOS/Apple Silicon/Python 지원 버전 검사, 고정 venv에 설치·고정 revision 다운로드·고정 LaunchAgent 생성·한국어/일본어 샘플 확인을 제공한다. 기존 설정·토큰을 덮어쓰지 않고 중단/재실행/복구 방법을 안내한다.
- 기존 웹 업데이트는 세 Node 서버를 다루므로 TTS Python 자체 갱신은 Mac 명령으로 별도 수행한다. 프로토콜 불일치 시 재설정 안내를 표시한다. TTS 서비스는 data backup 중 DB를 쓰지 않는다.
- Node/Python mock HTTP 및 저장소 격리/정답 게이트/취소/큐/timeout/혼합 구간/잘못된 WAV 시험, 전체 회귀, 변경 UI 확인. 실제 MLX·Metal·음질·성능·실제 Mac LaunchAgent는 Windows에서 검증 불가이며 Mac 점검 결과와 구분한다.
- 운영 안내는 offline HTML(큰 SVG·표·진행/조건부/중단박스·light/dark)+기술 Markdown. 실제 Mac 접속·모델 설치·운영 서비스 재시작은 현재 실행하지 않는다.

## 검토 반영 계약

- 입력은 전체 2,000자, 구간 최대200자·최대24구간, 출력16MiB/총180초. Node합성120초·브라우저준비150초·Nginx대기180초 이상. 초과/토큰상한 도달은 오류로 처리하고 잘린 음성을 완료/캐시하지 않는다. 긴 채팅 답변은 명시적으로 거절하며 앞부분만 몰래 읽지 않는다.
- 캐시는 계정·서비스·engine·model revision·style/분할 정책·language·voice·text를 구분한다. 양 경로는2초마다 live revision/권한을 검사하고 캐시 포함 최종 전송 직전 재검사한다.
- Python은 인증 전에 본문을 읽지 않는다. HTTP1.0/요청크기16KiB·읽기10초·연결최대8·생성1개·busy즉시응답. 토큰/본문/로그유출 금지.
- 설치는 venv/model고정→service.json/LaunchAgent준비→한/일샘플검사→check-qwen-tts --activate로qwen.json원자활성화. 활성 전 기존say유지. Qwen설정 뒤 오류는명시표시. 기존설정/토큰은보존, refresh는worker정지·종료확인후의존성변경.
- 두Node는TTS_CONFIG_FILE 또는 root/data/tts/qwen.json을공통사용하며DATA_DIR에따라달라지지않는다. Mac복구는TTS_ENGINE=mac명시후학습/채팅재시작. say복구는학습일본어기존범위를보장하고한국어/대화는Qwen권장.
- iOS재클릭key언어포함·언어전환cancel, chat저장완료ID확보후버튼활성, 전환/새대화/삭제음성취소. 한국어뜻/해설읽기는일본어듣기완료조건을충족하지않는다.
