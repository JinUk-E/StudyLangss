import { renderReport } from './report-format.js';
const $=s=>document.querySelector(s),el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
const labels={jpop:'J-POP 공연 알림',twins:'LG 트윈스 소식',milan:'AC 밀란 소식',jobs:'주간 채용 소식'};
const artwork={jpop:['♫','LIVE & MUSIC'],twins:['⚾','TWINS CLUB'],milan:['⚽','ROSSONERI'],jobs:['⌘','NEXT CHAPTER']};
let reportGeneration=0;
const params=new URLSearchParams(location.search);let topic=Object.hasOwn(labels,params.get('topic'))?params.get('topic'):'jpop',generation=0,connected=false;
async function api(path,options={}){const r=await fetch('/api/chat/news'+path,{...options,headers:{'Content-Type':'application/json',...options.headers},cache:'no-store'});const data=await r.json().catch(()=>({}));if(!r.ok)throw Error(data.error||'소식을 불러오지 못했습니다.');return data;}
const note=text=>{$('#notice').textContent=text;};
const time=value=>new Date(value).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'});
function deliveryPrompt(){const name=labels[$('#prompt-topic').value],key=$('#prompt-topic').value;$('#delivery-prompt').textContent=`기존 ${name} 검색 조건과 예약 시간은 유지해 주세요. 매 회차에 실제 확인한 출처로 한국어 리포트를 정리한 뒤, 연결된 별빛공방 소식 배달 플러그인의 publish_news_report 도구로 topic="${key}" 채널에 전송해 주세요. reportDate는 한국 시간 기준 작성일, deliveryId는 "${key}:작성일:회차" 형식의 고유 ID를 사용해 주세요. 제목, 요약 본문, 실제 확인한 출처 제목·HTTPS URL을 포함하세요. 새 소식이 없으면 확인한 출처와 함께 없다고 보고하고, 검색 실패를 새 소식 없음으로 처리하지 마세요. 대화 전체·개인정보·연결 키는 포함하지 마세요. 저장 결과 saved:true를 확인한 경우에만 별빛공방 전달 완료와 리포트 링크를 알려 주세요. 응답을 받지 못했다면 get_news_delivery_status로 확인하고, 재시도할 때는 동일한 전달 ID와 내용을 사용하세요.`;}
async function connection(){const c=await api('/connection');connected=c.enabled;$('#connection-state').textContent=c.oauthEnabled?'OAuth 연결이 활성화되어 있어요.':connected?'수동 키가 활성화되어 있어요. Codex 플러그인은 OAuth 인증으로 연결해 주세요.':'Codex에서 인증을 시작하고 별빛공방 로그인·승인을 완료해 주세요.';$('#issue-token').textContent='수동 키 발급·재발급';$('#revoke-token').hidden=!connected;$('#plugin-link').hidden=!c.pluginUrl;$('#plugin-pending').hidden=!!c.pluginUrl;if(c.pluginUrl)$('#plugin-link').href=c.pluginUrl;}
async function openConnection(){$('#connection-dialog').showModal();$('#connection-notice').textContent='';await connection();}
function clearToken(){$('#connection-token').value='';$('#token-box').hidden=true;}
async function refresh(){const run=++generation;for(const b of document.querySelectorAll('[data-topic]')){const active=b.dataset.topic===topic;b.setAttribute('aria-selected',String(active));b.tabIndex=active?0:-1;}$('#news-panel').setAttribute('aria-labelledby','tab-'+topic);$('#topic-heading').textContent=labels[topic];note('');$('#report-count').textContent='소식을 불러오고 있어요.';
  try {const {reports}=await api('?topic='+topic);if(run!==generation)return;$('#reports').replaceChildren();$('#report-count').textContent=`보관된 리포트 ${reports.length}개${reports.length===100?' · 최근 100개 표시':''}`;
    if(!reports.length){const empty=el('div');empty.className='empty-state';empty.append(el('h3','아직 도착한 소식이 없어요.'),el('p','ChatGPT 예약 작업에 소식 배달을 연결하면\n새 리포트가 이곳에 차곡차곡 쌓여요.'));const button=el('button','ChatGPT 연결 안내');button.onclick=()=>openConnection().catch(e=>note(e.message));empty.append(button);$('#reports').append(empty);}
    for(const report of reports){
      const card=el('article');card.className='report-card';card.dataset.channel=report.topic;
      const b=el('button');b.type='button';b.className='report-open';b.setAttribute('aria-label',report.title+' — 소식 열기');b.setAttribute('aria-haspopup','dialog');
      const cover=el('span');cover.className='card-cover';cover.setAttribute('aria-hidden','true');
      const mark=el('span',artwork[report.topic][1]);mark.className='card-mark';const icon=el('span',artwork[report.topic][0]);icon.className='card-symbol';
      cover.append(mark,icon,el('span','STARLIGHT NEWS'));
      const content=el('span');content.className='card-content';const date=el('time',report.reportDate);date.dateTime=report.reportDate;
      const title=el('strong',report.title);title.className='card-title';const preview=el('span',report.preview.replace(/^#{1,6}\s/gm,'').replace(/\*\*/g,''));preview.className='card-preview';
      const more=el('span','소식 펼쳐보기 ↗');more.className='card-more';content.append(date,title,preview,more);b.append(cover,content);
      b.onclick=()=>openReport(report.id);card.append(b);$('#reports').append(card);
    }
  }catch(e){if(run===generation){note(e.message);$('#report-count').textContent='새로고침으로 다시 확인할 수 있어요.';}}
}
async function openReport(id){
  const run=++reportGeneration,dialog=$('#report-dialog'),body=$('#report-body'),sources=$('#report-sources');
  dialog.dataset.channel=topic;$('#report-topic').textContent=labels[topic];$('#report-title').textContent='소식을 펼치고 있어요';$('#report-date').textContent='';body.replaceChildren();sources.replaceChildren();$('.report-sources').hidden=true;
  if(!dialog.open)dialog.showModal();dialog.scrollTop=0;
  try{
    const {report}=await api('/reports/'+encodeURIComponent(id));if(run!==reportGeneration||!dialog.open)return;
    dialog.dataset.channel=report.topic;$('#report-topic').textContent=labels[report.topic];$('#report-title').textContent=report.title;$('#report-date').textContent=`기준일 ${report.reportDate} · 도착 ${time(report.receivedAt)}`;
    renderReport(body,report.body,report.sources,report.title);
    for(const [index,source] of report.sources.entries()){const li=el('li'),a=el('a');a.href=source.url;a.target='_blank';a.rel='noopener noreferrer';const number=el('span',String(index+1).padStart(2,'0'));number.className='source-number';const detail=el('span');detail.append(el('strong',source.title),el('small',new URL(source.url).hostname));a.append(number,detail,el('span','↗'));li.append(a);sources.append(li);}$('.report-sources').hidden=false;
    const url=new URL(location.href);url.searchParams.set('report',id);history.replaceState(null,'',url);
  }catch(e){if(run===reportGeneration&&dialog.open){$('#report-title').textContent='소식을 불러오지 못했어요';body.append(el('p',e.message));}}
}
$('#report-dialog').addEventListener('close',()=>{reportGeneration++;const url=new URL(location.href);url.searchParams.delete('report');history.replaceState(null,'',url);});
for(const dialog of document.querySelectorAll('dialog')){
  let startedOutside=false;
  const outside=e=>{const r=dialog.getBoundingClientRect();return e.target===dialog&&(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom);};
  dialog.addEventListener('pointerdown',e=>{startedOutside=outside(e);});
  dialog.addEventListener('pointerup',e=>{if(startedOutside&&outside(e))dialog.close();startedOutside=false;});
  dialog.addEventListener('pointercancel',()=>{startedOutside=false;});
}
for(const b of document.querySelectorAll('[data-topic]'))b.onclick=()=>{topic=b.dataset.topic;history.replaceState(null,'','?topic='+topic);refresh();};
$('.topic-tabs').onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const keys=Object.keys(labels),index=keys.indexOf(topic);topic=e.key==='Home'?keys[0]:e.key==='End'?keys.at(-1):keys[(index+(e.key==='ArrowRight'?1:-1)+keys.length)%keys.length];$('#tab-'+topic).click();$('#tab-'+topic).focus();};
$('#refresh-news').onclick=refresh;$('#close-report').onclick=()=>$('#report-dialog').close();$('#open-connection').onclick=()=>openConnection().catch(e=>note(e.message));$('#close-connection').onclick=()=>{clearToken();$('#connection-dialog').close();};$('#connection-dialog').addEventListener('cancel',clearToken);$('#connection-dialog').addEventListener('close',clearToken);
$('#issue-token').onclick=async()=>{if(connected&&!confirm('새 키를 발급하면 기존 ChatGPT 연결 키가 즉시 만료됩니다. 재발급할까요?'))return;const b=$('#issue-token');b.disabled=true;try{clearToken();const {token}=await api('/connection/token',{method:'POST',body:'{}'});$('#connection-token').value=token;$('#token-box').hidden=false;await connection();$('#connection-notice').textContent='직접 구성한 클라이언트의 보안 인증 저장소에 등록하세요. 창을 닫으면 다시 표시되지 않습니다.';}catch(e){$('#connection-notice').textContent=e.message;}finally{b.disabled=false;}};
$('#copy-token').onclick=async()=>{try{await navigator.clipboard.writeText($('#connection-token').value);$('#connection-notice').textContent='수동 키를 복사했어요. 대화·소스·로그에 붙여넣지 마세요.';}catch{$('#connection-token').select();$('#connection-notice').textContent='선택한 키를 직접 복사해 주세요.';}};
$('#revoke-token').onclick=async()=>{if(!confirm('모든 기기의 소식 전달 연결을 해제할까요? 기존 리포트는 보관됩니다.'))return;try{await api('/connection/token',{method:'DELETE'});clearToken();await connection();$('#connection-notice').textContent='모든 소식 연결을 해제했어요.';}catch(e){$('#connection-notice').textContent=e.message;}};
$('#prompt-topic').onchange=deliveryPrompt;$('#copy-prompt').onclick=async()=>{try{await navigator.clipboard.writeText($('#delivery-prompt').textContent);$('#connection-notice').textContent='전달 지시를 복사했어요. 기존 예약 작업에 추가해 주세요.';}catch{$('#connection-notice').textContent='전달 지시를 선택해 직접 복사해 주세요.';}};
deliveryPrompt();await refresh();if(params.get('report'))openReport(params.get('report')).catch(e=>note(e.message));if(params.get('connect')==='1')openConnection().catch(e=>note(e.message));setInterval(()=>{if(!document.hidden&&!$('#report-dialog').open&&!$('#connection-dialog').open)refresh();},60000);window.addEventListener('pagehide',clearToken);
