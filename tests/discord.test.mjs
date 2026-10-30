import assert from 'node:assert/strict';
import { postDiscordMessage, queueDiscordMessage } from '../src/discord.js';
import worker from '../src/index.js';
import { DatabaseSync } from 'node:sqlite';

const originalFetch=globalThis.fetch, originalWarn=console.warn;
let calls=[], warnings=[];
console.warn=(...args)=>warnings.push(args.join(' '));
globalThis.fetch=async(url,options)=>{calls.push({url,options});return new Response('{}');};
const env={DISCORD_WEBHOOK_URL:'https://discord.com/api/webhooks/123/test-secret',DB:{prepare(){throw new Error('identity unavailable');}}};
const user={id:'listener',username:'Deepu'};
try {
  queueDiscordMessage({}, {waitUntil(){throw new Error('disabled bridge queued');}},user,{id:'1',text:'hello'});
  let task;
  queueDiscordMessage(env,{waitUntil(p){task=p;}},user,{id:'1',text:'hello @everyone',image:true});
  await task;
  assert.equal(calls.length,1);
  const payload=JSON.parse(calls[0].options.body);
  assert.equal(payload.username,'Deepu');
  assert.deepEqual(payload.allowed_mentions.parse,[]);
  assert.match(payload.embeds[0].description,/Photo shared/);
  assert.equal(payload.embeds[0].color,0xbca4f5);
  assert.equal(calls[0].options.redirect,'error');
  for(const url of ['http://discord.com/api/webhooks/123/secret','https://evil.example/api/webhooks/123/secret'])await postDiscordMessage({...env,DISCORD_WEBHOOK_URL:url},user,{id:'x',text:'hi'});
  assert.equal(calls.length,1,'Reject untrusted webhook hosts');
  let attempts=0;
  globalThis.fetch=async()=>{attempts++;return attempts===1?Response.json({retry_after:0.001},{status:429}):new Response('{}');};
  await postDiscordMessage(env,user,{id:'2',text:'retry'});
  assert.equal(attempts,2);
  attempts=0;
  globalThis.fetch=async()=>{attempts++;return Response.json({retry_after:90},{status:429});};
  await postDiscordMessage(env,user,{id:'3',text:'skip'});
  assert.equal(attempts,1);
  globalThis.fetch=async()=>{throw new Error('contains test-secret');};
  await postDiscordMessage(env,user,{id:'4',text:'offline'});
  assert.ok(!warnings.join(' ').includes('test-secret'));

  // Exercise the real send routes with SQLite and an unavailable Discord API.
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE users(id TEXT PRIMARY KEY,username TEXT,created_at TEXT);CREATE TABLE conversations(id TEXT PRIMARY KEY,user_id TEXT,created_at TEXT);CREATE TABLE messages(id TEXT PRIMARY KEY,conversation_id TEXT,sender_id TEXT,message TEXT,parent_id TEXT,created_at TEXT);');
  const DB={prepare(sql){let args=[];return {bind(...a){args=a;return this;},async first(){return sqlite.prepare(sql).get(...args)||null;},async all(){return {results:sqlite.prepare(sql).all(...args)};},async run(){return {meta:{changes:Number(sqlite.prepare(sql).run(...args).changes)}};}};},async batch(ss){return Promise.all(ss.map(s=>s.run()));}};
  const pending=[],ctx={waitUntil(p){pending.push(p);}};
  const target={DB,DISCORD_WEBHOOK_URL:env.DISCORD_WEBHOOK_URL,ASSETS:{fetch(){return new Response('404',{status:404});}}};
  const call=(path,opts={})=>worker.fetch(new Request('https://example.com'+path,opts),target,ctx);
  const signup=await call('/api/user');
  const cookie=signup.headers.get('Set-Cookie').split(';')[0];
  for(const path of ['/api/chat/send','/api/messages']){
    const r=await call(path,{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({message:'hello bridge'})});
    assert.equal(r.status,200);
    assert.equal((await r.json()).success,true);
  }
  await Promise.all(pending);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM messages').get().n,2);
  const before=pending.length;
  assert.equal((await call('/api/chat/send',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({message:''})})).status,400);
  assert.equal(pending.length,before,'Rejected messages never bridge');
  sqlite.close();
  console.log('PASS: webhook payload, host validation, bounded 429 retry, secret-safe failure and nonblocking real send routes');
} finally {globalThis.fetch=originalFetch;console.warn=originalWarn;}
