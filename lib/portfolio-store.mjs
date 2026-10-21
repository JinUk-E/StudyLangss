import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { assert } from './validation.mjs';
import { starterProfile, starterProjects, starterResume } from '../content/portfolio-defaults.mjs';
import { careerProfile, careerResume, careerProjects, careerAssets } from '../content/career-content.mjs';
import previousCareerResume from '../content/career-resume-v1.json' with { type: 'json' };

export const defaultProfile = {
  name: '별빛공방', role: 'PERSONAL WORKSHOP & PORTFOLIO',
  tagline: '작은 생각을 모아,\n나만의 세계를 만듭니다.',
  bio: '배우고, 만들고, 기록하는 개인 작업실입니다.', email: '', githubUrl: '', contactUrl: ''
};
const string = (value, max, label, required = false) => {
  assert(typeof value === 'string' && value.length <= max && (!required || value.trim()), `${label}을 확인해 주세요.`);
  return value.trim();
};
const link = value => {
  const result = string(value || '', 2000, '링크'); if (!result) return '';
  let url; try { url = new URL(result); } catch { assert(false, '올바른 링크를 입력하세요.'); }
  assert(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password, 'http 또는 https 링크만 사용할 수 있습니다.');
  return url.href;
};
export function profileInput(value) {
  assert(value && typeof value === 'object', '소개 형식을 확인해 주세요.');
  const email = string(value.email || '', 254, '이메일');
  assert(!email || /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email), '이메일 형식을 확인해 주세요.');
  return { name: string(value.name, 60, '표시 이름', true), role: string(value.role || '', 120, '분야'), tagline: string(value.tagline || '', 200, '한 줄 소개'), intro: string(value.intro || '', 600, '홈 소개'), bio: string(value.bio || '', 3000, '자기소개'), email, githubUrl: link(value.githubUrl), contactUrl: link(value.contactUrl) };
}
export function resumeInput(value) {
  assert(value && typeof value === 'object' && typeof value.published === 'boolean', '이력서 공개 설정을 확인하세요.');
  assert(Array.isArray(value.skills) && value.skills.length <= 40, '기술은 최대 40개입니다.');
  const entries = (items, label) => {
    assert(Array.isArray(items) && items.length <= 30, `${label}은 최대 30개입니다.`);
    return items.map(item => { assert(item && typeof item === 'object', `${label} 형식을 확인하세요.`); return {
      title: string(item.title, 150, `${label} 제목`, true), organization: string(item.organization || '', 150, '기관'),
      period: string(item.period || '', 80, '기간'), description: string(item.description || '', 3000, '설명')
    }; });
  };
  return { headline: string(value.headline, 160, '이력서 제목', true), summary: string(value.summary || '', 5000, '요약'), skills: [...new Set(value.skills.map(v => string(v, 60, '기술', true)))], experience: entries(value.experience, '경력'), education: entries(value.education, '학력'), published: value.published };
}
export function projectInput(value, imageExists) {
  assert(value && typeof value === 'object', '프로젝트 형식을 확인해 주세요.');
  const image = path => {
    if (!path) return '';
    assert(typeof path === 'string' && /^\/media\/[a-f0-9-]{36}\.(png|jpg|webp)$/.test(path) && imageExists(path), '등록된 이미지를 선택하세요.');
    return path;
  };
  assert(Array.isArray(value.tags || []) && (value.tags || []).length <= 8, '태그는 최대 8개입니다.');
  assert(Array.isArray(value.gallery || []) && (value.gallery || []).length <= 6, '추가 이미지는 최대 6개입니다.');
  assert(typeof value.published === 'boolean' && typeof value.featured === 'boolean', '공개·대표작 설정을 확인하세요.');
  assert(Number.isInteger(value.order) && value.order >= 0 && value.order <= 9999, '정렬 순서는 0~9999입니다.');
  return { title: string(value.title, 100, '프로젝트 이름', true), summary: string(value.summary || '', 300, '요약'), description: string(value.description || '', 12000, '상세 설명'), category: string(value.category || 'PROJECT', 40, '분류'), role: string(value.role || '', 160, '담당 역할'), year: string(value.year || '', 30, '작업 기간'), tags: [...new Set((value.tags || []).map(tag => string(tag, 40, '태그', true)))], link: link(value.link), repository: link(value.repository), cover: image(value.cover), gallery: [...new Set((value.gallery || []).map(image).filter(Boolean))], published: value.published, featured: value.featured, order: value.order };
}
export function imageType(buffer) {
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && buffer.toString('ascii', 12, 16) === 'IHDR') {
    const width = buffer.readUInt32BE(16), height = buffer.readUInt32BE(20);
    assert(width > 0 && height > 0 && width <= 16000 && height <= 16000, '이미지 크기가 너무 큽니다.');
    return { mime: 'image/png', extension: 'png' };
  }
  if (buffer.length > 4 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return { mime: 'image/jpeg', extension: 'jpg' };
  if (buffer.length > 16 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return { mime: 'image/webp', extension: 'webp' };
  assert(false, 'PNG, JPEG, WebP 이미지 파일만 올릴 수 있습니다.', 415);
}

function importCareerContent(db) {
  const migration = 'career-import-v1';
  if (db.prepare('SELECT 1 FROM migrations WHERE id=?').get(migration)) return;
  db.exec('BEGIN IMMEDIATE');
  try {
    const previous = JSON.parse(db.prepare('SELECT json FROM profile WHERE id=1').get().json);
    const migrated = { ...previous };
    for (const [key, value] of Object.entries(careerProfile)) {
      if (previous[key] === undefined || previous[key] === defaultProfile[key] || previous[key] === starterProfile[key]) migrated[key] = value;
    }
    const nextProfile = profileInput(migrated);
    const previousResume = JSON.parse(db.prepare('SELECT json FROM documents WHERE id=?').get('resume').json);
    // A visibility change alone does not turn the starter text into a custom resume.
    const starterContent = value => JSON.stringify(resumeInput({ ...value, published: false }));
    const nextResume = starterContent(previousResume) === starterContent(starterResume)
      ? resumeInput({ ...careerResume, published: previousResume.published }) : previousResume;
    const paths = new Set();
    const images = careerAssets.map(asset => {
      assert(asset && typeof asset.file === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,150}$/.test(asset.file), '기본 이미지 파일명을 확인하세요.');
      assert(typeof asset.path === 'string' && /^\/media\/[a-f0-9-]{36}\.(png|jpg|webp)$/.test(asset.path) && !paths.has(asset.path), '기본 이미지 경로를 확인하세요.');
      paths.add(asset.path);
      const file = new URL(`../content/career-assets/${asset.file}`, import.meta.url);
      const info = statSync(file);
      assert(info.isFile() && info.size > 0 && info.size <= 8 * 1024 * 1024, '기본 이미지 크기를 확인하세요.');
      const content = readFileSync(file);
      assert(content.length <= 8 * 1024 * 1024, '기본 이미지 크기를 확인하세요.');
      const { mime, extension } = imageType(content);
      assert(asset.path.endsWith(`.${extension}`), '기본 이미지 확장자를 확인하세요.');
      return { path: asset.path, mime, content };
    });
    const ids = new Set();
    const projects = careerProjects.map(({ id, ...project }) => {
      assert(typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id) && !ids.has(id), '기본 프로젝트 ID를 확인하세요.'); ids.add(id);
      return { id, value: projectInput(project, path => paths.has(path) || Boolean(db.prepare('SELECT 1 FROM images WHERE path=?').get(path))) };
    });
    const timestamp = new Date().toISOString();
    db.prepare('UPDATE profile SET json=? WHERE id=1').run(JSON.stringify(nextProfile));
    db.prepare('UPDATE documents SET json=? WHERE id=?').run(JSON.stringify(nextResume), 'resume');
    const insertImage = db.prepare('INSERT OR IGNORE INTO images VALUES (?,?,?,?)');
    for (const image of images) insertImage.run(image.path, image.mime, image.content, timestamp);
    const insertProject = db.prepare('INSERT OR IGNORE INTO projects VALUES (?,?,?)');
    for (const project of projects) insertProject.run(project.id, JSON.stringify(project.value), timestamp);
    db.prepare('INSERT INTO migrations VALUES (?)').run(migration);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); db.close(); throw error; }
}

