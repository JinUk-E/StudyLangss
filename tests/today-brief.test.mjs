import test from 'node:test';
import assert from 'node:assert/strict';
import {timelineInputs,validateCandidates,generateCandidates} from '../lib/today-brief.mjs';

const library={projects:()=>[{id:'Game'},{id:'Broken'}],snapshot:id=>{if(id==='Broken')throw Error('unreadable');return {sources:[{path:'_timeline.md',text:'2026-11-04 다음 할 일: 배포 절차를 확인한다.'}]};}};
test('candidates require a real verbatim timeline quote and stay scoped to known projects',()=>{
  const input=timelineInputs(library);assert.equal(input.failed[0],'Broken');
  const raw=JSON.stringify({candidates:[{project:'Game',title:'배포 절차 확인',evidence:'다음 할 일: 배포 절차를 확인한다.'},{project:'Game',title:'추측',evidence:'존재하지 않는 근거 문장입니다.'},{project:'Other',title:'다른 프로젝트',evidence:'다음 할 일: 배포 절차를 확인한다.'}]});
  assert.deepEqual(validateCandidates(raw,input.sources),[{project:'Game',title:'배포 절차 확인',path:'_timeline.md',evidence:'다음 할 일: 배포 절차를 확인한다.'}]);
  assert.throws(()=>validateCandidates('not json',input.sources));
});
test('local model receives timeline only; invalid or invented candidates are not registered',async()=>{
  let input;
  const upstream={async capabilities(){return [];},async *generate(model,messages){input=messages;yield {message:{content:JSON.stringify({candidates:[{project:'Game',title:'배포 확인',evidence:'다음 할 일: 배포 절차를 확인한다.'}]})}};}};
  const result=await generateCandidates({library,upstream,model:'local',signal:AbortSignal.timeout(1000)});
  assert.equal(result.candidates.length,1);assert.equal(result.checked,1);assert.deepEqual(result.failed,['Broken']);assert(!JSON.stringify(input).includes('개인 일정'));
});
