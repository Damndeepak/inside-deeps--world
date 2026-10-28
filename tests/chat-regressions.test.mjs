import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {webcrypto} from 'node:crypto';
import worker from '../src/index.js';
if(!globalThis.crypto)Object.defineProperty(globalThis,'crypto',{value:webcrypto});
class DB {
 sqlite=new DatabaseSync(':memory:');
 constructor(){this.sqlite.exec('CREATE TABLE users(id TEXT PRIMARY KEY,username TEXT NOT NULL,created_at TEXT);CREATE TABLE messages(id TEXT PRIMARY KEY,message TEXT,parent_id TEXT,sender_id TEXT,conversation_id TEXT,created_at TEXT);');}
 prepare(sql){const db=this.sqlite;let args=[];return{bind(...values){args=values;return this;},async first(){return db.prepare(sql).get(...args)||null;},async all(){return{results:db.prepare(sql).all(...args)};},async run(){const result=db.prepare(sql).run(...args);return{meta:{changes:Number(result.changes)}};}};}
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
for(const path of ['/metrolist','/metrolist.html','/metrolist/']){
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
