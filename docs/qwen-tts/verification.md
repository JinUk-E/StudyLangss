# Qwen3-TTS 검증 기록

2026-10-20 · main-codex · Windows / Node.js 24.15.0

## 실행한 검증

- `npm test`: 165개 중 **164 통과, 0 실패, 1 건너뜀**. 기존 Certbot 상대 파일 링크 시험은 Windows 심볼릭 링크 권한이 없어 생략했으며 Mac에서 확인해야 한다.
- 이후 재생 배속 watchdog 보완: `node --test tests/speech.test.mjs` **12/12 통과**. 180초 음원을 0.5배속으로 끝까지 재생할 수 있는 제한을 확인했다.
- `python -m unittest discover -s tests -p qwen_service_test.py -v`: **7/7 통과**. 실제 MLX 대신 fake 엔진/모듈을 사용했다.
- 학습·채팅 HTTP 시험은 임시 계정 DB와 모의 Qwen 서비스로 수행했다. 본인 저장 자료 ID만 합성, 타 계정 접근/임의 텍스트/미완료 답변 거절, 2초 권한 회수와 마지막 전달 차단, 계정·서비스 캐시 분리, 손상 WAV 거절을 포함한다.
- 설치/어댑터 시험: 고정 모델·버전 불일치, 토큰·경로·포트, 기존 PID 종료, 두 언어 합성 실패 시 활성화 거절, 22050Hz/stereo/잘못된 Content-Type 거절을 확인했다.
- Python 시험: 인증, body 제한, 언어 분할/구간 상한, PCM WAV, token cap 600 도달 시 거절, 시간 초과 후 모델 실행이 끝날 때까지 busy 유지.
- README·설치·기획/검증 문서 9개의 UTF-8·로컬 링크, HTML의 외부 자산 없음·인라인 SVG·밝고 어두운 테마 구조 검사 통과. 안내 HTML의 실제 브라우저 렌더 검사는 수행하지 않았다.

## 브라우저에서 확인한 동작

실제 앱 HTML/CSS/JS와 채팅 CSP, 독립 테스트 계정/DB를 사용했다. 음성만 1초 합성 테스트음으로 바꾸었으며 Qwen 음질 시험은 아니다.

- 완료된 스텔라 답변에서 읽기·중지·자동/한국어/일본어 선택 표시.
- 답변 읽기 클릭 시 `재생 중` 확인, 브라우저 오류/CSP 차단 없음.
- 언어 변경 시 중지하고 다시 누르기 안내.
- 390px 화면 `scrollWidth === innerWidth === 390`, 읽기 버튼과 언어 선택이 화면 안에 배치됨.
- 뜻 공개 후 한국어 뜻 읽기, 답안 제출 후 한국어 해설 읽기의 재생 상태 확인.
- 임시 탭·서버 종료, 화면 크기 원복. 증빙 `.qa/qwen-tts-desktop.png`, `.qa/qwen-tts-ui.png`는 개인 QA 산출물로 Git에서 제외한다.

## 실제 Mac에서 남은 확인

MLX/Metal 모델 로드, 패키지 실제 설치, LaunchAgent, 고정 모델 발음·속도·메모리와 Ollama 동시 사용, 운영 Nginx 설정 검사·재시작, 휴대폰 실제 재생은 수행하지 않았다. [Mac 설치 안내](../../deploy/MAC-QWEN-TTS.md)의 두 언어 샘플 확인 후 활성화한다. 모델 revision과 핵심 패키지는 고정했지만 전체 전이 의존성의 해시 lock은 아니다.

## 원문 확인 자료

- [Qwen3-TTS 공식 저장소](https://github.com/QwenLM/Qwen3-TTS): 한국어·일본어와 CustomVoice의 speaker/instruct 기능.
- [MLX-Audio v0.6.0](https://github.com/Blaizzy/mlx-audio/tree/v0.6.0): 실제 모델 load/generate/GenerationResult API 대조.
- [사용 모델의 고정 revision](https://huggingface.co/mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-6bit/tree/1c6c0ff58c43afa8df571facde2efa077efd85e2): 설치 도구의 다운로드 대상.

세 역할의 설계 검토와 운영·보안·UI 코드 검토를 반영했고 마지막 재검토에서 확정 결함 0건이었다. 동일 Codex 계열의 팀 검토이며 외부 CLI나 다른 모델 계열로 새 문서를 전송하지 않았다.
