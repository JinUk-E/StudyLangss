# Mac 사이트 업데이트 버튼

관리자(owner)로 **홈 → 사이트 업데이트**에서 GitHub의 `starlightForge` 코드를 확인하고 적용합니다. 다른 계정은 화면·API를 사용할 수 없습니다. 소개·포트폴리오·이력서는 기존 편집 화면에서 저장합니다.

## 처음 한 번

먼저 기존 수동 업데이트 절차로 이 기능을 Mac에 받고, 세 서버를 재시작합니다. 인증을 다시 만들 필요는 없습니다.

지원 조건은 macOS / Node 24 이상 / 기본 `data/` 경로 / 다음 세 사용자 LaunchAgent입니다. 예제 plist의 절대 경로를 실제 설치와 맞추고 등록해야 합니다. 터미널에서만 실행 중인 서버, 다른 서비스 이름·포트, 외부 데이터 경로는 버튼으로 재시작하지 않습니다.

| 서비스 | 사용자 LaunchAgent | 포트 |
|---|---|---|
| 홈 | org.starlightforge.portfolio | 3212 |
| AI 대화 | org.starlightforge.chat | 3211 |
| 학습 | kr.haru.jlpt | 3210 |

Mac에서 앱 저장소로 이동한 후:

```sh
npm run setup-updater -- --origin https://starlightforge.duckdns.org
launchctl kickstart -k "gui/$(id -u)/org.starlightforge.portfolio"
launchctl kickstart -k "gui/$(id -u)/org.starlightforge.chat"
launchctl kickstart -k "gui/$(id -u)/kr.haru.jlpt"
npm run update-status
```

별도 `org.starlightforge.updater` 사용자 LaunchAgent를 등록합니다. Mac 사용자 로그인 후 실행됩니다. Nginx의 기존 `/api/portfolio/`·`/` 전달 규칙을 그대로 쓰며 추가 공개 포트는 없습니다. 설정 주소는 실제 HTTPS 주소와 정확히 같아야 하고 `/`로 끝내지 않습니다.

설정은 `.site-updater/` 아래에 보관합니다. 토큰·작업자·전체 백업·의존성 사본은 Git에서 제외하고 Mac 사용자 전용 디렉터리에 둡니다. 웹에서는 비밀 토큰이나 임의 명령을 지정할 수 없습니다. 정상 설치를 매번 다시 설정할 필요는 없습니다. 별도 작업자 사본은 앱 업데이트로 자동 교체하지 않으므로 향후 작업자 자체 변경은 이 문서의 재설치 절차가 필요합니다.

`data` 자체 및 하위 폴더를 외부로 연결한 심볼릭 링크는 지원하지 않습니다. Certbot처럼 **같은 data 안의 파일을 가리키는 상대 링크**는 원형대로 백업합니다. 권한 때문에 읽을 수 없는 인증서·파일이 있으면 적용을 중단합니다. Nginx 인증서 경로를 임의로 바꾸거나 비밀키를 공개하지 말고 Mac에서 해당 파일의 소유권·백업 구성을 먼저 점검하세요.

## 다음부터

1. 관리자 계정으로 사이트의 **홈 → 사이트 업데이트**를 엽니다.
2. **새 버전 확인**으로 현재·대상 커밋 제목을 확인합니다.
3. 10분 안에 **확인한 버전으로 업데이트**를 누릅니다.
4. 검증 → 정지 → 전체 데이터 백업 → 코드·의존성 반영 → 세 서버의 실제 버전 확인 순으로 진행합니다.

검증에는 인터넷 연결과 npm 패키지 다운로드 공간이 필요합니다. 별도 worktree에서 테스트하므로 검증 단계에는 기존 사이트를 계속 사용할 수 있습니다. 재시작 구간에는 잠시 접속이 끊길 수 있습니다. 새로 누르지 말고 자동 재연결을 기다리세요. Mac이 절전·로그아웃되면 작업이 중단될 수 있습니다.

