import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {webcrypto} from 'node:crypto';
import worker from '../src/index.js';
if(!globalThis.crypto)Object.defineProperty(globalThis,'crypto',{value:webcrypto});
class DB {
 sqlite=new DatabaseSync(':memory:');
 constructor(){this.sqlite.exec('CREATE TABLE users(id TEXT PRIMARY KEY,username TEXT NOT NULL,created_at TEXT);CREATE TABLE messages(id TEXT PRIMARY KEY,message TEXT,parent_id TEXT,sender_id TEXT,conversation_id TEXT,created_at TEXT);');}
 prepare(sql){const db=this.sqlite;let args=[];return{bind(...values){if(values.length>100)throw new Error("D1 bind parameter limit exceeded");args=values;return this;},async first(){return db.prepare(sql).get(...args)||null;},async all(){return{results:db.prepare(sql).all(...args)};},async run(){const result=db.prepare(sql).run(...args);return{meta:{changes:Number(result.changes)}};}};}
 batch(statements){const run=async()=>{this.sqlite.exec('BEGIN');try{const result=[];for(const s of statements)result.push(await s.run());this.sqlite.exec('COMMIT');return result;}catch(e){this.sqlite.exec('ROLLBACK');throw e;}};const result=(this.pending||Promise.resolve()).then(run);this.pending=result.catch(()=>{});return result;}
}

