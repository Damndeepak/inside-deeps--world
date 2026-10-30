import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {handleActivity,visitLocation} from '../src/activity.js';
const sql=new DatabaseSync(':memory:');
sql.exec("CREATE TABLE users(id TEXT PRIMARY KEY,username TEXT); INSERT INTO users VALUES('visitor','deepu'); CREATE TABLE site_sessions(session_id TEXT NOT NULL,user_id TEXT NOT NULL,page TEXT NOT NULL,first_seen INTEGER NOT NULL,last_seen INTEGER NOT NULL,views INTEGER NOT NULL,device TEXT NOT NULL,browser TEXT NOT NULL,os TEXT NOT NULL,PRIMARY KEY(session_id,user_id,page)); INSERT INTO site_sessions VALUES('old-session-12345','visitor','/memories',1,2,1,'Mobile','Chrome','Android');");
const DB={prepare(query){let args=[];return {bind(...values){args=values;return this},async run(){return {meta:{changes:Number(sql.prepare(query).run(...args).changes)}}},async first(){return sql.prepare(query).get(...args)||null},async all(){return {results:sql.prepare(query).all(...args)}}}},async batch(statements){return Promise.all(statements.map(s=>s.run()))}};
const helpers={getUserId:()=> 'visitor',getUser:async()=>({id:'visitor',username:'deepu'}),chatIsAdmin:async request=>request.headers.get('X-Admin-Key')==='test'};
const env={DB};
const get=async key=>handleActivity(new Request('https://example.com/api/admin/activity',{headers:key?{'X-Admin-Key':key}:{}}),env,helpers);
assert.equal((await get()).status,403);
assert.equal(sql.prepare("SELECT name FROM sqlite_master WHERE name='site_visit_locations'").get(),undefined,'Unauthorized reads do not create or expose location records');
const session='new-session-123456';
async function visit(cf,kind='view',extra={}){const r=new Request('https://example.com/api/activity',{method:'POST',headers:{Origin:'https://example.com','Content-Type':'application/json'},body:JSON.stringify({session,page:'/',kind,...extra})});Object.defineProperty(r,'cf',{value:cf});return handleActivity(r,env,helpers)}
assert.deepEqual(visitLocation({}),{city:null,region:null,country:null});
assert.deepEqual(visitLocation({cf:{city:' Surat\u0000 ',region:42,country:'invalid'}}),{city:'Surat',region:null,country:null});
assert.equal((await visit({city:'Surat',region:'Gujarat',country:'IN'},'view',{city:'Fake city'})).status,200);
let response=await get('test');assert.equal(response.headers.get('Cache-Control'),'no-store');let data=await response.json();
assert.deepEqual(data.visitors[0].location,{city:'Surat',region:'Gujarat',country:'IN'});
assert.equal(data.sessions.find(s=>s.page==='/').city,'Surat');
assert.equal(data.sessions.find(s=>s.page==='/memories').city,null,'Old records stay intact with unknown location');
assert.equal(data.events[0].details.city,'Surat');
await visit({city:'Ahmedabad',region:'Gujarat',country:'IN'});
assert.equal(sql.prepare('SELECT city FROM site_visit_locations').get().city,'Surat','Duplicate views do not add location writes');
const originalNow=Date.now;Date.now=()=>originalNow()+11000;
try{await visit({city:'Ahmedabad',region:'Gujarat',country:'IN'});data=await (await get('test')).json();assert.equal(data.visitors[0].location.city,'Ahmedabad');assert.equal(data.sessions.find(s=>s.page==='/').views,2)}finally{Date.now=originalNow}
assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM site_visit_locations').get().n,1);
assert.equal((await get('wrong')).status,403);
assert.ok(!JSON.stringify(data).includes('Fake city'));
console.log('PASS: migration without ALTER, server-derived city, admin-only access, no-store, deduplication, latest city, old records and unknown metadata');