확인한 뒤 GitHub가 바뀌거나 로컬 수정이 생기면 적용을 중단합니다. 로컬 수정은 직접 보관한 뒤 다시 확인하세요. `git reset --hard`나 강제 덮어쓰기를 자동 실행하지 않습니다. 진행 중 수동 `git pull`, npm 설치, 서비스 재시작, DB를 쓰는 CLI·다른 인스턴스를 실행하지 마세요.

## 실패 시

검증 단계의 실패는 운영 코드를 바꾸지 않습니다. 정지 이후 실패는 `manual`로 기록하고 새 프로세스의 정지를 시도합니다. 서비스 종료에 실패했을 수도 있으므로 아래처럼 직접 확인하세요. 코드를 되돌린 것만으로 DB가 호환된다고 판단하지 않습니다.

```sh
npm run update-status
launchctl print "gui/$(id -u)/org.starlightforge.updater"
```

로컬 진단은 `.site-updater/worker-errors.log`, `worker.stderr.log`, 상태는 `status.json`입니다. `npm run update-status`는 두 진단 파일의 마지막 부분을 함께 출력합니다. 설치/테스트 명령이 실패하면 실제 출력의 마지막 부분을 `worker-errors.log`에 남깁니다. 웹에는 단계·종료 코드만 표시하고 원본 로그는 보내지 않습니다. 백업 번호가 `JOB`일 때:

| 경로 | 내용 |
|---|---|
| `.site-updater/backups/JOB/data/` | 업데이트 전 전체 data 사본 |
| `.site-updater/backups/JOB/manifest.json` | 백업 검증 완료 표시·원래 SHA·파일 목록 |
| `.site-updater/previous-modules/JOB/` | 교체 전 node_modules(교체 단계까지 도달한 경우) |
| `.site-updater/service-plists/` | 최초 설정 시 원본 plist 사본 |

**manifest가 없으면 완성된 백업으로 취급하지 않습니다.** 백업·기존 의존성 사본은 자동 삭제하지 않습니다. 여유 공간은 직접 관리하세요. 백업에는 인증·대화 등 개인 자료가 있으므로 공개하거나 Git에 넣지 마세요.

### 수동 복구 순서

1. updater와 앱 세 LaunchAgent를 `launchctl bootout`으로 내립니다. Mac에서 이전 PID와 3210~3212 포트가 실제 종료됐는지 확인합니다. Nginx·Ollama는 그대로 둘 수 있습니다.
2. 현재 저장소·data·상태·백업을 별도 사용자 전용 폴더에 **추가 보존**합니다. 로컬 수정이 있으면 먼저 보관하고 코드 전환을 중단합니다.
3. 완성된 manifest의 `sha`를 확인합니다. 변경 없는 저장소에서 `git switch -c recovery-JOB <원래SHA>`로 복구 브랜치를 만들어 이전 코드를 선택할 수 있습니다. 기존 `starlightForge` 브랜치와 새 버전 커밋은 유지합니다.
4. 백업 data를 임시 폴더로 복사·검증한 뒤 기존 data는 실패 시점 사본으로 이름을 바꿔 보존하고, 준비한 전체 data 사본을 `data/`로 둡니다. 새 버전에서 입력된 자료는 실패 시점 사본에만 남으므로 필요하면 별도로 회수해야 합니다.
5. 같은 JOB의 기존 node_modules가 있다면 사본을 사용합니다. 없으면 원래 코드의 lockfile로 `npm ci --ignore-scripts`를 수행합니다. 실패한 새 의존성도 보존한 뒤 교체합니다.
6. 기존 plist로 앱 세 LaunchAgent를 `launchctl bootstrap "gui/$(id -u)" <plist절대경로>`해 시작하고 관리자 로그인·학습·대화·포트폴리오를 확인합니다. 복구 브랜치에서는 업데이트 버튼이 차단됩니다. 수정 버전을 준비하고 `starlightForge`·데이터 호환을 검토한 다음 정상 운영으로 돌아갑니다.

실패 원인·단계에 따라 불필요한 복원은 생략하되, 마이그레이션 이후 **이전 코드와 새 DB를 섞어 실행하지 않습니다**. 확신이 없으면 백업과 로그를 보존하고 정지 상태에서 점검하세요. 자동 롤백은 제공하지 않습니다.

## 설치 실패·설정 변경·작업자 재설치

