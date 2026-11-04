# 별빛공방 소식 MCP 인증

0.1.0의 `auth.type: api_key`는 인증 방식 선언일 뿐 Codex에 자격 증명을 저장하지 않았다. 빈 headers와 OAuth discovery가 없는 서버 조합에서는 인증된 tools/list를 완료할 수 없었다. 0.2.0부터 OAuth authorization code + S256 PKCE를 사용한다.

## 연결

- 플러그인을 0.2.0 이상으로 업데이트하고 Codex MCP 설정에서 인증을 시작한다.
- 별빛공방 소유자 계정으로 브라우저에서 로그인한 뒤 소식 연결을 승인한다.
- Codex가 콜백을 받아 인증을 완료한 뒤 MCP 연결을 새로고침한다. 새 대화가 필요할 수 있다.
- `list_news_topics` 결과에 `jpop`, `twins`가 있는지 확인한다. 0.3.0 이상에서는 주간 채용 `jobs`도 제공한다.
- 직접 구성하는 Codex CLI에서는 `codex mcp add starlight-news --url https://starlightforge.duckdns.org/api/chat/bridge/mcp`, 이어서 `codex mcp login starlight-news`를 실행한다. 플러그인 연결과 직접 등록은 별도 연결이다.
- 로그인은 Codex가 실행되는 컴퓨터에서 완료한다. Windows의 loopback 콜백은 Windows 브라우저에서, Mac의 콜백은 Mac 브라우저에서 완료한다.

## 서버와 프록시

`/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource`, `/.well-known/oauth-protected-resource/api/chat/bridge/mcp`를 chat-server(3211)로 프록시해야 한다. 나머지 `/api/chat/bridge/oauth/` 경로는 기존 chat 프록시를 사용한다. 요청 헤더·POST 본문·응답 토큰을 로깅하지 않는다.

OAuth 권한은 `news:deliver` 하나이며 소식 도구 3개로 제한한다. DCR 공개 클라이언트, S256 PKCE, 정확한 redirect/resource/client 결합, issuer 식별, 2분짜리 일회용 코드, 15분 access token, 30일 refresh grant를 사용한다. 토큰·코드는 SHA-256 해시로만 SQLite에 저장한다. 갱신 토큰을 회전하고 재사용 시 해당 연결을 폐기한다. 소유자 계정 revision 변경 또는 소식 화면의 연결 해제 시 기존 권한이 무효화된다. 연결 해제는 수동 키도 폐기한다.

승인은 소유자 로그인·HttpOnly/Secure/SameSite 쿠키·일회용 CSRF 검증을 모두 요구한다. 승인 화면에 표시한 앱 이름은 클라이언트가 제공한 이름으로, 신원 보증이 아니다. 콜백은 ChatGPT OAuth 경로와 127.0.0.1/IPv6 loopback callback만 허용한다. 임의 메타데이터 URL을 fetch하지 않는다.

공식 문서: https://learn.chatgpt.com/docs/extend/mcp 및 https://developers.openai.com/plugins/build/auth

플러그인 배포와 사용자의 실제 연결 완료는 별개다. 테스트용 SDK 호출을 Codex 호스트에서의 도구 호출 성공으로 표현하지 않는다. 원본 리포트를 확보하지 못하면 내용이나 출처를 추측해서 전송하지 않는다.

## Mac의 예약 전달

Codex의 기존 대화에 매일 오전 7시(Asia/Seoul) 예약 작업을 연결한다. 예약 작업은 새 리포트를 확인하고 `publish_news_report`로 전달한다. 기존 ChatGPT 검색 예약의 조건과 시간은 변경하지 않는다. 채용은 원본 작성일을 보존하고, LG 원본 대화가 연결되지 않았다면 공식 출처를 직접 확인한 리포트임을 명시한다.

현재 턴에 MCP 도구가 노출되지 않는 경우, 직접 등록한 `starlight-news` 연결을 다음 명령으로 사용할 수 있다. 먼저 같은 Mac에서 Codex OAuth 로그인이 완료되어 있어야 한다.

```sh
python3 scripts/news/deliver.py --topics
python3 scripts/news/deliver.py data/chat/news-sync/outbox/report.json
```

입력 JSON은 `topic`, `deliveryId`, `title`, `body`, `reportDate`, `sources`를 포함한다. 헬퍼는 공식 Codex app-server의 임시 MCP 컨텍스트에서 도구를 호출하며 모델 대화를 시작하지 않는다. 인증 파일이나 키를 읽거나 내보내지 않는다. `saved:true`와 전달 ID 조회 결과가 일치해야 성공하며, 비공개 영수증을 `data/chat/news-sync/receipts/`에 저장한다. 동일 회차 재시도는 원래 ID와 본문을 유지한다.

예약 실행은 해당 Mac과 Codex 앱이 실행 가능한 상태여야 한다. OAuth 연결 만료·해제, 원본 조회 실패, 출처 확인 실패는 전달 실패로 알리고 새 소식 없음으로 표시하지 않는다. 인증 복구가 필요하면 Codex의 로그인 흐름을 다시 진행한다.
