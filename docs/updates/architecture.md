# 아키텍처 계약

- 앱 root의 `.site-updater/`는 Git 무시, mode700, 같은 볼륨. config.json(mode600), status.json, heartbeat.json, pending/ 단일 요청, worker.lock/, runtime/ 고정 사본, stage/, previous-modules/, backups/<job>/data/.
- config v1: root, origin(HTTPS), branch(starlightForge), remote(고정 GitHub HTTPS URL), nodePath, npmCli, token(64hex), services[{label,plist,script,service,port}]. service: portfolio/chat/study. uid는 worker 자신의 process.getuid().
- status v1: phase(disabled/idle/checking/ready/current/validating/stopping/backing-up/applying/starting/succeeded/failed/manual), message, updatedAt, jobId?, current{sha,subject}?, target{sha,subject}?, checkToken?, checkedAt?, backupId?. UI는 allowlist만 반환한다. heartbeat는 별도 at/pid이며 15초 초과면 실행 불가.
- request v1: id(UUID), action(check/apply), requestedAt, expectedHead?, targetSha?, checkToken?. apply는 ready 상태와 정확히 일치하고 10분 이내여야 한다. HTTP에서 mkdir pending 원자 획득 후 request.json을 wx 저장한다. worker가 실행하고 finally pending 제거. worker 재기동 때 pending/중간 phase가 남으면 manual(재실행 금지).
- lib/update-worker.mjs: runCommand bounded/no shell; inspectCheckout(config), checkForUpdate(config), performUpdate(config,request,saveStatus), runWorker(directory). 실제 명령/health/sleep 주입 가능한 경계로 단위 테스트. 고정 Git args는 hooks 차단, fetch origin branch 후 exactSHA ff-only. service.script는 파일명이며 plistHash는 설치 시 SHA-256이다.
- GET /api/portfolio/updates → {configured,available,phase,message,current,target,checkedAt,updatedAt,checkToken,jobId,backupId}. POST /check {} 또는 /apply {expectedHead,targetSha,checkToken} →202 {jobId}. owner/auth 후 검사. 설정/로컬 경로/비밀 토큰/로그는 HTTP 반환 금지.
- 각 서버의 /internal/update-health는 loopback socket+config.token 헤더 X-Starlight-Update-Token 검증 후 {service,startupSha}; SHA는 생성 시 고정. 프록시 경유 외부 요청은 worker token 없이는 404.
- setup-updater는 macOS·Node24·clean fixedbranch repo·등록된 기본3개 사용자 LaunchAgent·기본data/env만 허용. plist 원본과 config snapshot 검증. 별도 worker LaunchAgent 등록. setup 자체는 3앱 서비스를 재시작하지 않는다.
- 새 target의 data/node_modules/.site-updater 경로가 추적되면 차단. stop 전, stop 뒤 clean/HEAD 재검사. 이전 node_modules 보존, code+data 자동 되감기 없음. stopped 이후 오류는 모든 새 프로세스를 정지하고 manual 상태·복구자료 유지.
- 최종 호환 보완: data 루트·폴더·외부·절대 링크는 차단하되 Certbot의 내부 상대 파일 링크는 원문·대상 hash를 검증하고 verbatimSymlinks로 보존한다. stop 전 launchctl print로 기존 3PID를 수집하고 PID 종료+포트 해제 모두 확인 후 백업한다.
- 공통 HTTP 큐는 SITE_UPDATE_DIR로 테스트 경로를 격리할 수 있다. 실제 Mac setup·worker·health는 root/.site-updater 고정 경로를 사용한다. health 생성은 config 설치 시에만 SHA를 캡처하며 지원하지 않는 데이터 env는 DB 개방 전에 차단한다.