const ctx={waitUntil(){}};
const makeEnv=()=>{const DB=new globalDB();DB.sqlite.exec('CREATE TABLE conversations(id TEXT PRIMARY KEY,user_id TEXT,created_at TEXT)');return {DB,ADMIN_KEY:'test-administrator-secret',ASSETS:{fetch:()=>new Response('Not found',{status:404})}}};
const globalDB=DB;
const env=makeEnv();
const call=(path,{cookie='',method='GET',body,headers={}}={},target=env)=>worker.fetch(new Request('https://example.com'+path,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined}),target,ctx);
const create=async()=>{const r=await call('/api/user');assert.equal(r.status,200);assert.match(r.headers.get('Set-Cookie'),/HttpOnly; Secure/);const data=await r.json();return {cookie:r.headers.get('Set-Cookie').split(';')[0],user:data.user};};
const alice=await create(),bob=await create();
assert.match((await call('/api/user',{cookie:alice.cookie})).headers.get('Set-Cookie'),/HttpOnly; Secure/);
const db=env.DB.sqlite;
db.prepare('INSERT INTO conversations VALUES(?,?,?)').run('main',alice.user.id,'2020-01-01');
db.prepare('INSERT INTO conversations VALUES(?,?,?)').run('historical',bob.user.id,'2020-02-01');
const stamp='2026-10-28T10:00:00.000Z';
for(let i=0;i<8;i++)db.prepare('INSERT INTO messages VALUES(?,?,?,?,?,?)').run('message-'+i,'hello',null,i%2?bob.user.id:alice.user.id,i%2?'historical':'main',stamp);
const original=db.prepare('SELECT * FROM messages ORDER BY id').all();
for(const path of ['/api/conversations','/api/conversations/main'])assert.equal((await call(path,{cookie:alice.cookie})).status,200);
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM conversations').get().n,2);
assert.deepEqual(db.prepare('SELECT * FROM messages ORDER BY id').all(),original,'Legacy reads preserve every conversation association');
const legacy=await(await call('/api/conversations/main',{cookie:alice.cookie})).json();
assert.equal(legacy.messages.length,8);assert.ok(legacy.messages.every(m=>!('sender_id' in m)));
assert.equal(legacy.messages.find(m=>m.id==='message-0').mine,true);
assert.equal(legacy.messages.find(m=>m.id==='message-1').mine,false);
assert.ok(!JSON.stringify(legacy).includes(bob.user.id),'Legacy feed must not publish identity credentials');
const list=await(await call('/api/conversations',{cookie:alice.cookie})).json();assert.equal(list.conversations[0].message_count,8);
const redirects=fs.readFileSync('public/_redirects','utf8').split(/\r?\n/).filter(Boolean);
for(const path of ['/metrolist','/metrolist.html','/metrolist/']){
 assert.ok(redirects.includes(path+' /deeplist.html 302'),'Static assets must redirect before Worker routing');
 const redirect=await call(path+'?user=abc');assert.equal(redirect.status,302);assert.equal(redirect.headers.get('Location'),'https://example.com/deeplist.html?user=abc');
}
let cursor='',ids=[];
for(let i=0;i<5;i++){
 const r=await call('/api/chat?limit=3'+cursor,{cookie:alice.cookie});assert.equal(r.status,200);const data=await r.json();
 ids.push(...data.messages.map(m=>m.id));if(!data.has_more)break;
 const oldest=data.messages[0];cursor='&before='+encodeURIComponent(oldest.created_at)+'&before_id='+encodeURIComponent(oldest.id);
}
assert.equal(ids.length,8);assert.equal(new Set(ids).size,8,'Tie timestamps never skip or duplicate messages across pages');
for(const [path,method]of [['/api/messages/message-0','DELETE'],['/api/chat/message/message-0','DELETE'],['/api/conversations','POST'],['/api/push/subscribe','POST'],['/api/chat/reactions','POST']]){
 for(const headers of [{Origin:'https://evil.example'},{'Sec-Fetch-Site':'cross-site'}])assert.equal((await call(path,{cookie:alice.cookie,method,headers})).status,403);
}
assert.equal((await call('/api/messages',{cookie:alice.cookie,method:'POST',body:{message:'a'.repeat(1001)}})).status,400);
await call('/api/chat',{cookie:alice.cookie});
const removed=[];env.CHAT_IMAGES={delete:async key=>removed.push(key)};
db.prepare('INSERT INTO message_images VALUES(?,?,?,?,?)').run('message-0','photo','image/png',100,stamp);
db.prepare('INSERT INTO message_audio VALUES(?,?,?,?,?)').run('message-0','voice','audio/webm',100,stamp);
db.prepare('INSERT INTO message_reactions VALUES(?,?,?)').run('message-0',bob.user.id,'😂');
db.prepare('UPDATE messages SET parent_id=? WHERE id=?').run('message-0','message-1');
assert.equal((await call('/api/messages/message-0',{cookie:bob.cookie,method:'DELETE'})).status,403);
assert.equal((await call('/api/messages/message-0',{cookie:alice.cookie,method:'DELETE'})).status,200);
assert.deepEqual(removed.sort(),['photo','voice']);
for(const table of ['message_images','message_audio','message_reactions'])assert.equal(db.prepare('SELECT COUNT(*) AS n FROM '+table+' WHERE message_id=?').get('message-0').n,0);
assert.equal(db.prepare('SELECT id FROM messages WHERE id=?').get('message-0'),undefined);
const after=await(await call('/api/chat')).json();assert.equal(after.messages.find(m=>m.id==='message-1').parent.deleted,true);
// Independent database bindings in one isolate must each initialize their own tables and push keys.
const second=makeEnv();assert.equal((await call('/api/chat',{},second)).status,200);
const pushA=await(await call('/api/push/key')).json(),pushB=await(await call('/api/push/key',{},second)).json();
assert.equal(pushA.success,true);assert.equal(pushB.success,true);assert.notEqual(pushA.key,pushB.key);
assert.equal((await(await call('/api/push/key')).json()).key,pushA.key);
console.log('PASS: legacy identity privacy, non-destructive reads, tied pagination, CSRF, upload cleanup, secure cookies and per-database schema/push isolation');

