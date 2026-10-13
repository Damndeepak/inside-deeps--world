import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
if(!globalThis.crypto)Object.defineProperty(globalThis,'crypto',{value:webcrypto});

const visitorSource=fs.readFileSync(new URL('../src/deeplist-visitors.js',import.meta.url),'utf8');
const visitorModule='data:text/javascript;base64,'+Buffer.from(visitorSource).toString('base64');
const source=fs.readFileSync(new URL('../src/deeplist.js',import.meta.url),'utf8').replace('from "./deeplist-visitors.js"','from '+JSON.stringify(visitorModule));
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

const browserHeaders={ 'X-Deeplist-Action':'session' };
assert.equal((await call(request('/api/deeplist/me'))).status,403);
assert.equal((await call(request('/api/deeplist/me','GET',undefined,{'X-Deeplist-Action':'session','Sec-Fetch-Site':'cross-site'}))).status,403);
const meResponseA=await call(request('/api/deeplist/me','GET',undefined,browserHeaders));
const meA=await meResponseA.json(), cookieA=meResponseA.headers.get('Set-Cookie').split(';')[0];
assert.match(meResponseA.headers.get('Set-Cookie'),/HttpOnly; Secure; SameSite=Strict/);
assert.ok(meA.channel);assert.equal('token' in meA,false);
const meResponseB=await call(request('/api/deeplist/me','GET',undefined,browserHeaders));
const meB=await meResponseB.json(), cookieB=meResponseB.headers.get('Set-Cookie').split(';')[0];
assert.notEqual(meA.channel,meB.channel);
assert.equal((await(await call(request('/api/deeplist/me','GET',undefined,{...browserHeaders,Cookie:cookieA}))).json()).channel,meA.channel);
assert.equal((await call(request('/api/deeplist/pair?scope=visitor','POST',undefined,{'X-Deeplist-Action':'pair'}))).status,401);
assert.equal((await call(request('/api/deeplist/pair?scope=visitor','POST',undefined,{Cookie:cookieA}))).status,403);
const pairA=await(await call(request('/api/deeplist/pair?scope=visitor','POST',undefined,{Cookie:cookieA,'X-Deeplist-Action':'pair'}))).json();
const pairB=await(await call(request('/api/deeplist/pair?scope=visitor','POST',undefined,{Cookie:cookieB,'X-Deeplist-Action':'pair'}))).json();
const ownerPair=await(await call(request('/api/deeplist/pair','POST',undefined,{'X-Admin-Key':'correct-admin-key'}))).json();
await call(request('/api/deeplist/state','POST',{...track,title:'Deepu track'},{Authorization:'Bearer '+ownerPair.token}));
await call(request('/api/deeplist/state?user='+meB.channel,'POST',{...track,title:'Visitor A',id:'AAAAAAAAAAA'},{Authorization:'Bearer '+pairA.token}));
await call(request('/api/deeplist/state','POST',{...track,title:'Visitor B',id:'BBBBBBBBBBB'},{Authorization:'Bearer '+pairB.token}));
const visitorState=async channel=> (await(await call(request('/api/deeplist/state?user='+channel))).json());
assert.equal((await visitorState(meA.channel)).state.title,'Visitor A');
assert.equal((await visitorState(meB.channel)).state.title,'Visitor B');
assert.equal((await(await call(request('/api/deeplist/state'))).json()).state.title,'Deepu track');
assert.equal((await call(request('/api/deeplist/name','POST',{displayName:'Rahul'},{'X-Deeplist-Action':'name'}))).status,401);
assert.equal((await call(request('/api/deeplist/name','POST',{displayName:'x'.repeat(33)},{Cookie:cookieA,'X-Deeplist-Action':'name'}))).status,400);
await call(request('/api/deeplist/name?user='+meB.channel,'POST',{displayName:'  Rahul  '},{Cookie:cookieA,'X-Deeplist-Action':'name'}));
assert.equal((await visitorState(meA.channel)).label,'Rahul');
assert.notEqual((await visitorState(meB.channel)).label,'Rahul');
assert.equal((await(await call(request('/api/deeplist/me','GET',undefined,{...browserHeaders,Cookie:cookieA}))).json()).displayName,'Rahul');
const directory=await(await call(request('/api/deeplist/listeners'))).json();assert.equal(directory.listeners.length,2);assert.equal(directory.listeners.find(x=>x.channel===meA.channel).label,'Rahul');assert.ok(directory.listeners.every(x=>!('token_hash' in x)&&!('payload' in x)&&!('browser_hash' in x)));
assert.equal((await call(request('/api/deeplist/state?user=bad'))).status,400);
assert.equal((await call(request('/api/deeplist/history?user='+meA.channel))).status,404);
await call(request('/api/deeplist/pair?scope=visitor&user='+meB.channel,'DELETE',undefined,{Cookie:cookieA,'X-Deeplist-Action':'pair'}));
assert.equal((await visitorState(meA.channel)).connected,false);assert.equal((await visitorState(meB.channel)).connected,true);
assert.equal((await call(request('/api/deeplist/state','POST',track,{Authorization:'Bearer '+pairA.token}))).status,401);
assert.equal((await(await call(request('/api/deeplist/state'))).json()).state.title,'Deepu track');
const freshB=await(await call(request('/api/deeplist/pair?scope=visitor','POST',undefined,{Cookie:cookieB,'X-Deeplist-Action':'pair'}))).json();
assert.equal(freshB.channel,meB.channel);assert.equal((await call(request('/api/deeplist/state','POST',track,{Authorization:'Bearer '+pairB.token}))).status,401);
console.log('PASS: separate secure browser sessions, two visitors plus owner, no token leaks, scoped publishing, rotation, revocation and cross-site rejection');

await call(request('/api/deeplist/name','POST',{displayName:''},{Cookie:cookieA,'X-Deeplist-Action':'name'}));
assert.match((await visitorState(meA.channel)).label,/^Listener · /);
console.log('PASS: optional names, bounds, persistence, directory labels and browser ownership');
