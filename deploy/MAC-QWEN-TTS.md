# Mac에 Qwen3-TTS 설치하기

Mac에서 한국어·일본어 음성을 합성하고, 로그인한 웹·휴대폰으로 전달합니다. 휴대폰에는 모델을 설치하지 않습니다. 스텔라는 한국어 `Sohee`, 일본어 `Ono_Anna`로 차분하고 부드럽게 말하도록 설정했습니다. 두 언어의 음색은 다를 수 있습니다.

2026-10-21 Apple Silicon Mac에서 설치·LaunchAgent 실행·한국어/일본어 실제 합성과 학습/채팅 API의 WAV 전달·캐시 재사용을 확인했습니다. 생성 샘플은 24kHz 모노 PCM16 형식입니다. 발음과 음질 선호는 아래 샘플을 직접 들어 확인하세요. 회귀 테스트의 가짜 음성 서비스는 임시 포트를 사용하므로 운영 Qwen 서비스를 켠 상태로 원격 업데이트 테스트를 실행할 수 있습니다.

## 1. 준비

Apple Silicon Mac, macOS 14 이상, arm64 Python 3.12, Node.js 24 이상이 필요합니다. 기존 웹 서버를 운영하는 **동일한 로그인 사용자**로 저장소 폴더에서 실행합니다. `sudo`는 사용하지 않습니다.

```sh
git switch starlightForge
git pull --ff-only origin starlightForge
npm ci
```

Python 3.12가 없다면 Homebrew가 설치된 환경에서 다음 명령을 실행합니다.

```sh
brew install python@3.12
export PATH="$(brew --prefix python@3.12)/bin:$PATH"
python3.12 -c 'import platform, sys; print(sys.version); print(platform.machine())'
```

출력은 Python 3.12와 `arm64`여야 합니다. 설치 스크립트도 이를 검사합니다. 최초 설치는 Python 패키지와 수 GB의 모델을 다운로드하므로 인터넷 연결과 여유 공간이 필요합니다. Ollama의 대화 모델과 별도 모델이며, 동시 실행에 따른 속도·메모리는 Mac에서 확인해야 합니다.

## 2. 모델과 도우미 설치

```sh
npm run setup-qwen-tts
```

이 명령은 전용 가상환경, 고정 revision의 모델, `org.starlightforge.tts` 사용자 LaunchAgent를 준비합니다. **이 단계에서는 웹 음성 엔진을 바꾸지 않습니다.** 모델 로딩에는 시간이 걸릴 수 있습니다.

## 3. 두 언어를 합성하고 들어보기

```sh
npm run check-qwen-tts
open data/tts/qwen-check-ko.wav
open data/tts/qwen-check-ja.wav
```

`loading` 안내가 나오면 잠시 뒤 점검 명령을 다시 실행합니다. 두 파일에서 자연스러움·발음·음량을 확인하세요. 한국어와 일본어 샘플이 모두 성공해야 활성화할 수 있습니다.

## 4. 웹에 적용

```sh
npm run check-qwen-tts -- --activate
launchctl kickstart -k "gui/$(id -u)/kr.haru.jlpt"
launchctl kickstart -k "gui/$(id -u)/org.starlightforge.chat"
```

활성화 명령은 두 언어를 다시 합성한 뒤 Node용 설정을 원자적으로 저장합니다. 합성·검증이 실패하면 기존 활성 설정을 교체하지 않습니다. 위 Label은 저장소 LaunchAgent 예제 기준이며, 터미널 운영이면 학습·채팅 서버를 각각 중지한 뒤 `npm start`, `npm run start:chat`으로 다시 실행합니다. 포트폴리오 서버는 음성 적용을 위해 재시작할 필요가 없습니다.

웹을 새로고침하고 다음을 확인합니다.

- 학습: 일본어 단어·문장·듣기, 공개한 단어의 한국어 뜻, 답안 제출 후 한국어 해설.
- AI 대화: 완료된 본인 스텔라 답변의 **답변 읽기**, 한국어·일본어·자동 언어 선택, 중지.
- 휴대폰: 처음 재생과 중지. iPhone에서 재생 권한을 요구하면 안내에 따라 같은 버튼을 다시 누릅니다.

자동 언어 선택은 글자를 보고 구분하는 보조 기능입니다. 한자·영문·언어가 섞인 문장이 어색하면 읽기 언어를 직접 선택하세요. 답변 읽기는 2,000자까지 지원하며, 생성이 제한 시간·분할 수·오디오 크기를 넘으면 완료 음성으로 처리하지 않습니다.

