const $=s=>document.querySelector(s);
const el=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
export function mountLibrary(api,{newChat,setPrompt,notice,openThread}) {
  const select=$('#library-project'),dialog=$('#library-dialog'),result=$('#library-results'),note=$('#library-note');
  let project=null,available=false,request=0,lastNotice=null;
  const report=message=>{note.textContent=message;};
  const query=extras=>new URLSearchParams({project,...extras});
  async function refresh() {
    const data=await api('/library');available=data.connected;select.replaceChildren(new Option('개인 비서',''));
    for(const p of data.projects)select.add(new Option(p.name,p.id));select.value=project||'';
    $('#library-controls').hidden=false;
    $('#library-state').textContent=available?`자료실 연결됨 · 공유 전송 대기 ${data.status.ahead??'?'}건`:'자료실 연결 설정이 필요합니다.';
    if(data.maintenance?.enabled)$('#library-state').textContent+=` · 매일 오전 8시 정제${data.maintenance.running?' 중':''}`;
    if(data.health)$('#library-state').textContent+=` · 최근 점검 ${new Date(data.health.checkedAt).toLocaleString('ko-KR')}`;
  }
  async function drafts() {
    if(!project)return;const id=++request,{drafts:items}=await api('/library/drafts?'+query());if(id!==request)return;
    result.replaceChildren();
    if(!items.length)result.append(el('p','대화에서 “이 내용을 자료실에 기록해 줘”라고 요청하면 초안을 볼 수 있어요.'));
    for(const draft of items) {
      const card=el('article');card.className='library-document';card.append(el('h3',draft.title),el('small',draft.project));
      const body=el('pre',draft.body);card.append(body);
      if(draft.state==='draft') {
        const save=el('button','내용 확인 · 메모와 타임라인에 저장'),discard=el('button','초안 폐기');
        save.onclick=async()=>{save.disabled=true;try{await api(`/library/drafts/${draft.id}/apply`,{method:'POST',body:'{}'});report('메모와 타임라인을 로컬 저장소에 기록했어요. Git 동기화를 누르면 공유됩니다.');await drafts();await refresh();}catch(e){report(e.message);}finally{save.disabled=false;}};
        discard.onclick=async()=>{discard.disabled=true;try{await api(`/library/drafts/${draft.id}/discard`,{method:'POST',body:'{}'});await drafts();}catch(e){report(e.message);}finally{discard.disabled=false;}};
        card.append(save,discard);
      } else card.append(el('p',draft.state==='applied'?'로컬 저장 완료 · Git 동기화로 공유':'폐기한 초안'));
      result.append(card);
    }
  }
  async function open() {
    dialog.showModal();report('');$('#library-heading').textContent=project?project+' 자료실':'AI-Team 자료실';
    const content=project?drafts():Promise.resolve(result.replaceChildren(el('p','채팅 상단에서 프로젝트를 선택하면 자료 검색과 기록을 시작할 수 있어요.')));
    await Promise.all([refresh(),content]);
  }
  async function notices(open=false) {const {notices}=await api('/notices');const latest=notices[0];let seen='';try{seen=localStorage.getItem('starlight.library.noticeSeen')||'';}catch{}$('#stella-notices').textContent=latest&&latest.updatedAt!==seen?'스텔라 공지 · 새 소식':'스텔라 공지';if(open){if(latest){await openThread(latest.id);try{localStorage.setItem('starlight.library.noticeSeen',latest.updatedAt);}catch{}$('#stella-notices').textContent='스텔라 공지';}else notice('아직 공지가 없어요. 정제 결과는 이곳에 남길게요.');}else if(lastNotice!==null&&latest?.updatedAt!==lastNotice)notice('스텔라의 새 자료실 정제 공지가 도착했어요.');lastNotice=latest?.updatedAt||'';}
  $('#stella-notices').onclick=()=>notices(true).catch(e=>notice(e.message));
  select.onchange=()=>{project=select.value||null;newChat();notice(project?`${project} 전용 대화예요. 자료는 이 프로젝트 안에서만 찾아요.`:'개인 비서 대화예요.');};
  $('#open-library').onclick=()=>open().catch(e=>notice(e.message));$('#close-library').onclick=()=>dialog.close();
  $('#library-drafts').onclick=()=>drafts().catch(e=>report(e.message));
  $('#library-brief').onclick=()=>{if(!project){notice('먼저 자료실 프로젝트를 선택해 주세요.');return;}setPrompt('선택한 프로젝트의 최근 타임라인과 공유 자료를 읽고, 진행 상황·미해결 사항·다음 할 일을 근거 경로와 함께 브리핑해 줘.');};
  $('#library-search-form').onsubmit=async e=>{
    e.preventDefault();if(!project){report('먼저 프로젝트를 선택해 주세요.');return;}const id=++request;
    try {const found=await api('/library/search?'+query({q:$('#library-query').value}));if(id!==request)return;
      result.replaceChildren();report(`${found.total}개 문서${found.truncated?' · 최대 12개 표시':''}`);
      for(const doc of found.items){const row=el('article');row.className='library-document';const b=el('button',doc.path);b.onclick=async()=>{try{const detail=await api('/library/read?'+query({path:doc.path,tail:doc.path==='_timeline.md'}));row.replaceChildren(el('h3',doc.path),el('pre',detail.text));if(detail.truncated)row.append(el('p','일부 내용입니다. 대화에서 이어지는 부분을 요청할 수 있어요.'));}catch(e){report(e.message);}};row.append(b,el('p',doc.excerpt));result.append(row);}
    }catch(e){report(e.message);}
  };
  $('#library-audit').onclick=async()=>{if(!project){report('먼저 프로젝트를 선택해 주세요.');return;}try {const data=await api('/library/audit?'+query());result.replaceChildren(el('p',data.note));report(`${data.documents}개 문서 · 확인할 항목 ${data.total}개${data.truncated?' · 일부 표시':''}`);for(const f of data.findings)result.append(el('p',`${f.path} · ${f.detail}`));}catch(e){report(e.message);}};
  $('#library-sync').onclick=async()=>{const b=$('#library-sync');b.disabled=true;report('Git 저장소를 동기화하고 있어요…');try{await api('/library/sync',{method:'POST',body:'{}'});report('최신 자료를 받고 저장한 기록을 공유했어요.');await refresh();}catch(e){report(e.message);}finally{b.disabled=false;}};
  window.addEventListener('stella-library',()=>open().catch(e=>notice(e.message)));
  return {init:async user=>{if(user.id==='owner'){await refresh();await notices();setInterval(()=>{if(!document.hidden)notices().catch(()=>{});},60000);}},project:()=>project,setProject(value){project=value||null;select.value=project||'';},refresh};
}
