import { browserRequest, currentVisitor, visitorSchema } from './deeplist-visitors.js';
const ready = new WeakMap();
const reply = (data, status=200) => Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
const secret = () => Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
async function schema(db) {
 if(!ready.has(db)) ready.set(db,Promise.all([
  db.prepare('CREATE TABLE IF NOT EXISTS deeplist_handoffs (code_hash TEXT PRIMARY KEY, token TEXT NOT NULL, expires INTEGER NOT NULL)').run(),
  db.prepare('CREATE TABLE IF NOT EXISTS deeplist_commands (token_hash TEXT PRIMARY KEY, command_id TEXT NOT NULL, payload TEXT NOT NULL, expires INTEGER NOT NULL)').run()
 ]).catch(e=>{ready.delete(db);throw e;}));
 await ready.get(db);
}
export function validateCommand(data) {
 if(!data||!['play','pause','seek'].includes(data.action)||!/^[A-Za-z0-9_-]{11}$/.test(data.trackId))return null;
 if(data.action==='seek'&&(!Number.isFinite(data.position)||data.position<0||data.position>86400000))return null;
 return {action:data.action,trackId:data.trackId,...(data.action==='seek'?{position:Math.round(data.position)}:{})};
}
async function json(request){if(Number(request.headers.get('Content-Length'))>2048)return null;const reader=request.body?.getReader();if(!reader)return null;let chunks='',size=0;const decoder=new TextDecoder();while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>2048){await reader.cancel();return null;}chunks+=decoder.decode(value,{stream:true});}try{return JSON.parse(chunks+decoder.decode());}catch{return null;}}
export async function handleConnect(request,env,isAdmin,hash) {
 const url=new URL(request.url),path=url.pathname;
 if(!['/api/deeplist/handoff','/api/deeplist/claim','/api/deeplist/control','/api/deeplist/control-access'].includes(path))return null;
 await schema(env.DB);await visitorSchema(env.DB);
 const now=Date.now();
 if(path==='/api/deeplist/claim'&&request.method==='POST'){
  const data=await json(request);if(!/^[a-f0-9]{64}$/.test(data?.code||''))return reply({error:'invalid_link'},400);
  // DELETE RETURNING consumes the handoff atomically; two apps cannot redeem it.
  const grant=await env.DB.prepare('DELETE FROM deeplist_handoffs WHERE code_hash=? RETURNING token,expires').bind(await hash(data.code)).first();
  if(!grant||grant.expires<now)return reply({error:'expired_link'},410);
  const tokenHash=await hash(grant.token);
  const active=await env.DB.prepare('SELECT token_hash FROM deeplist_bridge WHERE id=1 AND token_hash=? UNION ALL SELECT token_hash FROM deeplist_visitors WHERE token_hash=?').bind(tokenHash,tokenHash).first();
  return active?reply({token:grant.token,website:url.origin}):reply({error:'revoked_link'},410);
 }
 const bearer=(request.headers.get('Authorization')||'').replace(/^Bearer /,'');
 if(path==='/api/deeplist/control'&&request.method==='GET'){
  if(!/^[a-f0-9]{64}$/.test(bearer))return reply({error:'unauthorized'},401);
  const tokenHash=await hash(bearer);
  const active=await env.DB.prepare('SELECT token_hash FROM deeplist_bridge WHERE id=1 AND token_hash=? UNION ALL SELECT token_hash FROM deeplist_visitors WHERE token_hash=?').bind(tokenHash,tokenHash).first();
  if(!active)return reply({error:'unauthorized'},401);
  const ack=url.searchParams.get('ack');if(ack)await env.DB.prepare('DELETE FROM deeplist_commands WHERE token_hash=? AND command_id=?').bind(tokenHash,ack).run();
  const row=await env.DB.prepare('SELECT command_id,payload FROM deeplist_commands WHERE token_hash=? AND expires>?').bind(tokenHash,now).first();
  return reply({command:row?{id:row.command_id,...JSON.parse(row.payload)}:null});
 }
 if(!browserRequest(request,'control'))return reply({error:'same_site_required'},403);
 const channel=url.searchParams.get('user');
 const me=await currentVisitor(request,env.DB,hash);
 const allowed=channel?me?.channel_id===channel:await isAdmin(request);
 if(path==='/api/deeplist/control-access'&&request.method==='GET')return reply({canControl:!!allowed});
 if(!allowed)return reply({error:'owner_required'},403);
 const row=channel?await env.DB.prepare('SELECT token_hash,payload,updated_at FROM deeplist_visitors WHERE channel_id=?').bind(channel).first():await env.DB.prepare('SELECT token_hash,payload,updated_at FROM deeplist_bridge WHERE id=1').first();
 if(!row?.token_hash)return reply({error:'not_paired'},409);
 if(path==='/api/deeplist/handoff'&&request.method==='POST'){
  const data=await json(request);if(!/^[a-f0-9]{64}$/.test(data?.token||'')||await hash(data.token)!==row.token_hash)return reply({error:'invalid_pairing'},403);
  const code=secret();await env.DB.prepare('DELETE FROM deeplist_handoffs WHERE expires<?').bind(now).run();
  await env.DB.prepare('INSERT INTO deeplist_handoffs(code_hash,token,expires) VALUES(?,?,?)').bind(await hash(code),data.token,now+120000).run();
  return reply({link:`deeplist://connect?website=${encodeURIComponent(url.origin)}&code=${code}`});
 }
 if(path==='/api/deeplist/control'&&request.method==='POST'){
  const command=validateCommand(await json(request));if(!command)return reply({error:'invalid_command'},400);
  let state;try{state=JSON.parse(row.payload);}catch{}
  if(!state||state.id!==command.trackId||now-row.updated_at>15000)return reply({error:'stale_track'},409);
  const id=crypto.randomUUID();await env.DB.prepare('INSERT INTO deeplist_commands(token_hash,command_id,payload,expires) VALUES(?,?,?,?) ON CONFLICT(token_hash) DO UPDATE SET command_id=excluded.command_id,payload=excluded.payload,expires=excluded.expires').bind(row.token_hash,id,JSON.stringify(command),now+15000).run();
  return reply({queued:true,id});
 }
 return reply({error:'method_not_allowed'},405);
}
