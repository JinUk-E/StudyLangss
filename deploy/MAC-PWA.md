# Mac에서 PWA 설치와 Web Push 구성

PWA는 기존 HTTPS 웹을 홈 화면에서 앱처럼 여는 방식이다. APK 설치·iOS 미서명 앱 실행이 아니며 별도 앱스토어 등록이나 Apple Developer Program 가입은 필요하지 않다. 다만 인증서 오류, 브라우저의 유해 사이트 판정, 회사·학교의 기기 관리 정책, OS 알림 차단으로 제한될 수 있다. 보안 경고를 무시해 설치하지 않는다.

## 업데이트와 최초 설정

저장소에서 실행한다. 기존 인증 파일·학습·대화·포트폴리오 자료는 유지한다.

```sh
git pull --ff-only
npm ci
npm run setup-push -- --origin https://starlightforge.duckdns.org --contact https://starlightforge.duckdns.org
```

이 명령은 해당 Mac에서 VAPID 키 쌍을 만든다. 개인키는 `data/push/vapid.json`에 저장되며 Git에 올리지 않는다. 이미 파일이 있으면 덮어쓰지 않는다. 푸시가 이미 설정되어 있으면 매 업데이트마다 다시 만들 필요가 없다. 키를 바꾸면 기존 휴대폰 구독을 다시 연결해야 할 수 있다.

세 서버를 기존 실행 방식으로 재시작한다. LaunchAgent 이름을 저장소 예제대로 쓰는 경우:

```sh
launchctl kickstart -k "gui/$(id -u)/org.starlightforge.portfolio"
launchctl kickstart -k "gui/$(id -u)/org.starlightforge.chat"
launchctl kickstart -k "gui/$(id -u)/kr.haru.jlpt"
```

수동으로 띄웠다면 기존 프로세스를 정상 종료한 뒤 `npm run start:portfolio`, `npm run start:chat`, `npm start`를 각 터미널에서 실행한다. 위 명령은 LaunchAgent 설치 자체를 하지 않는다. 실제 등록 이름이 다르면 해당 이름을 사용한다.

기본 파일 경로:

| 항목 | 기본값 | 변경할 환경 변수 |
|---|---|---|
| VAPID 설정 | `data/push/vapid.json` | `PUSH_CONFIG_FILE` |
| 기기 구독 DB | `data/push/` 내부 SQLite | `PUSH_DATA_DIR` |

경로를 바꾼 경우 설정 명령·서버·수동 발송 명령에 같은 환경 변수를 적용한다. `PORTFOLIO_DATA_DIR`만 변경하면 세 명령 모두 그 디렉터리 아래 `push/`를 사용한다. `PUSH_DATA_DIR`·`PUSH_CONFIG_FILE`을 지정하면 우선 적용된다. 구독 DB에는 알림 수신 주소와 암호화 키가 들어 있으므로 개인키와 함께 비공개로 보관한다. 목록 API에는 이를 반환하지 않는다.

## Nginx와 네트워크

별도 앱 포트를 추가하지 않는다. 기존 `deploy/nginx/starlightforge.conf.example` 구성에서 `/`와 `/api/portfolio/`는 portfolio 서버3212로 전달되므로 새 기능도 같은 경로로 전달된다. Nginx에 전역 Basic 인증을 추가해 둔 환경이라면 `/sw.js`, `/manifest.webmanifest`, `/pwa/`의 비밀 없는 정적 자원이 로그인 없이 제공되는지도 확인한다. `/app/`와 `/api/portfolio/push/` 인증은 앱 서버에서 계속 요구한다.

수정한 설정을 적용할 때만 `nginx -t` 후 기존 방식으로 reload한다. 같은 HTTPS 도메인 아래 홈·채팅·학습을 제공해야 한다. 개별 개발 서버 포트만 열어 설치한 환경은 전체 앱 경로를 제공하는 배포 구성이 아니다.

Mac에서 외부 푸시 제공자로 HTTPS443을 요청할 수 있어야 한다. 지원 endpoint는 Apple `*.push.apple.com`, Google `fcm.googleapis.com`, Mozilla `updates.push.services.mozilla.com`이다. 구독 주소는 기기 브라우저가 생성한다. 방화벽을 쓰는 환경에서는 해당 제공자 연결을 확인한다. 푸시 때문에 외부에서 Mac으로 새 포트를 열 필요는 없다. Mac 전원·로그인 세션·서버가 살아 있어야 새 알림을 발송할 수 있다.

## 휴대폰 설치와 연결

