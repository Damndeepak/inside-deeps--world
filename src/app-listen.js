import {visitorSchema,currentVisitor,browserRequest} from './deeplist-visitors.js';
const ready=new WeakMap();
const response=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
const uuid=v=>/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v||'');
async function schema(db){
 if(!ready.has(db))ready.set(db,(async()=>{
  for(const sql of [
   'CREATE TABLE IF NOT EXISTS app_listener_links(channel TEXT PRIMARY KEY,user_id TEXT NOT NULL,token_hash TEXT NOT NULL,updated INTEGER NOT NULL)',
   'CREATE TABLE IF NOT EXISTS app_listen_requests(id TEXT PRIMARY KEY,sender TEXT NOT NULL,target TEXT NOT NULL,recipient TEXT NOT NULL,label TEXT NOT NULL,status TEXT NOT NULL,created INTEGER NOT NULL,expires INTEGER NOT NULL)',
   "CREATE UNIQUE INDEX IF NOT EXISTS app_listen_pending ON app_listen_requests(sender,recipient) WHERE status='pending'",
   'CREATE INDEX IF NOT EXISTS app_listen_inbox ON app_listen_requests(recipient,status,expires)',
   'CREATE TABLE IF NOT EXISTS app_listen_mutes(recipient TEXT NOT NULL,sender TEXT NOT NULL,until INTEGER NOT NULL,PRIMARY KEY(recipient,sender))'
  ])await db.prepare(sql).run();
 })().catch(e=>{ready.delete(db);throw e}));
 await ready.get(db);await visitorSchema(db);
}
async function activeToken(db,channel){return channel==='owner'?db.prepare('SELECT token_hash FROM deeplist_bridge WHERE id=1').first():db.prepare('SELECT token_hash FROM deeplist_visitors WHERE channel_id=?').bind(channel).first()}
export async function handleAppListen(request,env,{userFor,digest,body,rate,error}){
 const url=new URL(request.url),path=url.pathname;
 if(!path.startsWith('/api/app/listen/')&&path!=='/api/deeplist/listen-request')return null;
 const db=env.DB,now=Date.now();await schema(db);
 if(path==='/api/deeplist/listen-request'){
  if(!browserRequest(request,'listen-request'))throw error('Open this from the website',403);
  const sender=await currentVisitor(request,db,digest);if(!sender)throw error('Set your website nickname first',401);
  if(request.method==='POST'){
   const data=await body(request),target=data.channel;
   if(target!=='owner'&&!uuid(target))throw error('Invalid listener');
   if(sender.channel_id===target)throw error('Choose another listener');
   await rate(db,'listen-send:'+sender.channel_id,5,60000);
   const receiver=await db.prepare('SELECT l.* FROM app_listener_links l JOIN app_accounts a ON a.id=l.user_id WHERE l.channel=? AND a.blocked=0').bind(target).first();
   const pairing=receiver?await activeToken(db,target):null;
   if(!receiver||!pairing?.token_hash||pairing.token_hash!==receiver.token_hash)throw error('This listener needs to update Deeplist and enable website integration',409);
   const mute=await db.prepare('SELECT until FROM app_listen_mutes WHERE recipient=? AND sender=? AND until>?').bind(receiver.user_id,sender.channel_id,now).first();
   if(mute)throw error('Requests are paused for five minutes',429);
   await db.prepare("UPDATE app_listen_requests SET status='expired' WHERE sender=? AND recipient=? AND status='pending' AND expires<=?").bind(sender.channel_id,receiver.user_id,now).run();
   const pending=await db.prepare("SELECT id FROM app_listen_requests WHERE sender=? AND recipient=? AND status='pending' AND expires>?").bind(sender.channel_id,receiver.user_id,now).first();
   if(pending)return response({id:pending.id,status:'pending'});
   const id=crypto.randomUUID(),label=String(sender.display_name||'Listener '+sender.channel_id.slice(0,6)).slice(0,60);
   await db.prepare('DELETE FROM app_listen_requests WHERE expires<?').bind(now-86400000).run();
   await db.prepare("INSERT OR IGNORE INTO app_listen_requests(id,sender,target,recipient,label,status,created,expires) VALUES(?,?,?,?,?,'pending',?,?)").bind(id,sender.channel_id,target,receiver.user_id,label,now,now+120000).run();
   const saved=await db.prepare("SELECT id FROM app_listen_requests WHERE sender=? AND recipient=? AND status='pending'").bind(sender.channel_id,receiver.user_id).first();
   return response({id:saved.id,status:'pending'},201);
  }
  if(request.method==='GET'){
   const id=url.searchParams.get('id');if(!uuid(id))throw error('Invalid request');
   const row=await db.prepare('SELECT target,status,expires FROM app_listen_requests WHERE id=? AND sender=?').bind(id,sender.channel_id).first();
   if(!row)throw error('Request not found',404);
   const status=row.status==='pending'&&row.expires<=now?'expired':row.status;
   return response({status,...(status==='accepted'?{player:row.target==='owner'?'/deeplist.html':'/deeplist.html?user='+encodeURIComponent(row.target)}:{})});
  }
  throw error('Method not allowed',405);
 }
 const user=await userFor(request,db);if(!user)throw error('Sign in to Deeplist',401);if(user.blocked)throw error('This account is blocked',403);
 if(path==='/api/app/listen/connect'&&request.method==='POST'){
  const data=await body(request);if(!/^[a-f0-9]{64}$/.test(data.token||''))throw error('Invalid integration token');
  const tokenHash=await digest(data.token);
  const found=await db.prepare('SELECT channel_id AS channel FROM deeplist_visitors WHERE token_hash=? UNION ALL SELECT \'owner\' AS channel FROM deeplist_bridge WHERE id=1 AND token_hash=?').bind(tokenHash,tokenHash).first();
  if(!found)throw error('Reconnect your website integration',409);
  await db.prepare('INSERT INTO app_listener_links(channel,user_id,token_hash,updated) VALUES(?,?,?,?) ON CONFLICT(channel) DO UPDATE SET user_id=excluded.user_id,token_hash=excluded.token_hash,updated=excluded.updated').bind(found.channel,user.id,tokenHash,now).run();
  return response({connected:true});
 }
 if(path==='/api/app/listen/inbox'&&request.method==='GET'){
  const rows=await db.prepare("SELECT id,label,created,expires FROM app_listen_requests WHERE recipient=? AND status='pending' AND expires>? ORDER BY created LIMIT 20").bind(user.id,now).all();
  return response({requests:rows.results});
 }
 if(path==='/api/app/listen/respond'&&request.method==='POST'){
  const data=await body(request);if(!uuid(data.id)||!['accept','reject','mute'].includes(data.action))throw error('Invalid response');
  const row=await db.prepare("SELECT sender FROM app_listen_requests WHERE id=? AND recipient=? AND status='pending' AND expires>?").bind(data.id,user.id,now).first();
  if(!row)throw error('Request expired',409);
  const status=data.action==='accept'?'accepted':'rejected';
  if(data.action==='mute'){
   const changed=await db.batch([
    db.prepare("UPDATE app_listen_requests SET status='rejected' WHERE id=? AND recipient=? AND status='pending' AND expires>?").bind(data.id,user.id,now),
    db.prepare('INSERT INTO app_listen_mutes(recipient,sender,until) SELECT ?,?,? WHERE changes()=1 ON CONFLICT(recipient,sender) DO UPDATE SET until=excluded.until').bind(user.id,row.sender,now+300000),
    db.prepare("UPDATE app_listen_requests SET status='rejected' WHERE recipient=? AND sender=? AND status='pending' AND EXISTS(SELECT 1 FROM app_listen_mutes WHERE recipient=? AND sender=? AND until=?)").bind(user.id,row.sender,user.id,row.sender,now+300000)
   ]);
   if(!changed[0].meta.changes)throw error('Request already answered or expired',409);
  }else {
   const changed=await db.prepare("UPDATE app_listen_requests SET status=? WHERE id=? AND recipient=? AND status='pending' AND expires>? RETURNING id").bind(status,data.id,user.id,now).first();
   if(!changed)throw error('Request already answered or expired',409);
  }
  return response({status,...(data.action==='mute'?{mutedUntil:now+300000}:{})});
 }
 throw error('Not found',404);
}
