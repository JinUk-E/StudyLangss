// Repository-backed descriptions only. No employment, education or awards are invented.
import { refreshProject } from './portfolio-latest.mjs';
export const starterProfile = {
  name: '별빛공방', role: '개인 프로젝트 · 웹 도구',
  tagline: '아이디어를 직접 만들고,\n오래 쓸 도구로 다듬습니다.',
  intro: '필요한 도구를 만들고, 사용하며 고쳐 갑니다. 개인 서버에서 운영하는 웹 프로젝트와 학습의 기록을 모았습니다.',
  bio: '별빛공방은 직접 만든 도구와 작업 과정을 기록하는 개인 작업실입니다.\n\n외국어 공부를 이어가기 위한 학습 앱, 생각을 정리하는 로컬 AI 대화, 작업을 소개하는 포트폴리오를 하나의 공간에 연결했습니다. 작은 기능부터 실제로 사용해 보고, 불편한 점을 고치며 프로젝트를 발전시킵니다.',
  email: '', githubUrl: 'https://github.com/JinUk-E/StudyLangss', contactUrl: ''
};
export const starterResume = {
  headline: '프로젝트 중심 이력서',
  summary: '개인 서버에서 사용할 웹 도구를 만들고 운영합니다. 아래에는 현재 공개된 프로젝트에서 사용한 기술과 작업 내용을 정리했습니다.',
  skills: ['JavaScript', 'Node.js', 'SQLite', 'Nginx', 'Ollama'],
  experience: [], education: [], published: true
};
const base = { role: '개인 프로젝트', year: '2026', repository: 'https://github.com/JinUk-E/StudyLangss', cover: '', gallery: [], published: true, featured: false };
export const starterProjects = [
  { ...base, id: '8d47aa00-1000-4000-8000-000000000001', title: '하루 일본어', category: '학습 도구', summary: '오늘의 문제 풀이에서 오답 복습까지, 혼자 꾸준히 공부하기 위한 JLPT 학습 앱.', description: 'N5부터 N1까지 목표 급수를 선택하고 어휘·문법·독해·청해 예제를 학습하는 개인용 웹앱입니다. 풀이 기록과 복습 일정을 SQLite에 보관하고, 필요한 순간에는 Ollama로 추가 설명을 요청할 수 있습니다.\n\n브라우저 이어하기, 자료 가져오기, 백업·복원을 지원합니다. 포함된 60문항은 자체 제작 연습 예제이며 공식 기출이나 공식 난도 판정 자료는 아닙니다. 학습 공간은 로그인 후 이용합니다.', tags: ['Node.js', 'SQLite', 'JLPT', 'Ollama'], link: 'https://starlightforge.duckdns.org/study/', order: 0, featured: true },
  { ...base, id: '8d47aa00-1000-4000-8000-000000000002', title: '별빛 AI 대화', category: '개인 도구', summary: '로컬 모델과 대화하고, 필요할 때 웹 검색의 출처를 함께 확인하는 개인 작업 공간.', description: 'Mac Studio의 Ollama에 연결해 대화를 나누는 웹 인터페이스입니다. 설치된 모델 선택, 답변 스트리밍과 중지, 대화 기록 관리를 지원합니다.\n\n웹 검색을 켜면 연결한 검색 서비스의 결과와 출처를 함께 표시합니다. 대화 저장소는 학습 기록과 분리되어 있고 로그인 후 이용합니다. 외부 검색은 Mac의 검색 서비스 연결이 필요합니다.', tags: ['Ollama', '스트리밍', 'SQLite'], link: 'https://starlightforge.duckdns.org/chat/', order: 1 },
  { ...base, id: '8d47aa00-1000-4000-8000-000000000003', title: '별빛공방 웹사이트', category: '웹사이트', summary: '프로젝트를 소개하고, 포트폴리오와 이력서를 직접 관리하는 개인 웹사이트.', description: '공개 포트폴리오와 개인 도구를 하나의 도메인에 연결한 웹사이트입니다. 프로젝트별 설명과 이미지를 등록하고 공개 여부를 선택할 수 있습니다.\n\nNode.js와 SQLite로 데이터를 보관하고 Nginx와 HTTPS를 통해 Mac Studio에서 운영합니다. 소개·포트폴리오·이력서는 로그인한 관리 화면에서 편집합니다.', tags: ['JavaScript', 'Node.js', 'Nginx', 'HTTPS'], link: 'https://starlightforge.duckdns.org/', order: 2 }
].map(refreshProject);
