const schemas=new WeakMap();
const headers={'Cache-Control':'no-store'};
const reply=(data,status=200)=>Response.json(data,{status,headers});
export async function ensureActivity(db){
 if(!schemas.has(db))schemas.set(db,db.batch([
  db.prepare(`CREATE TABLE IF NOT EXISTS site_sessions(session_id TEXT NOT NULL,user_id TEXT NOT NULL,page TEXT NOT NULL,first_seen INTEGER NOT NULL,last_seen INTEGER NOT NULL,views INTEGER NOT NULL,device TEXT NOT NULL,browser TEXT NOT NULL,os TEXT NOT NULL,PRIMARY KEY(session_id,user_id,page))`),
  db.prepare('CREATE INDEX IF NOT EXISTS idx_site_sessions_seen ON site_sessions(last_seen)'),
  db.prepare(`CREATE TABLE IF NOT EXISTS site_visit_locations(session_id TEXT NOT NULL,user_id TEXT NOT NULL,page TEXT NOT NULL,city TEXT,region TEXT,country TEXT,recorded_at INTEGER NOT NULL,PRIMARY KEY(session_id,user_id,page))`),
  db.prepare('CREATE INDEX IF NOT EXISTS idx_site_visit_locations_user_time ON site_visit_locations(user_id,recorded_at)'),
  db.prepare('CREATE TABLE IF NOT EXISTS site_activity_rate(user_id TEXT PRIMARY KEY,started INTEGER NOT NULL,n INTEGER NOT NULL)'),
  db.prepare(`CREATE TABLE IF NOT EXISTS site_audit(id TEXT PRIMARY KEY,at INTEGER NOT NULL,actor_id TEXT,actor_name TEXT NOT NULL,action TEXT NOT NULL,target_id TEXT,details TEXT NOT NULL)`),
  db.prepare('CREATE INDEX IF NOT EXISTS idx_site_audit_time ON site_audit(at,id)'),
  db.prepare(`CREATE TABLE IF NOT EXISTS deleted_chat_archive(message_id TEXT PRIMARY KEY,author_name TEXT NOT NULL,message TEXT NOT NULL,created_at TEXT NOT NULL,deleted_at INTEGER NOT NULL,deleted_by TEXT NOT NULL,type TEXT NOT NULL)`),
  db.prepare('CREATE INDEX IF NOT EXISTS idx_deleted_chat_archive_time ON deleted_chat_archive(deleted_at,message_id)'),
  db.prepare(`CREATE TRIGGER IF NOT EXISTS audit_username_changes AFTER UPDATE OF username ON users
   WHEN OLD.username IS NOT NEW.username BEGIN
   INSERT INTO site_audit(id,at,actor_id,actor_name,action,target_id,details)
   VALUES(lower(hex(randomblob(16))),CAST((julianday('now')-2440587.5)*86400000 AS INTEGER),NEW.id,NEW.username,'name_changed',NULL,json_object('old_name',OLD.username,'new_name',NEW.username)); END`)
 ]).catch(e=>{schemas.delete(db);throw e}));
 await schemas.get(db);
}
export async function purgeDeletedArchive(db){
 await ensureActivity(db);
 await db.prepare('DELETE FROM deleted_chat_archive WHERE deleted_at<=?').bind(Date.now()-30*86400000).run();
}
export async function auditStatement(db,actor,action,target,details={}){
 await ensureActivity(db);
 const values=[crypto.randomUUID(),Date.now(),actor?.id||null,actor?.username||'Admin',action,target||null,JSON.stringify(details).slice(0,2000)];
 if(action==='message_deleted')return db.prepare('INSERT INTO site_audit(id,at,actor_id,actor_name,action,target_id,details) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM messages WHERE id=?)').bind(...values,target);
 return db.prepare('INSERT INTO site_audit(id,at,actor_id,actor_name,action,target_id,details) VALUES(?,?,?,?,?,?,?)').bind(...values);
}
export async function recordAudit(db,actor,action,target,details={}){
 try{await(await auditStatement(db,actor,action,target,details)).run()}catch{console.error('Activity event could not be recorded')}
}
export function deviceInfo(ua){
 return {device:/iPad|Tablet/i.test(ua)?'Tablet':/Mobile|Android|iPhone/i.test(ua)?'Mobile':'Desktop',browser:/Edg\//.test(ua)?'Edge':/OPR\//.test(ua)?'Opera':/Firefox\//.test(ua)?'Firefox':/Chrome\/|CriOS\//.test(ua)?'Chrome':/Safari\//.test(ua)?'Safari':'Other',os:/Android/.test(ua)?'Android':/iPhone|iPad/.test(ua)?'iOS':/Windows/.test(ua)?'Windows':/Macintosh/.test(ua)?'macOS':/Linux/.test(ua)?'Linux':'Other'};
}
// Use Cloudflare's server metadata only, never a browser-submitted location or raw IP.
export function visitLocation(request){
 const clean=value=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,100)||null:null;
 const cf=request.cf||{};
 return {city:clean(cf.city),region:clean(cf.region),country:/^[A-Z]{2}$/.test(cf.country||'')?cf.country:null};
}
const pages=new Set(['/','/index.html','/memories','/memories/','/memories.html','/media','/media/','/media/index.html','/deeplist.html','/on-repeat.html','/arcade.html','/the-room.html']);
export async function handleActivity(request,env,helpers){
 const url=new URL(request.url),admin=url.pathname==='/api/admin/activity';
 if(!admin&&url.pathname!=='/api/activity')return null;
 if(admin){
  if(request.method!=='GET')return reply({success:false},405);
  if(!await helpers.chatIsAdmin(request))return reply({success:false,error:'Admin access required'},403);
  try{
   await ensureActivity(env.DB);
   const before=Number(url.searchParams.get('before'))||Date.now()+1,beforeId=url.searchParams.get('before_id')||'~';
   const rows=await env.DB.prepare(`SELECT id,at,actor_name,action,target_id,details FROM site_audit WHERE at<? OR(at=? AND id<?) ORDER BY at DESC,id DESC LIMIT 101`).bind(before,before,beforeId).all();
   const visitors=await env.DB.prepare(`SELECT u.username,MIN(s.first_seen) AS first_seen,MAX(s.last_seen) AS last_seen,SUM(s.views) AS views,COUNT(DISTINCT s.session_id) AS sessions,(SELECT json_object('city',l.city,'region',l.region,'country',l.country) FROM site_visit_locations l WHERE l.user_id=s.user_id ORDER BY l.recorded_at DESC LIMIT 1) AS location_json FROM site_sessions s JOIN users u ON u.id=s.user_id GROUP BY s.user_id ORDER BY last_seen DESC LIMIT 100`).all();
   const sessions=await env.DB.prepare(`SELECT u.username,s.page,s.first_seen,s.last_seen,s.views,s.device,s.browser,s.os,l.city,l.region,l.country FROM site_sessions s JOIN users u ON u.id=s.user_id LEFT JOIN site_visit_locations l ON l.session_id=s.session_id AND l.user_id=s.user_id AND l.page=s.page ORDER BY s.last_seen DESC LIMIT 100`).all();
   await purgeDeletedArchive(env.DB);
   const deleted=await env.DB.prepare('SELECT message_id,author_name,message,created_at,deleted_at,deleted_by,type FROM deleted_chat_archive WHERE deleted_at>? ORDER BY deleted_at DESC,message_id DESC LIMIT 100').bind(Date.now()-30*86400000).all();
   const names=await env.DB.prepare(`SELECT a.actor_id,a.at,a.details,u.username AS current_name FROM site_audit a LEFT JOIN users u ON u.id=a.actor_id WHERE a.action='name_changed' ORDER BY a.at DESC,a.id DESC LIMIT 100`).all();
   const groups=new Map();
   for(const row of names.results){if(!groups.has(row.actor_id))groups.set(row.actor_id,{current_name:row.current_name||JSON.parse(row.details).new_name,changes:[]});const detail=JSON.parse(row.details);groups.get(row.actor_id).changes.push({at:row.at,old_name:detail.old_name,new_name:detail.new_name});}
   return reply({success:true,deleted_messages:deleted.results,name_history:[...groups.values()],tracking_note:'Records start with this update. Browser identities are not verified people. Cities are approximate IP locations; VPNs and mobile networks can differ from physical location. Location records start with the city-location update.',visitors:visitors.results.map(({location_json,...v})=>({...v,location:location_json?JSON.parse(location_json):null})),sessions:sessions.results,events:rows.results.slice(0,100).map(r=>({...r,details:JSON.parse(r.details)})),has_more:rows.results.length>100});
  }catch{return reply({success:false,error:'Activity unavailable'},503)}
 }
 if(request.method!=='POST')return reply({success:false},405);
 const origin=request.headers.get('Origin');
 if((origin&&origin!==url.origin)||request.headers.get('Sec-Fetch-Site')==='cross-site')return reply({success:false},403);
 try{
  const user=await helpers.getUser(helpers.getUserId(request));if(!user)return reply({success:false},401);
  const raw=await request.text();if(raw.length>512)return reply({success:false},413);
  const body=JSON.parse(raw);
  if(!pages.has(body.page)||!['view','heartbeat'].includes(body.kind)||!/^[-a-zA-Z0-9]{16,64}$/.test(body.session||''))return reply({success:false},400);
  await ensureActivity(env.DB);const now=Date.now(),info=deviceInfo(request.headers.get('User-Agent')||'');
  const rate=await env.DB.prepare(`INSERT INTO site_activity_rate(user_id,started,n) VALUES(?,?,1) ON CONFLICT(user_id) DO UPDATE SET n=CASE WHEN started<=? THEN 1 ELSE n+1 END,started=CASE WHEN started<=? THEN excluded.started ELSE started END RETURNING n`).bind(user.id,now,now-60000,now-60000).first();
  if(rate.n>12)return reply({success:false},429);
  const row=await env.DB.prepare(`INSERT INTO site_sessions(session_id,user_id,page,first_seen,last_seen,views,device,browser,os) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(session_id,user_id,page) DO UPDATE SET last_seen=excluded.last_seen,views=site_sessions.views+? WHERE site_sessions.last_seen<=? RETURNING first_seen,views`).bind(body.session,user.id,body.page,now,now,body.kind==='view'?1:0,info.device,info.browser,info.os,body.kind==='view'?1:0,now-10000).first();
  if(row&&body.kind==='view'){
   const location=visitLocation(request);
   await env.DB.prepare(`INSERT INTO site_visit_locations(session_id,user_id,page,city,region,country,recorded_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(session_id,user_id,page) DO UPDATE SET city=excluded.city,region=excluded.region,country=excluded.country,recorded_at=excluded.recorded_at`).bind(body.session,user.id,body.page,location.city,location.region,location.country,now).run();
   await recordAudit(env.DB,user,'page_view',null,{page:body.page,...info,...location});
  }
  return reply({success:true});
 }catch{return reply({success:false},400)}
}
