import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createChatStore } from '../lib/chat-store.mjs';
import { runChatAgent, cleanAgentAnswer } from '../lib/chat-agent.mjs';
const event={kind:'event',title:'엔진 회의',startAt:'2026-11-05T15:00:00+09:00',endAt:'2026-11-05T16:00:00+09:00'};
function fixture(t){const dir=mkdtempSync(join(tmpdir(),'stella-plans-'));const s=createChatStore(dir);t.after(()=>{try{s.db.close();}catch{}rmSync(dir,{recursive:true,force:true});});return {s,dir};}
test('plans persist across conversations, normalize Korea time, detect overlap and safely reject stale revisions',t=>{
 const {s,dir}=fixture(t),p=s.planner;
 const first=p.mutate('create',event,{operationId:'first'});assert.equal(first.item.startAt,'2026-11-05T06:00:00.000Z');
 assert.equal(p.list({from:'2026-11-05T16:00:00+09:00',to:'2026-11-05T17:00:00+09:00'}).total,0);
 assert.equal(p.list({from:'2026-11-05T15:00:00+09:00',to:'2026-11-05T16:00:00+09:00'}).total,1);
 assert(p.mutate('create',event,{operationId:'first'}).duplicate);assert.equal(p.list().total,1);
 assert.equal(p.mutate('create',{...event,title:'검토 회의'}).conflicts[0].id,first.item.id);
 assert.throws(()=>p.mutate('create',{...event,startAt:'2026-02-30T15:00:00+09:00'}));
 assert.throws(()=>p.mutate('create',{...event,startAt:'2026-11-05T15:00:00'}));
 assert.throws(()=>p.mutate('create',{...event,endAt:'2026-11-05T14:00:00+09:00'}));
 const updated=p.mutate('update',{id:first.item.id,revision:1,changes:{status:'cancelled'}});assert.equal(updated.item.revision,2);
 assert.throws(()=>p.mutate('update',{id:first.item.id,revision:1,changes:{title:'stale'}}),e=>e.status===409);
 assert.equal(p.list().total,1);assert.equal(p.list({status:'cancelled'}).total,1);
 const task=p.mutate('create',{kind:'task',title:'이미지 정리'}).item;assert.equal(task.dueAt,null);
 s.db.close();const reopened=createChatStore(dir);assert.equal(reopened.planner.list({kind:'task'}).items[0].id,task.id);reopened.db.close();
});
test('agent calls tools, records durable action receipts, prevents duplicate calls and respects cancellation/access checks',async t=>{
 const {s}=fixture(t),thread=s.create('fixture'),assistantId=s.begin(thread.id,'회의 등록해줘','fixture');let round=0;const emitted=[];
 const upstream={async *generate(model,messages,signal,options){assert.equal(options.tools.length,3);if(round++===0)yield {message:{content:'등록할게요.',tool_calls:[{function:{name:'create_plan',arguments:event}},{function:{name:'create_plan',arguments:event}}]}};else {assert.equal(messages.filter(m=>m.role==='tool').length,2);yield {message:{content:'오후 3시 회의를 등록했어요.'}};}}};
 const value=await runChatAgent({upstream,model:'fixture',messages:[{role:'system',content:'test'}],planner:s.planner,assistantId,signal:AbortSignal.timeout(5000),emit:e=>emitted.push(e),checkAccess:()=>{},capabilities:['tools']});
 assert.match(value,/등록/);assert.equal(s.planner.list().total,1);assert.equal(emitted.filter(e=>e.type==='action').length,1);assert.equal(s.planner.actions(assistantId).length,1);
 assert.equal(emitted.filter(e=>e.type==='delta').map(e=>e.text).join(''),value);assert.match(value,/오후 3:00/);assert.match(value,/오후 4:00/);
 const controller=new AbortController();controller.abort();await assert.rejects(runChatAgent({upstream,model:'fixture',messages:[{role:'system',content:''}],planner:s.planner,assistantId,signal:controller.signal,emit:()=>{},checkAccess:()=>{},capabilities:['tools']}));
 await assert.rejects(runChatAgent({upstream,model:'fixture',messages:[{role:'system',content:''}],planner:s.planner,assistantId,signal:AbortSignal.timeout(5000),emit:()=>{},checkAccess:()=>{throw Error('revoked');},capabilities:['tools']}),/revoked/);
 assert.equal(s.planner.list().total,1);
});
test('unsupported tools and invalid writes become explicit failures; tools-disabled models cannot execute writes',async t=>{
 const {s}=fixture(t);let round=0;
 const upstream={async *generate(){yield round++===0?{message:{tool_calls:[{function:{name:'exec_shell',arguments:{command:'ignored'}}},{function:{name:'create_plan',arguments:{...event,startAt:'tomorrow'}}}]}}:{message:{content:'등록하지 못했어요.'}};}};
 const emitted=[];await runChatAgent({upstream,model:'fixture',messages:[{role:'system',content:''}],planner:s.planner,assistantId:'test',signal:AbortSignal.timeout(5000),emit:e=>emitted.push(e),checkAccess:()=>{},capabilities:['tools']});assert.equal(s.planner.list().total,0);assert.equal(emitted.filter(e=>e.type==='action').length,0);
 round=0;await assert.rejects(runChatAgent({upstream,model:'fixture',messages:[{role:'system',content:''}],planner:s.planner,assistantId:'test2',signal:AbortSignal.timeout(5000),emit:()=>{},checkAccess:()=>{},capabilities:[]}),/도구/);assert.equal(s.planner.list().total,0);
});

test('agent answer removes model thinking delimiters without exposing internal text',()=>{assert.equal(cleanAgentAnswer('<think>private scratch</think>완료했어요.'),'완료했어요.');assert.equal(cleanAgentAnswer('private scratch</think>완료했어요.'),'완료했어요.');assert.throws(()=>cleanAgentAnswer('<think>unfinished'));});

test('unverified model success claims trigger one repair attempt and never reach the user as saved',async t=>{
 const {s}=fixture(t);let rounds=0;const events=[];
 const upstream={async *generate(){rounds++;yield {message:{content:'일정을 등록했어요.'}};}};
 const text=await runChatAgent({upstream,model:'fixture',messages:[{role:'system',content:''},{role:'user',content:'일정을 등록해줘'}],planner:s.planner,assistantId:'proof',signal:AbortSignal.timeout(5000),emit:e=>events.push(e),checkAccess(){},capabilities:['tools']});
 assert.equal(rounds,2);assert.equal(s.planner.list().total,0);assert.match(text,/아직 저장된/);assert(!events.some(e=>e.text==='일정을 등록했어요.'));
});
