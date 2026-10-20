# 검증 기록

2026-10-20 · main-codex

- 최종 전체 회귀: 138개 중 137 통과·실패0·Windows 파일 symlink 권한으로 1 skip. PID 종료 확인을 포함한 최종 코드로 실행했다.
- 최종 worker 관련 16개 중 15 통과·실패0·같은 symlink 1 skip. PID가 살아 있고 포트만 닫힌 경우 백업·코드·의존성 변경을 수행하지 않는다.
- 실제 HTTP: anonymous 401 / 일반 계정 403 / owner 200; 안내·JS·CSS까지 동일 제한. 다른/없는 Origin 403, 임의 명령/추가 항목 400, text/plain 415, 중복 접수409.
- disposable Git+명령 주입: 정확한 SHA·ff-only·dirty/remote 변경·새 원격 대상·다른 plist·검증 실패·일부 bootout 실패·잘못된 실행 SHA·중간 재기동·singleton 잠금·보호 경로 추적 차단. 운영 데이터/실제 launchctl 사용 없음.
- 브라우저: 모의 API의 실제 UI, 390x844 가로 넘침 없음(document scrollWidth375 / innerWidth390), 데스크톱 관리자 메뉴/대상 표시, 적용 접수 시 비활성·진행·완료 표시, 설치 안내 이동 확인. 스크린샷 `.qa/site-update-preview.png`는 개발용이며 Git 제외.
- 실제 Mac에 접속하지 않았다. setup/launchctl·복사·인증서 읽기 권한·사용자 로그인/절전·HTTPS 재접속은 현장 확인이 필요하다. 실제 사이트 코드 적용이나 외부 알림 발송 없음.
