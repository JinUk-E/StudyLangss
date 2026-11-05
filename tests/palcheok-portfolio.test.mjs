import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createPortfolioStore} from '../lib/portfolio-store.mjs';
import {palcheokProject,pedalBuildProject} from '../content/portfolio-20261105.mjs';
import {webGameForProject} from '../content/web-games.mjs';
import {DatabaseSync} from 'node:sqlite';

test('Palcheok is public with the original image and playable link; subsequent edits and deletion are preserved',t=>{
  const dir=mkdtempSync(join(tmpdir(),'palcheok-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  let store=createPortfolioStore(dir);const project=store.project(palcheokProject.id);
  assert.equal(project.title,'팔척');assert.equal(project.published,true);assert.equal(store.publicImage(project.cover),true);
  assert.equal(webGameForProject(project.id).url,project.link);assert.equal(project.repository,'https://github.com/JinUk-E/WebGame');
  assert.match(store.project(pedalBuildProject.id).description,/페달의민족/);assert.match(store.project(pedalBuildProject.id).description,/Jenkins/);
  store.saveProject({...project,summary:'직접 수정한 소개',published:false},project.id);store.db.close();store=createPortfolioStore(dir);
  assert.equal(store.project(project.id).summary,'직접 수정한 소개');assert.equal(store.project(project.id).published,false);
  store.remove(project.id);store.db.close();store=createPortfolioStore(dir);assert.equal(store.project(project.id),undefined);store.db.close();
});

test('new project and image insertion rolls back together if the migration marker fails',t=>{
  const dir=mkdtempSync(join(tmpdir(),'palcheok-rollback-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  let store=createPortfolioStore(dir);store.remove(palcheokProject.id);store.remove(pedalBuildProject.id);
  store.db.prepare('DELETE FROM images WHERE path=?').run(palcheokProject.cover);store.db.prepare('DELETE FROM migrations WHERE id=?').run('portfolio-20261105-v1');
  store.db.exec("CREATE TRIGGER fail_palcheok BEFORE INSERT ON migrations WHEN NEW.id='portfolio-20261105-v1' BEGIN SELECT RAISE(ABORT,'injected failure'); END");
  store.db.close();assert.throws(()=>createPortfolioStore(dir),/injected failure/);
  const db=new DatabaseSync(join(dir,'portfolio.sqlite'));
  for(const id of [palcheokProject.id,pedalBuildProject.id])assert.equal(db.prepare('SELECT 1 FROM projects WHERE id=?').get(id),undefined);
  assert.equal(db.prepare('SELECT 1 FROM images WHERE path=?').get(palcheokProject.cover),undefined);
  db.exec('DROP TRIGGER fail_palcheok');db.close();store=createPortfolioStore(dir);
  assert.ok(store.project(palcheokProject.id));assert.ok(store.project(pedalBuildProject.id));store.db.close();
});
