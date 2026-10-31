const ready=new WeakMap();
const MAX=16*1024*1024;
const reply=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export async function cloudSchema(db){
 if(!ready.has(db))ready.set(db,db.prepare('CREATE TABLE IF NOT EXISTS app_cloud(user_id TEXT PRIMARY KEY,revision INTEGER NOT NULL,object_key TEXT NOT NULL,previous_key TEXT,updated INTEGER NOT NULL)').run().catch(e=>{ready.delete(db);throw e}));
 await ready.get(db);
}
export async function deleteCloud(env,userId){
 await cloudSchema(env.DB);
 const row=await env.DB.prepare('SELECT object_key,previous_key FROM app_cloud WHERE user_id=?').bind(userId).first();
 if(row){await env.CHAT_IMAGES.delete([row.object_key,row.previous_key].filter(Boolean));await env.DB.prepare('DELETE FROM app_cloud WHERE user_id=? AND object_key=?').bind(userId,row.object_key).run();}
}
export async function purgeDeletedCloud(env){
 const exists=await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='app_cloud'").first();
 if(!exists)return;
 const rows=await env.DB.prepare('SELECT user_id FROM app_cloud WHERE NOT EXISTS(SELECT 1 FROM app_accounts WHERE id=user_id) LIMIT 20').all();
 for(const row of rows.results)await deleteCloud(env,row.user_id).catch(()=>{});
}
export async function handleAppCloud(request,env,{userFor,readLimited,rate,error}){
 if(new URL(request.url).pathname!=='/api/app/cloud')return null;
 const user=await userFor(request,env.DB);
 if(!user)throw error('Sign in to sync',401);
 if(user.blocked)throw error('This account is blocked',403);
 if(user.provider!=='google'||user.email_verified!==1)throw error('Connect Google to enable account sync',403);
 await cloudSchema(env.DB);
 if(request.method==='GET'){
  // Recheck metadata if a concurrent save retired the object we first read.
  for(let attempt=0;attempt<2;attempt++){
   const row=await env.DB.prepare('SELECT * FROM app_cloud WHERE user_id=?').bind(user.id).first();
   if(!row)return reply({revision:0,data:null});
   const object=await env.CHAT_IMAGES.get(row.object_key);
   if(object)return reply({revision:row.revision,data:JSON.parse(await object.text()),updated:row.updated});
  }
  throw error('Sync changed while reading. Try again.',409);
 }
 if(request.method!=='PUT')throw error('Method not allowed',405);
 await rate(env.DB,'cloud:'+user.id,12,60000);
 let value;try{value=JSON.parse(new TextDecoder().decode(await readLimited(request,MAX)))}catch(e){if(e.status)throw e;throw error('Invalid sync data')}
 if(!Number.isSafeInteger(value.revision)||value.revision<0||value.data?.format!=='deeplist-cloud'||value.data?.version!==1||!value.data?.records||Array.isArray(value.data.records)||typeof value.data.records!=='object')throw error('Unsupported sync format');
 const old=await env.DB.prepare('SELECT * FROM app_cloud WHERE user_id=?').bind(user.id).first();
 if((old?.revision||0)!==value.revision)throw error('Sync revision changed. Merge and retry.',409);
 const key='app-cloud/'+user.id+'/'+crypto.randomUUID(),now=Date.now();
 await env.CHAT_IMAGES.put(key,JSON.stringify(value.data),{httpMetadata:{contentType:'application/json'}});
 try{
  const changed=old?
   await env.DB.prepare('UPDATE app_cloud SET revision=revision+1,object_key=?,previous_key=object_key,updated=? WHERE user_id=? AND revision=? AND EXISTS(SELECT 1 FROM app_accounts WHERE id=? AND blocked=0) RETURNING revision').bind(key,now,user.id,value.revision,user.id).first():
   await env.DB.prepare('INSERT OR IGNORE INTO app_cloud(user_id,revision,object_key,updated) SELECT ?,1,?,? WHERE EXISTS(SELECT 1 FROM app_accounts WHERE id=? AND blocked=0) RETURNING revision').bind(user.id,key,now,user.id).first();
  if(!changed)throw error('Sync revision changed. Merge and retry.',409);
  if(old?.previous_key)await env.CHAT_IMAGES.delete(old.previous_key).catch(()=>{});
  return reply({revision:changed.revision,updated:now});
 }catch(e){await env.CHAT_IMAGES.delete(key);throw e}
}