작게 생성되는 음성은 Node 서버에서 WAV 전체에 일정한 배율을 적용해 보정합니다. 목표 RMS는 -16 dBFS, 최대 증폭은 8배이며, 피크는 -1 dBFS 이하로 제한합니다. 무음·극소음은 키우지 않습니다. 활성화 점검 샘플에도 같은 보정을 적용하며, 보정 버전을 캐시 키에 포함해 이전의 작은 음성을 재사용하지 않습니다. 이 처리는 Qwen 모델 재설치 없이 학습·채팅 Node 서버 재시작으로 반영됩니다.

## 저장 위치와 설정

| 항목 | 기본 위치 |
|---|---|
| Python 가상환경 | 저장소의 `.venv-tts/` |
| 모델 캐시 | `~/Library/Caches/StarlightForge/qwen3-tts/` |
| Python 도우미 설정 | `data/tts/service.json` |
| Node 활성 설정 | `data/tts/qwen.json` |
| 설치 패키지 목록 | `data/tts/installed-packages.txt` |
| 도우미 로그 | `data/tts/service.stdout.log`, `data/tts/service.stderr.log` |
| 도우미 등록 파일 | `~/Library/LaunchAgents/org.starlightforge.tts.plist` |

`DATA_DIR`, `CHAT_DATA_DIR`를 바꿔도 두 서버의 Qwen 활성 설정은 기본적으로 같은 저장소의 `data/tts/qwen.json`을 읽습니다. 학습 음성 캐시는 `DATA_DIR/tts-cache/`, 대화 음성 캐시는 `CHAT_DATA_DIR/tts-cache/`에 저장합니다.

활성 설정을 다른 위치에 둘 때만 **절대 경로**의 `TTS_CONFIG_FILE`을 점검 명령과 학습·채팅 서버에 동일하게 지정하세요. LaunchAgent는 터미널의 환경변수를 자동으로 물려받지 않습니다. 각 plist의 `EnvironmentVariables`에도 같은 값을 넣고 다시 등록해야 합니다. 이 값은 Python의 `service.json` 위치를 바꾸지 않습니다.

설정 파일에는 서비스 인증 토큰이 들어 있습니다. 권한 `600`을 유지하고 Git·메신저·공개 첨부에 올리지 마세요. 데이터 백업에도 설정이 포함될 수 있으므로 백업을 비공개로 보관합니다. 가상환경과 모델 캐시는 `data/` 밖에 있으며 앱 데이터 백업·Git에서 제외합니다.

**8877 포트는 Mac 내부 전용입니다. 포트포워딩하거나 Nginx에 공개 경로를 추가하지 마세요.** 기존 웹의 `/api/`, `/api/chat/` 프록시를 그대로 사용합니다. 웹은 저장된 본인 자료만 읽으며 일반 사용자에게 모델·토큰·지시문 변경 기능을 제공하지 않습니다.

## 외부 접속: Nginx 대기 시간 적용

**`git pull`은 실제 운영 중인 Nginx 설정을 바꾸지 않습니다.** 저장소 예제의 변경을 현재 서버 설정에도 반영해야 합니다. 기존 60초 설정이 남으면 첫 음성 생성 중 Nginx가 먼저 연결을 끊을 수 있습니다.

`nginx -t`에 표시되는 설정 파일과 그 파일의 `include` 경로에서, 현재 도메인의 server 블록을 찾으세요. Homebrew의 일반적인 위치는 `$(brew --prefix)/etc/nginx/`이지만 실제 사용 중인 경로를 먼저 확인합니다. 인증서·도메인 경로를 유지하고, 해당 프록시 블록 안의 두 값을 변경합니다.

```nginx
proxy_read_timeout 180s;
proxy_send_timeout 180s;
```

- [별빛공방 전체 사이트 예제](nginx/starlightforge.conf.example): 학습 API의 `location /api/`에 적용합니다. `/api/chat/`을 처리하는 채팅 블록의 기존 `600s`는 유지합니다.
- [학습 단독 사이트 예제](nginx/haru.conf.example): 학습 서버를 받는 `location /`에 적용합니다.

수정 후 검사가 성공한 경우에만 서비스를 다시 읽힙니다. Homebrew 서비스로 운영 중이라면:

```sh
nginx -t
brew services restart nginx
```

