import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
if(!globalThis.crypto)Object.defineProperty(globalThis,'crypto',{value:webcrypto});

const source=fs.readFileSync(new URL('../src/deeplist.js',import.meta.url),'utf8');
const {handleDeeplist,validateState,listeningSession}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
class DB {
 sqlite=new DatabaseSync(':memory:');
 get row(){return this.sqlite.prepare('SELECT * FROM deeplist_bridge WHERE id=1').get()||null;}
 prepare(sql){const stmt=this.sqlite.prepare(sql);let args=[];return{bind(...a){args=a;return this;},async first(){return stmt.get(...args)||null;},async all(){return{results:stmt.all(...args)};},async run(){const result=stmt.run(...args);return{meta:{changes:Number(result.changes)}};}};}
}
const db=new DB(),env={DB:db},isAdmin=async r=>r.headers.get('X-Admin-Key')==='correct-admin-key';
const request=(path,method='GET',body,headers={})=>new Request('https://example.com'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
const call=(r)=>handleDeeplist(r,env,isAdmin);
assert.equal((await call(request('/api/deeplist/pair','POST'))).status,403);
assert.equal((await call(request('/api/deeplist/state'))).status,200);
let paired=await(await call(request('/api/deeplist/pair','POST',undefined,{'X-Admin-Key':'correct-admin-key'}))).json();
assert.match(paired.token,/^[a-f0-9]{64}$/);assert.equal(paired.website,'https://example.com');
const track={id:'abcdefghijk',title:'A test song',artist:'Artist',position:1500,duration:60000,playing:true,lines:[{time:1000,text:'First line',words:[{text:'First',start:1000,end:1800}]}]};
const auth={Authorization:'Bearer '+paired.token};
assert.equal((await call(request('/api/deeplist/state','POST',track))).status,401);
assert.equal((await call(request('/api/deeplist/state','POST',track,auth))).status,200);
let state=await(await call(request('/api/deeplist/state'))).json();assert.equal(state.state.lines.length,1);assert.equal(state.connected,true);assert.equal('token_hash' in state,false);
const version=state.state.lyricsVersion; const reduced=await(await call(request('/api/deeplist/state?lyricsVersion='+encodeURIComponent(version)))).json();assert.equal(reduced.state.lines,undefined,'Unchanged lyrics must not be downloaded every heartbeat');
const {lines,...progress}=track;progress.position=4000;progress.playing=false;
await call(request('/api/deeplist/state','POST',progress,auth));state=await(await call(request('/api/deeplist/state'))).json();assert.equal(state.state.lines.length,1);assert.equal(state.state.position,4000);assert.equal(state.state.playing,false);
progress.id='ZYXWVUTSRQP';await call(request('/api/deeplist/state','POST',progress,auth));state=await(await call(request('/api/deeplist/state'))).json();assert.equal(state.state.lines.length,0,'New track must not inherit previous lyrics');
assert.equal(validateState({...track,position:-1}),null);assert.equal(validateState({...track,lines:[{time:0,text:'bad',words:[{text:'x',start:10,end:2}]}]}),null);
assert.equal((await call(request('/api/deeplist/state','POST',{...track,title:'x'.repeat(301)},auth))).status,400);
db.sqlite.prepare('UPDATE deeplist_bridge SET updated_at=?').run(Date.now()-16000);assert.equal((await(await call(request('/api/deeplist/state'))).json()).connected,false);
await call(request('/api/deeplist/pair','POST',undefined,{'X-Admin-Key':'correct-admin-key'}));assert.equal((await call(request('/api/deeplist/state','POST',track,auth))).status,401,'Rotation must revoke old code');
assert.equal((await call(request('/api/deeplist/pair','DELETE'))).status,403);
assert.equal((await call(request('/api/deeplist/pair','DELETE',undefined,{'X-Admin-Key':'correct-admin-key'}))).status,200);assert.equal(db.row,null);
console.log('PASS: auth, pairing, rotation, revocation, validation, stale expiry, pause/seek and track lyric isolation');

const initial={...track,_history:{session:'one',started:1000,listened:28000}};
assert.equal(listeningSession(track,initial,1000,3000).listened,30000);
assert.equal(listeningSession(track,{...initial,playing:false},1000,3000).listened,28000);
assert.equal(listeningSession(track,initial,1000,20000).listened,28000,'Offline gaps are not counted');
assert.equal(listeningSession({...track,id:'ZYXWVUTSRQP'},initial,1000,3000,()=> 'next').session,'next');
assert.equal(listeningSession({...track,position:100}, {...initial,position:59000},1000,3000,()=> 'replay').session,'replay');
const newPair=await(await call(request('/api/deeplist/pair','POST',undefined,{'X-Admin-Key':'correct-admin-key'}))).json();
const newAuth={Authorization:'Bearer '+newPair.token};
const oldNow=Date.now;let now=1000000;Date.now=()=>now;
try {
 await call(request('/api/deeplist/state','POST',track,newAuth));
 for(let i=0;i<16;i++){now+=2000;await call(request('/api/deeplist/state','POST',{...progress,id:track.id,playing:true,position:1500+i*2000},newAuth));}
 let recent=await(await call(request('/api/deeplist/history'))).json();assert.equal(recent.tracks.length,1,'One entry per listening session');
 now+=2000;await call(request('/api/deeplist/state','POST',{...progress,id:track.id,playing:false},newAuth));
 now+=10000;await call(request('/api/deeplist/state','POST',{...progress,id:track.id,playing:true},newAuth));
 recent=await(await call(request('/api/deeplist/history'))).json();assert.equal(recent.tracks.length,1,'Pause/resume does not duplicate');
 const repeat=await(await call(request('/api/deeplist/on-repeat'))).json();assert.equal(repeat.tracks[0].plays,1);
 const publicResponse=await(await call(request('/api/deeplist/state'))).json();assert.equal('_history' in publicResponse.state,false);
 await call(request('/api/deeplist/pair','DELETE',undefined,{'X-Admin-Key':'correct-admin-key'}));
 recent=await(await call(request('/api/deeplist/history'))).json();assert.equal(recent.tracks.length,1,'Disconnect must preserve listening history');
} finally {Date.now=oldNow;}
console.log('PASS: real SQLite schema, history threshold, no heartbeat/pause duplicates, offline gaps, replays, weekly counts and preserved history');
