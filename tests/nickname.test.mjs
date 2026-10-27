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
const db=new DB(),env={DB:db,ADMIN_KEY:'test-administrator-secret'},ctx={waitUntil(){}};
const request=(path,{cookie='',method='GET',body,headers={}}={})=>new Request('https://example.com'+path,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined});
const call=(path,options)=>worker.fetch(request(path,options),env,ctx);
const create=async()=>{const r=await call('/api/user');assert.equal(r.status,200);const d=await r.json();return {cookie:r.headers.get('Set-Cookie').split(';')[0],user:d.user};};
const first=await create(),second=await create();
const set=(person,nickname,symbol='',color='lavender',extra={})=>call('/api/user/nickname',{cookie:person.cookie,method:'POST',body:{nickname,symbol,color},...extra});
assert.equal((await call('/api/user/nickname')).status,401);
assert.equal((await set(first,'deepu','🪐','mint',{headers:{Origin:'https://evil.example'}})).status,403);
for(const [name,symbol,color]of [['<script>','','mint'],['a','','mint'],['hello','<img>','mint'],['hello','','red;display:none']])assert.equal((await set(first,name,symbol,color)).status,400);
let r=await set(first,'deepu','🪐','mint');assert.equal(r.status,200);let d=await r.json();assert.equal(d.user.username,'deepu');assert.equal(d.user.symbol,'🪐');assert.equal(d.user.color,'mint');
let again=await(await call('/api/user',{cookie:first.cookie})).json();assert.equal(again.user.username,'deepu','Reload must not re-add damn_');
assert.equal((await set(second,'DEEPu','♡','rose')).status,409,'Names remain case-insensitively unique');
assert.equal((await set(second,'sleepy cassette','♡','rose')).status,200,'Taken-name attempts do not consume the cooldown');
assert.equal((await set(first,'another name')).status,429);
const initialChange=db.sqlite.prepare('SELECT last_changed FROM chat_nicknames WHERE user_id=?').get(first.user.id).last_changed;
r=await set(first,'deepu','🎧','sky');assert.equal(r.status,200,'Style-only changes remain available during name cooldown');
assert.equal(db.sqlite.prepare('SELECT last_changed FROM chat_nicknames WHERE user_id=?').get(first.user.id).last_changed,initialChange);
const realNow=Date.now;Date.now=()=>initialChange+24*3600000+1;
try{assert.equal((await set(first,'midnight ghost','✦','gold')).status,200,'Names unlock after 24 hours');}finally{Date.now=realNow;}
// Explicit legacy-looking names also survive reload.
const third=await create();assert.equal((await set(third,'User123','🫧','peach')).status,200);
assert.equal((await(await call('/api/user',{cookie:third.cookie})).json()).user.username,'User123');
// Simultaneous claims do not create duplicate names or mix one person's style with another.
const a=await create(),b=await create();const outcomes=await Promise.all([set(a,'lunar chai','♡','rose'),set(b,'lunar chai','⚡','mint')]);assert.deepEqual(outcomes.map(x=>x.status).sort(),[200,409]);
const winner=db.sqlite.prepare("SELECT id FROM users WHERE username='lunar chai'").get();const winnerStyle=db.sqlite.prepare('SELECT symbol,color FROM chat_identity WHERE user_id=?').get(winner.id);assert.deepEqual({...winnerStyle},winner.id===a.user.id?{symbol:'♡',color:'rose'}:{symbol:'⚡',color:'mint'});
// Existing messages keep their IDs and inherit the current author identity without exposing user IDs.
db.sqlite.prepare('INSERT INTO messages(id,message,sender_id,created_at) VALUES(?,?,?,?)').run('old-message','Still here',first.user.id,'2026-10-26T12:00:00Z');
const feed=await(await call('/api/chat',{cookie:first.cookie})).json();assert.equal(feed.success,true);const message=feed.messages.find(x=>x.id==='old-message');assert.equal(message.username,'midnight ghost');assert.equal(message.symbol,'✦');assert.equal(message.color,'gold');assert.equal('sender_id' in message,false);
// Link only this browser's music channel; preserve other listener names and public visibility rules.
const meResponse=await call('/api/deeplist/me',{headers:{'X-Deeplist-Action':'session'}}),me=await meResponse.json();const musicCookie=meResponse.headers.get('Set-Cookie').split(';')[0];
const combined=first.cookie+'; '+musicCookie;
await call('/api/user/nickname',{cookie:combined});
const pair=await(await call('/api/deeplist/pair?scope=visitor',{cookie:combined,method:'POST',headers:{'X-Deeplist-Action':'pair'}})).json();
const track={id:'abcdefghijk',title:'Track',artist:'Artist',position:1000,duration:60000,playing:true};
assert.equal((await call('/api/deeplist/state',{method:'POST',body:track,headers:{Authorization:'Bearer '+pair.token}})).status,200);
const ranking=await(await call('/api/deeplist/stats')).json(),listener=ranking.listeners.find(x=>x.channel===me.channel);assert.equal(listener.label,'midnight ghost');assert.equal(listener.symbol,'✦');assert.equal(listener.color,'gold');assert.equal('user_id' in listener,false);
assert.equal((await call('/api/deeplist/name',{cookie:combined,method:'POST',body:{displayName:'Conflicting name'},headers:{'X-Deeplist-Action':'name'}})).status,409);
db.sqlite.prepare('INSERT INTO deeplist_listening_months(channel_id,month,listened_ms) VALUES(?,?,?)').run(me.channel,'2026-10',120000);
assert.equal((await set({cookie:combined},'midnight ghost','🌙','sky')).status,200);
assert.equal((await(await call('/api/deeplist/stats')).json()).listeners.find(x=>x.channel===me.channel).totalMs,120000,'Style/name linking preserves recorded listening totals');
const directory=await(await call('/api/deeplist/listeners')).json();assert.equal(directory.listeners[0].label,'midnight ghost');assert.equal(directory.listeners[0].symbol,'🌙');
await call('/api/deeplist/pair?scope=visitor',{cookie:combined,method:'DELETE',headers:{'X-Deeplist-Action':'pair'}});assert.ok((await(await call('/api/deeplist/stats')).json()).listeners.every(x=>x.channel!==me.channel));
assert.equal(db.sqlite.prepare('SELECT message FROM messages WHERE id=?').get('old-message').message,'Still here');
console.log('PASS: prefix-free persistent names, allowlisted styles, unique claims, 24-hour cooldown, style-only edits, CSRF, saved messages, shared music identity and revocation');
