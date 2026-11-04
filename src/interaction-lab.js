const schemas=new WeakMap(),ttl=7*86400000;
const reply=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
async function setup(db){if(!schemas.has(db))schemas.set(db,db.batch([db.prepare('CREATE TABLE IF NOT EXISTS interaction_batches(id TEXT PRIMARY KEY,session TEXT NOT NULL,at INTEGER NOT NULL,events TEXT NOT NULL)'),db.prepare('CREATE INDEX IF NOT EXISTS interaction_batches_time ON interaction_batches(at)'),db.prepare('CREATE INDEX IF NOT EXISTS interaction_batches_session ON interaction_batches(session,at)')]).catch(e=>{schemas.delete(db);throw e}));await schemas.get(db)}
const kinds=new Set(['tap','double-tap','swipe','long-press','cursor','scroll','dwell','rage']);
const sections=new Set(['hero','chat','listeners','owner','memories','media','other']);
export async function handleInteractionLab(request,env,helpers){
 const path=new URL(request.url).pathname;if(!['/api/interactions','/api/admin/interactions'].includes(path))return null;
 const admin=path==='/api/admin/interactions';
 if(admin){if(request.method!=='GET')return reply({success:false},405);if(!await helpers.chatIsAdmin(request))return reply({success:false},403)}
 else{if(request.method!=='POST')return reply({success:false},405);if(request.headers.get('Origin')!==new URL(request.url).origin||request.headers.get('Sec-Fetch-Site')==='cross-site')return reply({success:false},403)}
 try{
  await setup(env.DB);
  if(admin){const rows=await env.DB.prepare('SELECT session,at,events FROM interaction_batches WHERE at>? ORDER BY at DESC LIMIT 500').bind(Date.now()-ttl).all();return reply({success:true,window:'Latest 500 batches within 7 days; sampled cursor movement; opted-in visits only.',batches:rows.results.map(r=>({...r,events:JSON.parse(r.events)}))})}
  if(Number(request.headers.get('Content-Length'))>20000)return reply({success:false},413);
  const raw=await request.text();if(raw.length>20000)return reply({success:false},413);const body=JSON.parse(raw);
  if(body.consent!==true||!/^[-a-zA-Z0-9]{16,64}$/.test(body.session||'')||!Array.isArray(body.events)||body.events.length>80)return reply({success:false},400);
  const events=body.events.map(e=>({kind:e.kind,section:e.section,t:Math.max(0,Math.min(3600000,Number(e.t)||0)),x:Math.max(0,Math.min(100,Number(e.x)||0)),y:Math.max(0,Math.min(100,Number(e.y)||0)),value:Math.max(0,Math.min(60000,Number(e.value)||0))}));if(events.some(e=>!kinds.has(e.kind)||!sections.has(e.section)))return reply({success:false},400);
  const user=await helpers.getUser(helpers.getUserId(request));if(!user)return reply({success:false},401);
  const now=Date.now();
  // One accepted batch per browser identity per 15s; rate check and insert are atomic.
  const result=await env.DB.prepare('INSERT INTO interaction_batches(id,session,at,events) SELECT ?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM interaction_batches WHERE session=? AND at>?)').bind(crypto.randomUUID(),user.id+':'+body.session,now,JSON.stringify(events),user.id+':'+body.session,now-15000).run();
  if(!result.meta.changes)return reply({success:false},429);
  await env.DB.prepare('DELETE FROM interaction_batches WHERE at<=?').bind(now-ttl).run();return reply({success:true});
 }catch{return reply({success:false},400)}
}
