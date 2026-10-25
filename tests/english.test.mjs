import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createStore} from '../lib/store.mjs';
import {createUserStores} from '../lib/user-stores.mjs';
import {englishQuestions,englishPractice} from '../content/english.mjs';
import {resolveSpeechSource} from '../lib/tts-source.mjs';

test('English catalogue, native speech sources and progress survive reopening and remain account-scoped',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'starlight-english-')); t.after(()=>rm(directory,{recursive:true,force:true}));
  const factory=path=>createStore(path,englishQuestions,{language:'en',practiceSeeds:englishPractice});
  let stores=createUserStores(directory,factory,'jlpt.sqlite');
  const user={id:'00000000-0000-4000-8000-000000000001'},other={id:'00000000-0000-4000-8000-000000000002'};
  try {
    const store=stores.get(user),item=store.practice.list('A1','words','all').items[0];
    assert.equal(resolveSpeechSource(store,{entryId:item.id,part:'word'}).language,'en');
    assert.equal(resolveSpeechSource(store,{entryId:item.id,part:'meaning'}).language,'ko');
    assert.equal(resolveSpeechSource(store,{questionId:'en-a1-l01',part:'passage'}).language,'en');
    store.attempt({questionId:'en-a1-g01',answerIndex:3,durationMs:1000});store.setSettings({level:'B1'});
    assert.equal(stores.get(other).attempts().length,0);assert.equal(stores.owner.attempts().length,0);
    stores.close();stores=createUserStores(directory,factory,'jlpt.sqlite');
    assert.equal(stores.get(user).attempts().length,1);assert.equal(stores.get(user).getSettings().level,'B1');
  } finally {stores.close()}
});
