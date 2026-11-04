import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createServer} from 'node:http';
import {createHash,randomBytes} from 'node:crypto';
import {createNewsOAuth,validNewsRedirect} from '../lib/news-oauth.mjs';

let db,server,oauth,base,revision=1,time=Date.now();
const basic='Basic '+Buffer.from('owner:fixture-password').toString('base64');
const accounts={current:p=>p.id==='owner'&&p.revision===revision};
const random=()=>randomBytes(32).toString('base64url');
const challenge=v=>createHash('sha256').update(v).digest('base64url');
const request=(path,{method='GET',input,headers={}}={})=>fetch(base+path,{method,redirect:'manual',headers:{...(input?{'Content-Type':'application/x-www-form-urlencoded'}:{}),...headers},body:input?new URLSearchParams(input).toString():undefined});
const post=(path,input,headers={})=>request(path,{method:'POST',input,headers});
const route='/api/chat/bridge/oauth';
before(async()=>{
  db=new DatabaseSync(':memory:');server=createServer(async(req,res)=>{if(await oauth.route(req,res))return;res.writeHead(oauth.authenticate(req.headers.authorization)?200:401,{'WWW-Authenticate':oauth.challenge});res.end();});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;
  oauth=createNewsOAuth(db,{origin:base,accounts,now:()=>time,authenticate:async(req,res)=>{if(req.headers.authorization!==basic){res.writeHead(401);res.end();return false;}req.user={id:'owner',revision};return req.user;}});
});
after(async()=>{await new Promise(r=>server.close(r));db.close();});
async function registration(redirect='http://127.0.0.1/callback'){
  const res=await fetch(base+route+'/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_name:'Codex fixture',redirect_uris:[redirect],token_endpoint_auth_method:'none'})});assert.equal(res.status,201);return res.json();
}
function authInput(c){const verifier=random();return {verifier,params:{client_id:c.client_id,redirect_uri:'http://127.0.0.1:19493/callback',response_type:'code',resource:base+'/api/chat/bridge/mcp',scope:'news:deliver',state:random(),code_challenge:challenge(verifier),code_challenge_method:'S256'}};}
async function consent(params){const page=await request(route+'/authorize?'+new URLSearchParams(params),{headers:{Authorization:basic}});assert.equal(page.status,200);const html=await page.text();return {cookie:page.headers.get('set-cookie').split(';')[0],csrf:html.match(/name="csrf" value="([^"]+)"/)[1]};}
async function authorize(params){const page=await consent(params);const response=await post(route+'/authorize',{csrf:page.csrf,decision:'allow'},{Authorization:basic,Origin:base,Cookie:page.cookie});assert.equal(response.status,302);const url=new URL(response.headers.get('location'));assert.equal(url.searchParams.get('state'),params.state);assert.equal(url.searchParams.get('iss'),base);return url.searchParams.get('code');}
const exchange=(params,code,verifier)=>post(route+'/token',{grant_type:'authorization_code',client_id:params.client_id,code,redirect_uri:params.redirect_uri,resource:params.resource,code_verifier:verifier});

test('discovery advertises OAuth and PKCE; redirects exclude arbitrary websites and query injection',async()=>{
  const blocked=await request('/api/chat/bridge/mcp');assert.equal(blocked.status,401);assert.match(blocked.headers.get('www-authenticate'),/resource_metadata=/);
  const meta=await (await request('/.well-known/oauth-authorization-server')).json();assert.equal(meta.issuer,base);assert.deepEqual(meta.code_challenge_methods_supported,['S256']);assert(meta.authorization_response_iss_parameter_supported);
  for(const url of ['https://evil.example/callback','http://localhost/callback','https://chatgpt.com.evil.org/connector_platform_oauth_redirect','http://127.0.0.1/callback?next=evil','http://127.0.0.1/other','https://chatgpt.com/connector_platform_oauth_redirect#fragment'])assert(!validNewsRedirect(url));
  assert(validNewsRedirect('https://chatgpt.com/connector_platform_oauth_redirect'));assert(validNewsRedirect('http://[::1]:4444/callback'));
});
test('consent requires owner, browser origin, cookie and CSRF; denial issues no code',async()=>{
  const c=await registration(),{params}=authInput(c);
  assert.equal((await request(route+'/authorize?'+new URLSearchParams(params))).status,401);
  const page=await consent(params);
  for(const headers of [{Authorization:basic,Origin:base},{Authorization:basic,Cookie:page.cookie},{Authorization:basic,Origin:'https://evil.example',Cookie:page.cookie}])assert.equal((await post(route+'/authorize',{csrf:page.csrf,decision:'allow'},headers)).status,403);
  assert.equal((await post(route+'/authorize',{csrf:'wrong',decision:'allow'},{Authorization:basic,Origin:base,Cookie:page.cookie})).status,403);
  const denied=await post(route+'/authorize',{csrf:page.csrf,decision:'deny'},{Authorization:basic,Origin:base,Cookie:page.cookie});const url=new URL(denied.headers.get('location'));assert.equal(url.searchParams.get('error'),'access_denied');assert.equal(url.searchParams.get('iss'),base);assert(!url.searchParams.has('code'));
});
test('code flow binds PKCE, resource, redirect and client; hashed tokens, rotation and replay revocation',async()=>{
  const c=await registration(),{params,verifier}=authInput(c),code=await authorize(params);
  assert.equal((await exchange(params,code,random())).status,400);
  assert.equal((await exchange({...params,resource:'https://evil.example'},code,verifier)).status,400);
  assert.equal((await exchange({...params,redirect_uri:'http://127.0.0.1:9999/callback'},code,verifier)).status,400);
  const other=await registration();assert.equal((await exchange({...params,client_id:other.client_id},code,verifier)).status,400);
  const response=await exchange(params,code,verifier);assert.equal(response.status,200);const tokens=await response.json();
  assert.equal((await exchange(params,code,verifier)).status,400);
  assert(oauth.authenticate('Bearer '+tokens.access_token));assert(!JSON.stringify(db.prepare('SELECT * FROM news_oauth_tokens').all()).includes(tokens.access_token));
  const refreshed=await post(route+'/token',{client_id:c.client_id,grant_type:'refresh_token',refresh_token:tokens.refresh_token,resource:params.resource});assert.equal(refreshed.status,200);const next=await refreshed.json();assert(oauth.authenticate('Bearer '+next.access_token));
  assert.equal((await post(route+'/token',{client_id:c.client_id,grant_type:'refresh_token',refresh_token:tokens.refresh_token})).status,400);assert(!oauth.authenticate('Bearer '+next.access_token));
});
test('authorization rejects downgrade, bad target/scope/redirect; access expiry, owner change and disconnect invalidate grants',async()=>{
  const c=await registration(),{params,verifier}=authInput(c);
  for(const change of [{code_challenge_method:'plain'},{scope:'calendar'},{resource:'https://evil.example'},{redirect_uri:'https://evil.example/callback'}])assert.equal((await request(route+'/authorize?'+new URLSearchParams({...params,...change}),{headers:{Authorization:basic}})).status,400);
  const code=await authorize(params),tokens=await (await exchange(params,code,verifier)).json();assert(oauth.authenticate('Bearer '+tokens.access_token));
  revision++;assert(!oauth.authenticate('Bearer '+tokens.access_token));revision--;
  time+=901000;assert(!oauth.authenticate('Bearer '+tokens.access_token));
  const next=await (await post(route+'/token',{client_id:c.client_id,grant_type:'refresh_token',refresh_token:tokens.refresh_token})).json();assert(oauth.authenticate('Bearer '+next.access_token));
  assert(oauth.status().enabled);oauth.revoke();assert(!oauth.status().enabled);assert(!oauth.authenticate('Bearer '+next.access_token));
});
