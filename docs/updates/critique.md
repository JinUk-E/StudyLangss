# 비판 수합

2026-10-20 · main-codex. 내부 Codex 3축. 외부 CLI 축은 이전 문서 전송 자동 승인 거절을 존중하여 미실행.

| 출처 | 지적 | 처리 |
|---|---|---|
| security-codex | 학습 JSON만으로 전체 복구 불가 | 채택: 정지 뒤 data 전체 백업, 외부 경로 차단 |
| security-codex | Basic 자동첨부/Origin 없는 변경 요청 | 채택: updater POST는 설정 HTTPS Origin 필수 |
| security-codex | 확인한 SHA와 실제 적용 불일치 | 채택: HEAD+SHA+일회용 토큰·원자 요청·재검증 |
| security-codex | 운영 환경변수가 테스트로 전파 | 채택: 최소 env·npm 설정 고정 |
| security-codex | 열린 포트를 새 버전으로 오판 | 채택: 시작 SHA+역할+로컬 토큰 |
| ops-codex | 실제 의존성 설치 재실패 | 채택: 검증된 디렉터리 교체·기존 보존 |
| ops-codex | KeepAlive 서비스 종료 전 DB 복사 | 채택: bootout·종료 확인·전체 백업 |
| ops-codex | ff-only로 이전 코드 복귀 불가 | 채택: 자동 롤백 약속 제거·전체 복구 안내 |
| ops-codex | 잘못된 프로세스 건강검사 성공 | 채택: 서비스별 시작 SHA |
| ops-codex | worker 자기 교체/환경 오염 | 채택: Git 소스 밖 worker 사본·최소 env |
| ux-codex | 작업 적용과 콘텐츠 저장 혼동 | 채택: 사이트 업데이트·확인한 버전 명명 |
| ux-codex | 미설정 상태가 고장처럼 보임 | 채택: Mac 설정 필요·최초 설정 안내 |
| ux-codex | 재연결 중 중복 실행 | 채택: 재연결 상태·상태 확인 전 비활성 |
| ux-codex | SHA만으로 판단/다음 행동 어려움 | 채택: 변경 제목·확인 시각·원인별 안내 |
| ux-codex | 매초 상태 알림·모바일 긴 해시 | 채택: 단계 변경만 live 알림·세로 버튼 |

채택률 15/15(100%). 반려 없음. 직접 인용: “DB 마이그레이션까지 발생했다면 코드만 되돌리는 것도 금지해야 합니다.” 미해결 확정 결함 ★0. 실제 Mac 검증은 사용자 환경 설치 뒤 수행할 운영 확인이며 개발 환경의 성공으로 대체하지 않는다.

## 구현 뒤 독립 검토

security-codex의 setup/bridge/health 검토와 ops-codex의 교차 검토를 수행했다. 같은 Codex 계열이며 지정 Opus 모델은 이 환경에서 제공되지 않는다.

| 지적 | 처리·증거 |
|---|---|
| P1: 기본 Certbot 인증서 링크와 전체 symlink 금지 충돌 | 채택: 내부 상대 파일 링크만 허용·원형 복사·대상 hash 검증. 외부·폴더·절대 링크 금지 유지. Windows 권한 부족으로 실제 파일 링크 시험은 skip, Mac 확인 필요 |
| P2: setup 부분 실패 뒤 재설치 불가 | 채택: 기존 worker 종료 확인→설정/백업/agent plist를 저장소 밖으로 보존→정상 설치에서 재설치 안내 추가 |
| 안내 HTML의 inline CSS가 기본 CSP에 차단 | 채택: 고정 안내 문서 응답에만 script-none/style-inline 정책 적용 |
| 포트 해제만으로 DB 프로세스 종료 보장 불가 | 채택: 기존 3PID 수집·ESRCH+포트 해제 확인. 살아 있는 PID 시험에서 백업/코드 교체 차단 |

마지막 재검토: 추가 확정 문제 없음. 미해결 확정 결함 ★0. 실제 Mac 운영 확인 범위는 유지한다.