// Update only the exact previous generated copy; handwritten resumes and visibility stay intact.
function refreshResumeCopy(db) {
  const migration = 'resume-readable-copy-v1';
  db.exec('BEGIN IMMEDIATE');
  try {
    if (!db.prepare('SELECT 1 FROM migrations WHERE id=?').get(migration)) {
      const previous = JSON.parse(db.prepare('SELECT json FROM documents WHERE id=?').get('resume').json);
      const content = value => JSON.stringify(resumeInput({ ...value, published: false }));
      if (content(previous) === content(previousCareerResume)) {
        db.prepare('UPDATE documents SET json=? WHERE id=?').run(JSON.stringify(resumeInput({ ...careerResume, published: previous.published })), 'resume');
      }
      db.prepare('INSERT INTO migrations VALUES (?)').run(migration);
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); db.close(); throw error; }
}

// Owner requested public resume and portfolio. Apply once, preserving all copy,
// images and IDs; later deliberate private settings must survive every restart.
function publishExistingContent(db) {
  const migration = 'public-career-content-v1';
  db.exec('BEGIN IMMEDIATE');
  try {
    if (!db.prepare('SELECT 1 FROM migrations WHERE id=?').get(migration)) {
      const resume = JSON.parse(db.prepare('SELECT json FROM documents WHERE id=?').get('resume').json);
      db.prepare('UPDATE documents SET json=? WHERE id=?').run(JSON.stringify({ ...resume, published: true }), 'resume');
      const update = db.prepare('UPDATE projects SET json=? WHERE id=?');
      for (const row of db.prepare('SELECT id,json FROM projects').all()) {
        const project = JSON.parse(row.json);
        if (!project.published) update.run(JSON.stringify({ ...project, published: true }), row.id);
      }
      db.prepare('INSERT INTO migrations VALUES (?)').run(migration);
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); db.close(); throw error; }
}

