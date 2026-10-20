# UI 개편 제한 검토

2026-10-21 · main-codex / ui-codex

| 지적 | 판정과 반영 |
|---|---|
| 뒤에 로드되는 공통 CSS가 홈 카드·타이포그래피를 덮을 수 있음 | 채택. main-codex는 쉘/테마/AI·학습을, ui-codex는 홈 내부/이력서를 소유한다. `body[data-section=home] .intro-card`, `.resume-*` 등 내부 선택자로 경계를 둔다. |
| 대표 벤토 추가로 목록 필터·직접 링크가 빠질 수 있음 | 채택. API 응답의 published/featured/cover만 사용하고 전체 프로젝트 배열과 /projects/:id 모달 흐름을 유지한다. |
| 긴 이력서의 섹션 단위 break-inside와 bullet 처리로 인쇄 공백·내용 손실 가능 | 채택. 전체 섹션의 avoid는 해제하고 개별 항목/제목을 제어한다. 줄 앞 -/• 목록과 일반 문단/줄바꿈을 모두 보존한다. |

채택 3/3, 반려 0, 미해결 확정결함 0. 직접 인용: “기존print .resume-section{break-inside:avoid}는긴경력섹션통째로다음장넘겨여백/잘림가능.” 동일 Codex 계열 1명의 제한 검토이며 다른 모델 계열의 검증으로 표현하지 않는다.