// Online usernames are visible only to authenticated admins, with stale sessions excluded.
db.prepare('INSERT OR REPLACE INTO chat_presence(user_id,seen_at,typing_until) VALUES(?,?,?)').run(alice.user.id,Date.now(),0);
db.prepare('INSERT OR REPLACE INTO chat_presence(user_id,seen_at,typing_until) VALUES(?,?,?)').run(bob.user.id,Date.now()-61000,0);
assert.equal((await call('/api/chat/admin/presence')).status,403);
assert.equal((await call('/api/chat/admin/presence',{cookie:alice.cookie,headers:{'X-Admin-Key':'wrong'}})).status,403);
const adminOnline=await call('/api/chat/admin/presence',{headers:{'X-Admin-Key':env.ADMIN_KEY}});
assert.equal(adminOnline.status,200);assert.equal(adminOnline.headers.get('Cache-Control'),'no-store');
const onlineData=await adminOnline.json();assert.equal(onlineData.online.length,1);assert.equal(onlineData.online[0].username,alice.user.username);
assert.ok(!JSON.stringify(onlineData).includes(alice.user.id));assert.ok(!JSON.stringify(onlineData).includes(bob.user.username));
const publicPresence=await(await call('/api/chat/presence')).json();assert.equal('online_users' in publicPresence,false);assert.equal(typeof publicPresence.online,'number');
console.log('PASS: admin-only online names, rejected anonymous/incorrect keys, stale expiry, no identity credentials and uncached responses');

// 100 message IDs plus the identity parameter must not exceed D1's 100 binds.
const reactionIds=Array.from({length:100},(_,i)=>'reaction-boundary-'+i);
for(const id of [reactionIds[0],reactionIds[99]]){
 db.prepare('INSERT INTO messages(id,message,sender_id,created_at) VALUES(?,?,?,?)').run(id,'test',alice.user.id,stamp);
 const saved=await call('/api/chat/reactions',{cookie:alice.cookie,method:'POST',body:{message_id:id,emoji:'😂',active:true}});assert.equal(saved.status,200);
}
const reactionPage=await call('/api/chat/reactions?ids='+encodeURIComponent(reactionIds.join(',')),{cookie:alice.cookie});assert.equal(reactionPage.status,200);
const reactionData=await reactionPage.json();assert.equal(reactionData.reactions[reactionIds[0]][0].count,1);assert.equal(reactionData.reactions[reactionIds[99]][0].mine,true);
assert.equal((await call('/api/chat/reactions',{cookie:alice.cookie,method:'POST',body:{message_id:reactionIds[99],emoji:'😂',active:false}})).status,200);
const removedReaction=await(await call('/api/chat/reactions?ids='+reactionIds[99],{cookie:alice.cookie})).json();assert.equal(removedReaction.reactions[reactionIds[99]],undefined);
console.log('PASS: 100-message reaction lookup within D1 bind limits, including last ID, add and remove');
// Admin activity is private, server-timed, and never retains deleted message content.
assert.equal((await call('/api/admin/activity')).status,403);
assert.equal((await call('/api/admin/activity',{headers:{'X-Admin-Key':'wrong'}})).status,403);
const visitBody={session:'test-session-0123456789',page:'/',kind:'view'};
assert.equal((await call('/api/activity',{cookie:alice.cookie,method:'POST',body:visitBody,headers:{Origin:'https://evil.example'}})).status,403);
assert.equal((await call('/api/activity',{cookie:alice.cookie,method:'POST',body:{...visitBody,page:'/?token=secret'}})).status,400);
assert.equal((await call('/api/activity',{cookie:alice.cookie,method:'POST',body:visitBody,headers:{'User-Agent':'Mozilla/5.0 (Android) Chrome/130.0 Mobile'}})).status,200);
assert.equal((await call('/api/activity',{cookie:alice.cookie,method:'POST',body:{...visitBody,kind:'heartbeat'}})).status,200);
db.prepare('UPDATE messages SET message=? WHERE id=?').run('deleted-text-must-not-be-retained',reactionIds[0]);
assert.equal((await call('/api/chat/message/'+reactionIds[0],{cookie:alice.cookie,method:'DELETE'})).status,200);
const privateAudit=await call('/api/admin/activity',{headers:{'X-Admin-Key':env.ADMIN_KEY}});assert.equal(privateAudit.status,200);assert.equal(privateAudit.headers.get('Cache-Control'),'no-store');
const activity=await privateAudit.json();assert.equal(activity.visitors[0].views,1);assert.equal(activity.sessions[0].device,'Mobile');assert.equal(activity.sessions[0].browser,'Chrome');
const deletion=activity.events.find(e=>e.action==='message_deleted'&&e.target_id===reactionIds[0]);assert.ok(deletion);assert.equal(deletion.actor_name,alice.user.username);assert.equal(deletion.details.by_admin,false);
assert.ok(!JSON.stringify(activity.events).includes('deleted-text-must-not-be-retained'));
assert.equal(activity.deleted_messages.find(m=>m.message_id===reactionIds[0]).message,'deleted-text-must-not-be-retained');assert.ok(!JSON.stringify(activity).includes(alice.user.id));
assert.ok(activity.events.some(e=>e.action==='reaction_added'));assert.ok(activity.events.some(e=>e.action==='reaction_removed'));
console.log('PASS: private activity dashboard, authenticated visits, CSRF, page allowlist, device labels, view deduplication and content-free deletion audit');


