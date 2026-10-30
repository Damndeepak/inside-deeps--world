import {recordAudit} from './activity.js';
// Additive community features. Existing messages and conversations are preserved.
const ready = new WeakMap();
export async function ensureFeatures(db) {
  if (!ready.has(db)) ready.set(db, db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS message_reactions (message_id TEXT NOT NULL, user_id TEXT NOT NULL, emoji TEXT NOT NULL, PRIMARY KEY(message_id,user_id,emoji))'),
    db.prepare('CREATE TABLE IF NOT EXISTS chat_presence (user_id TEXT PRIMARY KEY, seen_at INTEGER NOT NULL, typing_until INTEGER NOT NULL DEFAULT 0)'),
    db.prepare('CREATE TABLE IF NOT EXISTS message_audio (message_id TEXT PRIMARY KEY, r2_key TEXT NOT NULL, content_type TEXT NOT NULL, size INTEGER NOT NULL, created_at TEXT NOT NULL)'),
    db.prepare('CREATE TABLE IF NOT EXISTS memory_visits (user_id TEXT PRIMARY KEY, first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_memory_visits_seen ON memory_visits(last_seen_at)'),
    db.prepare('CREATE TABLE IF NOT EXISTS memory_wall (id TEXT PRIMARY KEY, caption TEXT NOT NULL, memory_date TEXT NOT NULL, r2_key TEXT NOT NULL, content_type TEXT NOT NULL, created_at TEXT NOT NULL)'),
    db.prepare('CREATE TABLE IF NOT EXISTS public_thoughts (id TEXT PRIMARY KEY, body TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)'),
    db.prepare('CREATE TABLE IF NOT EXISTS feature_limits (k TEXT PRIMARY KEY, started INTEGER NOT NULL, n INTEGER NOT NULL)')
  ]).catch(e => { ready.delete(db); throw e; }));
  await ready.get(db);
}
const headers = { 'Cache-Control': 'no-store' };
const json = (data, status=200) => Response.json(data, {status, headers});
const fail = (error,status=400) => json({success:false,error},status);
const validId = id => /^[A-Za-z0-9_-]{1,64}$/.test(id || '');
const emojis = ['😡','😂','🥺','😒'];
const legacyEmojis = ['❤️','🔥','👍'];
const text = (v,max) => typeof v === 'string' ? v.trim().slice(0,max) : '';
const image = track => (track.image || []).find(i => i.size === 'extralarge')?.['#text'] || '';
async function limit(db,k,max,ms) {
  const now=Date.now();
  const row=await db.prepare(`INSERT INTO feature_limits(k,started,n) VALUES(?,?,1)
    ON CONFLICT(k) DO UPDATE SET n=CASE WHEN started <= ? THEN 1 ELSE n+1 END,
    started=CASE WHEN started <= ? THEN excluded.started ELSE started END RETURNING n`)
    .bind(k,now,now-ms,now-ms).first();
  return row.n <= max;
}
async function smallJson(request) {
  const raw=await request.text();
  if(raw.length>12000)throw new Error('Request too large');
  return JSON.parse(raw);
}
function audioType(bytes) {
  if(bytes.length<12)return null;
  if(bytes[0]===0x1a&&bytes[1]===0x45&&bytes[2]===0xdf&&bytes[3]===0xa3)return 'audio/webm';
  if(String.fromCharCode(...bytes.slice(4,8))==='ftyp')return 'audio/mp4';
  if(String.fromCharCode(...bytes.slice(0,4))==='OggS')return 'audio/ogg';
  return null;
}
async function mediaResponse(request,bucket,key,type) {
  // Range reads make seeking work for Safari's audio player as well.
  const range=request.headers.get('Range');
  const object=await bucket.get(key,range?{range:request.headers}:undefined);
  if(!object)return new Response('Not found',{status:404});
  const h=new Headers({'Content-Type':type,'Cache-Control':'public, max-age=3600','X-Content-Type-Options':'nosniff','Accept-Ranges':'bytes'});
  let status=200;
  if(object.range){const {offset,length}=object.range;h.set('Content-Range',`bytes ${offset}-${offset+length-1}/${object.size}`);h.set('Content-Length',String(length));status=206;}
  return new Response(object.body,{status,headers:h});
}
export async function handleFeatures(request,env,ctx,helpers) {
  const url=new URL(request.url), path=url.pathname, method=request.method;
  const known=/^\/api\/thoughts(?:\/[A-Za-z0-9_-]{1,64})?$/.test(path)||path==='/api/lastfm/history'||path==='/api/lastfm/on-repeat'||path==='/api/chat/presence'||path==='/api/chat/admin/presence'||path==='/api/chat/reactions'||path==='/api/chat/voice'||/^\/api\/chat\/audio\/[A-Za-z0-9_-]+$/.test(path)||/^\/api\/memories(?:\/[A-Za-z0-9_-]+(?:\/image)?)?$/.test(path);
  if(!known)return null;
  const {getUser,getUserId,chatIsAdmin,ensureChatSchema,notifyChat,chatSniffImage}=helpers;
  let storedKey=null;
  try {
    if(!['GET','POST','DELETE'].includes(method)&&!(method==='PATCH'&&(/^\/api\/thoughts\/[A-Za-z0-9_-]{1,64}$/.test(path)||/^\/api\/memories\/[A-Za-z0-9_-]+$/.test(path))))return fail('Method not allowed',405);
    if(method!=='GET'){
      const origin=request.headers.get('Origin');
      if(origin&&origin!==url.origin)return fail('Cross-site request rejected',403);
      if(Number(request.headers.get('Content-Length')||0)>9*1024*1024)return fail('Upload exceeds 8 MB',413);
    }
    if(path==='/api/lastfm/history'||path==='/api/lastfm/on-repeat'){
      if(method!=='GET')return fail('Method not allowed',405);
      if(!env.LASTFM_API_KEY||!env.LASTFM_USERNAME)return json({success:true,configured:false,tracks:[]});
      const repeat=path.endsWith('on-repeat');
      const api=new URL('https://ws.audioscrobbler.com/2.0/');
      Object.entries({method:repeat?'user.gettoptracks':'user.getrecenttracks',user:env.LASTFM_USERNAME,api_key:env.LASTFM_API_KEY,format:'json',limit:repeat?'15':'11',...(repeat?{period:'7day'}:{})}).forEach(([k,v])=>api.searchParams.set(k,v));
      const res=await fetch(api,{cf:{cacheTtl:repeat?300:30,cacheEverything:true}});
      const data=await res.json();
      if(!res.ok||data.error)return fail('Last.fm is unavailable right now',502);
      const raw=repeat?data.toptracks?.track:data.recenttracks?.track;
      const rows=Array.isArray(raw)?raw:raw?[raw]:[];
      const tracks=rows.filter(t=>repeat||t['@attr']?.nowplaying!=='true').slice(0,repeat?15:10).map(t=>({name:t.name||'Unknown track',artist:t.artist?.name||t.artist?.['#text']||'',image:image(t),url:t.url||'',played_at:Number(t.date?.uts||0)||null,plays:repeat?Number(t.playcount||0):null}));
      return json({success:true,configured:true,username:env.LASTFM_USERNAME,period:repeat?'7day':null,tracks});
    }
    if(path==='/api/chat/admin/presence'){
      if(method!=='GET')return fail('Method not allowed',405);
      if(!await chatIsAdmin(request))return fail('Admin access required',403);
      await ensureFeatures(env.DB);
      const now=Date.now();
      const rows=await env.DB.prepare('SELECT u.username,p.seen_at FROM chat_presence p JOIN users u ON u.id=p.user_id WHERE p.seen_at>? ORDER BY p.seen_at DESC').bind(now-60000).all();
      return json({success:true,window_seconds:60,online:rows.results.map(r=>({username:r.username,last_seen_at:new Date(r.seen_at).toISOString()}))});
    }
    await ensureFeatures(env.DB);
    if(path==='/api/thoughts'||path.startsWith('/api/thoughts/')){
      const id=path.split('/')[3];
      if(method==='GET'&&!id){
        const rows=await env.DB.prepare('SELECT id,body,created_at,updated_at FROM public_thoughts ORDER BY created_at DESC,id DESC LIMIT 100').all();
        return json({success:true,thoughts:rows.results});
      }
      if(!((method==='POST'&&!id)||(['PATCH','DELETE'].includes(method)&&id)))return fail('Method not allowed',405);
      if(!await chatIsAdmin(request))return fail('Admin access required',403);
      if(method==='DELETE'){
        const result=await env.DB.prepare('DELETE FROM public_thoughts WHERE id=?').bind(id).run();
        return result.meta?.changes?json({success:true}):fail('Thought not found',404);
      }
      const data=await smallJson(request);
      if(!data||typeof data.body!=='string'||!data.body.trim()||data.body.trim().length>2000)return fail('Write a thought between 1 and 2000 characters');
      const body=data.body.trim(),now=new Date().toISOString();
      if(method==='POST'){
        const newId=crypto.randomUUID();
        await env.DB.prepare('INSERT INTO public_thoughts(id,body,created_at,updated_at) VALUES(?,?,?,?)').bind(newId,body,now,now).run();
        return json({success:true,id:newId},201);
      }
      const result=await env.DB.prepare('UPDATE public_thoughts SET body=?,updated_at=? WHERE id=?').bind(body,now,id).run();
      return result.meta?.changes?json({success:true}):fail('Thought not found',404);
    }
    const userId=getUserId(request);
    const user=method!=='GET'?await getUser(userId):null;
    if(path==='/api/chat/presence'){
      if(method==='POST'){
        if(!user)return fail('Reload to get a chat identity',401);
        const body=await smallJson(request), now=Date.now();
        if(!await limit(env.DB,'presence:'+user.id,90,60000))return fail('Too many updates',429);
        if(body.active===false)await env.DB.prepare('DELETE FROM chat_presence WHERE user_id=?').bind(user.id).run();
        else await env.DB.prepare('INSERT INTO chat_presence(user_id,seen_at,typing_until) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET seen_at=excluded.seen_at,typing_until=excluded.typing_until').bind(user.id,now,body.typing===true?now+8000:0).run();
        await env.DB.prepare('DELETE FROM chat_presence WHERE seen_at < ?').bind(now-120000).run();
      }else if(method!=='GET')return fail('Method not allowed',405);
      const now=Date.now();
      const count=await env.DB.prepare('SELECT COUNT(*) AS n FROM chat_presence WHERE seen_at > ?').bind(now-60000).first();
      const rows=await env.DB.prepare('SELECT u.username FROM chat_presence p JOIN users u ON u.id=p.user_id WHERE p.seen_at>? AND p.typing_until>? AND p.user_id!=? LIMIT 3').bind(now-60000,now,userId||'').all();
      return json({success:true,online:Number(count.n),typing:rows.results.map(r=>r.username)});
    }
    if(path==='/api/chat/reactions'){
      if(method==='GET'){
        const ids=[...new Set((url.searchParams.get('ids')||'').split(',').filter(validId))].slice(0,100);
        if(!ids.length)return json({success:true,reactions:{}});
        const reactions={};
        // D1 allows 100 bound parameters: reserve one for the current user.
        // Preserve all 100 requested IDs instead of silently dropping the last one.
        for(let offset=0;offset<ids.length;offset+=99){
          const chunk=ids.slice(offset,offset+99);
          const rows=await env.DB.prepare(`SELECT message_id,emoji,COUNT(*) AS n,MAX(CASE WHEN user_id=? THEN 1 ELSE 0 END) AS mine FROM message_reactions WHERE message_id IN (${chunk.map(()=>'?').join(',')}) GROUP BY message_id,emoji`).bind(userId||'',...chunk).all();
          for(const r of rows.results)(reactions[r.message_id]??=[]).push({emoji:r.emoji,count:Number(r.n),mine:!!r.mine});
        }
        return json({success:true,reactions});
      }
      if(method!=='POST')return fail('Method not allowed',405);
      if(!user)return fail('Reload to get a chat identity',401);
      const body=await smallJson(request);
      if(!validId(body.message_id)||!(emojis.includes(body.emoji)||(body.active===false&&legacyEmojis.includes(body.emoji)))||typeof body.active!=='boolean')return fail('Invalid reaction');
      if(!await limit(env.DB,'reaction:'+user.id,90,60000))return fail('Slow down a little',429);
      if(!await env.DB.prepare('SELECT id FROM messages WHERE id=?').bind(body.message_id).first())return fail('Message no longer exists',404);
      const changed=body.active?await env.DB.prepare('INSERT OR IGNORE INTO message_reactions(message_id,user_id,emoji) VALUES(?,?,?)').bind(body.message_id,user.id,body.emoji).run():await env.DB.prepare('DELETE FROM message_reactions WHERE message_id=? AND user_id=? AND emoji=?').bind(body.message_id,user.id,body.emoji).run();
      if(changed.meta.changes)await recordAudit(env.DB,user,body.active?'reaction_added':'reaction_removed',body.message_id,{emoji:body.emoji});
      return json({success:true});
    }
    if(path==='/api/chat/voice'){
      if(method!=='POST')return fail('Method not allowed',405);
      if(!user)return fail('Reload to get a chat identity',401);
      if(!env.CHAT_IMAGES)return fail('Media storage is unavailable',503);
      await ensureChatSchema();
      if(!await limit(env.DB,'voice:'+user.id,10,3600000))return fail('Voice-note limit reached; try later',429);
      const recent=await env.DB.prepare('SELECT COUNT(*) AS n FROM messages WHERE sender_id=? AND created_at>?').bind(user.id,new Date(Date.now()-300000).toISOString()).first();
      if(recent.n>=20)return fail('Slow down a little',429);
      const form=await request.formData(),file=form.get('audio');
      if(!file||typeof file.arrayBuffer!=='function'||!file.size||file.size>8*1024*1024)return fail('Choose a recording under 8 MB',413);
      const bytes=new Uint8Array(await file.arrayBuffer()),type=audioType(bytes);
      if(!type)return fail('Unsupported recording format',415);
      const message=text(form.get('message'),1000),parentId=text(form.get('parent_id'),64)||null;
      if(parentId&&!await env.DB.prepare('SELECT id FROM messages WHERE id=?').bind(parentId).first())return fail('Reply target no longer exists');
      let main=await env.DB.prepare('SELECT id FROM conversations ORDER BY created_at ASC LIMIT 1').first();
      if(!main){main={id:crypto.randomUUID()};await env.DB.prepare('INSERT INTO conversations(id,user_id,created_at) VALUES(?,?,?)').bind(main.id,user.id,new Date().toISOString()).run();}
      const id=crypto.randomUUID(),now=new Date().toISOString();storedKey='voice/'+id;
      await env.CHAT_IMAGES.put(storedKey,bytes,{httpMetadata:{contentType:type}});
      await env.DB.batch([
        env.DB.prepare('INSERT INTO messages(id,conversation_id,sender_id,message,parent_id,created_at) VALUES(?,?,?,?,?,?)').bind(id,main.id,user.id,message,parentId,now),
        env.DB.prepare('INSERT INTO message_audio(message_id,r2_key,content_type,size,created_at) VALUES(?,?,?,?,?)').bind(id,storedKey,type,bytes.length,now)
      ]);
      storedKey=null;
      if(ctx?.waitUntil)ctx.waitUntil(notifyChat(user.id));
      await recordAudit(env.DB,user,'message_sent',id,{type:'voice'});
      return json({success:true,message_id:id,created_at:now});
    }
    const audio=path.match(/^\/api\/chat\/audio\/([A-Za-z0-9_-]+)$/);
    if(audio){
      if(method!=='GET')return fail('Method not allowed',405);
      const row=await env.DB.prepare('SELECT a.r2_key,a.content_type FROM message_audio a JOIN messages m ON m.id=a.message_id WHERE a.message_id=?').bind(audio[1]).first();
      if(!row||!env.CHAT_IMAGES)return fail('Recording not found',404);
      return await mediaResponse(request,env.CHAT_IMAGES,row.r2_key,row.content_type);
    }
    if(path==='/api/memories/visits'){
      if(method==='GET'){
        if(!await chatIsAdmin(request))return fail('Admin access required',403);
        const rows=await env.DB.prepare('SELECT u.username,v.first_seen_at,v.last_seen_at FROM memory_visits v JOIN users u ON u.id=v.user_id ORDER BY v.last_seen_at DESC LIMIT 500').all();
        return json({success:true,visitors:rows.results});
      }
      if(method!=='POST')return fail('Method not allowed',405);
      if(!user)return fail('Reload to get a chat identity',401);
      const now=new Date().toISOString();
      await env.DB.prepare(`INSERT INTO memory_visits(user_id,first_seen_at,last_seen_at) VALUES(?,?,?)
        ON CONFLICT(user_id) DO UPDATE SET last_seen_at=excluded.last_seen_at
        WHERE memory_visits.last_seen_at <= ?`).bind(user.id,now,now,new Date(Date.now()-30000).toISOString()).run();
      return json({success:true});
    }
    if(path==='/api/memories'){
      if(method==='GET'){
        const rows=await env.DB.prepare('SELECT id,caption,memory_date,created_at FROM memory_wall ORDER BY memory_date DESC,created_at DESC LIMIT 100').all();
        return json({success:true,memories:rows.results});
      }
      if(method!=='POST')return fail('Method not allowed',405);
      if(!await chatIsAdmin(request))return fail('Admin access required',403);
      if(!env.CHAT_IMAGES)return fail('Media storage is unavailable',503);
      const form=await request.formData(),file=form.get('image'),caption=text(form.get('caption'),501),date=text(form.get('date'),10);
      if(caption.length>500||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)return fail('Enter a valid date and caption under 501 characters');
      if(!file||typeof file.arrayBuffer!=='function'||!file.size||file.size>8*1024*1024)return fail('Photo must be under 8 MB',413);
      const bytes=new Uint8Array(await file.arrayBuffer()),type=chatSniffImage(bytes);if(!type)return fail('Use JPG, PNG, WebP or GIF',415);
      const id=crypto.randomUUID();storedKey='memories/'+id;
      await env.CHAT_IMAGES.put(storedKey,bytes,{httpMetadata:{contentType:type}});
      await env.DB.prepare('INSERT INTO memory_wall(id,caption,memory_date,r2_key,content_type,created_at) VALUES(?,?,?,?,?,?)').bind(id,caption,date,storedKey,type,new Date().toISOString()).run();storedKey=null;
      return json({success:true,id});
    }
    const memory=path.match(/^\/api\/memories\/([A-Za-z0-9_-]+)(\/image)?$/);
    if(memory){
      if(!memory[2]&&method==='PATCH'){
        if(!await chatIsAdmin(request))return fail('Admin access required',403);
        const body=await request.json();
        if(!body||typeof body.caption!=='string'||typeof body.date!=='string')return fail('Enter a valid date and caption');
        const caption=body.caption.trim(),date=body.date;
        if(caption.length>500||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)return fail('Enter a valid date and caption under 501 characters');
        const result=await env.DB.prepare('UPDATE memory_wall SET caption=?,memory_date=? WHERE id=?').bind(caption,date,memory[1]).run();
        if(!result.meta?.changes)return fail('Memory not found',404);
        return json({success:true});
      }
      const row=await env.DB.prepare('SELECT r2_key,content_type FROM memory_wall WHERE id=?').bind(memory[1]).first();
      if(!row)return fail('Memory not found',404);
      if(memory[2]&&method==='GET'&&env.CHAT_IMAGES)return await mediaResponse(request,env.CHAT_IMAGES,row.r2_key,row.content_type);
      if(!memory[2]&&method==='DELETE'){
        if(!await chatIsAdmin(request))return fail('Admin access required',403);
        await env.CHAT_IMAGES?.delete(row.r2_key);
        await env.DB.prepare('DELETE FROM memory_wall WHERE id=?').bind(memory[1]).run();return json({success:true});
      }
      return fail('Method not allowed',405);
    }
    return fail('Not found',404);
  }catch(e){
    if(storedKey)try{await env.CHAT_IMAGES.delete(storedKey)}catch{}
    return fail(e instanceof SyntaxError?'Invalid request':'Could not complete request; try again',e instanceof SyntaxError?400:500);
  }
}



