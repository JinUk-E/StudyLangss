import { readdirSync, lstatSync, readFileSync, realpathSync, existsSync, mkdirSync, writeFileSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { resolve, relative, dirname, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { assert } from './validation.mjs';

const exec = promisify(execFile);
const hash = text => createHash('sha256').update(text).digest('hex');
const day = () => new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const safeName = value => typeof value === 'string' && value.length <= 120 && value !== '.' && value !== '..' && !/[\\/\x00-\x1f]/.test(value) && !value.startsWith('.');
const publicPath = value => ['_project.md','_shared.md','_timeline.md'].includes(value) || /^(notes|docs)\/.+\.md$/.test(value);

/** Dedicated working copy only. No arbitrary path, shell command, personal log, or credential tools. */
export function createTeamLibrary(directory) {
  if (!directory || !existsSync(directory)) return null;
  const root = realpathSync(directory);
  assert(lstatSync(resolve(root,'.git')).isDirectory()&&!lstatSync(resolve(root,'.git')).isSymbolicLink(),'자료실 전용 clone이 필요합니다.',503);
  const gitArgs = ['-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false','-c','commit.gpgsign=false','-C',root];
  const git = args => execFileSync('/usr/bin/git',[...gitArgs,...args],{encoding:'utf8',timeout:10000,maxBuffer:1024*1024,stdio:['ignore','pipe','pipe']}).trimEnd();
  assert(git(['rev-parse','--show-toplevel']) === root, '자료실 전용 Git 저장소가 필요합니다.',503);
  const checked = rel => {
    assert(typeof rel === 'string' && rel.length <= 500 && !rel.includes('\\') && !rel.split('/').some(p=>!p || p==='.' || p==='..' || p.startsWith('.')), '자료 경로가 올바르지 않습니다.');
    const path = resolve(root,rel);
    assert(path.startsWith(root+sep), '자료실 밖의 파일에는 접근할 수 없습니다.',403);
    let cursor=root;
    for(const part of rel.split('/')) {
      cursor=resolve(cursor,part);
      let info; try {info=lstatSync(cursor);} catch(error) {if(error.code!=='ENOENT')throw error;}
      if(info) assert(!info.isSymbolicLink(), '연결 파일에는 접근할 수 없습니다.',403);
    }
    return path;
  };
  const projectPath = project => {
    assert(safeName(project),'프로젝트를 선택하세요.');
    const path=checked('knowledge/'+project);
    assert(existsSync(path)&&lstatSync(path).isDirectory(),'프로젝트를 찾을 수 없습니다.',404);
    return path;
  };
  const documents = project => {
    const base=projectPath(project), out=[];
    function scan(dir,depth=0) {
      assert(depth<=12,'자료실 폴더 깊이가 제한을 초과했습니다.',422);
      for(const entry of readdirSync(dir,{withFileTypes:true})) {
        if(entry.name.startsWith('.')||entry.isSymbolicLink())continue;
        const file=resolve(dir,entry.name), rel=relative(base,file).split(sep).join('/');
        if(entry.isDirectory() && (rel==='notes'||rel==='docs'||rel.startsWith('notes/')||rel.startsWith('docs/')))scan(file,depth+1);
        if(entry.isFile()&&publicPath(rel))out.push(rel);
        assert(out.length<=5000,'자료가 너무 많습니다. 자료실 범위를 나눠 주세요.',422);
      }
    }
    scan(base);return out.sort();
  };
  const read = (project,path) => {
    projectPath(project);assert(publicPath(path),'공유 자료와 타임라인만 열람할 수 있습니다.',403);
    const file=checked('knowledge/'+project+'/'+path);
    assert(existsSync(file)&&lstatSync(file).isFile(),'문서를 찾을 수 없습니다.',404);
    assert(lstatSync(file).size<=512*1024,'문서가 너무 큽니다.',413);
    const text=readFileSync(file,'utf8');
    return {path,revision:hash(text),text};
  };
  let busy=false;
  function locked(fn) {
    assert(!busy,'자료실을 동기화하고 있습니다. 잠시 후 다시 시도하세요.',409);
    const lock=resolve(root,'.git/stella.lock');let fd;
    try {fd=openSync(lock,'wx',0o600);}catch{
      let stale=false;try{const pid=Number(readFileSync(lock,'utf8'));if(Number.isSafeInteger(pid)&&pid>0){try{process.kill(pid,0);}catch(e){stale=e.code==='ESRCH';}}}catch{}
      if(stale){unlinkSync(lock);fd=openSync(lock,'wx',0o600);}else assert(false,'다른 자료실 작업이 진행 중입니다.',409);
    }
    writeFileSync(fd,String(process.pid));
    busy=true;
    const release=()=>{closeSync(fd);unlinkSync(lock);busy=false;};
    try {const result=fn();if(result?.then)return result.finally(release);release();return result;}catch(e){release();throw e;}
  }
  const status = () => ({head:git(['rev-parse','--short','HEAD']),dirty:!!git(['status','--porcelain']),...(() => {
    try {const [behind,ahead]=git(['rev-list','--left-right','--count','@{upstream}...HEAD']).split(/\s+/).map(Number);return {ahead,behind};}catch{return {ahead:null,behind:null};}
  })()});
  return {
    projects() {return readdirSync(checked('knowledge'),{withFileTypes:true}).filter(e=>e.isDirectory()&&!e.isSymbolicLink()&&safeName(e.name)).map(e=>({id:e.name,name:e.name})).sort((a,b)=>a.name.localeCompare(b.name));},
    status,
    snapshot(project) {
      const source=[];
      for(const path of documents(project).filter(p=>!/^notes\/stella-/.test(p))) {
        try {const d=read(project,path);const text=path==='_timeline.md'?d.text.split('\n').filter(l=>!l.includes('<!-- stella:')).join('\n').trim():d.text;
          source.push({path,text,revision:hash(text),mtime:lstatSync(checked('knowledge/'+project+'/'+path)).mtimeMs});
        }catch(e){if(e.status!==413)throw e;}
      }
      const revision=hash(JSON.stringify(source.map(d=>[d.path,d.revision])));
      const selected=[...source.filter(d=>['_timeline.md','_shared.md'].includes(d.path)),...source.filter(d=>!['_timeline.md','_shared.md'].includes(d.path)).sort((a,b)=>b.mtime-a.mtime).slice(0,2)];
      return {project,revision,documents:source.length,sources:selected.map(d=>({path:d.path,text:d.path==='_timeline.md'?d.text.slice(-4500):d.text.slice(0,2000)}))};
    },
    read(project,path,{offset=0,limit=7000,tail=false}={}) {
      assert(Number.isInteger(offset)&&offset>=0&&Number.isInteger(limit)&&limit>=1&&limit<=12000,'문서 범위를 확인하세요.');
      const doc=read(project,path);if(tail)offset=Math.max(0,doc.text.length-limit);
      return {...doc,text:doc.text.slice(offset,offset+limit),offset,total:doc.text.length,truncated:offset>0||offset+limit<doc.text.length};
    },
    search(project,query='') {
      assert(typeof query==='string'&&query.length<=160,'검색어는 160자 이내로 입력하세요.');
      const tokens=query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean), matches=[];
      for(const path of documents(project)) {
        let doc;try{doc=read(project,path);}catch(e){if(e.status===413)continue;throw e;}
        const body=doc.text.toLocaleLowerCase(), label=path.toLocaleLowerCase();
        if(tokens.every(t=>body.includes(t)||label.includes(t))) {
          const index=Math.max(0,body.indexOf(tokens[0]||''));
          matches.push({path,revision:doc.revision,excerpt:doc.text.slice(Math.max(0,index-80),index+450)});
        }
      }
      return {project,items:matches.slice(0,12),total:matches.length,truncated:matches.length>12};
    },
    audit(project) {
      const paths=documents(project), findings=[];
      const names=new Set(paths.flatMap(p=>[p,p.replace(/\.md$/,''),p.split('/').at(-1).replace(/\.md$/,'')]));
      for(const path of paths) {
        let doc;try{doc=read(project,path);}catch(e){findings.push({path,kind:'large',detail:'크기 제한으로 점검하지 못한 문서'});continue;}
        if(/^(<{7}|={7}|>{7})/m.test(doc.text))findings.push({path,kind:'conflict',detail:'병합 충돌 표식 확인 필요'});
        if(doc.text.includes('⏳ 아직 안 채운 틀'))findings.push({path,kind:'template',detail:'아직 채우지 않은 문서 틀'});
        const missing=new Set();
        for(const match of doc.text.matchAll(/\[\[([^\]\n]+)\]\]/g)) {
          const target=match[1].split(/[|#]/)[0].trim();
          if(target && !names.has(target)&&!names.has(target.replace(/\.md$/,'')))missing.add(target);
        }
        for(const target of [...missing].slice(0,10))findings.push({path,kind:'link',detail:'연결 대상 확인 필요: '+target.slice(0,160)});
      }
      return {project,checkedAt:new Date().toISOString(),documents:paths.length,findings:findings.slice(0,60),total:findings.length,truncated:findings.length>60,note:'공유 문서의 링크·충돌 표식·빈 틀을 점검했습니다. 의미상 모순이나 완료 여부를 판정하지 않으며 원문은 수정하지 않습니다.'};
    },
    /** Exact reviewed draft -> immutable note + append-only timeline. Retry safe even after commit interruption. */
    apply(draft) {return locked(()=>{
      const {id,project,title,body}=draft;projectPath(project);
      assert(/^[a-f0-9-]{36}$/.test(id),'초안 ID를 확인하세요.');
      assert(typeof title==='string'&&title.trim().length>0&&title.length<=160&&!/[\r\n\x00-\x1f]/.test(title),'제목을 확인하세요.');
      assert(typeof body==='string'&&body.trim().length>0&&body.length<=12000,'기록 내용을 확인하세요.');
      const note='knowledge/'+project+'/notes/stella-'+id+'.md', timeline='knowledge/'+project+'/_timeline.md';
      const notePath=checked(note),timelinePath=checked(timeline), marker='<!-- stella:'+id+' -->';
      const content='# '+title+'\n\n'+body.trim()+'\n\n'+marker+'\n';
      const prior=git(['status','--porcelain','--untracked-files=all']);
      // Never stage or commit unrelated work, even if this copy was edited manually.
      if(prior) {
        const dirty=git(['-c','core.quotePath=false','status','--porcelain','--untracked-files=all']).split('\n').map(x=>x.slice(3).replace(/^"|"$/g,''));
        assert(dirty.every(p=>p===note||p===timeline),'자료실에 다른 미커밋 변경이 있습니다. 원본을 보존하고 기록을 중단했습니다.',409);
      }
      if(existsSync(notePath))assert(readFileSync(notePath,'utf8')===content,'같은 기록 ID에 다른 내용이 있습니다.',409);
      else {mkdirSync(dirname(notePath),{recursive:true,mode:0o700});writeFileSync(notePath,content,{flag:'wx',mode:0o600});}
      const old=existsSync(timelinePath)?readFileSync(timelinePath,'utf8'): '# '+project+' — 작업 연대기\n';
      if(!old.includes(marker)) {
        const label=title.replace(/[\[\]<>]/g,'');
        const line='\n- ['+day()+'] main-stella: 사용자 확인 기록 — '+label+' → [[stella-'+id+']] '+marker+'\n';
        if(!existsSync(timelinePath))writeFileSync(timelinePath,old,{flag:'wx',mode:0o600});
        writeFileSync(timelinePath,line,{flag:'a'});
      }
      git(['add','--',note,timeline]);
      if(git(['diff','--cached','--name-only']))git(['-c','user.name=Stella','-c','user.email=stella@localhost','commit','-m','knowledge('+project+'): main-stella - reviewed note','--',note,timeline]);
      return {saved:true,project,path:'notes/stella-'+id+'.md',title,head:git(['rev-parse','--short','HEAD']),synced:false};
    });},
    async sync() {return locked(async()=>{
      assert(!status().dirty,'미커밋 변경이 있어 동기화를 중단했습니다.',409);
      const run=async args=>{try {await exec('/usr/bin/git',[...gitArgs,...args],{timeout:45000,maxBuffer:1024*1024,env:{...process.env,GIT_TERMINAL_PROMPT:'0'}});}catch{assert(false,'Git 동기화에 실패했습니다. 저장된 기록은 보존됩니다. 연결과 원격 변경을 확인하세요.',502);}};
      await run(['fetch','--prune','origin']);const s=status();
      assert(s.ahead!==null&&s.behind!==null,'원격 추적 브랜치를 설정해 주세요.',409);
      assert(!(s.ahead&&s.behind),'양쪽에 새 커밋이 있어 자동 동기화를 중단했습니다. 두 기록을 보존한 병합이 필요합니다.',409);
      if(s.behind)await run(['merge','--ff-only','@{upstream}']);
      if(s.ahead)await run(['push','origin','HEAD']);
      return {...status(),syncedAt:new Date().toISOString()};
    });}
  };
}
