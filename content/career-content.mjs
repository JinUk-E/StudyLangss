// Public website copy adapted from the owner's portfolio and resume.
// Contact details and application-specific material are intentionally excluded.
import { refreshedAssets, refreshProject } from './portfolio-latest.mjs';
export const careerProfile = {
  name: '정진욱',
  role: 'Unity 클라이언트 개발자',
  tagline: '게임을 만드는 코드에서\n개발을 지탱하는 도구까지.',
  intro: 'Unity와 C#으로 게임을 만들고, 출시 이후에도 개발을 이어 갈 수 있는 기반을 다듬습니다. SDK 연동, 모바일 출시, 빌드 자동화와 런타임 안정성을 네 개의 프로젝트에 담았습니다.',
  bio: 'Unity 클라이언트 개발자 정진욱입니다. 모바일 게임의 기획·개발·출시 경험을 바탕으로, 게임 기능과 이를 지탱하는 개발 도구를 함께 만듭니다.\n\n페달의민족(Tour de Indoor)에서는 클라이언트 개발을 전담하고 Mac Studio의 Jenkins 기반 Android/iOS 자동 빌드를 담당했습니다. 아트와 서버는 팀원이 담당했습니다. 로그인·광고·데이터 SDK의 실패 처리, 리소스 수명과 빌드 입력값처럼 문제가 발생하기 쉬운 경계를 정리하는 데 관심이 있습니다.\n\n개인 프로토타입에서는 패키지 호환성, 서버 권한과 클라이언트 예측, 화면과 게임 규칙의 분리를 다뤘습니다. AI 도구는 코드 탐색·구현·검토에 활용하고, 변경된 코드와 실제 실행 결과를 확인하며 적용합니다.',
  email: '',
  githubUrl: 'https://github.com/JinUk-E',
  contactUrl: ''
};

export const careerResume = {
  headline: '게임을 만들고, 출시까지 이어가는 Unity 개발자',
  summary: 'Unity와 C#으로 게임과 인터랙티브 콘텐츠를 개발하는 정진욱입니다.\n\n개인 게임 BlindMaze는 기획부터 App Store·Google Play 출시까지 혼자 진행했습니다. 페달의민족(Tour de Indoor)에서는 팀의 클라이언트 개발을 전담하고, Android·iOS 자동 빌드를 구성했습니다.\n\n게임 기능 구현과 함께 SDK 연동, 리소스 관리, 빌드·배포 과정을 다룹니다. 문제가 생겼을 때 원인을 찾고, 다음 작업을 편하게 이어 갈 수 있도록 개발 환경을 정리합니다.',
  skills: ['Unity / C#', 'UGUI / Input System', 'URP / Shader Graph', 'UniTask / DOTween', 'Addressables / Localization', 'Unity Profiler / Memory Profiler', 'Android / Gradle', 'iOS / Xcode', 'WebGL', 'Firebase Analytics', 'AdMob / UMP / TheBackend', 'Jenkins / fastlane / Inno Setup', 'Git / REST API / AWS S3', 'Python / MySQL', 'C++ / OpenCV', 'JavaScript / Node.js', 'Claude Code / Codex / Gemini CLI', 'UnityMCP / Ollama'],
  experience: [
    {
      title: 'Unity 클라이언트 개발', organization: '(주)이노시뮬레이션', period: '2025.02 – 재직 중',
      description: '• PC·XR 콘텐츠의 UI와 상호작용을 개발하고, 애니메이션과 파티클을 제어했습니다.\n• Unity Profiler로 화면 동작을 살펴보고, 현실 화면과 가상 화면이 겹쳐 보이는 문제의 설정을 조정했습니다.\n• 기관용 런처에서 파일 점유와 쓰기 권한 오류를 구분해 처리했습니다.\n• 다운로드 파일 확인부터 Jenkins 빌드 연동, 설치 파일 생성까지 Windows 배포 과정을 자동화했습니다.'
    },
    {
      title: '클라이언트 개발', organization: '주식회사 토즈', period: '2022.11 – 2023.12',
      description: '• Addressables와 AWS S3를 연결해 원격 리소스를 내려받고, 실행 중 불러오는 기능을 만들었습니다.\n• 화면 전환 후 사용이 끝난 리소스를 해제하도록 관리했습니다.\n• 서버 요청과 데이터 변환 코드를 나누고, 응답이 늦거나 실패하면 시간 제한과 재시도가 동작하도록 구성했습니다.\n• Stable Diffusion API로 생성한 이미지를 받아 화면에 보여주는 기능을 개발했습니다.'
    },
    {
      title: 'R&D 엔지니어', organization: '스냅태그 주식회사', period: '2022.04 – 2022.10',
      description: '• C++와 OpenCV로 이미지 속 워터마크를 읽는 알고리즘을 연구했습니다.\n• 이미지 처리 코드의 동작을 분석하고, 워터마크를 판정하는 로직을 개선했습니다.\n• 오류 검출·정정 코드와 이미지 조건별 인식 결과를 시험하고, 잘 인식되지 않는 조건을 기록했습니다.'
    },
    {
      title: '데이터 엔지니어 / 분석', organization: '(주)조인트리 · (주)TNMS', period: '2020.09 – 2022.04',
      description: '• Python과 SQL로 공공데이터를 수집·정리해 DB에 저장하는 과정을 자동화했습니다.\n• 누락되거나 잘못된 데이터를 확인하고, REST API 데이터 전송과 반복 리포트 작업을 자동화했습니다.\n• 분석 도구 사용법과 데이터 처리 기준을 문서로 정리했습니다.'
    }
  ],
  education: [
    { title: '수학교육 전공 · 석사 졸업', organization: '경희대학교 교육대학원', period: '2015.02 – 2017.02', description: '' },
    { title: '수학과 · 학사 졸업', organization: '광운대학교', period: '2008.03 – 2015.02', description: '' }
  ],
  published: true
};

