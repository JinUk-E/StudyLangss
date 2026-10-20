# 관리자 사이트 업데이트

2026-10-20 · main-codex · L — 배포·프로세스 재시작·인증 경계가 포함된다.

사용자의 ‘해당 사이트에서 작업한걸 적용하도록 버튼 … 내 계정일때만’ 요청을 구현한다. GitHub에 커밋·푸시된 starlightForge 코드만 대상이다. 콘텐츠 편집 저장은 기존 기능을 쓴다.

## 확정 범위

- 홈 관리자 하위 `/admin/system/`, owner 전용 `/api/portfolio/updates` GET과 `/check`, `/apply` POST. UI와 서버 모두 관리자 검사. POST는 설정한 HTTPS Origin, Host, JSON, 작은 본문을 검사한다.
- 웹은 파일 요청만 기록한다. Mac 로그인 사용자 LaunchAgent가 별도 실행되며 앱을 재시작해도 작업을 지속한다. 최초 `npm run setup-updater`를 Mac 터미널에서 실행한다. 기본 3개 LaunchAgent·기본 data 경로 설치만 지원하고 다른 설치는 명시적으로 차단한다.
- origin URL과 starlightForge 브랜치 고정. dirty·분기·원격 불일치·divergence 차단. 확인 결과의 원래 HEAD·정확한 SHA·일회용 토큰을 적용에 연결하고 적용 전 재검증한다. 임의 명령·경로·브랜치 입력은 받지 않는다.
- 별도 worktree에서 최소 환경의 npm ci --ignore-scripts 및 테스트. 테스트 성공 전 운영 파일/서비스는 유지한다. 검증한 node_modules를 동일 볼륨에서 교체한다.
- 3서비스 bootout, 실제 종료 확인 후 data 전체(인증·DB·사용자자료·WAL·푸시·이미지) 백업. 코드 ff-only, 의존성 교체, bootstrap. 각 새 서비스가 시작 때 고정한 SHA+역할을 로컬 비밀 토큰 건강검사로 확인해야 성공이다.
- 단일 worker/요청 잠금, 외부 고정 worker 사본, 영속 상태. 재시작 중 웹은 재연결하며 새 작업을 중복 접수하지 않는다. worker 중간 종료는 자동 재실행하지 않고 현장 확인 상태로 둔다.
- 검증 중 실패는 운영 유지. 정지 이후 실패는 백업·진단 보존 및 Mac 수동 복구 안내. DB 마이그레이션 후 코드만 자동 롤백하지 않는다. 외부 데이터 경로·무인 부팅·임의 배포 명령·자동 업데이트 예약은 범위 밖이다.

## 검증

권한/CSRF/중복/오래된 대상 HTTP 테스트, disposable Git repo의 ff 및 dirty/divergence 차단, 모의 launchctl과 건강검사 실패, 전체 회귀, 관리자·일반계정·390px 화면 확인. 실제 Mac launchctl·실제 외부 도메인 배포는 이 Windows 실행 환경에서 확인할 수 없다.
