// Affiliation confirmed by the owner on 2026-11-02. Existing development credits retained.
// Official store and image source: https://play.google.com/store/apps/details?id=com.moraegames.bmz
import previous from './morae-releases-previous.json' with { type: 'json' };
export const pedalId = '8d47aa00-2000-4000-8000-000000000001';
export const moraeProfile = {
  intro: 'Unity와 C#으로 게임을 만들고, 모래게임즈 소속으로 페달의민족과 블라인드메이즈를 출시했습니다. 모바일 게임 개발·출시와 빌드 자동화, 개인 게임과 웹 도구 제작 경험을 소개합니다.',
  bio: previous.profile.bio.replace('모바일 게임의 기획·개발·출시 경험을 바탕으로,', '모래게임즈 소속으로 페달의민족과 블라인드메이즈를 출시했습니다. 모바일 게임의 기획·개발·출시 경험을 바탕으로,')
};
export const moraeResumeSummary = previous.resume.summary.replace('개인 게임 BlindMaze는 기획부터 App Store·Google Play 출시까지 혼자 진행했습니다.', '모래게임즈 소속으로 블라인드메이즈(BlindMaze)와 페달의민족(Tour de Indoor)을 출시했습니다. 블라인드메이즈는 기획부터 App Store·Google Play 출시까지 단독으로 진행했습니다.');
export const pedalRelease = {
  category: '모래게임즈 · 모바일 출시',
  summary: '모래게임즈 소속으로 App Store·Google Play에 출시한 모바일 자전거 게임. 팀의 클라이언트 개발과 SDK 연동, Mac Studio 자동 빌드를 담당했습니다.',
  description: previous.pedal.description.replace('App Store와 Google Play에 출시한 팀 프로젝트입니다.', '모래게임즈 소속으로 App Store와 Google Play에 출시한 팀 프로젝트입니다.')
};
export const blindMazeAsset = { file: 'blindmaze-store-20261102.png', path: '/media/8d47aa00-3000-4000-8000-000000000020.png' };
export const blindMazeProject = {
  id: '8d47aa00-2000-4000-8000-000000000006', title: '블라인드메이즈 · BlindMaze',
  category: '모래게임즈 · 모바일 출시', group: 'games', year: '',
  role: '기획·개발·App Store 및 Google Play 출시 단독 진행',
  summary: '모래게임즈 소속으로 출시한 모바일 미로 퍼즐 게임. 보이지 않는 길을 감각과 논리로 탐색하며, 기획·개발부터 양대 스토어 출시까지 단독으로 진행했습니다.',
  description: '블라인드메이즈(BlindMaze)는 모래게임즈 소속으로 App Store와 Google Play에 출시한 모바일 게임입니다. 기획·개발부터 스토어 출시까지 단독으로 진행했습니다.\n\n보이지 않는 미로를 탐색하며 단서를 찾고 탈출하는 퍼즐 게임입니다. 감각과 논리를 활용해 길을 찾아가며, 스테이지가 진행될수록 복잡해지는 미로에 도전합니다.\n\n대표 이미지는 공식 Google Play에 등록된 게임 소개 화면입니다.',
  tags: ['Unity', 'C#', '미로 퍼즐', '모바일', '단독 개발', 'App Store', 'Google Play'],
  link: 'https://play.google.com/store/apps/details?id=com.moraegames.bmz', repository: '',
  cover: blindMazeAsset.path, gallery: [], published: true, featured: true, order: 5
};
export const refreshMoraeProject = project => project.id === pedalId ? { ...project, ...pedalRelease } : project;
