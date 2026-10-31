const OWNER = 'gandhideepak6376@gmail.com';
const POLICY = '2026-10-30';
const DAY = 86400000;
const schemas = new WeakMap();
const enc = new TextEncoder();
const random = () => [...crypto.getRandomValues(new Uint8Array(32))].map(x => x.toString(16).padStart(2,'0')).join('');
export const digest = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('');
const b64 = bytes => btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
const un64 = text => Uint8Array.from(atob(text.replaceAll('-','+').replaceAll('_','/')), c=>c.charCodeAt(0));
const cookie = (r,name) => (r.headers.get('Cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='))?.slice(name.length+1)||'';
const cookieHeader = (name,value,age) => `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${age}`;
const headers = {'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const reply = (data,status=200,extra={}) => Response.json(data,{status,headers:{...headers,...extra}});
const error = (message,status=400) => Object.assign(new Error(message),{status});
const clean = (v,max) => typeof v==='string'?v.replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,max):'';
export const location = request => ({city:clean(request.cf?.city,100)||null,country:/^[A-Z]{2}$/.test(request.cf?.country||'')?request.cf.country:null});
export const admin = user => user?.provider==='google' && user.google_email===OWNER && user.email_verified===1;
export const publicProfile = u => ({username:u.username,name:u.name,bio:u.bio,avatar:u.avatar,collections:JSON.parse(u.collections||'{"playlists":[],"favourites":[]}')});
const privateProfile = u => ({...publicProfile(u),id:u.id,provider:u.provider,admin:admin(u),blocked:!!u.blocked,noticeVersion:POLICY});
async function schema(db) {
 if(!schemas.has(db)) schemas.set(db,(async()=>{
  for(const sql of [
   `CREATE TABLE IF NOT EXISTS app_accounts(id TEXT PRIMARY KEY,provider TEXT NOT NULL,google_sub TEXT UNIQUE,google_email TEXT,email_verified INTEGER NOT NULL DEFAULT 0,username TEXT NOT NULL UNIQUE,name TEXT NOT NULL,bio TEXT NOT NULL DEFAULT '',avatar TEXT NOT NULL DEFAULT '',collections TEXT NOT NULL DEFAULT '{"playlists":[],"favourites":[]}',blocked INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,last_active INTEGER NOT NULL,city TEXT,country TEXT,app_version TEXT NOT NULL DEFAULT '',opens INTEGER NOT NULL DEFAULT 0,notice_version TEXT NOT NULL)`,
   'CREATE INDEX IF NOT EXISTS app_accounts_last_active ON app_accounts(last_active DESC,id)',
   'CREATE INDEX IF NOT EXISTS app_accounts_created ON app_accounts(created_at DESC,id)',
   'CREATE TABLE IF NOT EXISTS app_sessions(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires INTEGER NOT NULL)',
   'CREATE INDEX IF NOT EXISTS app_sessions_user ON app_sessions(user_id)',
   'CREATE TABLE IF NOT EXISTS app_oauth(state_hash TEXT PRIMARY KEY,browser_hash TEXT NOT NULL,nonce TEXT NOT NULL,challenge TEXT,expires INTEGER NOT NULL)',
   'CREATE TABLE IF NOT EXISTS app_account_links(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,challenge TEXT NOT NULL,expires INTEGER NOT NULL)',
   'CREATE TABLE IF NOT EXISTS app_handoffs(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,challenge TEXT NOT NULL,expires INTEGER NOT NULL)',
   'CREATE TABLE IF NOT EXISTS app_admin_audit(id TEXT PRIMARY KEY,actor TEXT NOT NULL,target TEXT NOT NULL,action TEXT NOT NULL,at INTEGER NOT NULL)',
   'CREATE TABLE IF NOT EXISTS app_rates(key TEXT PRIMARY KEY,n INTEGER NOT NULL,expires INTEGER NOT NULL)'
  ]) await db.prepare(sql).run();
 })().catch(e=>{schemas.delete(db);throw e}));
 return schemas.get(db);
}
async function readLimited(request, limit) {
 if(Number(request.headers.get('Content-Length')||0)>limit)throw error('Request too large',413);
 if(!request.body)return new Uint8Array();
 const reader=request.body.getReader(),chunks=[];let size=0;
 try {while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw error('Request too large',413)}chunks.push(value)}}finally{reader.releaseLock()}
 const result=new Uint8Array(size);let offset=0;for(const c of chunks){result.set(c,offset);offset+=c.length}return result;
}
async function body(request) {
 const bytes=await readLimited(request,32768);
 try{return JSON.parse(new TextDecoder().decode(bytes))}catch{throw error('Invalid JSON')}
}
async function rate(db,key,limit,window=60000) {
 const now=Date.now();
 const row=await db.prepare(`INSERT INTO app_rates(key,n,expires) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET n=CASE WHEN expires<=? THEN 1 ELSE n+1 END,expires=CASE WHEN expires<=? THEN excluded.expires ELSE expires END RETURNING n`).bind(key,now+window,now,now).first();
 if(row.n>limit)throw error('Please try again later',429);
}
async function userFor(request,db) {
 const raw=request.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1]||cookie(request,'__Host-dp-session');
 if(!/^[a-f0-9]{64}$/.test(raw))return null;
 return db.prepare('SELECT u.* FROM app_sessions s JOIN app_accounts u ON u.id=s.user_id WHERE s.hash=? AND s.expires>?').bind(await digest(raw),Date.now()).first();
}
async function session(db,id) {
 const token=random();await db.prepare('INSERT INTO app_sessions(hash,user_id,expires) VALUES(?,?,?)').bind(await digest(token),id,Date.now()+30*DAY).run();return token;
}
export function validCollections(value) {
 if(!value||!Array.isArray(value.playlists)||!Array.isArray(value.favourites)||value.playlists.length>30||value.favourites.length>100)throw error('Invalid collections');
 return Object.fromEntries(['playlists','favourites'].map(type=>[type,value[type].map(v=>{
  if(!v||typeof v.id!=='string'||!/^[A-Za-z0-9_-]{1,160}$/.test(v.id)||!clean(v.title,200))throw error('Invalid collection item');
  return {id:v.id,title:clean(v.title,200)};
 })]));
}
let jwks;
export async function verifyGoogle(token,clientId,nonce,fetcher=fetch) {
 const parts=token.split('.');if(parts.length!==3)throw error('Invalid Google identity',401);
 const head=JSON.parse(new TextDecoder().decode(un64(parts[0])));
 const claims=JSON.parse(new TextDecoder().decode(un64(parts[1])));
 if(head.alg!=='RS256'||typeof head.kid!=='string')throw error('Invalid Google identity',401);
 if(!jwks||jwks.until<Date.now()||!jwks.keys.some(k=>k.kid===head.kid)) {
  const r=await fetcher('https://www.googleapis.com/oauth2/v3/certs');if(!r.ok)throw error('Google verification unavailable',503);
  jwks={keys:(await r.json()).keys,until:Date.now()+3600000};
 }
 const jwk=jwks.keys.find(k=>k.kid===head.kid);if(!jwk)throw error('Invalid Google identity',401);
 const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
 if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,un64(parts[2]),enc.encode(parts[0]+'.'+parts[1]))||!['https://accounts.google.com','accounts.google.com'].includes(claims.iss)||claims.aud!==clientId||(claims.azp&&claims.azp!==clientId)||!Number.isFinite(claims.exp)||claims.exp*1000<=Date.now()||claims.nonce!==nonce||typeof claims.sub!=='string'||!claims.sub||claims.email_verified!==true)throw error('Invalid Google identity',401);
 return claims;
}
export async function handleAppAccounts(request,env,helpers={}) {
 const url=new URL(request.url),path=url.pathname;
 if(!path.startsWith('/api/app/'))return null;
 try {
  if(!['GET','HEAD'].includes(request.method)) {
   const origin=request.headers.get('Origin');
   if((origin&&origin!==url.origin)||request.headers.get('Sec-Fetch-Site')==='cross-site')throw error('Forbidden origin',403);
  }
  const clientId=String(env.DEEPLIST_GOOGLE_CLIENT_ID||'').trim(),clientSecret=String(env.DEEPLIST_GOOGLE_CLIENT_SECRET||'').trim();
  const configured=!!(clientId&&clientSecret);
  if(path==='/api/app/config'&&request.method==='GET')return reply({googleConfigured:configured,noticeVersion:POLICY});
  await schema(env.DB);const db=env.DB;
  if(path==='/api/app/auth/guest'&&request.method==='POST') {
   const data=await body(request);if(data.noticeVersion!==POLICY)throw error('Please read the current data notice');
   const ip=request.headers.get('CF-Connecting-IP')||'unknown';await rate(db,'guest:'+await digest(ip+Math.floor(Date.now()/DAY)),20,3600000);
   const id=crypto.randomUUID(),username='listener_'+random().slice(0,12),name='Listener '+username.slice(-6);
   const geo=location(request),now=Date.now();
   await db.prepare('INSERT INTO app_accounts(id,provider,username,name,created_at,last_active,city,country,notice_version,opens) VALUES(?,?,?,?,?,?,?,?,?,1)').bind(id,'guest',username,name,now,now,geo.city,geo.country,POLICY).run();
   await db.batch(['DELETE FROM app_account_links WHERE expires<?','DELETE FROM app_oauth WHERE expires<?','DELETE FROM app_handoffs WHERE expires<?','DELETE FROM app_sessions WHERE expires<?','DELETE FROM app_rates WHERE expires<?'].map(s=>db.prepare(s).bind(now)));
   return reply({token:await session(db,id),user:privateProfile(await db.prepare('SELECT * FROM app_accounts WHERE id=?').bind(id).first())},201);
  }
  if(path==='/api/app/auth/link/google'&&request.method==='POST') {
   if(!configured)throw error('Google sign-in is not configured yet. Your guest profile is safe.',503);
   const user=await userFor(request,db);if(!user)throw error('Sign in as Guest first',401);
   if(user.blocked)throw error('This account is blocked',403);
   if(user.provider!=='guest')throw error('Google is already connected',409);
   const data=await body(request);if(!/^[A-Za-z0-9_-]{43}$/.test(data.challenge||''))throw error('Invalid sign-in request');
   await rate(db,'link:'+user.id,5);
   const intent=random();
   await db.prepare('INSERT INTO app_account_links(hash,user_id,challenge,expires) VALUES(?,?,?,?)').bind('intent:'+await digest(intent),user.id,data.challenge,Date.now()+120000).run();
   return reply({url:url.origin+'/api/app/auth/google?link='+intent});
  }
  if(path==='/api/app/auth/google'&&request.method==='GET') {
   if(!configured)return reply({error:'Google sign-in is not configured yet. Continue as Guest for now.'},503);
   let challenge=url.searchParams.get('challenge');if(challenge&&!/^[A-Za-z0-9_-]{43}$/.test(challenge))throw error('Invalid sign-in request');
   await rate(db,'oauth:'+await digest(request.headers.get('CF-Connecting-IP')||'unknown'),15);
   const intent=url.searchParams.get('link');let linked=null;
   if(intent) {
    if(!/^[a-f0-9]{64}$/.test(intent))throw error('Invalid connection request');
    linked=await db.prepare('DELETE FROM app_account_links WHERE hash=? AND expires>? RETURNING user_id,challenge').bind('intent:'+await digest(intent),Date.now()).first();
    if(!linked)throw error('Connection expired. Please try again.',401);
    const guest=await db.prepare('SELECT provider,blocked FROM app_accounts WHERE id=?').bind(linked.user_id).first();
    if(!guest||guest.blocked||guest.provider!=='guest')throw error('Guest account is unavailable',409);
    challenge=linked.challenge;
   }
   const state=(linked?'link_':'')+random(),browser=random(),nonce=random();
   if(linked)await db.prepare('INSERT INTO app_account_links(hash,user_id,challenge,expires) VALUES(?,?,?,?)').bind('state:'+await digest(state),linked.user_id,challenge,Date.now()+600000).run();
   await db.prepare('INSERT INTO app_oauth(state_hash,browser_hash,nonce,challenge,expires) VALUES(?,?,?,?,?)').bind(await digest(state),await digest(browser),nonce,challenge,Date.now()+600000).run();
   const redirect=new URL('https://accounts.google.com/o/oauth2/v2/auth');
   for(const [k,v] of Object.entries({client_id:clientId,redirect_uri:url.origin+'/api/app/auth/callback',response_type:'code',scope:'openid email profile',state,nonce,prompt:'select_account'}))redirect.searchParams.set(k,v);
   return new Response(null,{status:302,headers:{...headers,Location:redirect.href,'Set-Cookie':cookieHeader('__Host-dp-login',browser,600)}});
  }
  if(path==='/api/app/auth/callback'&&request.method==='GET') {
   const state=url.searchParams.get('state')||'',code=url.searchParams.get('code')||'',browser=cookie(request,'__Host-dp-login');
   if(!configured||!state||!code||!browser)throw error('Sign-in expired. Please try again.',401);
   const flow=await db.prepare('DELETE FROM app_oauth WHERE state_hash=? AND browser_hash=? AND expires>? RETURNING *').bind(await digest(state),await digest(browser),Date.now()).first();
   if(!flow)throw error('Sign-in expired. Please try again.',401);
   const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({code,client_id:clientId,client_secret:clientSecret,redirect_uri:url.origin+'/api/app/auth/callback',grant_type:'authorization_code'})});
   if(!r.ok) {
    const failure=await r.json().catch(()=>({}));
    const messages={
     invalid_client:'Google rejected the Client ID/Secret pair (invalid_client). Copy both values directly from the same Google OAuth Web client into Cloudflare and deploy.',
     invalid_grant:'Google rejected the sign-in code (invalid_grant). Start a new sign-in from Deeplist. If it repeats, check the exact authorized redirect URI.',
     redirect_uri_mismatch:'Google redirect URI does not match (redirect_uri_mismatch). Set the authorized redirect URI to '+url.origin+'/api/app/auth/callback',
     unauthorized_client:'Google has not authorized this OAuth client (unauthorized_client). Check that this is an enabled Web application client.',
    };
    throw error(Object.hasOwn(messages,failure?.error)?messages[failure.error]:'Google token exchange failed. Please start a new sign-in and try again.',502);
   }
   const tokens=await r.json(),claims=await verifyGoogle(tokens.id_token,clientId,flow.nonce);
   const now=Date.now(),id=crypto.randomUUID(),username='listener_'+random().slice(0,12),geo=location(request);
   const email=clean(claims.email,254).toLowerCase();
   const avatar=typeof claims.picture==='string'&&/^https:\/\/lh[0-9]+\.googleusercontent\.com\//.test(claims.picture)?claims.picture.slice(0,1000):'';
   let u;
   if(state.startsWith('link_')) {
    const linked=await db.prepare('DELETE FROM app_account_links WHERE hash=? AND expires>? RETURNING user_id').bind('state:'+await digest(state),now).first();
    if(!linked)throw error('Connection expired. Please try again.',401);
    const existing=await db.prepare('SELECT id FROM app_accounts WHERE google_sub=?').bind(claims.sub).first();
    if(existing&&existing.id!==linked.user_id)throw error('This Google account already has a profile. Sign in separately; your guest profile was kept.',409);
    u=await db.prepare(`UPDATE app_accounts SET provider='google',google_sub=?,google_email=?,email_verified=1 WHERE id=? AND provider='guest' AND blocked=0 RETURNING *`).bind(claims.sub,email,linked.user_id).first();
    if(!u)throw error('Guest account is unavailable',409);
   } else {
   await db.prepare(`INSERT INTO app_accounts(id,provider,google_sub,google_email,email_verified,username,name,avatar,created_at,last_active,city,country,notice_version,opens) VALUES(?,'google',?,?,1,?,?,?,?,?,?,?,?,1) ON CONFLICT(google_sub) DO UPDATE SET google_email=excluded.google_email,email_verified=1`).bind(id,claims.sub,email,username,clean(claims.name,60)||'Listener',avatar,now,now,geo.city,geo.country,POLICY).run();
   u=await db.prepare('SELECT * FROM app_accounts WHERE google_sub=?').bind(claims.sub).first();
   }
   if(flow.challenge) {
    const handoff=random();await db.prepare('INSERT INTO app_handoffs(hash,user_id,challenge,expires) VALUES(?,?,?,?)').bind(await digest(handoff),u.id,flow.challenge,now+120000).run();
    // Only a one-use, PKCE-bound code goes through the Android URL handler.
    const responseHeaders=new Headers({...headers,Location:'deeplist://account?code='+handoff});
    responseHeaders.append('Set-Cookie',cookieHeader('__Host-dp-login','',0));
    responseHeaders.append('Set-Cookie',cookieHeader('__Host-dp-session',await session(db,u.id),30*86400));
    return new Response(null,{status:302,headers:responseHeaders});
   }
   const token=await session(db,u.id);
   return new Response(null,{status:302,headers:{...headers,Location:'/app-admin.html','Set-Cookie':cookieHeader('__Host-dp-session',token,30*86400)}});
  }
  if(path==='/api/app/auth/claim'&&request.method==='POST') {
   const data=await body(request);if(!/^[a-f0-9]{64}$/.test(data.code||'')||!/^[A-Za-z0-9_-]{43,128}$/.test(data.verifier||''))throw error('Invalid sign-in code');
   const challenge=b64(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(data.verifier))));
   const row=await db.prepare('DELETE FROM app_handoffs WHERE hash=? AND challenge=? AND expires>? RETURNING user_id').bind(await digest(data.code),challenge,Date.now()).first();
   if(!row)throw error('Sign-in expired. Please try again.',401);
   return reply({token:await session(db,row.user_id),user:privateProfile(await db.prepare('SELECT * FROM app_accounts WHERE id=?').bind(row.user_id).first())});
  }
  const publicMatch=path.match(/^\/api\/app\/profiles\/([a-z0-9_]{3,30})$/);
  if(publicMatch&&request.method==='GET') {
   const u=await db.prepare('SELECT username,name,bio,avatar,collections FROM app_accounts WHERE username=? AND blocked=0').bind(publicMatch[1]).first();
   if(!u)throw error('Profile not found',404);return reply({profile:publicProfile(u)});
  }
  const avatarMatch=path.match(/^\/api\/app\/avatars\/([a-f0-9-]{36})\/([a-f0-9]{16})$/);
  if(avatarMatch&&request.method==='GET') {
   const object=await env.CHAT_IMAGES.get('app-avatars/'+avatarMatch[1]+'/'+avatarMatch[2]);if(!object)throw error('Image not found',404);
   return new Response(object.body,{headers:{'Content-Type':object.httpMetadata?.contentType||'image/jpeg','X-Content-Type-Options':'nosniff','Cache-Control':'public,max-age=86400'}});
  }
  if(path.startsWith('/api/app/admin/')) {
   const websiteAdmin=typeof helpers.isWebsiteAdmin==='function' && await helpers.isWebsiteAdmin(request);
   const actor=websiteAdmin?{id:'website-admin'}:await userFor(request,db);
   if(!websiteAdmin) {
    if(!actor)throw error('Sign in with your website admin key or authorized Google account',401);
    if(actor.blocked||!admin(actor))throw error('Admin access required',403);
   }
   if(path==='/api/app/admin/status'&&request.method==='GET')return reply({authorized:true,method:websiteAdmin?'website':'google'});
   if(path==='/api/app/admin/users'&&request.method==='GET') {
    const before=Number(url.searchParams.get('before')||Date.now()+1),beforeId=url.searchParams.get('beforeId')||'';
    if(!Number.isSafeInteger(before)||(beforeId&&!/^[a-f0-9-]{36}$/.test(beforeId)))throw error('Invalid cursor');
    const rows=await db.prepare('SELECT id,provider,username,name,blocked,created_at,last_active,city,country,app_version,opens FROM app_accounts WHERE created_at<? OR(created_at=? AND id<?) ORDER BY created_at DESC,id DESC LIMIT 100').bind(before,before,beforeId).all();
    const last=rows.results.at(-1);
    return reply({users:rows.results,next:rows.results.length===100?{before:last.created_at,beforeId:last.id}:null});
   }
   if(path==='/api/app/admin/access'&&request.method==='POST') {
    const data=await body(request);if(typeof data.blocked!=='boolean'||typeof data.id!=='string')throw error('Invalid access change');
    const target=await db.prepare('SELECT * FROM app_accounts WHERE id=?').bind(data.id).first();if(!target)throw error('Account not found',404);if(admin(target))throw error('The owner cannot be blocked',409);
    await db.batch([db.prepare('UPDATE app_accounts SET blocked=? WHERE id=?').bind(data.blocked?1:0,data.id),db.prepare('INSERT INTO app_admin_audit(id,actor,target,action,at) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),actor.id,data.id,data.blocked?'block':'unblock',Date.now())]);return reply({ok:true});
   }
   if(path==='/api/app/admin/audit'&&request.method==='GET')return reply({events:(await db.prepare('SELECT id,actor,target,action,at FROM app_admin_audit ORDER BY at DESC LIMIT 100').all()).results});
   return reply({error:'Not found'},404);
  }
  const user=await userFor(request,db);if(!user)throw error('Sign in to continue',401);
  if(path==='/api/app/me'&&request.method==='GET')return reply({user:privateProfile(user)});
  if(path==='/api/app/session'&&request.method==='DELETE') {
   const token=request.headers.get('Authorization')?.slice(7)||cookie(request,'__Host-dp-session');
   await db.prepare('DELETE FROM app_sessions WHERE hash=?').bind(await digest(token)).run();return reply({ok:true},200,{'Set-Cookie':cookieHeader('__Host-dp-session','',0)});
  }
  if(path==='/api/app/me'&&request.method==='DELETE') {
   if(admin(user))throw error('Admin account deletion requires manual transfer of ownership',409);
   if(user.avatar.startsWith(url.origin+'/api/app/avatars/'+user.id+'/'))await env.CHAT_IMAGES.delete('app-avatars/'+user.id+'/'+user.avatar.split('/').at(-1));
   await db.batch([db.prepare('DELETE FROM app_sessions WHERE user_id=?').bind(user.id),db.prepare('DELETE FROM app_handoffs WHERE user_id=?').bind(user.id),db.prepare('DELETE FROM app_accounts WHERE id=?').bind(user.id)]);return reply({ok:true});
  }
  if(user.blocked)throw error('This account has been blocked by the app admin',403);
  if(path==='/api/app/me'&&request.method==='PATCH') {
   await rate(db,'profile:'+user.id,10);
   const data=await body(request),name=clean(data.name,60),username=clean(data.username,30).toLowerCase(),bio=clean(data.bio,160);
   if(!name||!/^[a-z0-9_]{3,30}$/.test(username))throw error('Use 3–30 letters, numbers or underscores for your username');
   if(await db.prepare('SELECT id FROM app_accounts WHERE username=? AND id<>?').bind(username,user.id).first())throw error('Username is already taken',409);
   await db.prepare('UPDATE app_accounts SET name=?,username=?,bio=? WHERE id=?').bind(name,username,bio,user.id).run();return reply({user:privateProfile({...user,name,username,bio})});
  }
  if(path==='/api/app/avatar'&&request.method==='POST') {
   await rate(db,'avatar:'+user.id,5);
   if(Number(request.headers.get('Content-Length')||0)>1048576)throw error('Photo must be under 1 MB',413);
   const bytes=await readLimited(request,1048576);if(bytes.length>1048576||bytes[0]!==0xff||bytes[1]!==0xd8||bytes[2]!==0xff)throw error('Use a JPEG photo under 1 MB');
   const key='app-avatars/'+user.id+'/'+random().slice(0,16);await env.CHAT_IMAGES.put(key,bytes,{httpMetadata:{contentType:'image/jpeg'}});
   const avatar=url.origin+'/api/app/avatars/'+key.slice('app-avatars/'.length);
   await db.prepare('UPDATE app_accounts SET avatar=? WHERE id=?').bind(avatar,user.id).run();
   if(user.avatar.startsWith(url.origin+'/api/app/avatars/'+user.id+'/'))await env.CHAT_IMAGES.delete('app-avatars/'+user.id+'/'+user.avatar.split('/').at(-1));return reply({user:privateProfile({...user,avatar})});
  }
  if(path==='/api/app/collections'&&request.method==='PUT') {
   await rate(db,'collections:'+user.id,10);
   const data=validCollections(await body(request));await db.prepare('UPDATE app_accounts SET collections=? WHERE id=?').bind(JSON.stringify(data),user.id).run();return reply({user:privateProfile({...user,collections:JSON.stringify(data)})});
  }
  if(path==='/api/app/heartbeat'&&request.method==='POST') {
   const data=await body(request),geo=location(request),now=Date.now();
   await db.prepare("UPDATE app_accounts SET last_active=?,city=?,country=?,app_version=?,opens=opens+CASE WHEN last_active<=? THEN ? ELSE 0 END WHERE id=? AND (last_active<=? OR app_version='')").bind(now,geo.city,geo.country,clean(data.version,40),now-300000,data.open===true?1:0,user.id,now-300000).run();return reply({user:privateProfile(user)});
  }
  return reply({error:'Not found'},404);
 }catch(e){return reply({error:e.status?e.message:'Service temporarily unavailable'},e.status||503)}
}