export const careerAssets = [
  { file: 'm.png', path: '/media/8d47aa00-3000-4000-8000-000000000001.png' },
  { file: 'f.png', path: '/media/8d47aa00-3000-4000-8000-000000000002.png' },
  { file: 'run.png', path: '/media/8d47aa00-3000-4000-8000-000000000003.png' },
  { file: 'lobby.png', path: '/media/8d47aa00-3000-4000-8000-000000000004.png' },
  { file: 'deduction.png', path: '/media/8d47aa00-3000-4000-8000-000000000005.png' },
  ...refreshedAssets
];
const asset = file => careerAssets.find(image => image.file === file).path;
const projectBase = { repository: '', link: '', cover: '', gallery: [], published: true, featured: true };

export const careerProjects = [
  {
    ...projectBase, id: '8d47aa00-2000-4000-8000-000000000001',
    title: '페달의민족 · Tour de Indoor', category: 'ProjectP · 모바일 출시', year: '2026.02 – 진행 중',
    role: '팀 프로젝트 · 클라이언트 개발 전담 · AI 활용 · 자동 빌드 담당',
    summary: 'App Store·Google Play에 출시한 모바일 자전거 게임. 클라이언트 SDK 연동과 Mac Studio 기반 자동 빌드를 담당했습니다.',
    description: '페달의민족(Tour de Indoor)은 App Store와 Google Play에 출시한 팀 프로젝트입니다. 클라이언트 개발을 전담하고 AI 도구를 활용했으며, 아트와 서버 개발은 팀원이 담당했습니다.\n\nTheBackend SDK의 로그인·사용자 데이터·재화·랭킹·우편·정책 동의를 게임 화면에 연결했습니다. SDK 콜백을 UniTaskCompletionSource로 감싸 공통 30초 시간 제한을 적용하고, 늦게 도착한 콜백이 중복으로 요청을 완료하지 않도록 처리했습니다. 요청 실패·취소와 화면 전환 뒤의 응답을 관리했습니다.\n\nAdMob 초기화에 대기 상한을 두고 광고 이벤트를 Unity 메인 스레드에서 받도록 구성했습니다. 재시도 횟수와 백오프 상한, 이벤트 구독 여부를 관리했습니다. Addressables와 Localization을 연결해 다국어 텍스트를 불러오도록 했습니다.\n\nMac Studio에서 Jenkins·fastlane을 활용한 Android/iOS 자동 빌드를 담당했습니다. Android APK/AAB 선택·버전·서명 입력값을 검사하고 iOS 빌드 진입점과 Xcode 산출물 경로를 분리했습니다. 빌드 전 로컬라이제이션 키를 검사해 리소스 오류를 앞 단계에서 확인하도록 구성했습니다.',
    tags: ['Unity', 'C#', 'UniTask', 'TheBackend', 'AdMob', 'Addressables', 'Jenkins', 'fastlane'],
    link: 'https://apps.apple.com/us/app/tour-de-indoor/id6758999952', order: 0
  },
  {
    ...projectBase, id: '8d47aa00-2000-4000-8000-000000000002',
    title: 'ProjectF · 전술 포격', category: '전술 포격 프로토타입', year: '2026',
    role: '투사체 패키지 호환 수정 · 전투 상태와 탄착 처리 · 회귀 검증',
    summary: 'Unity 버전별 패키지 호환성을 확인하고, 탄착 기록과 월드 상태 변경을 분리한 전술 포격 프로토타입입니다.',
    description: '투사체 패키지의 Unity 버전 호환성과 턴·탄착 처리를 다룬 전술 포격 프로토타입입니다. Unity 6000.5.6f1에서 Object.GetInstanceID() 사용이 CS0619 컴파일 오류를 일으킨 조건을 확인하고 식별자와 경고 중복 제거 키의 호환성을 수정했습니다.\n\n2026-10-17 저장된 패키지 검증 기록에서는 Unity 6000.5.6f1과 6000.0.32f1에서 각각 162건 통과·실패 0건이며, GC 측정 불가 3건을 별도로 기록했습니다. 이는 해당 시점과 환경의 검증 기록입니다.\n\n높이 배열을 지형의 기준 데이터로 두고 화면은 이를 표시하도록 구성했습니다. 비행 중에는 상태를 유지하고, 발사 계열 종료 뒤 탄착 기록을 시각과 안정적인 인덱스로 정렬해 피해·크레이터·탱크 정착·승패 순서로 반영했습니다.\n\n2026-10-17 전술 전장 검증 기록은 PlayMode 43/43, EditMode 209건 통과·실패 0건과 외부 패키지 GC 측정 불가 3건입니다. 사격 종료 전 상태 고정, 건물 차폐와 파괴 후 통행, 동일 시드 복원을 포함합니다.',
    tags: ['Unity 6', 'C#', 'URP', '패키지 호환성', '턴 처리', 'EditMode', 'PlayMode'],
    cover: asset('f.png'), order: 1
  },
  {
    ...projectBase, id: '8d47aa00-2000-4000-8000-000000000003',
    title: 'ProjectRun · 경찰과 도둑', category: '멀티플레이 프로토타입', year: '2026',
    role: '서버 권한 · 입력 예측과 보정 · 네트워크 검증 도구',
    summary: '서버 입력 검증과 클라이언트 예측을 구현하고, 실제 게임 흐름을 따라가는 네트워크 검사 도구를 구성했습니다.',
    description: '경찰·도둑 멀티플레이 프로토타입입니다. 클라이언트는 위치 대신 입력과 시퀀스를 전송하며, 서버는 NaN·Infinity와 입력 크기를 검사합니다. 준비 단계와 쿨다운에서 능력 사용을 거절하도록 권한 경계를 두었습니다.\n\n미확인 입력을 보관하는 고정 길이 128개 버퍼를 사용합니다. 서버 스냅샷에서 확인된 입력을 제거하고 나머지를 다시 실행하며, 중복·역순 스냅샷은 거절합니다. 큰 오차와 버퍼 초과는 스냅으로 복구합니다. 128은 동시 접속자 수가 아닌 입력 버퍼 용량입니다.\n\nReleaseNetworkSmoke 도구가 Host 시작, 네트워크 씬 전환, 캐릭터 8개 생성과 AI 7개 배치, 준비에서 플레이 전환을 단계별로 검사합니다. 시간 제한과 오류 로그 감지로 검사 자체의 무한 대기를 방지합니다. network-smoke와 release-regression 결과에는 서버 물리, 능력 쿨다운, 이동 범위, 오래된 입력 정지, 빌드 씬·프리팹 검사를 기록합니다.\n\nEffectPool은 키별 Stack으로 이펙트를 재사용하고 중복 반환을 방어합니다. 씬 종료로 파괴된 항목은 재사용 시 제외하고 종료 과정의 객체 재생성을 피하도록 처리했습니다.',
    tags: ['Unity', 'C#', 'Netcode', '클라이언트 예측', '입력 검증', 'Editor 도구', '오브젝트 풀'],
    cover: asset('run.png'), gallery: [asset('lobby.png')], order: 2
  },
  {
    ...projectBase, id: '8d47aa00-2000-4000-8000-000000000004',
    title: 'ProjectM · 사진 조사와 추리', category: '조사·추리 프로토타입', year: '2026',
    role: '순수 C# 규칙 모델 · UI Toolkit · AI 구현 교차 검토',
    summary: '게임 규칙과 화면을 분리하고, AI 도구의 구현을 실제 입력 경로와 자동 진행으로 확인한 Windows 프로토타입입니다.',
    description: '사진 조사와 추리 보드를 연결하는 Windows 실행 프로토타입입니다. GameState가 단서·탐문 노드·추리 보드·렌즈 모델과 화면 상태를 소유하고, 화면은 모델 메서드를 호출합니다. 화면 전환 가능 여부는 CanEnter에서 판단합니다.\n\n사건 문안과 규칙은 CaseData 및 JSON으로 관리하고, 알려지지 않은 핫스팟 ID와 중복·누락을 생성 시 검사합니다. 저장된 2026-10-17 EditMode 검증 결과는 225/225 통과입니다.\n\nClaude의 설계·검토와 Codex의 구현을 나눠 활용했습니다. 제안된 수정은 실제 게임 규칙과 비교하고 적용 여부와 이유를 기록했습니다. 모달 종료 뒤 렌즈가 키 입력을 받지 못하는 문제를 Root.Focus()로 수정하고, 키 유지와 모달 진입 시점의 입력도 다시 확인했습니다.\n\n자동 진행 도구는 단서를 직접 추가하지 않고 버튼과 사진 입력 경로를 호출합니다. 1280×720과 1920×1080에서 의뢰부터 결말까지 진행하고 화면을 캡처했습니다. 자동 검사는 입력·상태·표시를 확인하며 이야기 이해도와 플레이 감각은 사람의 평가로 확인합니다. Steam은 목표 플랫폼이며 SDK 연동 또는 스토어 출시 실적은 포함하지 않습니다.',
    tags: ['Unity', 'C#', 'UI Toolkit', 'JSON', '규칙 모델', 'AI 교차 검토', '자동 진행'],
    cover: asset('m.png'), gallery: [asset('deduction.png')], order: 3
  }
].map(refreshProject);
