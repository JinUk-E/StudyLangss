# Qwen TTS 비판 수합

2026-10-20 · main-codex. 내부 Codex 세 역할의 읽기 전용 검토. 실제 Mac은 접근하지 못한다.

| 출처 | 지적 | 판정 |
|---|---|---|
| security-codex | 기존캐시에모델/개인구분부재 | 채택: engine/revision/style/분할/language/계정서비스key |
| security-codex | 장시간생성중권한회수 | 채택: 2초live감시·최종응답전재검사 |
| security-codex | 20만자assistant와2000자TTS불일치 | 채택: 2000자초과명시거절·구간/시간/출력상한 |
| security-codex | 인증전thread/body무한생성 | 채택: 연결8·body16KiB·읽기10초·생성1·인증우선 |
| ops-codex | 30/40초제한과neural장문불일치 | 채택: 120/150/180초·token상한완료오인금지 |
| ops-codex | 설치실패시기존음성차단 | 채택: 실제두언어샘플검사후별도activate |
| ops-codex | 활성venv제자리업그레이드 | 채택: refresh시정지/PID확인→고정버전설치 |
| ops-codex | 커스텀DATA_DIR로두설정분기 | 채택: 공통TTS_CONFIG_FILE/defaultroot고정 |
| ui-codex | coldstart/loading을장애오인 | 채택: 상태코드/수치timeout맞춤 |
| ui-codex | iOS재클릭언어키누락 | 채택: 언어body/key포함·변경cancel |
| ui-codex | 새답변저장ID미확보 | 채택: 완료ID를통신/재조회로확보 |
| ui-codex | 한국어재생으로듣기진도우회 | 채택: 한국어handler와listeninggate분리 |
| ui-codex | chat전환시음성중지부재 | 채택: 대화수명주기cancel·상태리셋 |

채택13/13=100%, 반려없음. 직접 인용: “요청시 인증만으로는 장시간 TTS 중 회수된 권한이 마지막 WAV에 남습니다.” 미해결확정결함★0. 본 요청은 구현까지 승인한 범위이며 재승인을 요구하지 않는다. 문서 전달에 대한 이전 외부CLI허용은 정기리포트 특정문서의승인이므로 새TTS기획을 자동외부전송하지않는다. 내부동일Codex계열한계보존.

## 구현 후 교차 검토

| 검토 | 발견 내용 | 수정·확인 |
|---|---|---|
| UI·보안 공통 | 채팅 CSP에서 Blob 음성을 차단 | `media-src 'self' blob:` 허용. 실제 앱 CSP를 유지한 브라우저에서 모의 WAV 재생 확인 |
| UI | 큐 대기를 제외한 120초 제한과 브라우저/Nginx 대기 불일치 | 요청 전체 140초, 브라우저 150초, 학습 Nginx 180초. 큐 포함 회귀 테스트 |
| 보안 | 설치 점검이 22050Hz도 통과 | Node와 설치 점검의 PCM16 mono 24kHz·180초·16MiB·Content-Type 검사를 공통 함수로 통일 |
| main-codex | 180초 음원을 느리게 들으면 재생 제한 초과 | 배속에 맞게 watchdog 조정, 0.5배속 회귀 확인 |

최종 ops-codex 읽기 전용 재검토에서 위 변경의 확정 결함 0건. 서로 다른 역할의 동일 Codex 계열 검토이며, 별도 모델 계열의 독립 검증이나 실제 Mac 실행으로 표현하지 않는다.
