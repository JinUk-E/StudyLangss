import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';

const hash=s=>createHash('sha256').update(s).digest('hex');
const secret=()=>randomBytes(32).toString('base64url');
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&timingSafeEqual(Buffer.from(hash(a),'hex'),Buffer.from(hash(b),'hex'));
const fail=(error='invalid_request',status=400)=>{throw Object.assign(Error(error),{oauthError:error,status});};
const check=(ok,error,status)=>{if(!ok)fail(error,status);};
const scope='news:deliver';
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cookieName='__Host-starlight-news-consent';

// Registration is public, but redirects are limited to supported OpenAI hosts
// and native loopback callbacks. No client-supplied URL is fetched by this server.
export function validNewsRedirect(value) {
  try {
    const u=new URL(value);
    if(u.username||u.password||u.hash||u.search||value.length>1000)return false;
    if(u.protocol==='http:'&&['127.0.0.1','[::1]'].includes(u.hostname))return /^\/callback(?:\/[A-Za-z0-9_-]+)?$/.test(u.pathname);
    return u.protocol==='https:'&&u.hostname==='chatgpt.com'&&!u.port&&(/^\/connector\/oauth\/[A-Za-z0-9_-]+$/.test(u.pathname)||u.pathname==='/connector_platform_oauth_redirect');
  }catch{return false;}
}
function redirectMatches(registered,actual) {
  if(!validNewsRedirect(actual))return false;
  if(registered===actual)return true;
  const a=new URL(registered),b=new URL(actual);
  return a.protocol==='http:'&&!a.port&&a.hostname===b.hostname&&a.pathname===b.pathname;
}
async function payload(req) {
  let size=0;const chunks=[];
  for await(const chunk of req){size+=chunk.length;check(size<=8192,'invalid_request',413);chunks.push(chunk);}
  const raw=Buffer.concat(chunks).toString('utf8'),type=(req.headers['content-type']||'').split(';')[0];
  if(type==='application/json'){try{const o=JSON.parse(raw);check(o&&typeof o==='object'&&!Array.isArray(o));return o;}catch{fail();}}
  check(type==='application/x-www-form-urlencoded','invalid_request',415);
  return parameters(new URLSearchParams(raw));
}
function parameters(params){const out={};for(const [k,v]of params){check(!Object.hasOwn(out,k));out[k]=v;}return out;}

