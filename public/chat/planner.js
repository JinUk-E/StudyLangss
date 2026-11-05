const $ = selector => document.querySelector(selector);
const el = (tag, text, cls) => {const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const zone='Asia/Seoul';
export const planTime = item => {
  const format = value => new Intl.DateTimeFormat('ko-KR',{timeZone:zone,month:'short',day:'numeric',weekday:'short',hour:'numeric',minute:'2-digit'}).format(new Date(value));
  return item.kind==='event' ? `${format(item.startAt)}${item.endAt?' – '+format(item.endAt):''}` : item.dueAt ? `${format(item.dueAt)} 마감` : '마감일 없음';
};
export function actionCard(action) {
  const card=el('div',undefined,'planner-action'),p=action.item;
  if(action.type==='library-draft') {const d=action.draft;card.append(el('strong',`자료실 초안 · ${d.title}`),el('span',d.state==='applied'?'로컬 저장 완료':'아직 공유되지 않았어요. 내용을 확인한 뒤 저장할 수 있어요.'));const b=el('button','자료실에서 확인');b.type='button';b.onclick=()=>window.dispatchEvent(new CustomEvent('stella-library'));card.append(b);return card;}
  card.append(el('strong',`${action.action==='create'?'저장됨':p.status==='done'?'완료됨':p.status==='cancelled'?'취소됨':'변경됨'} · ${p.title}`),el('span',planTime(p)));
  if(action.conflicts?.length)card.append(el('span',`겹치는 일정: ${action.conflicts.map(p=>p.title).join(', ')}`,'planner-warning'));
  return card;
}
export function mountPlanner(api, setPrompt) {
  const dialog=$('#planner-dialog'),form=$('#plan-form'),note=$('#planner-note');let editing=null,items=[],loading=0,saveKey=null;
  const notify=t=>{note.textContent=t;};
  const datetime=value=>value?new Date(Date.parse(value)+9*3600000).toISOString().slice(0,16):'';
  const iso=value=>value?`${value}:00+09:00`:null;
  function kindFields() {const event=$('#plan-kind').value==='event';$('#plan-event-fields').hidden=!event;$('#plan-task-fields').hidden=event;$('#plan-start').required=event;}
  function reset() {editing=null;form.reset();$('#plan-kind').disabled=false;$('#plan-form-title').textContent='새 일정·할 일';$('#plan-submit').textContent='저장';$('#plan-edit-cancel').hidden=true;kindFields();saveKey=null;}
  function edit(item) {editing=item;$('#plan-form-title').textContent='일정·할 일 수정';$('#plan-kind').value=item.kind;$('#plan-kind').disabled=true;$('#plan-title').value=item.title;$('#plan-notes').value=item.notes;$('#plan-start').value=datetime(item.startAt);$('#plan-end').value=datetime(item.endAt);$('#plan-due').value=datetime(item.dueAt);$('#plan-submit').textContent='변경 저장';$('#plan-edit-cancel').hidden=false;kindFields();$('#plan-title').focus();saveKey=null;}
  async function change(item,status) {
    try {const result=await api(`/plans/${item.id}`,{method:'PATCH',body:JSON.stringify({revision:item.revision,changes:{status},requestId:crypto.randomUUID()})});notify(`${result.item.title} · ${status==='done'?'완료':status==='cancelled'?'취소':'다시 진행'} 처리했어요.`);if(editing?.id===item.id)reset();await refresh();await brief();}
    catch(error){notify(error.message);await refresh();}
  }
  async function refresh() {
    const token=++loading;
    try {
      const query=new URLSearchParams({status:$('#plan-filter').value,query:$('#plan-search').value.trim()});
      const result=await api('/plans?'+query);if(token!==loading)return;items=result.items;
      const list=$('#plan-list');list.replaceChildren();$('#plan-count').textContent=`${result.total}개`;
      if(result.truncated)list.append(el('p','최대 150개를 표시합니다. 검색어로 범위를 좁혀 주세요.','planner-warning'));
      if(!items.length)list.append(el('p','아직 항목이 없어요. 대화로 부탁하거나 여기에서 추가해 보세요.','planner-empty'));
      for(const item of items) {
        const row=el('article',undefined,'plan-row');row.append(el('small',item.kind==='event'?'일정':'할 일'),el('h3',item.title),el('p',planTime(item)));
        if(item.notes)row.append(el('p',item.notes,'plan-notes'));
        const overdue=item.status==='open'&&item.kind==='task'&&item.dueAt&&Date.parse(item.dueAt)<Date.now();
        if(overdue)row.append(el('strong','마감이 지났어요','planner-warning'));
        const actions=el('div',undefined,'plan-row-actions');
        for(const [text,fn] of [['수정',()=>edit(item)],...(item.status==='open'?[['완료',()=>change(item,'done')],['취소',()=>change(item,'cancelled')]]:[['다시 진행',()=>change(item,'open')]])]) {
          const b=el('button',text);b.type='button';b.onclick=async()=>{b.disabled=true;try{await fn();}finally{b.disabled=false;}};actions.append(b);
        }
        row.append(actions);list.append(row);
      }
    }catch(error){notify(error.message);}
  }
  async function brief() {
    try {
      const day=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
      const start=new Date(`${day}T00:00:00+09:00`),end=new Date(start.getTime()+86400000);
      const [events,tasks]=await Promise.all([api('/plans?'+new URLSearchParams({kind:'event',from:start.toISOString(),to:end.toISOString()})),api('/plans?kind=task')]);
      const overdue=tasks.items.filter(p=>p.dueAt&&Date.parse(p.dueAt)<Date.now()).length;
      $('#planner-brief').textContent=`오늘 일정 ${events.total} · 남은 할 일 ${tasks.total}${overdue?` · 기한 지난 ${overdue}${tasks.truncated?'+':''}`:''}`;
    }catch{$('#planner-brief').textContent='일정 확인이 필요해요';}
  }
  $('#open-planner').onclick=()=>{dialog.showModal();notify('');refresh();};$('#close-planner').onclick=()=>dialog.close();
  $('#new-plan').onclick=()=>{reset();$('#plan-form-title').scrollIntoView({block:'start'});$('#plan-title').focus();};
  $('#plan-filter').onchange=refresh;$('#plan-search-form').onsubmit=e=>{e.preventDefault();refresh();};$('#plan-kind').onchange=kindFields;
  $('#plan-edit-cancel').onclick=reset;$('#plan-form').oninput=()=>{saveKey=null;};
  const todayDialog=$('#today-dialog');
  $('#close-today').onclick=()=>todayDialog.close();
  $('#daily-brief').onclick=async()=>{
    todayDialog.showModal();const target=$('#today-plans');target.replaceChildren(el('p','일정과 할 일을 확인하고 있어요…'));
    try{
      const day=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
      const start=new Date(`${day}T00:00:00+09:00`),end=new Date(start.getTime()+86400000);
      const [events,tasks]=await Promise.all([api('/plans?'+new URLSearchParams({kind:'event',from:start.toISOString(),to:end.toISOString()})),api('/plans?kind=task')]);
      target.replaceChildren();const eventHeading=el('h3',`오늘 일정 · ${events.total}건`);target.append(eventHeading);
      if(!events.items.length)target.append(el('p','오늘 예정된 일정이 없어요.'));
      for(const item of events.items.slice(0,8)){const row=el('div',undefined,'today-row');row.append(el('strong',item.title),el('p',planTime(item)));target.append(row);}
      if(events.total>8)target.append(el('p','일부 일정만 표시했어요. 일정·할 일에서 전체를 확인해 주세요.'));
      const due=tasks.items.filter(p=>p.dueAt&&Date.parse(p.dueAt)<end.getTime());
      target.append(el('h3',`오늘까지 할 일 · ${due.length}${tasks.truncated?'+':''}건`));
      if(!due.length)target.append(el('p','오늘까지 마감인 할 일이 없어요.'));
      for(const item of due.slice(0,8)){const row=el('div',undefined,'today-row');row.append(el('strong',item.title),el('p',`${planTime(item)}${Date.parse(item.dueAt)<Date.now()?' · 기한 지남 · 우선 확인':' · 오늘 마감'}`));target.append(row);}
      if(due.length>8||tasks.truncated)target.append(el('p','일부 항목만 표시했어요. 일정·할 일에서 전체를 확인해 주세요.'));
      const upcoming=tasks.items.filter(p=>p.dueAt&&Date.parse(p.dueAt)>=end.getTime()&&Date.parse(p.dueAt)<end.getTime()+6*86400000);
      target.append(el('h3',`가까운 마감 · ${upcoming.length}${tasks.truncated?'+':''}건`));
      if(!upcoming.length)target.append(el('p',tasks.truncated?'조회 한도로 일부 마감을 확인하지 못했어요.':'앞으로 6일 동안 마감인 할 일이 없어요.'));
      for(const item of upcoming.slice(0,5)){const row=el('div',undefined,'today-row');row.append(el('strong',item.title),el('p',planTime(item)));target.append(row);}
      if(upcoming.length>5)target.append(el('p','일부 항목만 표시했어요. 일정·할 일에서 전체를 확인해 주세요.'));
    }catch(error){target.replaceChildren(el('p',`일정을 불러오지 못했어요: ${error.message}`));}
  };
  $('#find-candidates').onclick=async()=>{
    const button=$('#find-candidates'),status=$('#candidate-status'),list=$('#candidate-list');button.disabled=true;status.textContent='로컬 모델로 타임라인을 확인하고 있어요. 시간이 조금 걸릴 수 있어요…';list.replaceChildren();
    try {
      const result=await api('/today-brief/candidates',{method:'POST',body:'{}'});
      if(!result.connected){status.textContent='AI-Team 자료실이 연결되지 않았어요.';return;}
      status.textContent=`타임라인 ${result.checked||0}개 확인 · 후보 ${result.candidates.length}개${result.truncated?' · 최근 20개만 확인':''}${result.failed.length?` · 읽기 실패 ${result.failed.length}개`:''}`;
      if(!result.candidates.length)list.append(el('p','확인한 범위에서 조건에 맞는 후보를 만들지 못했어요. 원문을 살펴보거나 다시 시도해 주세요.'));
      for(const candidate of result.candidates){
        const row=el('article',undefined,'today-candidate');row.append(el('small',`${candidate.project} · ${candidate.path}`),el('h4',candidate.title),el('blockquote',candidate.evidence));
        const add=el('button','할 일로 검토'),source=el('button','원문 보기');add.type=source.type='button';
        add.onclick=()=>{todayDialog.close();reset();$('#plan-kind').value='task';kindFields();$('#plan-title').value=candidate.title;$('#plan-notes').value=`AI-Team ${candidate.project}/${candidate.path}\n근거: ${candidate.evidence}`;dialog.showModal();notify('내용을 확인하고 저장을 눌러 주세요. 마감은 직접 선택할 수 있어요.');$('#plan-title').focus();};
        source.onclick=async()=>{source.disabled=true;try{const doc=await api('/library/read?'+new URLSearchParams({project:candidate.project,path:candidate.path,tail:'true'}));let pre=row.querySelector('pre');if(!pre){pre=el('pre');row.append(pre);}pre.textContent=(doc.truncated?'일부 발췌\n':'')+doc.text;}catch(error){status.textContent=error.message;}finally{source.disabled=false;}};
        row.append(add,source);list.append(row);
      }
    }catch(error){status.textContent=`타임라인 후보를 만들지 못했어요: ${error.message}`;}finally{button.disabled=false;}
  };
  form.onsubmit=async event=>{
    event.preventDefault();const button=$('#plan-submit');button.disabled=true;notify('');
    try {
      saveKey ||= crypto.randomUUID();const kind=$('#plan-kind').value;
      const plan={title:$('#plan-title').value.trim(),notes:$('#plan-notes').value.trim(),startAt:kind==='event'?iso($('#plan-start').value):null,endAt:kind==='event'?iso($('#plan-end').value):null,dueAt:kind==='task'?iso($('#plan-due').value):null};
      const result=await api(editing?`/plans/${editing.id}`:'/plans',{method:editing?'PATCH':'POST',body:JSON.stringify(editing?{revision:editing.revision,changes:plan,requestId:saveKey}:{plan:{...plan,kind},requestId:saveKey})});
      reset();notify(`${result.item.title} · 저장했어요.${result.conflicts?.length?' 겹치는 일정: '+result.conflicts.map(p=>p.title).join(', '):''}`);await refresh();await brief();
    }catch(error){notify(error.message);}finally{button.disabled=false;}
  };
  reset();brief();setInterval(()=>{if(!document.hidden)brief();},60000);
  return { refresh:()=>{brief();if(dialog.open)refresh();} };
}
