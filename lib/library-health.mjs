import { readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';

/** Bounded local maintenance: reports only, no LLM calls, remote writes, or edits to knowledge. */
export function startLibraryHealth(library,directory) {
  if(!library)return {latest:()=>null,close(){}};
  mkdirSync(directory,{recursive:true,mode:0o700});const file=join(directory,'library-health.json');
  let latest=null,running=false,closed=false;
  try{latest=JSON.parse(readFileSync(file,'utf8'));}catch{}
  async function run() {
    if(running||closed)return;running=true;
    try {
      const projects=[];
      for(const p of library.projects()) {
        if(closed)return;
        try {const r=library.audit(p.id);projects.push({project:p.id,documents:r.documents,findings:r.total});}
        catch{projects.push({project:p.id,error:'점검하지 못했습니다.'});}
        await setImmediate();
      }
      latest={checkedAt:new Date().toISOString(),projects};
      writeFileSync(file+'.tmp',JSON.stringify(latest),{mode:0o600});renameSync(file+'.tmp',file);
    }catch{ /* A failed maintenance scan must not interrupt chat. */ }finally{running=false;}
  }
  const first=setTimeout(run,10000);first.unref();const timer=setInterval(run,6*3600000);timer.unref();
  return {latest:()=>latest,close(){closed=true;clearTimeout(first);clearInterval(timer);}};
}
