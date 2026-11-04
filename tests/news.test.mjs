import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createCredentials,loadAuth} from '../lib/auth.mjs';
import {createNewsStore,validateNews} from '../lib/news-store.mjs';
import {newsMcpResponse} from '../lib/news-mcp.mjs';

const report={topic:'jpop',deliveryId:'jpop:2026-11-04:test',title:'테스트 공연 알림',body:'검증용 정보입니다. [1]',reportDate:'2026-11-04',sources:[{title:'검증 출처',url:'https://example.org/news'}]};
test('news validates sources/date, rejects unknown fields, preserves idempotency and topic separation',t=>{
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());const news=createNewsStore(db);
  const a=news.publish(report);assert(a.saved);assert(news.publish(report).duplicate);assert.equal(news.list('jpop').length,1);assert.equal(news.list('twins').length,0);
  assert.throws(()=>news.publish({...report,body:'different'}),e=>e.status===409);
  for(const change of [{topic:'private'},{reportDate:'2026-02-30'},{deliveryId:'../secret'},{ownerId:'other'},{sources:[]},{sources:[{title:'XSS',url:'javascript:alert(1)'}]},{sources:[{title:'credentials',url:'https://secret@example.org/'}]}])assert.throws(()=>validateNews({...report,...change}));
  assert.deepEqual(news.delivery('twins',report.deliveryId),{found:false});
});
test('connector keys are hashed, rotate/revoke immediately and are bound to owner revision',t=>{
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());const news=createNewsStore(db);let revision=1;
  const accounts={current:p=>p.id==='owner'&&p.revision===revision};const a=news.issue(1);
  assert(!JSON.stringify(db.prepare('SELECT * FROM news_bridge').get()).includes(a));assert(!JSON.stringify(news.connection()).includes(a));
  assert(news.authenticate('Bearer '+a,accounts));assert(!news.authenticate('Basic '+a,accounts));
  const b=news.issue(1);assert(!news.authenticate('Bearer '+a,accounts));assert(news.authenticate('Bearer '+b,accounts));revision=2;assert(!news.authenticate('Bearer '+b,accounts));
  const c=news.issue(2);news.revoke();assert(!news.authenticate('Bearer '+c,accounts));
});
test('MCP only advertises delivery tools and returns explicit failures without arbitrary execution',t=>{
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());const news=createNewsStore(db),rpc=(method,params)=>newsMcpResponse({jsonrpc:'2.0',id:1,method,params},news,'https://example.org');
  assert.equal(rpc('initialize',{protocolVersion:'2025-11-25'}).body.result.protocolVersion,'2025-11-25');
  assert.deepEqual(rpc('tools/list').body.result.tools.map(t=>t.name),['list_news_topics','publish_news_report','get_news_delivery_status']);
  assert.equal(rpc('tools/call',{name:'read_calendar',arguments:{}}).body.error.code,-32602);
  const saved=rpc('tools/call',{name:'publish_news_report',arguments:report}).body.result;assert(saved.structuredContent.saved);assert.match(saved.structuredContent.url,/chat\/news/);
  assert(rpc('tools/call',{name:'publish_news_report',arguments:{...report,body:'conflict'}}).body.result.isError);
  assert.equal(newsMcpResponse({jsonrpc:'2.0',method:'notifications/initialized'},news,'').status,202);assert.equal(newsMcpResponse([],news,'').status,400);
});

let directory,child,base,manager;
const auth=name=>'Basic '+Buffer.from(name+':news-fixture-password-2026').toString('base64');
const call=(path,{name='owner',method='GET',value,headers={}}={})=>fetch(base+path,{method,headers:{Authorization:auth(name),'Content-Type':'application/json',...headers},body:value===undefined?undefined:JSON.stringify(value)});
before(async()=>{
  directory=await mkdtemp(join(tmpdir(),'stella-news-http-'));const file=join(directory,'auth.json');await writeFile(file,JSON.stringify(await createCredentials('owner','news-fixture-password-2026')),{mode:0o600});
  manager=await loadAuth(file);await manager.accounts.create({username:'member',password:'news-fixture-password-2026',permissions:['chat','study']});
  child=spawn(process.execPath,['chat-server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,CHAT_PORT:'0',CHAT_DATA_DIR:join(directory,'chat'),AUTH_FILE:file,AUTH_USERS_FILE:join(directory,'accounts.sqlite')},stdio:['ignore','pipe','pipe']});
  let errors='';child.stderr.on('data',b=>errors+=b);base=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Startup timeout '+errors)),12000);child.on('exit',code=>{clearTimeout(timer);reject(Error('Exit '+code+' '+errors));});child.stdout.on('data',b=>{const m=String(b).match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timer);resolve(m[0]);}});});
});
after(async()=>{if(child?.exitCode===null){const done=once(child,'exit');child.kill();await done;}manager?.accounts.close();if(directory)await rm(directory,{recursive:true,force:true});});
test('news pages and API are owner-only; MCP uses a separate revocable credential and validates Origin',async()=>{
  for(const path of ['/chat/news/','/chat/news/app.js','/api/chat/news?topic=jpop','/api/chat/news/connection']) {assert.equal((await fetch(base+path)).status,401);assert.equal((await call(path,{name:'member'})).status,403);assert.equal((await call(path)).status,200);}
  assert.equal((await call('/api/chat/news/connection/token',{name:'member',method:'POST',value:{}})).status,403);
  assert.equal((await call('/api/chat/news/connection/token',{method:'POST',value:{},headers:{Origin:'https://evil.example'}})).status,403);
  const issued=await call('/api/chat/news/connection/token',{method:'POST',value:{}});assert.equal(issued.status,201);const {token}=await issued.json();
  const headers={Authorization:'Bearer '+token,Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2025-11-25'};
  const rpc=(method,params)=>call('/api/chat/bridge/mcp',{method:'POST',headers,value:{jsonrpc:'2.0',id:1,method,params}});
  assert.equal((await call('/api/chat/bridge/mcp',{method:'POST',value:{}})).status,401);
  assert.equal((await call('/api/chat/bridge/mcp',{method:'POST',headers:{...headers,Origin:'https://evil.example'},value:{}})).status,403);
  assert.equal((await call('/api/chat/bridge/mcp',{headers})).status,405);
  const initialized=await (await rpc('initialize',{protocolVersion:'2025-11-25'})).json();assert.equal(initialized.result.serverInfo.name,'starlight-news');
  const result=await (await rpc('tools/call',{name:'publish_news_report',arguments:report})).json();assert(result.result.structuredContent.saved);
  const reports=await (await call('/api/chat/news?topic=jpop')).json();assert.equal(reports.reports.length,1);assert.equal((await call('/api/chat/news/reports/'+reports.reports[0].id,{name:'member'})).status,403);
  const scoped=await call('/api/chat/plans',{headers});assert.equal(scoped.status,401);
  await call('/api/chat/news/connection/token',{method:'DELETE'});assert.equal((await rpc('tools/list')).status,401);
});
