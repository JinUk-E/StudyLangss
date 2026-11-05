import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {createTeamLibrary} from '../lib/team-library.mjs';
import {createChatStore} from '../lib/chat-store.mjs';
import {scopedLibrary} from '../lib/library-agent.mjs';
import {runChatAgent} from '../lib/chat-agent.mjs';
import {startLibraryMaintenance,firstMaintenanceDay} from '../lib/library-maintenance.mjs';
import {createUpstream} from '../lib/chat-upstream.mjs';

function fixture(t) {
  const dir=mkdtempSync(join(tmpdir(),'stella-library-')),repo=join(dir,'repo'),remote=join(dir,'remote.git');
  const git=(...args)=>execFileSync('/usr/bin/git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git('init','--bare',remote);git('clone',remote,repo);git('-C',repo,'config','user.name','Fixture');git('-C',repo,'config','user.email','fixture@localhost');
  mkdirSync(join(repo,'knowledge','Game','notes'),{recursive:true});mkdirSync(join(repo,'knowledge','Other','notes'),{recursive:true});
  writeFileSync(join(repo,'knowledge/Game/_timeline.md'),'# Timeline\n- [2026-11-03] main: 테스트 예정\n');
  writeFileSync(join(repo,'knowledge/Game/notes/review.md'),'# 검토\n기획 확정은 아직. [[missing]]\n');
  writeFileSync(join(repo,'knowledge/Game/private-agent.md'),'PRIVATE LOG');
  writeFileSync(join(repo,'knowledge/Other/_shared.md'),'OTHER PROJECT');
  git('-C',repo,'add','.');git('-C',repo,'commit','-m','fixture');git('-C',repo,'push','-u','origin','HEAD');
  const library=createTeamLibrary(repo),store=createChatStore(join(dir,'chat'));
  t.after(()=>{store.db.close();rmSync(dir,{recursive:true,force:true});});return {dir,repo,remote,git,library,store};
}
test('library reads only selected shared Markdown; rejects traversal, symlinks and private logs',t=>{
  const {library,repo,dir}=fixture(t);
  assert.equal(library.search('Game','OTHER').total,0);assert.equal(library.search('Game','PRIVATE').total,0);
  assert.throws(()=>library.read('Game','private-agent.md'),e=>e.status===403);
  assert.throws(()=>library.read('Game','notes/../../Other/_shared.md'));
  assert.throws(()=>library.search('../Other',''));
  symlinkSync(join(repo,'knowledge/Other/_shared.md'),join(repo,'knowledge/Game/notes/leak.md'));
  assert.throws(()=>library.read('Game','notes/leak.md'),e=>e.status===403);
  symlinkSync(join(dir,'nonexistent'),join(repo,'knowledge/Game/notes/dangling.md'));
  assert.throws(()=>library.read('Game','notes/dangling.md'),e=>e.status===403);
  assert.equal(library.search('Game','OTHER').total,0);
  const audit=library.audit('Game');assert.equal(audit.findings[0].kind,'link');assert.equal(audit.documents,2);
});
test('reviewed note preserves timeline prefix, retries without duplicate and syncs only clean non-divergent commits',async t=>{
  const {library,repo,git,remote,dir}=fixture(t),timeline=join(repo,'knowledge/Game/_timeline.md'),before=readFileSync(timeline,'utf8');
  const revision=library.snapshot('Game').revision;
  const draft={id:randomUUID(),project:'Game',title:'검토 메모',body:'결론은 미확정.'};
  const r=library.apply(draft);assert(r.saved);assert.equal(library.status().ahead,1);assert.equal(library.snapshot('Game').revision,revision);
  assert(readFileSync(timeline,'utf8').startsWith(before));const after=readFileSync(timeline,'utf8');
  library.apply(draft);assert.equal(readFileSync(timeline,'utf8'),after);assert.equal(library.status().ahead,1);
  await library.sync();assert.equal(library.status().ahead,0);
  writeFileSync(join(repo,'knowledge/Game/notes/unrelated.md'),'must preserve');
  assert.throws(()=>library.apply({...draft,id:randomUUID()}),e=>e.status===409);await assert.rejects(library.sync(),e=>e.status===409);
  git('-C',repo,'add','.');git('-C',repo,'commit','-m','local unrelated');
  const other=join(dir,'other');git('clone',remote,other);git('-C',other,'config','user.name','Fixture');git('-C',other,'config','user.email','fixture@localhost');writeFileSync(join(other,'remote.md'),'remote');git('-C',other,'add','.');git('-C',other,'commit','-m','remote');git('-C',other,'push');
  await assert.rejects(library.sync(),e=>e.status===409);assert.equal(readFileSync(join(repo,'knowledge/Game/notes/unrelated.md'),'utf8'),'must preserve');
});
test('library agent can draft but cannot publish, run commands or cross project boundaries',async t=>{
  const {library,store}=fixture(t),thread=store.create('fixture','Game');assert.equal(store.thread(thread.id).project,'Game');
  let round=0;const emitted=[];
  const upstream={async *generate(model,messages,signal,{tools}) {
    assert(tools.some(t=>t.function.name==='propose_library_note'));assert(!tools.some(t=>/sync|shell|apply/.test(t.function.name)));
    if(round++===0)yield {message:{tool_calls:[{function:{name:'propose_library_note',arguments:{title:'기록',body:'다음에 검토'}}}]}};
    else yield {message:{content:'공유 저장 완료라는 잘못된 답변'}};
  }};
  const text=await runChatAgent({upstream,model:'fixture',messages:[{role:'system',content:'test'}],planner:store.planner,assistantId:randomUUID(),signal:AbortSignal.timeout(5000),emit:e=>emitted.push(e),checkAccess(){},capabilities:['tools'],library:scopedLibrary(library,'Game',store.drafts)});
  assert.match(text,/아직 공유 저장소에는/);assert(!text.includes('공유 저장 완료라는'));assert.equal(library.status().ahead,0);assert.equal(store.drafts.list('Other').length,0);assert.equal(store.drafts.list('Game').length,1);
});
test('daily 08:00 Korea maintenance creates linked notes and a private chat notice exactly once, skips unchanged input',async t=>{
  const {library,store,dir}=fixture(t);let time=new Date('2026-11-04T22:59:00Z'),generations=0;
  const upstream={async capabilities(){return ['completion'];},async *generate(model,messages){generations++;assert(!JSON.stringify(messages).includes('PRIVATE LOG'));yield {message:{content:'진행 상황은 원문에서 확인이 필요합니다.'}};}};
  const opts={library,store,upstream,directory:join(dir,'maintenance'),now:()=>time,auto:false};
  const worker=startLibraryMaintenance(opts);t.after(()=>worker.close());await worker.tick();assert.equal(generations,0);
  time=new Date('2026-11-04T23:00:00Z');await worker.tick();assert.equal(generations,2);assert.equal(store.notices().length,1);assert.equal(library.status().ahead,0);
  const announcement=store.messages(store.notices()[0].id)[0].content;assert.match(announcement,/정제 메모 2개/);assert.match(announcement,/동기화했어요/);
  assert.match(announcement,/진행 상황은 원문에서 확인이 필요합니다/);assert.match(announcement,/자동 등록되지 않았어요/);
  await worker.tick();assert.equal(generations,2);
  worker.close();const restarted=startLibraryMaintenance(opts);t.after(()=>restarted.close());await restarted.tick();assert.equal(store.notices().length,1);
  time=new Date('2026-11-05T23:01:00Z');await restarted.tick();assert.equal(generations,2);assert.equal(store.notices().length,1);assert.match(store.messages(store.notices()[0].id).at(-1).content,/변경 없음 2개/);
});
test('retry repairs failed projects without regenerating successful notes or duplicating the notice',async t=>{
  const {library,store,dir}=fixture(t);let fail=true,calls=0;
  const upstream={async capabilities(){return [];},async *generate(){calls++;if(fail&&calls===1)throw Error('offline');yield {message:{content:'후속 작업 후보: 원문을 확인하세요.'}};}};
  const worker=startLibraryMaintenance({library,store,upstream,directory:join(dir,'maintenance'),auto:false});t.after(()=>worker.close());
  const first=await worker.run('2026-11-05');assert.equal(first.failed.length,1);assert.equal(first.saved.length,1);assert.equal(calls,2);
  fail=false;const retried=await worker.run('2026-11-05',{retry:true});assert.equal(retried.failed.length,0);assert.equal(retried.saved.length,2);assert.equal(calls,3);assert.equal(store.notices().length,1);assert.match(store.messages(store.notices()[0].id)[0].content,/후속 작업 후보/);
  await worker.run('2026-11-05',{retry:true});assert.equal(calls,3);
});
test('daily model failures publish a failure notice without inventing completed refinement',async t=>{
  const {library,store,dir}=fixture(t);const worker=startLibraryMaintenance({library,store,upstream:{async capabilities(){return [];},async *generate(){throw Error('offline');}},directory:join(dir,'maintenance'),auto:false});t.after(()=>worker.close());
  await worker.run('2026-11-05');assert.equal(library.status().ahead,0);assert.equal(store.drafts.list('Game').length,0);assert.match(store.messages(store.notices()[0].id)[0].content,/실패 2개/);
});
test('schedule installation after 08:00 begins next morning; before 08:00 starts today',()=>{
  assert.equal(firstMaintenanceDay(new Date('2026-11-04T22:59:00Z')),'2026-11-05');assert.equal(firstMaintenanceDay(new Date('2026-11-04T23:00:00Z')),'2026-11-06');
});
test('provider boundary can accept another backend without changing tools or search',async()=>{
  const provider={models:async()=>[{name:'future-provider'}],capabilities:async()=>['tools'],async *generate(){yield {message:{content:'adapter'}};}};
  const upstream=createUpstream({provider,search:'http://127.0.0.1:1'});assert.equal((await upstream.models())[0].name,'future-provider');assert.deepEqual(await upstream.capabilities(),['tools']);assert.equal((await Array.fromAsync(upstream.generate()))[0].message.content,'adapter');
});

test('notice retry updates its own announcement and preserves user replies; registration is idempotent',t=>{
  const {library,store,dir}=fixture(t);
  const opts={library,store,upstream:{},directory:join(dir,'maintenance'),now:()=>new Date('2026-11-04T22:00:00Z')};
  const first=startLibraryMaintenance(opts);first.close();const second=startLibraryMaintenance(opts);second.close();assert.equal(store.notices().length,1);
  const thread=store.announce('fixture','공지','처음');const answer=store.begin(thread.id,'사용자 답변','fixture');store.finish(answer,'응답','complete',[]);store.announce('fixture','공지','갱신');
  const messages=store.messages(thread.id);assert.equal(messages.length,4);assert.equal(messages[1].content,'갱신');assert.equal(messages[2].content,'사용자 답변');
});
test('old notice threads merge with replies intact and each daily retry updates only its own message',t=>{
  const dir=mkdtempSync(join(tmpdir(),'stella-notices-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  let store=createChatStore(dir);const a=store.create('stella-notice'),b=store.create('stella-notice');
  const insert=store.db.prepare('INSERT INTO messages VALUES (?,?,?,?,?,?,?,?)');
  insert.run('old-a',a.id,'assistant','첫 공지','complete','[]','스텔라 자료실 관리','2026-11-01T00:00:00Z');
  insert.run('reply-a',a.id,'user','사용자 답변','complete','[]','model','2026-11-01T01:00:00Z');
  insert.run('old-b',b.id,'assistant','둘째 공지','complete','[]','스텔라 자료실 관리','2026-11-02T00:00:00Z');
  store.db.prepare('INSERT INTO assistant_notices(noticeKey,threadId) VALUES (?,?)').run('library:1',a.id);
  store.db.prepare('INSERT INTO assistant_notices(noticeKey,threadId) VALUES (?,?)').run('library:2',b.id);
  store.db.close();store=createChatStore(dir);t.after(()=>store.db.close());
  assert.equal(store.notices().length,1);const thread=store.notices()[0];assert.deepEqual(store.messages(thread.id).map(m=>m.content),['첫 공지','사용자 답변','둘째 공지']);
  store.announce('library:2','변경','둘째 수정');store.announce('library:3','새 공지','셋째 공지');
  assert.deepEqual(store.messages(thread.id).map(m=>m.content),['첫 공지','사용자 답변','둘째 수정','셋째 공지']);assert.equal(store.notices().length,1);
});