export function createNewsOAuth(db,{origin,accounts,authenticate,now=()=>Date.now()}) {
  const resource=origin+'/api/chat/bridge/mcp',base='/api/chat/bridge/oauth';
  const metadataPath='/.well-known/oauth-protected-resource/api/chat/bridge/mcp';
  const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  db.exec(`CREATE TABLE IF NOT EXISTS news_oauth_clients(id TEXT PRIMARY KEY,name TEXT NOT NULL,redirects TEXT NOT NULL,created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS news_oauth_pending(id TEXT PRIMARY KEY,csrf TEXT NOT NULL,request TEXT NOT NULL,revision INTEGER NOT NULL,expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS news_oauth_codes(digest TEXT PRIMARY KEY,client TEXT NOT NULL,redirect TEXT NOT NULL,challenge TEXT NOT NULL,revision INTEGER NOT NULL,expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS news_oauth_grants(id TEXT PRIMARY KEY,client TEXT NOT NULL,revision INTEGER NOT NULL,created INTEGER NOT NULL,expires INTEGER NOT NULL,lastUsed INTEGER,revoked INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS news_oauth_tokens(digest TEXT PRIMARY KEY,grantId TEXT NOT NULL,kind TEXT NOT NULL,expires INTEGER NOT NULL,used INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS news_oauth_tokens_grant ON news_oauth_tokens(grantId);`);
  const current=revision=>accounts.current({id:'owner',revision},'admin');
  function cleanup(){const t=now();db.prepare('DELETE FROM news_oauth_pending WHERE expires<?').run(t);db.prepare('DELETE FROM news_oauth_codes WHERE expires<?').run(t);db.prepare('DELETE FROM news_oauth_tokens WHERE grantId IN (SELECT id FROM news_oauth_grants WHERE expires<?)').run(t);db.prepare('DELETE FROM news_oauth_grants WHERE expires<?').run(t);}
  function transaction(fn){db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}
  function client(id){check(typeof id==='string'&&id.length<=100,'invalid_client');const c=db.prepare('SELECT * FROM news_oauth_clients WHERE id=?').get(id);check(c,'invalid_client');return c;}
  function authorization(input){
    const c=client(input.client_id);check(typeof input.redirect_uri==='string'&&JSON.parse(c.redirects).some(r=>redirectMatches(r,input.redirect_uri)));
    check(input.response_type==='code','unsupported_response_type');check(input.resource===resource,'invalid_target');
    check((input.scope||scope)===scope,'invalid_scope');check(input.code_challenge_method==='S256'&&/^[A-Za-z0-9_-]{43}$/.test(input.code_challenge||''));
    check(typeof input.state==='string'&&input.state.length>=8&&input.state.length<=1024);
    return c;
  }
  function issue(grant){
    const access='sf_oauth_'+secret(),refresh='sf_refresh_'+secret(),expires=Math.min(now()+900000,grant.expires);
    const insert=db.prepare('INSERT INTO news_oauth_tokens VALUES (?,?,?,?,0)');
    insert.run(hash(access),grant.id,'access',expires);insert.run(hash(refresh),grant.id,'refresh',grant.expires);
    return {access_token:access,token_type:'Bearer',expires_in:Math.floor((expires-now())/1000),refresh_token:refresh,scope};
  }
  function token(input){
    cleanup();const c=client(input.client_id);check(!input.client_secret&&!input.client_assertion,'invalid_client');
    check(!input.resource||input.resource===resource,'invalid_target');check(!input.scope||input.scope===scope,'invalid_scope');
    if(input.grant_type==='authorization_code')return transaction(()=>{
      check(input.resource===resource,'invalid_target');check(typeof input.code==='string'&&input.code.length<=128,'invalid_grant');
      const code=db.prepare('SELECT * FROM news_oauth_codes WHERE digest=?').get(hash(input.code));
      check(code&&code.client===c.id&&code.expires>now()&&code.redirect===input.redirect_uri&&current(code.revision),'invalid_grant');
      check(typeof input.code_verifier==='string'&&/^[A-Za-z0-9._~-]{43,128}$/.test(input.code_verifier)&&equal(createHash('sha256').update(input.code_verifier).digest('base64url'),code.challenge),'invalid_grant');
      check(db.prepare('SELECT count(*) n FROM news_oauth_grants WHERE revoked=0').get().n<128,'temporarily_unavailable',503);
      db.prepare('DELETE FROM news_oauth_codes WHERE digest=?').run(hash(input.code));
      const grant={id:secret(),client:c.id,revision:code.revision,created:now(),expires:now()+30*86400000};
      db.prepare('INSERT INTO news_oauth_grants VALUES (?,?,?,?,?,NULL,0)').run(grant.id,grant.client,grant.revision,grant.created,grant.expires);
      return issue(grant);
    });
    if(input.grant_type==='refresh_token'){
      check(typeof input.refresh_token==='string'&&input.refresh_token.length<=128,'invalid_grant');
      const old=db.prepare('SELECT * FROM news_oauth_tokens WHERE digest=? AND kind=\'refresh\'').get(hash(input.refresh_token));
      const grant=old&&db.prepare('SELECT * FROM news_oauth_grants WHERE id=?').get(old.grantId);
      check(grant&&grant.client===c.id,'invalid_grant');
      if(old.used){db.prepare('UPDATE news_oauth_grants SET revoked=1 WHERE id=?').run(grant.id);fail('invalid_grant');}
      check(!grant.revoked&&old.expires>now()&&current(grant.revision),'invalid_grant');
      return transaction(()=>{db.prepare('UPDATE news_oauth_tokens SET used=1 WHERE digest=?').run(old.digest);return issue(grant);});
    }
    fail('unsupported_grant_type');
  }
  function authenticated(header){
    if(typeof header!=='string'||!/^Bearer sf_oauth_[A-Za-z0-9_-]{43}$/.test(header))return false;
    const row=db.prepare(`SELECT t.expires tokenExpires,g.* FROM news_oauth_tokens t JOIN news_oauth_grants g ON g.id=t.grantId WHERE t.digest=? AND t.kind='access'`).get(hash(header.slice(7)));
    if(!row||row.revoked||row.tokenExpires<=now()||row.expires<=now()||!current(row.revision))return false;
    db.prepare('UPDATE news_oauth_grants SET lastUsed=? WHERE id=?').run(now(),row.id);return true;
  }
  const status=()=>({enabled:db.prepare('SELECT revision FROM news_oauth_grants WHERE revoked=0 AND expires>?').all(now()).some(g=>current(g.revision)),method:'oauth'});
  const revoke=()=>{db.prepare('UPDATE news_oauth_grants SET revoked=1').run();db.prepare('DELETE FROM news_oauth_codes').run();db.prepare('DELETE FROM news_oauth_pending').run();};
  function redirect(res,input,values){const url=new URL(input.redirect_uri);for(const [k,v]of Object.entries({...values,state:input.state,iss:origin}))url.searchParams.set(k,v);res.writeHead(302,{Location:url.href});res.end();}
  async function route(req,res){
    const url=new URL(req.url,origin),path=url.pathname;
    if(![metadataPath,'/.well-known/oauth-protected-resource','/.well-known/oauth-authorization-server',base+'/register',base+'/authorize',base+'/token',base+'/revoke'].includes(path))return false;
    res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
    try {
      if(path===metadataPath||path==='/.well-known/oauth-protected-resource'){
        check(req.method==='GET','invalid_request',405);json(res,200,{resource,authorization_servers:[origin],scopes_supported:[scope],bearer_methods_supported:['header']});return true;
      }
      if(path==='/.well-known/oauth-authorization-server'){
        check(req.method==='GET','invalid_request',405);json(res,200,{issuer:origin,authorization_endpoint:origin+base+'/authorize',token_endpoint:origin+base+'/token',registration_endpoint:origin+base+'/register',revocation_endpoint:origin+base+'/revoke',response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],token_endpoint_auth_methods_supported:['none'],code_challenge_methods_supported:['S256'],scopes_supported:[scope],authorization_response_iss_parameter_supported:true});return true;
      }
      check(!req.headers.origin||req.headers.origin===origin,'invalid_request',403);
      if(path===base+'/authorize'){
        check(['GET','POST'].includes(req.method),'invalid_request',405);
        if(!await authenticate(req,res))return true;
        check(req.user.id==='owner'&&current(req.user.revision),'access_denied',403);
        cleanup();
        if(req.method==='GET'){
          const input=parameters(url.searchParams),c=authorization(input);
          res.setHeader('Content-Security-Policy',`default-src 'none'; form-action 'self' ${new URL(input.redirect_uri).origin}; frame-ancestors 'none'; base-uri 'none'`);
          check(db.prepare('SELECT count(*) n FROM news_oauth_pending').get().n<64,'temporarily_unavailable',429);
          const id=secret(),csrf=secret();db.prepare('INSERT INTO news_oauth_pending VALUES (?,?,?,?,?)').run(hash(id),hash(csrf),JSON.stringify(input),req.user.revision,now()+300000);
          res.setHeader('Set-Cookie',`${cookieName}=${id}; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=300`);
          res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
          res.end(`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>별빛공방 소식 연결 승인</title><main><h1>별빛공방 소식 배달 연결</h1><p>요청 앱: ${escape(c.name)} (앱이 제공한 이름)</p><p>연결 대상: ${escape(new URL(input.redirect_uri).origin)}</p><p>허용 범위: J-POP·LG 트윈스 소식 저장, 채널 목록 및 전달 결과 확인.</p><p>개인 대화·일정·자료실에는 접근할 수 없습니다. 직접 시작한 연결인지 확인해 주세요.</p><form method="post" action="${base}/authorize"><input type="hidden" name="csrf" value="${csrf}"><button name="decision" value="allow">소식 연결 허용</button> <button name="decision" value="deny">취소</button></form><p>연결은 30일간 유효하며 소식 → ChatGPT 연결에서 해제할 수 있습니다.</p></main></html>`);return true;
        }
        check(req.headers.origin===origin&&req.headers['sec-fetch-site']!=='cross-site','access_denied',403);
        const input=await payload(req),id=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1);
        check(id&&id.length===43&&typeof input.csrf==='string','access_denied',403);
        const pending=db.prepare('SELECT * FROM news_oauth_pending WHERE id=?').get(hash(id));
        check(pending&&pending.expires>now()&&pending.revision===req.user.revision&&equal(hash(input.csrf),pending.csrf),'access_denied',403);
        const request=JSON.parse(pending.request);authorization(request);check(['allow','deny'].includes(input.decision));
        res.setHeader('Content-Security-Policy',`default-src 'none'; form-action 'self' ${new URL(request.redirect_uri).origin}; frame-ancestors 'none'; base-uri 'none'`);
        const code=secret();transaction(()=>{db.prepare('DELETE FROM news_oauth_pending WHERE id=?').run(hash(id));if(input.decision==='allow')db.prepare('INSERT INTO news_oauth_codes VALUES (?,?,?,?,?,?)').run(hash(code),request.client_id,request.redirect_uri,request.code_challenge,pending.revision,now()+120000);});
        res.setHeader('Set-Cookie',`${cookieName}=; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
        redirect(res,request,input.decision==='allow'?{code}:{error:'access_denied'});return true;
      }
      check(req.method==='POST','invalid_request',405);const input=await payload(req);
      if(path===base+'/register'){
        check((req.headers['content-type']||'').startsWith('application/json'));
        check(Array.isArray(input.redirect_uris)&&input.redirect_uris.length>=1&&input.redirect_uris.length<=5&&input.redirect_uris.every(validNewsRedirect),'invalid_redirect_uri');
        check(!input.token_endpoint_auth_method||input.token_endpoint_auth_method==='none','invalid_client_metadata');
        check(!input.grant_types||(Array.isArray(input.grant_types)&&input.grant_types.every(g=>['authorization_code','refresh_token'].includes(g))),'invalid_client_metadata');
        check(!input.response_types||(Array.isArray(input.response_types)&&input.response_types.every(t=>t==='code')),'invalid_client_metadata');
        check(!input.scope||input.scope===scope,'invalid_scope');
        check(db.prepare('SELECT count(*) n FROM news_oauth_clients').get().n<256,'temporarily_unavailable',429);
        const id='sf_client_'+secret(),name=typeof input.client_name==='string'?input.client_name.slice(0,120):'MCP 클라이언트';
        db.prepare('INSERT INTO news_oauth_clients VALUES (?,?,?,?)').run(id,name,JSON.stringify(input.redirect_uris),now());
        json(res,201,{client_id:id,client_id_issued_at:Math.floor(now()/1000),client_name:name,redirect_uris:input.redirect_uris,token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code'],scope});return true;
      }
      if(path===base+'/token'){json(res,200,token(input));return true;}
      const c=client(input.client_id);check(typeof input.token==='string'&&input.token.length<=128);
      db.prepare('UPDATE news_oauth_grants SET revoked=1 WHERE client=? AND id IN (SELECT grantId FROM news_oauth_tokens WHERE digest=?)').run(c.id,hash(input.token));json(res,200,{});return true;
    }catch(e){json(res,e.oauthError?e.status:500,{error:e.oauthError||'server_error'});return true;}
  }
  return {route,authenticate:authenticated,status,revoke,challenge:`Bearer resource_metadata="${origin+metadataPath}", scope="${scope}"`};
}
