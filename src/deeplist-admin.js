import {visitorSchema, browserRequest} from './deeplist-visitors.js';
const reply=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
const uuid=value=>/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value||'');
export async function handlePlayerAdmin(request,env,isAdmin){
 const url=new URL(request.url);
 if(url.pathname!=='/api/deeplist/admin/players')return null;
 if(!browserRequest(request,'admin')||!await isAdmin(request))return reply({error:'admin_required'},403);
 await visitorSchema(env.DB);
 if(request.method==='GET'){
  const owner=await env.DB.prepare("SELECT display_name FROM deeplist_player_names WHERE channel_id='owner'").first();
  const rows=await env.DB.prepare(`SELECT v.channel_id,COALESCE(a.display_name,u.username,NULLIF(n.display_name,''),'Listener · '||SUBSTR(v.channel_id,1,6)) AS label,v.updated_at,v.token_hash IS NOT NULL AS paired FROM deeplist_visitors v LEFT JOIN deeplist_player_names a ON a.channel_id=v.channel_id LEFT JOIN deeplist_visitor_names n ON n.channel_id=v.channel_id LEFT JOIN deeplist_identity_links l ON l.channel_id=v.channel_id LEFT JOIN users u ON u.id=l.user_id ORDER BY v.updated_at DESC,v.created_at DESC`).all();
  return reply({players:[{channel:'owner',label:owner?.display_name||'damndeepak',owner:true},...rows.results.map(r=>({channel:r.channel_id,label:r.label,paired:!!r.paired,lastPlayedAt:r.updated_at}))]});
 }
 const channel=url.searchParams.get('channel');
 if(channel!=='owner'&&!uuid(channel))return reply({error:'invalid_channel'},400);
 if(channel!=='owner'&&!await env.DB.prepare('SELECT channel_id FROM deeplist_visitors WHERE channel_id=?').bind(channel).first())return reply({error:'player_not_found'},404);
 if(request.method==='PATCH'){
  const reader=request.body?.getReader();if(!reader)return reply({error:'invalid_name'},400);
  let size=0,text='';const decoder=new TextDecoder();
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>2048){await reader.cancel();return reply({error:'invalid_name'},400);}text+=decoder.decode(value,{stream:true});}
  let data;try{data=JSON.parse(text+decoder.decode());}catch{return reply({error:'invalid_name'},400);}
  if(typeof data?.name!=='string')return reply({error:'invalid_name'},400);
  const name=data.name.normalize('NFKC').replace(/[\p{Cc}\p{Cf}]/gu,'').replace(/\s+/gu,' ').trim();
  if(!name||Array.from(name).length>32)return reply({error:'Use 1–32 characters.'},400);
  await env.DB.prepare('INSERT INTO deeplist_player_names(channel_id,display_name) VALUES(?,?) ON CONFLICT(channel_id) DO UPDATE SET display_name=excluded.display_name').bind(channel,name).run();
  return reply({success:true,channel,label:name});
 }
 if(request.method==='DELETE'){
  if(channel==='owner')return reply({error:'The main player can be renamed or disconnected, but cannot be deleted.'},409);
  // Revoke and remove the channel atomically. In-flight heartbeats cannot recreate it.
  await env.DB.batch([
   env.DB.prepare('DELETE FROM deeplist_visitors WHERE channel_id=?').bind(channel),
   ...['deeplist_player_names','deeplist_visitor_names','deeplist_identity_links','deeplist_connection_totals'].map(table=>env.DB.prepare(`DELETE FROM ${table} WHERE channel_id=?`).bind(channel))
  ]);
  return reply({success:true,channel});
 }
 return reply({error:'method_not_allowed'},405);
}