export function createPortfolioStore(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(join(directory, 'portfolio.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS profile (id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, json TEXT NOT NULL, updatedAt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS images (path TEXT PRIMARY KEY, mime TEXT NOT NULL, content BLOB NOT NULL, createdAt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS migrations (id TEXT PRIMARY KEY);`);
  db.prepare('INSERT OR IGNORE INTO profile VALUES (1, ?)').run(JSON.stringify(defaultProfile));
  if (!db.prepare('SELECT 1 FROM migrations WHERE id=?').get('editorial-home-v1')) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const previous = JSON.parse(db.prepare('SELECT json FROM profile WHERE id=1').get().json);
      const migrated = { ...previous };
      for (const [key, value] of Object.entries(starterProfile)) if (previous[key] === undefined || previous[key] === defaultProfile[key]) migrated[key] = value;
      db.prepare('UPDATE profile SET json=? WHERE id=1').run(JSON.stringify(migrated));
      if (!db.prepare('SELECT COUNT(*) count FROM projects').get().count) {
        const insert = db.prepare('INSERT INTO projects VALUES (?,?,?)');
        for (const { id, ...project } of starterProjects) insert.run(id, JSON.stringify(projectInput(project, () => false)), new Date().toISOString());
      }
      db.prepare('INSERT INTO migrations VALUES (?)').run('editorial-home-v1'); db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  db.prepare('INSERT OR IGNORE INTO documents VALUES (?,?)').run('resume', JSON.stringify(starterResume));
  importCareerContent(db);
  refreshResumeCopy(db);
  publishExistingContent(db);
  const profile = () => JSON.parse(db.prepare('SELECT json FROM profile WHERE id=1').get().json);
  const projects = () => db.prepare('SELECT * FROM projects').all().map(row => ({ ...JSON.parse(row.json), id: row.id, updatedAt: row.updatedAt }))
    .sort((a, b) => Number(b.featured) - Number(a.featured) || a.order - b.order || b.updatedAt.localeCompare(a.updatedAt));
  return {
    db, profile, projects,
    resume: () => JSON.parse(db.prepare('SELECT json FROM documents WHERE id=?').get('resume').json),
    saveResume: input => { const value = resumeInput(input); db.prepare('UPDATE documents SET json=? WHERE id=?').run(JSON.stringify(value), 'resume'); return value; },
    saveProfile: input => { const value = profileInput(input); db.prepare('UPDATE profile SET json=? WHERE id=1').run(JSON.stringify(value)); return value; },
    project: id => projects().find(project => project.id === id),
    saveProject(input, id = randomUUID()) {
      const value = projectInput(input, path => Boolean(db.prepare('SELECT 1 FROM images WHERE path=?').get(path)));
      db.prepare('INSERT INTO projects VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET json=excluded.json, updatedAt=excluded.updatedAt').run(id, JSON.stringify(value), new Date().toISOString());
      return { ...value, id };
    },
    remove: id => db.prepare('DELETE FROM projects WHERE id=?').run(id),
    image: path => db.prepare('SELECT * FROM images WHERE path=?').get(path),
    publicImage: path => projects().some(p => p.published && (p.cover === path || p.gallery.includes(path))),
    addImage(buffer) {
      const { mime, extension } = imageType(buffer), path = `/media/${randomUUID()}.${extension}`;
      db.prepare('INSERT INTO images VALUES (?, ?, ?, ?)').run(path, mime, buffer, new Date().toISOString());
      return { path };
    }
  };
}
