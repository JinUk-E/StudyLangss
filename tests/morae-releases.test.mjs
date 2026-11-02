import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createPortfolioStore } from '../lib/portfolio-store.mjs';
import { blindMazeProject, moraeProfile, moraeResumeSummary, pedalId, pedalRelease } from '../content/morae-releases.mjs';
import previous from '../content/morae-releases-previous.json' with { type: 'json' };
const marker = 'morae-releases-20261102-v1';
function beforeRelease(store) {
  store.remove(blindMazeProject.id);
  store.saveProfile({ ...store.profile(), ...previous.profile, email: 'owner@example.com' });
  store.saveResume({ ...store.resume(), ...previous.resume, published: false });
  store.saveProject({ ...store.project(pedalId), ...previous.pedal, featured: false, order: 777 }, pedalId);
  store.db.prepare('DELETE FROM migrations WHERE id=?').run(marker);
}
test('Morae release migration adds BlindMaze, updates credits and preserves other data and later edits/deletions', t => {
  const dir = mkdtempSync(join(tmpdir(), 'morae-release-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  let store = createPortfolioStore(dir); beforeRelease(store);
  const other = store.projects().filter(p => p.id !== pedalId), profile = store.profile(), resume = store.resume(), pedal = store.project(pedalId);
  store.db.close(); store = createPortfolioStore(dir);
  assert.deepEqual(store.profile(), { ...profile, ...moraeProfile });
  assert.deepEqual(store.resume(), { ...resume, summary: moraeResumeSummary });
  assert.deepEqual(store.project(pedalId), { ...pedal, ...pedalRelease, updatedAt: store.project(pedalId).updatedAt });
  assert.deepEqual(store.projects().filter(p => ![pedalId, blindMazeProject.id].includes(p.id)), other);
  assert.equal(store.project(blindMazeProject.id).group, 'games');
  assert.equal(store.publicImage(blindMazeProject.cover), true);
  store.saveProject({ ...store.project(pedalId), summary: '직접 수정한 소개', published: false }, pedalId);
  store.remove(blindMazeProject.id); const snapshot = store.projects(); store.db.close();
  store = createPortfolioStore(dir); assert.deepEqual(store.projects(), snapshot); store.db.close();
});
test('Morae release migration preserves custom copy and rolls back all updates on failure', t => {
  const dir = mkdtempSync(join(tmpdir(), 'morae-release-rollback-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  let store = createPortfolioStore(dir); beforeRelease(store);
  store.saveProfile({ ...store.profile(), intro: '직접 쓴 소개' });
  store.saveProject({ ...store.project(pedalId), summary: '직접 쓴 요약' }, pedalId);
  const profile = store.profile(), resume = store.resume(), pedal = store.project(pedalId);
  store.db.exec(`CREATE TRIGGER fail_morae BEFORE INSERT ON projects WHEN NEW.id='${blindMazeProject.id}' BEGIN SELECT RAISE(ABORT, 'injected failure'); END`);
  store.db.close(); assert.throws(() => createPortfolioStore(dir), /injected failure/);
  const db = new DatabaseSync(join(dir, 'portfolio.sqlite'));
  assert.deepEqual(JSON.parse(db.prepare('SELECT json FROM profile WHERE id=1').get().json), profile);
  assert.deepEqual(JSON.parse(db.prepare("SELECT json FROM documents WHERE id='resume'").get().json), resume);
  assert.equal(JSON.parse(db.prepare('SELECT json FROM projects WHERE id=?').get(pedalId).json).description, pedal.description);
  assert.equal(db.prepare('SELECT 1 FROM migrations WHERE id=?').get(marker), undefined);
  db.exec('DROP TRIGGER fail_morae'); db.close();
  store = createPortfolioStore(dir); assert.equal(store.profile().intro, '직접 쓴 소개'); assert.equal(store.project(pedalId).summary, '직접 쓴 요약'); assert.equal(store.project(pedalId).category, pedalRelease.category); store.db.close();
});
