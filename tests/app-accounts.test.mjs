import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {handleAppAccounts,admin,publicProfile,validCollections,verifyGoogle,digest} from '../src/app-accounts.js';
const sql=new DatabaseSync(':memory:');
const DB={prepare(query){let args=[];return {bind(...values){args=values;return this},async run(){return {meta:{changes:Number(sql.prepare(query).run(...args).changes)}}},async first(){return sql.prepare(query).get(...args)||null},async all(){return {results:sql.prepare(query).all(...args)}}}},async batch(statements){sql.exec('BEGIN');try{const values=[];for(const s of statements)values.push(await s.run());sql.exec('COMMIT');return values}catch(e){sql.exec('ROLLBACK');throw e}}};
const env={DB,CHAT_IMAGES:{async delete(){}}};
async function call(path,method='GET',data,token,cf={city:'Surat',country:'IN'}){const r=new Request('https://example.com/api/app/'+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});Object.defineProperty(r,'cf',{value:cf});return handleAppAccounts(r,env)}
assert.equal(await handleAppAccounts(new Request('https://example.com/'),env),null);
assert.equal((await(await call('config')).json()).googleConfigured,false);
assert.equal((await call('auth/google')).status,503);
assert.equal((await call('admin/users')).status,401);
assert.equal((await call('auth/guest','POST',{})).status,400);
let r=await call('auth/guest','POST',{noticeVersion:'2026-10-30'});assert.equal(r.status,201);const guest=await r.json();
assert.equal(guest.user.admin,false);assert.equal(guest.user.blocked,false);assert.match(guest.token,/^[a-f0-9]{64}$/);
assert.equal((await call('heartbeat','POST',{version:'13.7.4',open:true},guest.token)).status,200);
assert.equal(sql.prepare('SELECT app_version FROM app_accounts WHERE id=?').get(guest.user.id).app_version,'13.7.4','first version is recorded immediately');
assert.equal(sql.prepare('SELECT opens FROM app_accounts WHERE id=?').get(guest.user.id).opens,1,'initial heartbeat does not double-count signup');
assert.equal((await call('me','PATCH',{name:'x'.repeat(40000)},guest.token)).status,413,'streamed request body is bounded');
assert.equal((await call('admin/users','GET',undefined,guest.token)).status,403);
assert.equal((await call('me','PATCH',{name:'Guest name',username:'my_name',bio:'hello',admin:true,google_email:'gandhideepak6376@gmail.com'},guest.token)).status,200);
assert.equal((await(await call('me','GET',undefined,guest.token)).json()).user.admin,false);
r=await call('profiles/my_name');const profile=(await r.json()).profile;assert.equal(profile.name,'Guest name');assert.equal(profile.city,undefined);assert.equal(profile.id,undefined);assert.equal(profile.google_email,undefined);
assert.deepEqual(profile.collections,{playlists:[],favourites:[]});
const collections={playlists:[{id:'PL123',title:'A playlist'}],favourites:[{id:'abcdef12345',title:'Song'}]};
assert.equal((await call('collections','PUT',collections,guest.token)).status,200);
assert.deepEqual((await(await call('profiles/my_name')).json()).profile.collections,collections);
assert.throws(()=>validCollections({playlists:[{id:'javascript:bad',title:'x'}],favourites:[]}));
assert.equal((await call('collections','PUT',{playlists:[],favourites:Array(101).fill({id:'a',title:'x'})},guest.token)).status,400);
const other=await(await call('auth/guest','POST',{noticeVersion:'2026-10-30'})).json();
assert.equal((await call('me','PATCH',{name:'Duplicate',username:'my_name',bio:''},other.token)).status,409);
sql.prepare('UPDATE app_accounts SET last_active=0 WHERE id=?').run(guest.user.id);
assert.equal((await call('heartbeat','POST',{city:'Fake',country:'US',version:'13.7.4',open:true},guest.token)).status,200);
let row=sql.prepare('SELECT * FROM app_accounts WHERE id=?').get(guest.user.id);assert.equal(row.city,'Surat');assert.equal(row.country,'IN');assert.equal(row.app_version,'13.7.4');const opens=row.opens;
await call('heartbeat','POST',{open:true},guest.token);assert.equal(sql.prepare('SELECT opens FROM app_accounts WHERE id=?').get(guest.user.id).opens,opens,'heartbeat writes throttled');
// A forged client name/email never grants admin; only a server-verified Google subject does.
assert.equal(admin({provider:'guest',google_email:'gandhideepak6376@gmail.com',email_verified:1}),false);
assert.equal(admin({provider:'google',google_email:'gandhideepak6376@gmail.com',email_verified:0}),false);
sql.prepare("UPDATE app_accounts SET provider='google',google_sub='verified-owner',google_email='gandhideepak6376@gmail.com',email_verified=1 WHERE id=?").run(other.user.id);
assert.equal((await call('admin/users','GET',undefined,other.token)).status,200);
assert.equal((await call('admin/access','POST',{id:other.user.id,blocked:true},other.token)).status,409,'owner cannot block self');
assert.equal((await call('admin/access','POST',{id:guest.user.id,blocked:true},other.token)).status,200);
assert.equal((await(await call('me','GET',undefined,guest.token)).json()).user.blocked,true);
assert.equal((await call('heartbeat','POST',{},guest.token)).status,403);
assert.equal((await call('me','PATCH',{name:'Bypass',username:'bypass',bio:''},guest.token)).status,403);
assert.equal((await call('profiles/my_name')).status,404);
assert.equal((await call('admin/access','POST',{id:guest.user.id,blocked:false},other.token)).status,200);
assert.equal((await call('profiles/my_name')).status,200);
assert.equal((await(await call('admin/audit','GET',undefined,other.token)).json()).events.length,2);
const csrf=new Request('https://example.com/api/app/admin/access',{method:'POST',headers:{Origin:'https://evil.example',Authorization:'Bearer '+other.token},body:'{}'});assert.equal((await handleAppAccounts(csrf,env)).status,403);
assert.equal((await call('auth/claim','POST',{code:'a'.repeat(64),verifier:'b'.repeat(43)})).status,401);
const verifier='v'.repeat(43),challenge=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))).toString('base64url');
await DB.prepare('INSERT INTO app_handoffs(hash,user_id,challenge,expires) VALUES(?,?,?,?)').bind(await digest('c'.repeat(64)),guest.user.id,challenge,Date.now()+60000).run();
assert.equal((await call('auth/claim','POST',{code:'c'.repeat(64),verifier:'x'.repeat(43)})).status,401);
assert.equal((await call('auth/claim','POST',{code:'c'.repeat(64),verifier})).status,200);
assert.equal((await call('auth/claim','POST',{code:'c'.repeat(64),verifier})).status,401,'one-use code rejects replay');
assert.equal((await call('me','DELETE',{},guest.token)).status,200);
assert.equal((await call('me','GET',undefined,guest.token)).status,401);
// Verify an actual signed JWT; wrong audience, nonce, expiry and signature must fail.
const keys=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const jwk={...await crypto.subtle.exportKey('jwk',keys.publicKey),kid:'test-key'};
const b64=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
async function token(changes={}){const input=b64({alg:'RS256',kid:'test-key'})+'.'+b64({iss:'https://accounts.google.com',aud:'client',nonce:'nonce',sub:'123',email_verified:true,exp:Math.floor(Date.now()/1000)+3600,...changes});return input+'.'+Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',keys.privateKey,new TextEncoder().encode(input))).toString('base64url')}
const fetcher=async()=>Response.json({keys:[jwk]});
assert.equal((await verifyGoogle(await token(),'client','nonce',fetcher)).sub,'123');
for(const changes of [{aud:'attacker'},{nonce:'wrong'},{exp:0},{email_verified:false},{iss:'attacker'}])await assert.rejects(()=>token(changes).then(t=>verifyGoogle(t,'client','nonce',fetcher)));
const signed=await token();await assert.rejects(()=>verifyGoogle(signed.slice(0,-10)+'aaaaaaaaaa','client','nonce',fetcher));
console.log('PASS accounts: guest defaults, private profiles, collection opt-in, throttling, verified admin, block/unblock, CSRF, deletion, PKCE replay and Google JWT validation');
// Exercise the complete web-to-Android Google callback without external services.
const configured={...env,DEEPLIST_GOOGLE_CLIENT_ID:'client',DEEPLIST_GOOGLE_CLIENT_SECRET:'test-client-secret'};
const originalFetch=globalThis.fetch;
globalThis.fetch=async url=>{
 if(String(url)==='https://oauth2.googleapis.com/token')return Response.json({id_token:await token({email:'gandhideepak6376@gmail.com',name:'Deepu',sub:'owner-subject'})});
 if(String(url)==='https://www.googleapis.com/oauth2/v3/certs')return fetcher();
 throw Error('Unexpected external request');
};
try{
 const oauthState='d'.repeat(64),browser='e'.repeat(64),ch='a'.repeat(43);
 await DB.prepare('INSERT INTO app_oauth(state_hash,browser_hash,nonce,challenge,expires) VALUES(?,?,?,?,?)').bind(await digest(oauthState),await digest(browser),'nonce',ch,Date.now()+60000).run();
 const request=()=>new Request('https://example.com/api/app/auth/callback?state='+oauthState+'&code=test-code',{headers:{Cookie:'__Host-dp-login='+browser}});
 const result=await handleAppAccounts(request(),configured);assert.equal(result.status,302);assert.match(result.headers.get('Location'),/^deeplist:\/\/account\?code=[a-f0-9]{64}$/);
 assert.equal(admin(sql.prepare("SELECT * FROM app_accounts WHERE google_sub='owner-subject'").get()),true);
 assert.ok(result.headers.get('Set-Cookie').includes('__Host-dp-session='),'browser admin session set alongside Android handoff');
 assert.equal((await handleAppAccounts(request(),configured)).status,401,'OAuth state is one use');
 // Public endpoint never leaks Google email, subject, location, admin role or activity.
 const owner=sql.prepare("SELECT * FROM app_accounts WHERE google_sub='owner-subject'").get();
 const publicData=(await(await call('profiles/'+owner.username)).json()).profile;
 for(const key of ['google_email','google_sub','email_verified','city','country','last_active','blocked','admin'])assert.equal(publicData[key],undefined);
}finally{globalThis.fetch=originalFetch}
console.log('PASS Google callback: signed identity, verified owner, browser cookie, Android handoff, replay rejection and public-data isolation');
// Reuse the production website authenticator, not a client-provided admin flag.
const {default:worker}=await import('../src/index.js');
const adminEnv={...env,ADMIN_KEY:'test-existing-website-key-12345'};
async function websiteAdmin(path,{key,method='GET',data,origin,token}={}){
 return worker.fetch(new Request('https://example.com/api/app/'+path,{method,headers:{...(key?{'X-Admin-Key':key}:{}),...(token?{Authorization:'Bearer '+token}:{}),...(origin?{Origin:origin}:{}),'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})}),adminEnv,{});
}
assert.equal((await websiteAdmin('admin/status')).status,401);
assert.equal((await websiteAdmin('admin/status',{key:'incorrect'})).status,401);
let auth=await websiteAdmin('admin/status',{key:adminEnv.ADMIN_KEY});assert.equal(auth.status,200);assert.equal((await auth.json()).method,'website');
assert.equal((await websiteAdmin('me',{key:adminEnv.ADMIN_KEY})).status,401,'website key applies only to admin endpoints');
const pending=await(await call('auth/guest','POST',{noticeVersion:'2026-10-30'})).json();
assert.equal((await websiteAdmin('admin/users',{key:adminEnv.ADMIN_KEY})).status,200,'Google configuration is not required');
assert.equal((await websiteAdmin('admin/access',{key:adminEnv.ADMIN_KEY,method:'POST',data:{id:pending.user.id,blocked:true}})).status,200);
assert.equal((await call('heartbeat','POST',{},pending.token)).status,403);
assert.equal(sql.prepare('SELECT actor FROM app_admin_audit WHERE target=? ORDER BY at DESC LIMIT 1').get(pending.user.id).actor,'website-admin');
assert.equal((await websiteAdmin('admin/access',{key:adminEnv.ADMIN_KEY,method:'POST',origin:'https://evil.example',data:{id:pending.user.id,blocked:false}})).status,403);
assert.equal((await websiteAdmin('admin/access',{key:adminEnv.ADMIN_KEY,method:'POST',data:{id:pending.user.id,blocked:false}})).status,200);
assert.equal((await(await call('me','GET',undefined,pending.token)).json()).user.blocked,false);
assert.equal((await websiteAdmin('admin/users',{token:pending.token})).status,403);
const rowTime=Date.now();
for(let i=0;i<101;i++)sql.prepare('INSERT INTO app_accounts(id,provider,username,name,created_at,last_active,notice_version) VALUES(?,?,?,?,?,?,?)').run('00000000-0000-4000-8000-'+String(i).padStart(12,'0'),'guest','bulk_'+i,'Listener '+i,rowTime,rowTime,'2026-10-30');
let page=await(await websiteAdmin('admin/users',{key:adminEnv.ADMIN_KEY})).json();assert.equal(page.users.length,100);assert.ok(page.next.beforeId);
const ids=new Set(page.users.map(u=>u.id));
page=await(await websiteAdmin('admin/users?'+new URLSearchParams(page.next),{key:adminEnv.ADMIN_KEY})).json();
for(const u of page.users){assert.equal(ids.has(u.id),false,'tied timestamps do not duplicate users');ids.add(u.id)}
assert.equal([...ids].filter(id=>id.startsWith('00000000-0000-4000-8000-')).length,101,'all tied records remain reachable');
console.log('PASS website admin: production key verification, no Google dependency, scoped privileges, block/unblock audit, CSRF and tied pagination');

// Upgrade a signed-in Guest in place; never merge an already-owned Google profile.
async function linkingCall(path,method='GET',data,guestToken,cookieValue) {
 return handleAppAccounts(new Request('https://example.com/api/app/'+path,{method,headers:{...(guestToken?{Authorization:'Bearer '+guestToken}:{}),...(cookieValue?{Cookie:cookieValue}:{}),'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})}),configured);
}
let linkSubject='new-linked-subject',linkNonce;
globalThis.fetch=async url=>{
 if(String(url)==='https://oauth2.googleapis.com/token')return Response.json({id_token:await token({nonce:linkNonce,email:'listener@example.com',name:'Google Name',sub:linkSubject})});
 if(String(url)==='https://www.googleapis.com/oauth2/v3/certs')return fetcher();
 throw Error('Unexpected external request');
};
try {
 const g=await(await call('auth/guest','POST',{noticeVersion:'2026-10-30'})).json();
 await call('me','PATCH',{name:'Keep my profile',username:'keep_my_profile',bio:'My bio'},g.token);
 await call('collections','PUT',collections,g.token);
 assert.equal((await linkingCall('auth/link/google','POST',{challenge})).status,401);
 assert.equal((await linkingCall('auth/link/google','POST',{challenge:'bad'},g.token)).status,400);
 async function startLink(account) {
  const r=await linkingCall('auth/link/google','POST',{challenge,user_id:'forged-target'},account.token);assert.equal(r.status,200);
  const address=new URL((await r.json()).url),path=address.pathname.replace('/api/app/','')+address.search;
  const browser=await linkingCall(path);assert.equal(browser.status,302);
  assert.equal((await linkingCall(path)).status,401,'link intent is one-use');
  const state=new URL(browser.headers.get('Location')).searchParams.get('state');
  linkNonce=sql.prepare('SELECT nonce FROM app_oauth WHERE state_hash=?').get(await digest(state)).nonce;
  return {state,cookie:browser.headers.get('Set-Cookie').split(';')[0]};
 }
 let flow=await startLink(g);
 const callback='auth/callback?state='+flow.state+'&code=verified-google-code';
 assert.equal((await linkingCall(callback,'GET',undefined,undefined,'__Host-dp-login=wrong')).status,401);
 const connected=await linkingCall(callback,'GET',undefined,undefined,flow.cookie);assert.equal(connected.status,302);
 const code=new URL(connected.headers.get('Location')).searchParams.get('code');
 assert.equal((await linkingCall('auth/claim','POST',{code,verifier:'x'.repeat(43)})).status,401);
 const claimed=await(await linkingCall('auth/claim','POST',{code,verifier})).json();
 assert.equal(claimed.user.id,g.user.id);assert.equal(claimed.user.provider,'google');assert.equal(claimed.user.name,'Keep my profile');assert.equal(claimed.user.username,'keep_my_profile');assert.equal(claimed.user.bio,'My bio');assert.deepEqual(claimed.user.collections,collections);
 assert.equal((await call('me','GET',undefined,g.token)).status,200,'existing guest session still refers to the same upgraded account');
 assert.equal((await linkingCall(callback,'GET',undefined,undefined,flow.cookie)).status,401,'link callback rejects replay');
 const second=await(await call('auth/guest','POST',{noticeVersion:'2026-10-30'})).json();
 flow=await startLink(second);
 assert.equal((await linkingCall('auth/callback?state='+flow.state+'&code=conflict','GET',undefined,undefined,flow.cookie)).status,409);
 assert.equal(sql.prepare('SELECT provider FROM app_accounts WHERE id=?').get(second.user.id).provider,'guest','Google account collision preserves Guest');
 flow=await startLink(second);linkSubject='blocked-link-subject';
 sql.prepare('UPDATE app_accounts SET blocked=1 WHERE id=?').run(second.user.id);
 assert.equal((await linkingCall('auth/callback?state='+flow.state+'&code=blocked','GET',undefined,undefined,flow.cookie)).status,409);
 assert.equal(sql.prepare('SELECT provider FROM app_accounts WHERE id=?').get(second.user.id).provider,'guest','blocked Guest cannot upgrade to escape block');
 const blockedStart=await linkingCall('auth/link/google','POST',{challenge},second.token);assert.equal(blockedStart.status,403);
 assert.equal((await linkingCall('auth/callback?state=link_missing&code=bad','GET',undefined,undefined,flow.cookie)).status,401);
} finally {globalThis.fetch=originalFetch}
console.log('PASS Guest-Google linking: authenticated one-use intent, browser binding, PKCE, same account and profile, collisions, blocked access and replay rejection');

// Expose only static, actionable OAuth error labels; provider text can contain secrets.
try {
 const spaced={...configured,DEEPLIST_GOOGLE_CLIENT_ID:' client\n',DEEPLIST_GOOGLE_CLIENT_SECRET:' test-client-secret '};
 for(const [index,reason] of ['invalid_client','invalid_grant','redirect_uri_mismatch','unauthorized_client','private-provider-error',null].entries()) {
  const state='diagnostic-'+index,browser='diagnostic-browser';
  await DB.prepare('INSERT INTO app_oauth(state_hash,browser_hash,nonce,challenge,expires) VALUES(?,?,?,?,?)').bind(await digest(state),await digest(browser),'nonce',challenge,Date.now()+60000).run();
  globalThis.fetch=async (url,options)=>{
   assert.equal(String(url),'https://oauth2.googleapis.com/token');
   assert.equal(options.body.get('client_id'),'client');assert.equal(options.body.get('client_secret'),'test-client-secret');
   return Response.json({error:reason,error_description:'private-secret-and-authorization-code'},{status:400});
  };
  const response=await handleAppAccounts(new Request('https://example.com/api/app/auth/callback?state='+state+'&code=private-code',{headers:{Cookie:'__Host-dp-login='+browser}}),spaced);
  assert.equal(response.status,502);const text=await response.text();
  assert.equal(text.includes('private'),false,'provider-supplied text and secrets stay private');
  if(index<4)assert.ok(text.includes(reason));else assert.ok(text.includes('token exchange failed'));
 }
 assert.equal((await(await handleAppAccounts(new Request('https://example.com/api/app/config'),{...env,DEEPLIST_GOOGLE_CLIENT_ID:' ',DEEPLIST_GOOGLE_CLIENT_SECRET:' '})).json()).googleConfigured,false);
} finally {globalThis.fetch=originalFetch}
console.log('PASS OAuth diagnostics: trimmed configuration, known error guidance and no upstream secret disclosure');
