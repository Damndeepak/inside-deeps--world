const ready = new WeakMap();
const cookieName = '__Host-deeplist';
const headers = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' };
const reply = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), {status, headers:{...headers,...extra}});
const uuid = value => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value || '');
const secret = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2,'0')).join('');
const label = (id,name) => name || 'Listener · '+id.slice(0,6);
export async function visitorSchema(db) {
 if(!ready.has(db))ready.set(db,db.prepare('CREATE TABLE IF NOT EXISTS deeplist_visitors (channel_id TEXT PRIMARY KEY, browser_hash TEXT UNIQUE NOT NULL, token_hash TEXT UNIQUE, payload TEXT, updated_at INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)').run().then(()=>db.prepare('CREATE INDEX IF NOT EXISTS deeplist_visitors_updated ON deeplist_visitors(updated_at)').run()).then(()=>db.prepare('CREATE TABLE IF NOT EXISTS deeplist_visitor_names (channel_id TEXT PRIMARY KEY, display_name TEXT NOT NULL)').run()).catch(e=>{ready.delete(db);throw e;}));
 await ready.get(db);
}
export function browserRequest(request, action) {
 const url=new URL(request.url), origin=request.headers.get('Origin'), site=request.headers.get('Sec-Fetch-Site');
 return request.headers.get('X-Deeplist-Action')===action && (!origin||origin===url.origin) && site!=='cross-site';
}
export async function currentVisitor(request, db, hash) {
 const raw=(request.headers.get('Cookie')||'').match(/(?:^|;\s*)__Host-deeplist=([a-f0-9]{64})(?:;|$)/)?.[1];
 if(!raw)return null;
 return db.prepare('SELECT v.channel_id, v.token_hash, n.display_name FROM deeplist_visitors v LEFT JOIN deeplist_visitor_names n ON n.channel_id=v.channel_id WHERE browser_hash=?').bind(await hash(raw)).first();
}
async function readState(request, validate) {
 if((Number(request.headers.get('Content-Length'))||0)>180000)return null;
 const reader=request.body?.getReader();if(!reader)return null;
 let size=0,text='';const decoder=new TextDecoder();
 while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>180000){await reader.cancel();return null;}text+=decoder.decode(value,{stream:true});}
 text+=decoder.decode();try{return validate(JSON.parse(text));}catch{return null;}
}
export async function handleVisitorDeeplist(request, env, {hash,validateState,publicState}) {
 const url=new URL(request.url),path=url.pathname,method=request.method,visitorScope=url.searchParams.get('scope')==='visitor';
 const addressed=url.searchParams.has('user');
 const relevant=path==='/api/deeplist/name'||path==='/api/deeplist/me'||path==='/api/deeplist/listeners'||(path==='/api/deeplist/pair'&&visitorScope)||(path==='/api/deeplist/state'&&(method==='POST'||addressed))||(addressed&&['/api/deeplist/history','/api/deeplist/on-repeat'].includes(path));
 if(!relevant)return null;
 await visitorSchema(env.DB);
 if(path==='/api/deeplist/name'&&method==='POST'){
  if(!browserRequest(request,'name'))return reply({error:'same_site_session_required'},403);
  const visitor=await currentVisitor(request,env.DB,hash);if(!visitor)return reply({error:'browser_session_required'},401);
  const data=await readState(request,x=>x&&typeof x.displayName==='string'?x:null);
  if(!data)return reply({error:'invalid_name'},400);
  const name=data.displayName.normalize('NFKC').replace(/[\p{Cc}\p{Cf}]/gu,'').replace(/\s+/gu,' ').trim();
  if(Array.from(name).length>32)return reply({error:'name_too_long'},400);
  await env.DB.prepare('INSERT INTO deeplist_visitor_names(channel_id,display_name) VALUES(?,?) ON CONFLICT(channel_id) DO UPDATE SET display_name=excluded.display_name').bind(visitor.channel_id,name).run();
  return reply({channel:visitor.channel_id,displayName:name,label:label(visitor.channel_id,name)});
 }
 if(path==='/api/deeplist/me'&&method==='GET') {
  if(!browserRequest(request,'session'))return reply({error:'same_site_session_required'},403);
  let visitor=await currentVisitor(request,env.DB,hash),extra={};
  if(!visitor){const key=secret(),id=crypto.randomUUID();await env.DB.prepare('INSERT INTO deeplist_visitors(channel_id,browser_hash,created_at) VALUES(?,?,?)').bind(id,await hash(key),Date.now()).run();visitor={channel_id:id,token_hash:null};extra['Set-Cookie']=`${cookieName}=${key}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Strict`;}
  return reply({channel:visitor.channel_id,displayName:visitor.display_name||'',label:label(visitor.channel_id,visitor.display_name),paired:!!visitor.token_hash,player:`/deeplist.html?user=${visitor.channel_id}`},200,extra);
 }
 if(path==='/api/deeplist/listeners'&&method==='GET') {
  const rows=await env.DB.prepare("SELECT channel_id, (SELECT display_name FROM deeplist_visitor_names n WHERE n.channel_id=deeplist_visitors.channel_id) AS display_name, json_extract(payload,'$.title') AS title, json_extract(payload,'$.artist') AS artist, json_extract(payload,'$.playing') AS playing FROM deeplist_visitors WHERE token_hash IS NOT NULL AND payload IS NOT NULL AND updated_at >= ? ORDER BY updated_at DESC,channel_id LIMIT 50").bind(Date.now()-15000).all();
  return reply({listeners:rows.results.map(r=>({channel:r.channel_id,label:label(r.channel_id,r.display_name),title:r.title,artist:r.artist,playing:!!r.playing,player:`/deeplist.html?user=${r.channel_id}`}))});
 }
 if(path==='/api/deeplist/pair'&&visitorScope&&['POST','DELETE'].includes(method)) {
  if(!browserRequest(request,'pair'))return reply({error:'same_site_session_required'},403);
  const visitor=await currentVisitor(request,env.DB,hash);if(!visitor)return reply({error:'browser_session_required'},401);
  if(method==='DELETE'){await env.DB.prepare('UPDATE deeplist_visitors SET token_hash=NULL,payload=NULL,updated_at=0 WHERE channel_id=?').bind(visitor.channel_id).run();return reply({success:true,channel:visitor.channel_id});}
  const token=secret();await env.DB.prepare('UPDATE deeplist_visitors SET token_hash=?,payload=NULL,updated_at=0 WHERE channel_id=?').bind(await hash(token),visitor.channel_id).run();
  return reply({token,website:url.origin,channel:visitor.channel_id,displayName:visitor.display_name||'',label:label(visitor.channel_id,visitor.display_name),player:`/deeplist.html?user=${visitor.channel_id}`});
 }
 if(path==='/api/deeplist/state'&&method==='POST') {
  const token=(request.headers.get('Authorization')||'').replace(/^Bearer /,'');if(!/^[a-f0-9]{64}$/.test(token))return null;
  const tokenHash=await hash(token);
  const row=await env.DB.prepare('SELECT channel_id,payload,updated_at FROM deeplist_visitors WHERE token_hash=?').bind(tokenHash).first();if(!row)return null;
  const state=await readState(request,validateState);if(!state)return reply({error:'invalid_state'},400);
  let old;try{old=JSON.parse(row.payload||'null');}catch{}
  if(state.lines===undefined){state.lines=old?.id===state.id?old.lines||[]:[];state.lyricsVersion=old?.id===state.id?old.lyricsVersion:undefined;}
  if(!state.lyricsVersion)state.lyricsVersion=state.id+':'+await hash(JSON.stringify(state.lines));
  const now=Date.now();const result=await env.DB.prepare('UPDATE deeplist_visitors SET payload=?,updated_at=? WHERE channel_id=? AND token_hash=?').bind(JSON.stringify(state),now,row.channel_id,tokenHash).run();
  return result.meta?.changes?reply({connected:true,serverNow:now}):reply({error:'pairing_required'},401);
 }
 if(addressed&&method==='GET') {
  const channel=url.searchParams.get('user');if(!uuid(channel))return reply({error:'invalid_channel'},400);
  if(path!=='/api/deeplist/state')return reply({error:'visitor_history_not_enabled'},404);
  const row=await env.DB.prepare('SELECT payload,updated_at,(SELECT display_name FROM deeplist_visitor_names n WHERE n.channel_id=deeplist_visitors.channel_id) AS display_name FROM deeplist_visitors WHERE channel_id=? AND token_hash IS NOT NULL').bind(channel).first();
  const now=Date.now();if(!row?.payload||now-row.updated_at>15000)return reply({connected:false,channel,label:label(channel,row?.display_name),serverNow:now});
  let state;try{state=JSON.parse(row.payload);}catch{return reply({connected:false,serverNow:now});}
  if(url.searchParams.get('lyricsVersion')===state.lyricsVersion)delete state.lines;
  return reply({connected:true,channel,label:label(channel,row?.display_name),state:publicState(state),receivedAt:row.updated_at,serverNow:now});
 }
 return reply({error:'method_not_allowed'},405);
}