// Archive is private, does not restore public messages, and expires after 30 days.
assert.equal((await call('/api/admin/activity')).status,403);
assert.ok(!JSON.stringify(await(await call('/api/chat')).json()).includes('deleted-text-must-not-be-retained'));
assert.equal((await call('/api/chat/message/'+reactionIds[0],{cookie:alice.cookie,method:'DELETE'})).status,404);
assert.equal(db.prepare('SELECT COUNT(*) n FROM deleted_chat_archive WHERE message_id=?').get(reactionIds[0]).n,1);
db.prepare('UPDATE deleted_chat_archive SET deleted_at=? WHERE message_id=?').run(Date.now()-31*86400000,reactionIds[0]);
const expired=await(await call('/api/admin/activity',{headers:{'X-Admin-Key':env.ADMIN_KEY}})).json();
assert.ok(!expired.deleted_messages.some(m=>m.message_id===reactionIds[0]));
assert.equal(db.prepare('SELECT message_id FROM deleted_chat_archive WHERE message_id=?').get(reactionIds[0]),undefined);
db.prepare('INSERT INTO deleted_chat_archive VALUES(?,?,?,?,?,?,?)').run('expired-cron','sender','expired text','2020-01-01',Date.now()-31*86400000,'Admin','text');
let cleanup;await worker.scheduled({},env,{waitUntil(p){cleanup=p;}});await cleanup;
assert.equal(db.prepare("SELECT COUNT(*) n FROM deleted_chat_archive WHERE message_id='expired-cron'").get().n,0);
assert.ok(db.prepare('SELECT COUNT(*) n FROM deleted_chat_archive').get().n>0,'Fresh archived messages survive cleanup');
console.log('PASS: admin-only deleted text, public absence, duplicate deletion, 30-day expiry and scheduled purge');


// Added emoji allowlist and on-demand reactor names contain no identity cookies.
for(const emoji of ['🤣','😭','💔','💀','🤔','😱','🫣','😖','😍','😕','👾','💘','💋','💞']){
 assert.equal((await call('/api/chat/reactions',{cookie:alice.cookie,method:'POST',body:{message_id:reactionIds[99],emoji,active:true}})).status,200);
 const d=await(await call('/api/chat/reactions?message_id='+reactionIds[99]+'&emoji='+encodeURIComponent(emoji))).json();
 assert.deepEqual(d.people,[alice.user.username]);assert.ok(!JSON.stringify(d).includes(alice.user.id));
}
for(let n=0;n<102;n++){
 db.prepare('INSERT INTO users(id,username) VALUES(?,?)').run('reactor-'+n,'reactor_'+String(n).padStart(3,'0'));
 db.prepare('INSERT INTO message_reactions VALUES(?,?,?)').run(reactionIds[99],'reactor-'+n,'👾');
}
const firstPeople=await(await call('/api/chat/reactions?message_id='+reactionIds[99]+'&emoji='+encodeURIComponent('👾'))).json();
assert.equal(firstPeople.people.length,100);assert.equal(firstPeople.has_more,true);
const nextPeople=await(await call('/api/chat/reactions?message_id='+reactionIds[99]+'&emoji='+encodeURIComponent('👾')+'&after='+encodeURIComponent(firstPeople.next))).json();
assert.equal(new Set([...firstPeople.people,...nextPeople.people]).size,103);
assert.equal(nextPeople.has_more,false);
assert.equal((await call('/api/chat/reactions?message_id=missing&emoji='+encodeURIComponent('😭'))).status,404);
console.log('PASS: new reactions, public usernames without credentials, bounded paginated names and deleted/missing messages');
