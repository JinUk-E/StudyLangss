export const portfolioGroups = Object.freeze([
  { id: 'games', label: '게임', description: '직접 만든 세계와 플레이의 기록.' },
  { id: 'learning', label: '학습', description: '조금씩 배우고, 나의 속도로 쌓는 도구.' },
  { id: 'tools', label: 'AI·도구', description: '생각을 정리하고 일상의 일을 돕는 도구.' },
  { id: 'web', label: '웹페이지', description: '이야기와 작업을 담아 두는 공간.' },
  { id: 'other', label: '기타', description: '새로운 시도와 아직 분류하지 않은 작업.' }
].map(Object.freeze));

const groupIds = new Set(portfolioGroups.map(group => group.id));
const legacyGroups = Object.freeze({
  '8d47aa00-2000-4000-8000-000000000001': 'games',
  '8d47aa00-2000-4000-8000-000000000002': 'games',
  '8d47aa00-2000-4000-8000-000000000003': 'games',
  '8d47aa00-2000-4000-8000-000000000004': 'games',
  '8d47aa00-2000-4000-8000-000000000005': 'games',
  '8d47aa00-1000-4000-8000-000000000001': 'learning',
  '8d47aa00-1000-4000-8000-000000000002': 'tools',
  '8d47aa00-1000-4000-8000-000000000003': 'web'
});

// Display grouping is independent of genre, titles, visibility and stored order.
export function projectGroup(project) {
  if (project.group !== undefined) return groupIds.has(project.group) ? project.group : 'other';
  return Object.hasOwn(legacyGroups, project.id) ? legacyGroups[project.id] : 'other';
}
export const isPortfolioGroup = value => typeof value === 'string' && groupIds.has(value);
