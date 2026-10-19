# Mac에서 비밀번호 인증 + 서브도메인 HTTPS 구성

이 문서는 Nginx와 앱이 **같은 Mac Studio**에서 실행되는 구성이 기본입니다. 실제 도메인·인증서·Nginx 설치 경로는 사용자 환경에 맞춰 수정하세요. 예시는 `jlpt.example.com`, Apple Silicon Homebrew 경로 `/opt/homebrew`를 사용합니다. Intel Homebrew는 보통 `/usr/local`이며 `brew --prefix`로 확인합니다.

## 1. 앱 업데이트와 비밀번호 설정

기존 학습 데이터는 `data/`에 남으며 `git pull`로 덮어쓰지 않습니다. 기존 앱을 Ctrl+C로 종료한 뒤 저장소 폴더에서 실행합니다.

```sh
git pull --ff-only
npm run setup-auth
npm start
```

아이디(기본 haru)와 12자 이상의 비밀번호를 직접 입력합니다. 비밀번호는 입력 중 표시되지 않습니다. 평문 대신 무작위 salt와 scrypt 해시를 `data/auth.json`에 저장하고 파일 권한을 600으로 설정합니다. 이 파일은 Git과 학습 백업에 포함되지 않습니다. 임의 기본 비밀번호나 인증을 해제하는 옵션은 없습니다. 설정이 없거나 손상되면 서버가 시작되지 않습니다.

Mac에서 `http://127.0.0.1:3210`을 열면 브라우저의 기본 아이디·비밀번호 창이 나타납니다. 학습 화면뿐 아니라 정적 파일·백업·설정 변경·AI·상태 확인 API까지 모두 보호됩니다. 브라우저의 로그인 정보가 기억되면 매번 창이 나타나지는 않습니다. 별도 로그아웃 버튼이 없는 HTTP Basic 방식이므로 공용 기기에서는 비공개 창을 사용하고 끝나면 창을 모두 닫으세요.

**외부에서는 반드시 HTTPS로 접속합니다.** Basic 인증은 그 자체로 암호화하지 않습니다. Ollama와 앱의 11434·3210 포트는 인터넷에 포트포워딩하지 않습니다.

비밀번호 변경·분실 시 같은 `npm run setup-auth`를 다시 실행한 후 앱을 재시작합니다. 기존 학습 기록은 유지됩니다. 재시작 전까지는 기존 비밀번호가 적용됩니다. 서버 프로세스가 해당 인증 파일을 읽을 수 있어야 합니다.

## 2. DNS와 공유기

- 서브도메인의 A 레코드를 집의 공인 IPv4에 연결합니다. 유동 IP라면 DNS 갱신이 필요합니다.
- 공유기의 TCP 443을 Nginx 장비의 443으로 전달합니다.
- 아래 HTTP-01 인증서 발급·갱신을 쓰면 TCP 80도 Nginx 장비의 80으로 전달합니다.
- Nginx 장비의 내부 IP를 공유기 DHCP 예약 등으로 고정합니다.
- IPv6를 사용하지 않는다면 잘못된 AAAA 레코드를 남기지 않습니다. CGNAT나 이중 NAT 환경에서는 일반 포트포워딩만으로 연결되지 않을 수 있습니다.

같은 공유기의 기존 사이트들이 80·443을 이미 Nginx로 받고 있다면 공유기 포워딩을 새 앱 포트로 변경하지 말고, 기존 Nginx에 이 서브도메인의 server 블록만 추가합니다.

## 3. Nginx와 인증서 준비

Nginx가 이미 설치되어 있다면 기존 설치·관리 방식을 유지하세요. 새 Homebrew 설치의 예:

```sh
brew install nginx certbot
brew --prefix
mkdir -p /opt/homebrew/var/www/haru-acme/.well-known/acme-challenge
mkdir -p /opt/homebrew/etc/nginx/servers
```

`nginx -V`에서 실제 설정 파일 경로를 확인합니다. `nginx.conf`의 **http 블록 안**에 `include servers/*;`가 있는지 확인하세요. 예제의 `limit_req_zone`은 http 문맥의 설정이므로 server 블록 안에 붙여 넣지 않습니다.

기존 인증서가 해당 서브도메인을 포함하면 4단계로 바로 이동할 수 있습니다. 첫 인증서가 없다면 HTTP 전용 예제를 먼저 설치합니다.

```sh
cp deploy/nginx/haru-http-bootstrap.conf.example /opt/homebrew/etc/nginx/servers/haru.conf
# 복사한 파일의 jlpt.example.com을 실제 도메인으로 수정합니다.
nginx -t
```

이미 실행 중이면 기존 방식으로 reload합니다(`nginx -s reload`, 권한이 필요하면 sudo). 새 설치라면 설정을 확인한 뒤 `brew services start nginx`로 시작할 수 있습니다. 80·443 포트 바인딩 권한과 서비스 실행 사용자는 해당 Mac의 정책에 맞춰 설정해야 합니다. 다른 웹서버가 포트를 점유하면 먼저 충돌을 해결하세요.

외부망에서 테스트 파일이 열리는지 확인한 후 인증서를 발급합니다.

```sh
printf 'haru-acme-ok\n' > /opt/homebrew/var/www/haru-acme/.well-known/acme-challenge/check
curl http://jlpt.example.com/.well-known/acme-challenge/check

sudo certbot certonly --webroot \
  -w /opt/homebrew/var/www/haru-acme \
  -d jlpt.example.com \
  --config-dir /opt/homebrew/etc/letsencrypt \
  --work-dir /opt/homebrew/var/lib/letsencrypt \
  --logs-dir /opt/homebrew/var/log/letsencrypt
```

