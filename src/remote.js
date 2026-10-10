// Remote effects are isolated from chat, private sections, and media playback.
const schemas = new WeakMap();
async function ensureSchema(db) {
  if (!schemas.has(db)) {
    const ready = (async () => {
      await db.prepare(`CREATE TABLE IF NOT EXISTS remote_sessions (id TEXT PRIMARY KEY, host_hash TEXT NOT NULL, control_hash TEXT NOT NULL, source_hash TEXT NOT NULL, client TEXT, created INTEGER NOT NULL, expires INTEGER NOT NULL, host_seen INTEGER NOT NULL, control_seen INTEGER NOT NULL DEFAULT 0, last_command INTEGER NOT NULL DEFAULT 0)`).run();
      await db.prepare(`CREATE TABLE IF NOT EXISTS remote_events (seq INTEGER PRIMARY KEY AUTOINCREMENT, session TEXT NOT NULL, command TEXT NOT NULL, payload TEXT NOT NULL, created INTEGER NOT NULL)`).run();
      await db.prepare("CREATE INDEX IF NOT EXISTS remote_event_session ON remote_events(session,seq)").run();
    })().catch(e => { schemas.delete(db); throw e; });
    schemas.set(db, ready);
  }
  await schemas.get(db);
}
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const reply = (data, status=200) => Response.json(data, { status, headers });
const hash = async text => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), b=>b.toString(16).padStart(2,'0')).join('');
const token = () => crypto.randomUUID().replaceAll('-','') + crypto.randomUUID().replaceAll('-','');
async function bodyOf(request) {
  if (!request.headers.get('Content-Type')?.includes('application/json')) throw Error('Use JSON');
  const reader=request.body?.getReader(); if(!reader) throw Error('Missing body');
  const chunks=[];let length=0;
  try { while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>2048){await reader.cancel();throw Error('Request too large')}chunks.push(value)} }
  finally { reader.releaseLock(); }
  const all=new Uint8Array(length);let offset=0;for(const part of chunks){all.set(part,offset);offset+=part.length}
  return JSON.parse(new TextDecoder().decode(all));
}
export async function handleRemote(request, env) {
  const url=new URL(request.url);
  if(!url.pathname.startsWith('/api/remote/')) return null;
  const mutating=request.method!=='GET';
  if ((mutating && request.headers.get('Origin')!==url.origin) || request.headers.get('Sec-Fetch-Site')==='cross-site') return reply({error:'Same-origin requests only'},403);
  if(!env.DB) return reply({error:'Remote mode is unavailable'},503);
  try {
    await ensureSchema(env.DB);
    const now=Date.now();
    if(url.pathname==='/api/remote/create' && request.method==='POST') {
      await env.DB.batch([env.DB.prepare('DELETE FROM remote_events WHERE session IN (SELECT id FROM remote_sessions WHERE expires < ?)').bind(now),env.DB.prepare('DELETE FROM remote_sessions WHERE expires < ?').bind(now)]);
      const source=await hash(request.headers.get('CF-Connecting-IP')||'local');
      const count=await env.DB.prepare('SELECT COUNT(*) AS n FROM remote_sessions WHERE source_hash = ?').bind(source).first();
      if(Number(count?.n)>=3) return reply({error:'Close an existing remote session first'},429);
      const id=crypto.randomUUID(),host=token(),control=token(),expires=now+15*60*1000;
      await env.DB.prepare('INSERT INTO remote_sessions (id,host_hash,control_hash,source_hash,created,expires,host_seen) VALUES (?,?,?,?,?,?,?)').bind(id,await hash(host),await hash(control),source,now,expires,now).run();
      return reply({id,host,control,expires});
    }
    const match=url.pathname.match(/^\/api\/remote\/([0-9a-f-]{36})\/(state|join|command|stop)$/);
    if(!match) return reply({error:'Not found'},404);
    const [,id,action]=match;
    const raw=(request.headers.get('Authorization')||'').replace(/^Bearer /,'');
    if(!/^[a-f0-9]{64}$/.test(raw)) return reply({error:'Invalid pairing token'},403);
    const session=await env.DB.prepare('SELECT * FROM remote_sessions WHERE id = ?').bind(id).first();
    if(!session||session.expires<=now) return reply({error:'Session ended. Pair again.'},410);
    const digest=await hash(raw),host=digest===session.host_hash,controller=digest===session.control_hash;
    if(!host&&!controller) return reply({error:'Invalid pairing token'},403);
    const client=request.headers.get('X-Remote-Client')||'';
    if(controller&&action!=='join'&&client!==session.client) return reply({error:'Pair this phone first'},403);
    if(action==='join' && request.method==='POST' && controller) {
      if(!/^[0-9a-f-]{36}$/.test(client)) return reply({error:'Invalid device'},400);
      const result=await env.DB.prepare('UPDATE remote_sessions SET client = ?, control_seen = ? WHERE id = ? AND (client IS NULL OR client = ?) AND expires > ?').bind(client,now,id,client,now).run();
      if(!result.meta.changes) return reply({error:'Another phone is paired. Start a new session on the screen.'},409);
      return reply({success:true,expires:session.expires});
    }
    if(action==='state' && request.method==='GET') {
      const column=host?'host_seen':'control_seen';
      if(now-session[column]>5000) await env.DB.prepare(`UPDATE remote_sessions SET ${column} = ? WHERE id = ?`).bind(now,id).run();
      const after=Number(url.searchParams.get('after')||0);
      if(!Number.isSafeInteger(after)||after<0) return reply({error:'Invalid cursor'},400);
      const events=host?await env.DB.prepare('SELECT seq,command,payload,created FROM remote_events WHERE session = ? AND seq > ? ORDER BY seq LIMIT 64').bind(id,after).all():{results:[]};
      return reply({success:true,expires:session.expires,connected:!!session.client&&now-session.control_seen<20000,screen_active:now-session.host_seen<20000,events:events.results.map(e=>({...e,payload:JSON.parse(e.payload)}))});
    }
    if(action==='stop' && request.method==='POST' && host) {
      await env.DB.batch([env.DB.prepare('DELETE FROM remote_events WHERE session = ?').bind(id),env.DB.prepare('DELETE FROM remote_sessions WHERE id = ?').bind(id)]);
      return reply({success:true});
    }
    if(action==='command' && request.method==='POST' && controller) {
      const body=await bodyOf(request);let payload={};
      if(['point','tilt'].includes(body.command)) {
        if(!Number.isFinite(body.x)||!Number.isFinite(body.y)||Math.abs(body.x)>1||Math.abs(body.y)>1) return reply({error:'Invalid position'},400);
        payload={x:body.x,y:body.y};
      } else if(body.command==='beat') {
        if(!Number.isInteger(body.pad)||body.pad<0||body.pad>3) return reply({error:'Invalid pad'},400);
        payload={pad:body.pad};
      } else if(body.command==='react') {
        if(!Number.isInteger(body.emoji)||body.emoji<0||body.emoji>5) return reply({error:'Invalid emoji'},400);
        payload={emoji:body.emoji};
      } else if(!['gravity','blackhole','reset'].includes(body.command)) return reply({error:'Unknown control'},400);
      // Atomic cooldown prevents overlapping requests bypassing the rate limit.
      const accepted=await env.DB.prepare('UPDATE remote_sessions SET last_command = ?, control_seen = ? WHERE id = ? AND last_command <= ? AND expires > ?').bind(now,now,id,now-250,now).run();
      if(!accepted.meta.changes) return reply({error:'Slow down'},429);
      await env.DB.prepare('INSERT INTO remote_events (session,command,payload,created) VALUES (?,?,?,?)').bind(id,body.command,JSON.stringify(payload),now).run();
      await env.DB.prepare('DELETE FROM remote_events WHERE session = ? AND seq < (SELECT COALESCE(MAX(seq),0)-64 FROM remote_events WHERE session = ?)').bind(id,id).run();
      return reply({success:true});
    }
    return reply({error:'Not allowed'},405);
  } catch { return reply({error:'Could not connect. Please try again.'},400); }
}
