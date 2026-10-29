const schemas=new WeakMap();
const headers={'Cache-Control':'no-store'};
const reply=(data,status=200)=>Response.json(data,{status,headers});
export async function ensureActivity(db){
 if(!schemas.has(db))schemas.set(db,db.batch([
  db.prepare(`CREATE TABLE IF NOT EXISTS site_sessions(session_id TEXT NOT NULL,user_id TEXT NOT NULL,page TEXT NOT NULL,first_seen INTEGER NOT NULL,last_seen INTEGER NOT NULL,views INTEGER NOT NULL,device TEXT NOT NULL,browser TEXT NOT NULL,os TEXT NOT NULL,PRIMARY KEY(session_id,user_id,page))`),
  db.prepare('CREATE INDEX IF NOT EXISTS idx_site_sessions_seen ON site_sessions(last_seen)'),
  db.prepare('CREATE TABLE IF NOT EXISTS site_activity_rate(user_id TEXT PRIMARY KEY,started INTEGER NOT NULL,n INTEGER NOT NULL)'),
  db.prepare(`CREATE TABLE IF NOT EXISTS site_audit(id TEXT PRIMARY KEY,at INTEGER NOT NULL,actor_id TEXT,actor_name TEXT NOT NULL,action TEXT NOT NULL,target_id TEXT,details TEXT NOT NULL)`),
  db.prepare('CREATE INDEX IF NOT EXISTS idx_site_audit_time ON site_audit(at,id)')
 ]).catch(e=>{schemas.delete(db);throw e}));
 await schemas.get(db);
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
   const visitors=await env.DB.prepare(`SELECT u.username,MIN(s.first_seen) AS first_seen,MAX(s.last_seen) AS last_seen,SUM(s.views) AS views,COUNT(DISTINCT s.session_id) AS sessions FROM site_sessions s JOIN users u ON u.id=s.user_id GROUP BY s.user_id ORDER BY last_seen DESC LIMIT 100`).all();
   const sessions=await env.DB.prepare(`SELECT u.username,s.page,s.first_seen,s.last_seen,s.views,s.device,s.browser,s.os FROM site_sessions s JOIN users u ON u.id=s.user_id ORDER BY s.last_seen DESC LIMIT 100`).all();
   return reply({success:true,tracking_note:'Records start with this update. Browser identities are not verified people.',visitors:visitors.results,sessions:sessions.results,events:rows.results.slice(0,100).map(r=>({...r,details:JSON.parse(r.details)})),has_more:rows.results.length>100});
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
  if(row&&body.kind==='view')await recordAudit(env.DB,user,'page_view',null,{page:body.page,...info});
  return reply({success:true});
 }catch{return reply({success:false},400)}
}