이메일·이용약관 확인은 Mac에서 직접 진행합니다. 발급 결과에 출력된 인증서 경로를 사용하세요. 인증서 개인키는 Git에 넣지 않습니다. HTTP-01은 외부 80번 포트에서 검증하므로 80을 열 수 없으면 DNS-01 방식의 인증서를 별도로 준비해야 합니다.

## 4. HTTPS 프록시 적용

발급이 끝나면 **동일한 haru.conf 파일을** HTTPS 예제로 교체합니다. bootstrap 파일을 별도 이름으로 남겨 중복 server_name을 만들지 않습니다.

```sh
cp deploy/nginx/haru.conf.example /opt/homebrew/etc/nginx/servers/haru.conf
# 실제 도메인, 인증서 경로, ACME webroot 경로를 수정합니다.
nginx -t
nginx -s reload
```

기존 Nginx가 root로 실행 중이면 테스트와 reload도 그에 맞는 권한으로 수행합니다. 변경 전 기존 설정을 백업하고 `nginx -t`가 성공한 뒤 reload하세요.

인증은 앱에서 수행하므로 별도 htpasswd 파일이 필요 없습니다. `Host`와 `Authorization` 헤더를 그대로 전달합니다. 특히 Host를 내부 주소로 바꾸면 앱의 출처 검사 때문에 설정 저장과 답안 제출이 403으로 실패합니다. AI 응답을 기다리는 시간은 120초, 백업 복원 본문 제한은 32MB로 맞췄습니다. Nginx는 IP별 초당 5회/추가 20회 버스트를 적용해 반복 요청을 제한합니다.

앱이 이미 인증을 확인하므로 Nginx의 `auth_basic`을 추가로 켜서 서로 다른 두 계정을 겹치지 마세요. 현재 정적 파일과 API는 도메인 루트 경로를 사용하므로 `https://jlpt.example.com/`으로 연결합니다. `/jlpt/` 아래 배치는 지원하지 않습니다.

## 5. 외부망에서 확인

Wi-Fi를 끈 휴대폰 등 다른 네트워크에서 확인합니다. 아래 명령의 도메인은 실제 값으로 바꿉니다.

```sh
# 비로그인: 401 및 WWW-Authenticate: Basic 헤더가 나와야 합니다.
curl -i https://jlpt.example.com/api/state
curl -i https://jlpt.example.com/api/backup

# 비밀번호를 명령행에 적지 않으면 curl이 터미널에서 입력받습니다.
curl -u haru https://jlpt.example.com/api/health
```

인증한 health는 `{"ok":true}`가 나와야 합니다. 브라우저에서 목표 급수 저장, 문제 제출, AI 해설, 백업 다운로드도 확인합니다. 비밀번호를 입력하기 전에 브라우저 주소가 HTTPS이고 인증서 오류가 없는지 확인하세요.

인증서 갱신 시험:

```sh
sudo certbot renew --dry-run \
  --config-dir /opt/homebrew/etc/letsencrypt \
  --work-dir /opt/homebrew/var/lib/letsencrypt \
  --logs-dir /opt/homebrew/var/log/letsencrypt
```

실제 운영에서는 위 경로를 쓰는 `certbot renew`와 성공 후 Nginx reload를 주기적으로 실행하도록 **해당 Mac의 기존 인증서 관리 작업**에 등록해야 합니다. 이 저장소가 인증서 자동 갱신 작업을 자동 설치하지는 않습니다. 앱 자동 실행은 `deploy/kr.haru.jlpt.plist.example`을 참고하고 Node·프로젝트 절대 경로를 실제 값으로 바꾸세요. 앱과 Nginx의 재부팅 후 동작, Mac 절전 상태도 확인합니다.

## Nginx가 NAS 등 다른 장비인 경우

앱은 기본적으로 127.0.0.1에서만 받으므로 다른 장비에서는 연결할 수 없습니다. Mac 내부 IP가 192.168.0.50이라면:

```sh
HOST=192.168.0.50 npm start
```

Nginx의 proxy_pass를 `http://192.168.0.50:3210`으로 바꾸고 Mac 방화벽에서 Nginx 장비만 3210에 접근하게 제한합니다. Basic 인증 정보가 Nginx→Mac 구간에서도 전달되므로 이 구간은 신뢰할 수 있는 개인 LAN으로 제한하세요. 신뢰할 수 없는 네트워크를 가로지르면 이 구간도 TLS/VPN으로 보호해야 합니다. 앱의 Ollama 주소는 계속 Mac의 localhost를 사용합니다.

## 참고 문서와 검증 범위

- [Nginx proxy_set_header](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_set_header)
- [Nginx 요청 빈도 제한](https://nginx.org/en/docs/http/ngx_http_limit_req_module.html)
- [Let's Encrypt 인증 방식](https://letsencrypt.org/docs/challenge-types/)
- [Node.js scrypt](https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback)

앱의 인증·우회 차단·학습 기능은 자동 테스트로 검사합니다. 이 작업 환경은 Windows이므로 Nginx 설정의 실제 `nginx -t`, macOS 권한·서비스, 도메인 라우팅과 실 인증서 발급은 사용자의 Mac에서 확인해야 합니다.