별도 서비스 관리자나 직접 실행으로 운영한다면 그 방식에 맞춰 재시작·reload 하세요. 설정 검사가 실패하면 재시작하지 말고 표시된 파일·줄의 오류부터 수정합니다. Node 서버 재시작과 Nginx 설정 반영은 별개입니다.

## 갱신과 문제 해결

웹의 사이트 업데이트 버튼은 기존 **Node 서버 3개**를 다룹니다. Python 패키지·모델 갱신은 Mac에서 별도로 실행합니다.

```sh
npm run setup-qwen-tts -- --refresh
npm run check-qwen-tts
open data/tts/qwen-check-ko.wav
open data/tts/qwen-check-ja.wav
npm run check-qwen-tts -- --activate
launchctl kickstart -k "gui/$(id -u)/kr.haru.jlpt"
launchctl kickstart -k "gui/$(id -u)/org.starlightforge.chat"
```

`--refresh`는 기존 도우미를 정지하고 종료를 확인한 뒤 재설치합니다. 토큰을 보존하지만, 도중에 실패하면 Python 서비스가 정지된 상태로 남을 수 있습니다. 오류를 해결하고 같은 명령을 다시 실행하거나 아래 Mac 기본 음성 복구를 사용하세요. 다른 설치를 가리키는 LaunchAgent나 사용 중인 8877 포트는 자동으로 덮어쓰지 않습니다.

| 안내 | 확인할 내용 |
|---|---|
| 모델 로딩 중 | 잠시 뒤 `npm run check-qwen-tts` 재실행 |
| 서비스 연결 실패 | 아래 LaunchAgent 상태·로그 확인 |
| 서비스 버전 불일치 | 현재 코드에서 위 `--refresh` 절차 수행 |
| busy / 요청이 많음 | 다른 음성 생성 완료 후 다시 재생 |
| 기존 토큰 불일치 | 두 서버와 점검 명령의 설정 경로 확인. 파일 삭제·토큰 복사로 우회하지 않기 |

```sh
launchctl print "gui/$(id -u)/org.starlightforge.tts"
tail -n 60 data/tts/service.stderr.log
tail -n 60 data/tts/service.stdout.log
```

패키지의 주요 버전과 모델 revision은 저장소에서 고정합니다. 모든 전이 의존성을 해시까지 잠근 완전한 lockfile은 아닙니다. 실제 설치 목록은 `installed-packages.txt`에 기록하며, 최초 Mac 설치 성공 여부는 별도 확인이 필요합니다.

## Mac 기본 일본어 음성으로 복구

Qwen 장애 중에는 `TTS_ENGINE=mac`을 명시해 기존 일본어 음성으로 돌아갈 수 있습니다. 한국어·혼합 대화 음성은 Qwen을 복구한 뒤 사용할 수 있습니다. [기본 음성 설치·점검 안내](MAC-TTS.md)를 먼저 확인하세요.

터미널 운영은 기존 학습·채팅 프로세스를 중지한 뒤 각각 다음과 같이 실행합니다.

```sh
TTS_ENGINE=mac npm start
```

별도 터미널에서:

```sh
TTS_ENGINE=mac npm run start:chat
```

LaunchAgent 운영은 학습·채팅 plist의 `EnvironmentVariables` 안에 다음 항목을 추가합니다.

```xml
<key>TTS_ENGINE</key><string>mac</string>
```

plist 변경은 `kickstart`만으로 다시 읽지 않습니다. 예제 파일명으로 설치했다면 아래처럼 재등록합니다. 다른 파일명을 사용했다면 실제 경로로 바꾸세요.

```sh
launchctl bootout "gui/$(id -u)/kr.haru.jlpt"
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/kr.haru.jlpt.plist"
launchctl bootout "gui/$(id -u)/org.starlightforge.chat"
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/org.starlightforge.chat.plist"
```

Mac 기본 음성으로 전환해도 Python 모델은 계속 메모리를 사용할 수 있습니다. 필요하면 따로 정지합니다.

```sh
launchctl bootout "gui/$(id -u)/org.starlightforge.tts"
```

Qwen으로 돌아갈 때는 위 갱신·샘플 확인·활성화 절차를 진행하고 `TTS_ENGINE=mac` 항목을 제거하거나 `qwen`으로 바꾼 뒤 Node LaunchAgent를 재등록합니다. `qwen` 강제 설정에서 설치·서비스가 실패하면 오류를 표시하며 몰래 다른 음성으로 대체하지 않습니다.