1. 휴대폰에서 `https://starlightforge.duckdns.org/app/`을 열고 기존 아이디·비밀번호로 로그인한다.
2. 아이폰·아이패드: Safari 공유 → 홈 화면에 추가 → 웹 앱으로 열기(표시되는 경우). 안드로이드: Chrome 메뉴 → 앱 설치 또는 홈 화면에 추가.
3. 추가한 **별빛공방 아이콘**으로 실행한다. 설치 앱에서 로그인을 다시 요구할 수 있다.
4. 홈 하위 메뉴의 **앱 설치·알림**에서 기기 이름을 적고 **이 기기에서 알림 켜기**를 누른다. OS 권한 창은 사용자가 직접 허용한다.
5. **이 기기로 테스트 보내기**를 누른다. 푸시 서비스 접수 표시와 실제 폰 알림 도착을 모두 확인한다.
6. 앱을 닫은 상태에서도 테스트하고, 알림을 눌러 앱으로 돌아와 로그인·전체 탭 이동을 확인한다. 다른 기기에서 현재 기기의 테스트를 실행하거나 아래 명령으로 발송할 수 있다.

아이폰·아이패드의 Web Push는 iOS/iPadOS16.4 이상에서 홈 화면에 추가한 웹앱으로 사용한다. 알림이 안 보이면 집중 모드·알림 요약·OS의 사이트/앱 알림 허용을 확인한다. 브라우저에서 차단한 권한을 웹페이지가 자동으로 다시 허용할 수는 없다. 설치와 수신은 사용 기기에서 확인해야 한다.

앱 설치는 완료했지만 `서버의 푸시 설정이 준비되지 않음`이 보이면 Mac 설정과 portfolio 서버 재시작을 확인한다. 주소가 다르다는 안내는 설정 origin과 접속 주소가 다를 때다. 인증서는 정상 HTTPS를 사용해야 한다. HTTP LAN IP는 푸시 지원 대상이 아니다.

## 수동 발송과 향후 연동

웹은 기기별 고정 테스트만 제공한다. 일반 발송은 Mac 로컬 명령에서 명시적으로 대상 기기 또는 전체 기기를 선택한다. 실제 기기 ID는 인증된 설정 화면의 API 목록이나 관리자가 로컬 데이터에서 확인한다.

```sh
# 연결한 모든 기기에 일반 안내를 보냄. 이 명령은 실제로 발송한다.
npm run send-push -- --all
```

이 모듈은 이후 주간 리포트 완료 알림에서 재사용할 수 있다. **이번 버전에는 검색·주간 예약 발송이 연결되어 있지 않다.** 잠금 화면 알림은 고정 일반 안내만 표시하고 대화·리포트 본문을 넣지 않는다. 푸시는 브라우저 제조사의 중계 서비스를 통과하며 암호화된 payload를 사용한다. 인터넷과 제공자의 가용성·폰 설정에 따라 지연·미수신이 생길 수 있다.

## 해제·실패·백업

- 이 기기 해제: 서버 등록과 현재 브라우저 구독을 지운다. OS 권한은 별개로 유지될 수 있다.
- 다른 기기 연결 삭제: 그 기기로의 서버 발송을 중단한다. 해당 브라우저의 구독과 OS 권한은 직접 삭제하지 못한다.
- 이미 중계 서비스가 접수한 알림은 연결 해제 후에도 도착할 수 있다.
- 테스트·수동 발송은 기기당60초 간격을 둔다. 중계 서비스의 404/410은 만료로 정리한다. 429/5xx/시간 초과는 자동 재발송하지 않는다. 접수 결과 불명일 때는 폰을 먼저 확인한다.
- 푸시 설정이 누락·손상되어도 홈·채팅·학습은 계속 사용할 수 있다. 키를 무작정 재생성하지 말고 기존 파일을 복원한다.
- 백업은 portfolio 서버와 수동 발송을 멈춘 뒤 `data/push/` 전체(또는 별도 PUSH 경로의 설정·DB)를 안전한 개인 저장소로 복사한다. DB의 WAL/SHM 파일이 있으면 함께 포함한다. 복원은 서버 정지 상태에서 같은 경로로 되돌리고 Mac 사용자 전용 권한(디렉터리700·파일600)을 적용한 뒤 재시작한다. 학습 JSON 백업에는 이 비밀자료를 포함하지 않는다.

## 공식 근거와 검증 한계

- [Apple 홈 화면 웹앱 설치](https://support.apple.com/en-lamr/guide/iphone/iphea86e5236/ios)
- [Apple Web Push](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers)
- [WebKit iOS Web Push](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)
- [web-push Node 라이브러리](https://github.com/web-push-libs/web-push)

개발 환경은 Windows다. 자동 검증은 로컬 모의 전송·서비스 워커·HTTP 인증 경계를 대상으로 하며, 실제 Mac 인증서·Nginx·iPhone/Android 백그라운드 알림 도착을 대신하지 않는다.
