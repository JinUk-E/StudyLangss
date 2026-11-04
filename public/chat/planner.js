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
  $('#daily-brief').onclick=()=>setPrompt('오늘 일정과 기한이 지난 할 일을 확인해서 브리핑해 줘. 우선순위도 같이 정리해 줘.');
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
