// Only verified, public games belong here. Editable portfolio URLs never become iframe sources.
export const webGames = Object.freeze([
  Object.freeze({
    slug: 'projectf', projectId: '8d47aa00-2000-4000-8000-000000000002',
    title: '제5병기창', subtitle: 'PROJECT F · TACTICAL ARTILLERY',
    url: 'https://jinuk-e.github.io/ProjectF/',
    summary: '전차를 고르고, 지형과 바람을 읽으며 한 발을 준비하세요. AI 또는 같은 PC의 친구와 즐기는 3D 전술 포격전입니다.',
    device: 'PC · 키보드와 마우스', mode: 'AI 대전 · 로컬 2인',
    controls: ['이동: 방향키', '포신 방향 A·D / 각도 W·S', '발사 위력 Q·E · 탄종 1·2 · 발사 Space', '카메라: 마우스 우클릭 드래그 / 휠'],
    note: 'PC에서 플레이해 주세요. 게임 안의 「플레이 시작」을 누르면 첫 게임 데이터를 불러옵니다.',
    saveNote: '게임을 종료하면 진행 중인 대전이 끝납니다. 전체화면 전환은 같은 게임 화면을 유지합니다.'
  }),
  Object.freeze({
    slug: 'dugout', projectId: '8d47aa00-2000-4000-8000-000000000005',
    title: '더그아웃', subtitle: 'BASEBALL LIFE · YOUR CAREER',
    url: 'https://jinuk-e.github.io/BaseBallLife/',
    summary: '고교의 첫 유니폼부터 마지막 시즌까지. 훈련과 회복, 계약을 선택하며 나만의 야구 인생을 이어가세요.',
    device: 'PC · 모바일 브라우저', mode: '싱글 플레이 · 커리어 시뮬레이션',
    controls: ['선수 생성 후 매주 훈련·회복 선택', '기록실에서 시즌과 통산 기록 확인', '설정에서 저장 파일 내보내기·가져오기'],
    note: '화면의 버튼을 눌러 진행합니다. 처음이라면 게임 안의 플레이 가이드를 확인해 주세요.',
    saveNote: '저장은 브라우저와 이 화면·새 탭 열기에 따라 달라질 수 있어요. 이어서 하려면 같은 방식으로 열거나 게임 설정의 저장 내보내기·가져오기를 이용하세요.'
  })
]);
export const webGameForProject = id => webGames.find(game => game.projectId === id);
export const webGameForSlug = slug => webGames.find(game => game.slug === slug);
export const webPlayPath = game => `/play/${game.slug}/`;