설정 도중 실패하면 파일을 지우지 않고 보존합니다. 중복 설정을 막으므로 곧바로 setup을 반복하면 차단됩니다.

1. `launchctl bootout "gui/$(id -u)/org.starlightforge.updater"`로 기존 작업자를 정지합니다. 등록이 없으면 그 사실을 확인합니다. `launchctl print`와 `.site-updater/worker.lock/pid`의 프로세스가 종료됐는지 확인합니다. 앱 적용 도중이면 먼저 위 수동 복구를 마칩니다.
2. `.site-updater/`와 `~/Library/LaunchAgents/org.starlightforge.updater.plist`를 **저장소 밖의 새 사용자 전용 폴더로 이동해 보존**합니다. 백업까지 포함하므로 삭제하지 않습니다. 앱의 data와 앱 세 plist는 그대로 둡니다.
3. 앱 저장소가 정상 `starlightForge`·깨끗한 상태이고 세 앱 LaunchAgent가 등록돼 있는지 확인합니다. 경로·환경 변수·plist를 변경했다면 지원 조건을 다시 맞춥니다.
4. `npm run setup-updater -- --origin https://starlightforge.duckdns.org`를 다시 실행하고 앱 세 서비스를 한 번 재시작합니다.

## 진단 개선이 기존 도우미에 반영되지 않을 때

도우미는 `.site-updater/runtime/`에 복사된 독립 실행본입니다. 웹앱 코드를 새로 받는 것만으로 이미 설치된 도우미가 갱신되지는 않습니다. Mac에서 작업이 진행 중이지 않은지 먼저 확인하고, 최신 코드를 수동 검증·반영한 뒤 위 **설치 실패·설정 변경·작업자 재설치** 절차로 도우미를 다시 설치합니다. `.site-updater/`에는 백업도 있으므로 기존 폴더를 삭제하지 않습니다.

이전 도우미의 `명령 실행 실패 (...): node` 메시지에는 실제 npm/테스트 결과가 저장되지 않았을 수 있습니다. 해당 메시지만으로 실패 원인을 확정하지 않습니다. 개선된 도우미로 같은 확인·검증을 실행한 뒤 `npm run update-status`에서 실제 결과를 확인합니다. `validating` 단계 실패라면 앱 서버를 정지하기 전이며, 검증을 건너뛰어 적용하지 않습니다.

Windows에서 권한·큐·Git·백업·실패 경로를 자동 검증했습니다. 실제 Mac의 launchctl, 저장 공간, 인증서 읽기 권한, 사용자 로그인/절전, 운영 도메인에서의 재접속은 Mac에서 최종 확인해야 합니다.

## LaunchAgent에서만 음성 시간 제한 테스트가 실패할 때

Mac의 실제 백그라운드 LaunchAgent와 `.site-updater/stage/<UUID>` 경로에서 검증한 결과, `tests/tts.test.mjs`의 160ms 요청 제한 시험이 `TTS_TIMEOUT`으로 실패하고, 30ms 생성 제한 시험의 모의 명령이 이미 발생한 취소 신호를 놓쳐 대기하는 현상을 재현했다. 같은 커밋이 터미널에서 통과해도 백그라운드 스케줄링에서는 발생할 수 있으므로 폴더 접근 오류로 단정하지 않는다.

두 시험은 모의 시계를 사용하고 생성 시작을 확인한 뒤 제한 시간 직전·직후를 검증하도록 수정했다. 큐 대기 시간이 요청 기한에 포함되는지, 실제 취소 신호·임시 파일 정리·재시도가 동작하는지 계속 검사하며 운영 서비스의 제한 시간과 업데이트 검증은 완화하지 않는다. 이런 문제를 다시 점검할 때는 단순히 작업 디렉터리만 바꾸지 말고 설치된 작업자와 같은 Node 실행 파일·환경변수·LaunchAgent 실행 방식까지 맞춰야 한다.

수정 후 실제 Mac LaunchAgent의 UUID worktree·제한된 환경에서 전체 183개 테스트가 모두 통과했다(약 74초). 임시 검증 서비스와 worktree는 종료 후 제거했다.
