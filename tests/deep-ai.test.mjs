import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { webcrypto } from 'node:crypto';
import worker from '../src/index.js';
import { DEEP_AI_ID, S_AI_ID, DEEP_AI_MODEL, S_AI_MODEL, aiTargets, mentionsSAI, mentionsDeepAI, queueDeepAI, deepAIStatus } from '../src/deep-ai.js';
if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: webcrypto });

class DB {
  sqlite = new DatabaseSync(':memory:');
  constructor() { this.sqlite.exec('CREATE TABLE users(id TEXT PRIMARY KEY,username TEXT NOT NULL,created_at TEXT);CREATE TABLE conversations(id TEXT PRIMARY KEY,user_id TEXT,created_at TEXT);CREATE TABLE messages(id TEXT PRIMARY KEY,message TEXT,parent_id TEXT,sender_id TEXT,conversation_id TEXT,created_at TEXT);'); }
  prepare(sql) {
    const db = this.sqlite; let args = [];
    return { bind(...values) { args = values; return this; }, async first() { return db.prepare(sql).get(...args) || null; }, async all() { return { results: db.prepare(sql).all(...args) }; }, async run() { return { meta: { changes: Number(db.prepare(sql).run(...args).changes) } }; } };
  }
  batch(statements) {
    const result = (this.pending || Promise.resolve()).then(async () => {
      this.sqlite.exec('BEGIN');
      try { const out = []; for (const statement of statements) out.push(await statement.run()); this.sqlite.exec('COMMIT'); return out; }
      catch (error) { this.sqlite.exec('ROLLBACK'); throw error; }
    });
    this.pending = result.catch(() => {}); return result;
  }
}

function setup() {
  const calls = [], tasks = [];
  const env = { DB: new DB(), AI: { run: async (model, input) => { calls.push({ model, input }); return { response: 'Try a little music and a little chaos. ✦' }; } } };
  env.DB.sqlite.prepare('INSERT INTO users VALUES(?,?,?)').run('visitor', 'realperson', '2026-01-01');
  env.DB.sqlite.prepare('INSERT INTO conversations VALUES(?,?,?)').run('room', 'visitor', '2026-01-01');
  const ctx = { waitUntil(promise) { tasks.push(promise); } };
  const flush = async () => { while (tasks.length) await Promise.all(tasks.splice(0)); };
  const source = (id, message = '@deepAi suggest a song', parent_id = null, sender_id = 'visitor') => {
    const row = { id, message, parent_id, sender_id };
    env.DB.sqlite.prepare('INSERT INTO messages VALUES(?,?,?,?,?,?)').run(id, message, parent_id, sender_id, 'room', new Date().toISOString());
    return row;
  };
  const request = (ip = '192.0.2.1') => new Request('https://example.com/api/chat/send', { headers: { 'CF-Connecting-IP': ip } });
  return { env, calls, ctx, flush, source, request };
}

assert.equal(mentionsDeepAI('hey @DeepAi!'), true);
assert.equal(mentionsDeepAI('@deepAi\nhi'), true);
for (const text of ['deepAi', 'a@deepAi.comx', '@deepAii', '@deepAi_extra', 'hello']) {
  assert.equal(mentionsDeepAI(text), false);
}
let t = setup();
assert.equal((await deepAIStatus(t.env)).available, true);
assert.equal((await deepAIStatus(t.env, 'not-a-message')).state, 'missing');
assert.equal(t.env.DB.sqlite.prepare("SELECT name FROM sqlite_master WHERE name='chat_ai_jobs'").get(), undefined, 'Status checks do not write schema or create a bot');
assert.equal(await queueDeepAI(t.env, t.ctx, t.source('ordinary', 'hi everyone'), t.request()), null);
assert.equal(t.calls.length, 0, 'Ordinary chat never invokes AI');
t.source('unrelated', 'DO NOT SEND THIS SURROUNDING MESSAGE');
const first = t.source('ask');
assert.equal((await queueDeepAI(t.env, t.ctx, first, t.request())).state, 'pending');
await t.flush();
assert.equal(t.calls[0].model, DEEP_AI_MODEL);
assert.equal(t.calls[0].input.max_tokens, 320);
assert.ok(!JSON.stringify(t.calls).includes('DO NOT SEND THIS'));
assert.ok(!JSON.stringify(t.calls).includes('192.0.2.1'));
const bot = t.env.DB.sqlite.prepare('SELECT * FROM messages WHERE sender_id=?').get(DEEP_AI_ID);
assert.equal(bot.parent_id, first.id);
assert.equal((await deepAIStatus(t.env, first.id)).state, 'done');
await queueDeepAI(t.env, t.ctx, first, t.request()); await t.flush();
assert.equal(t.calls.length, 1, 'The same source message is never billed/generated twice');
const limited = await queueDeepAI(t.env, t.ctx, t.source('too-fast'), t.request());
assert.equal(limited.state, 'limited');
assert.equal(t.calls.length, 1);
assert.equal(await queueDeepAI(t.env, t.ctx, { id: bot.id, message: '@deepAi loop', sender_id: DEEP_AI_ID }, t.request()), null);

// Follow-ups receive only their bounded reply chain and preserve server-assigned roles.
const realNow = Date.now;
Date.now = () => realNow() + 21000;
try {
  assert.equal((await queueDeepAI(t.env, t.ctx, t.source('followup', 'one more?', bot.id), t.request())).state, 'pending');
  await t.flush();
  assert.equal(t.calls[1].input.messages.at(-2).role, 'assistant');
  assert.equal(t.calls[1].input.messages.at(-1).content, 'one more?');
  assert.ok(!JSON.stringify(t.calls[1]).includes('DO NOT SEND THIS'));
} finally { Date.now = realNow; }

// Missing/disabled inference never loses or rejects a saved human message.
for (const enabled of [false, true]) {
  t = setup();
  if (enabled) t.env.DEEP_AI_ENABLED = 'false'; else delete t.env.AI;
  assert.equal((await queueDeepAI(t.env, t.ctx, t.source('offline'), t.request())).state, 'unavailable');
  assert.equal(t.env.DB.sqlite.prepare('SELECT message FROM messages WHERE id=?').get('offline').message, '@deepAi suggest a song');
  assert.equal(t.calls.length, 0);
}
t = setup(); t.env.AI.run = async () => { throw new Error('upstream private diagnostic'); };
await queueDeepAI(t.env, t.ctx, t.source('failure'), t.request()); await t.flush();
assert.equal((await deepAIStatus(t.env, 'failure')).state, 'failed');
assert.ok(!JSON.stringify(await deepAIStatus(t.env, 'failure')).includes('private diagnostic'));
assert.equal(t.env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM messages').get().n, 1);

// Distinct visitors below the room safety budget can all ask.
t = setup();
const claims = await Promise.all(Array.from({ length: 65 }, (_, i) => queueDeepAI(t.env, t.ctx, t.source('race-' + i, '@deepAi hello', null, 'user-' + i), t.request('192.0.2.' + i))));
await t.flush();
assert.equal(claims.filter(v => v.state === 'pending').length, 65);
assert.equal(t.calls.length, 65, 'Visitors within the room daily budget');
assert.ok(t.env.DB.sqlite.prepare('SELECT ip_hash FROM chat_ai_jobs LIMIT 1').get().ip_hash.match(/^[a-f0-9]{64}$/));

// No daily per-user or IP cap after the brief cooldown.
for (const kind of ['user', 'ip']) {
  t = setup(); const start = realNow();
  try {
    for (let i = 0; i < 22; i++) {
      Date.now = () => start + i * 21000;
      const user = kind === 'user' ? 'visitor' : 'fresh-' + i;
      const result = await queueDeepAI(t.env, t.ctx, t.source('budget-' + i, '@deepAi hi', null, user), t.request());
      assert.equal(result.state, 'pending');
      await t.flush();
    }
  } finally { Date.now = realNow; }
}
// Deleting the triggering message while inference is running never resurrects it.
t = setup(); let finish;
t.env.AI.run = () => new Promise(resolve => { finish = resolve; });
await queueDeepAI(t.env, t.ctx, t.source('removed'), t.request());
t.env.DB.sqlite.prepare('DELETE FROM messages WHERE id=?').run('removed');
finish({ response: 'This must not be posted.' }); await t.flush();
assert.equal(t.env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM messages').get().n, 0);

// Actual Worker endpoint: AI identity cannot be claimed with a nickname or forged cookie.
t = setup();
const call = (path, cookie, body) => worker.fetch(new Request('https://example.com' + path, { method: body ? 'POST' : 'GET', headers: { Cookie: cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }), t.env, t.ctx);
assert.equal((await call('/api/user/nickname', 'deep_user=visitor', { nickname: 'DeepAI' })).status, 409);
assert.equal((await call('/api/chat/send', 'deep_user=' + DEEP_AI_ID, { message: 'impersonation' })).status, 401);
const sent = await call('/api/chat/send', 'deep_user=visitor', { message: '@deepAi hi' });
assert.equal(sent.status, 200); assert.equal((await sent.json()).ai.state, 'pending'); await t.flush();
const feed = await (await call('/api/chat', 'deep_user=visitor')).json();
assert.equal(feed.messages.filter(m => m.ai).length, 1);
assert.equal(feed.messages.find(m => m.ai).username, 'deepAi');
assert.ok(!JSON.stringify(feed).includes(DEEP_AI_ID), 'Public feed never leaks identity credentials');
assert.equal(feed.messages.find(m => m.ai).mine, false);
console.log('PASS: DeepAI mention/reply routing, private context isolation, idempotency, spam cooldowns and free daily access, outage handling, and unforgeable bot badge');

// S.Ai routes independently; explicit mentions take precedence over reply targets.
assert.equal(mentionsSAI('hey @S.Ai!'), true);
for(const text of ['email@S.Ai', '@S.Aii', '@SxAi']) assert.equal(mentionsSAI(text), false);
assert.deepEqual(aiTargets('@S.Ai help', DEEP_AI_ID), [S_AI_ID]);
assert.deepEqual(aiTargets('continue', S_AI_ID), [S_AI_ID]);
assert.deepEqual(aiTargets('@both chai pe debate karo'), []);
assert.deepEqual(aiTargets('@deepAi @S.Ai argue about tea'), [S_AI_ID]);
t=setup();assert.equal((await queueDeepAI(t.env,t.ctx,t.source('no-key','@S.Ai hi'),t.request())).state,'unavailable');
assert.equal(t.calls.length,0,'No silent provider substitution when Groq is missing');
const nativeFetch=globalThis.fetch;
const groqCalls=[];
globalThis.fetch=async (url,options)=>{groqCalls.push({url,options,body:JSON.parse(options.body)});return new Response(JSON.stringify({choices:[{message:{content:'Tum aur tumhare dramatic headphones ♡'}}]}),{status:200});};
try {
 t=setup();t.env.GROQ_API_KEY='test-secret';
 assert.equal((await queueDeepAI(t.env,t.ctx,t.source('solo','@S.Ai coding samjhao'),t.request())).state,'pending');await t.flush();
 assert.equal(t.calls.length,0);assert.equal(groqCalls.at(-1).body.model,S_AI_MODEL);
 let row=t.env.DB.sqlite.prepare('SELECT * FROM messages WHERE sender_id=?').get(S_AI_ID);assert.equal(row.parent_id,'solo');
 assert.equal(await queueDeepAI(t.env,t.ctx,{id:row.id,message:'@both loop',sender_id:S_AI_ID},t.request()),null);
 t=setup();t.env.GROQ_API_KEY='test-secret';const before=groqCalls.length;
 assert.equal((await queueDeepAI(t.env,t.ctx,t.source('couple','@deepAi love you'),t.request())).state,'pending');await t.flush();
 const rows=t.env.DB.sqlite.prepare('SELECT sender_id,parent_id,id FROM messages WHERE id!=? ORDER BY rowid').all('couple');
 assert.deepEqual(rows.map(r=>r.sender_id),[DEEP_AI_ID,S_AI_ID]);
 assert.equal(groqCalls.length-before,1);assert.equal(t.calls.length,1);
 assert.equal(rows[1].parent_id,rows[0].id);assert.equal((await deepAIStatus(t.env,'couple')).state,'done');
 assert.ok(groqCalls.at(-1).body.messages[0].content.includes('female character'));
 assert.ok(!JSON.stringify(groqCalls.at(-1).body).includes('test-secret'));
 assert.equal((await call('/api/chat/send','deep_user='+S_AI_ID,{message:'forged'})).status,401);
 t=setup();t.env.GROQ_API_KEY='test-secret';globalThis.fetch=async()=>new Response('rate limited',{status:429});
 await queueDeepAI(t.env,t.ctx,t.source('groq-failed','@S.Ai hello'),t.request());await t.flush();
 assert.equal((await deepAIStatus(t.env,'groq-failed')).state,'failed');
 assert.equal(t.env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM messages').get().n,1);
} finally {globalThis.fetch=nativeFetch;}
console.log('PASS: exact S.Ai routing, Groq isolation, missing key, four alternating turns, no bot loops, identity protection and provider failures');

// Primary quota/outage failures fall back without changing identity or prompt.
globalThis.fetch=async(url,options)=>{
 const body=JSON.parse(options.body);
 assert.ok(body.messages[0].content.includes('You are DeepAI'));
 assert.ok(body.messages[0].content.includes('one short line'));
 assert.ok(!body.messages[0].content.includes('husband and wife'));
 return new Response(JSON.stringify({choices:[{message:{content:'bhai calculator bhi thak gaya 😭'}}]}));
};
try {
 t=setup();t.env.GROQ_API_KEY='test-secret';t.env.AI.run=async()=>{throw new Error('quota exceeded');};
 await queueDeepAI(t.env,t.ctx,t.source('fallback','@deepAi roast me'),t.request());await t.flush();
 const rows=t.env.DB.sqlite.prepare('SELECT * FROM messages WHERE sender_id=?').all(DEEP_AI_ID);
 assert.equal(rows.length,1);assert.equal(rows[0].parent_id,'fallback');
 assert.equal((await deepAIStatus(t.env,'fallback')).state,'done');
 t=setup();t.env.GROQ_API_KEY='test-secret';delete t.env.AI;
 assert.equal((await deepAIStatus(t.env)).available,true);
 await queueDeepAI(t.env,t.ctx,t.source('no-primary','@deepAi hi'),t.request());await t.flush();
 assert.equal((await deepAIStatus(t.env,'no-primary')).state,'done');
} finally {globalThis.fetch=nativeFetch;}
console.log('PASS: deepAi quota fallback preserves identity, context and short non-romantic personality');

assert.deepEqual(aiTargets('S.Ai love you'),[S_AI_ID,DEEP_AI_ID]);
assert.deepEqual(aiTargets('love you',S_AI_ID),[S_AI_ID,DEEP_AI_ID]);
assert.deepEqual(aiTargets('@S.Ai no love you'),[S_AI_ID]);
assert.deepEqual(aiTargets('@deepAi explain love you meaning'),[DEEP_AI_ID]);
assert.deepEqual(aiTargets('love you human friend'),[]);
assert.deepEqual(aiTargets('@both hello'),[]);
console.log('PASS: reciprocal single jealousy reaction, plain AI name/reply targeting, negation and ordinary-message isolation');

// Vision uses only the nearest real attachment, directly from R2; ordinary text stays text-only.
globalThis.fetch=async(url,options)=>{groqCalls.push({url,body:JSON.parse(options.body)});return Response.json({choices:[{message:{content:'Visible text: test'}}]});};
try {
  t=setup();t.env.GROQ_API_KEY='test';
  t.env.DB.sqlite.exec('CREATE TABLE message_images(message_id TEXT PRIMARY KEY,r2_key TEXT,content_type TEXT,size INTEGER)');
  const src=t.source('photo','@deepAi read this');
  t.env.DB.sqlite.prepare('INSERT INTO message_images VALUES(?,?,?,?)').run(src.id,'chat/photo','image/png',3);
  let reads=0;t.env.CHAT_IMAGES={get:async key=>{assert.equal(key,'chat/photo');reads++;return {arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer}}};
  const before=groqCalls.length;
  await queueDeepAI(t.env,t.ctx,src,t.request());await t.flush();
  assert.equal(reads,1);assert.equal(t.calls.length,0);
  assert.equal(groqCalls.length,before+1);
  assert.equal(groqCalls.at(-1).body.model,'qwen/qwen3.8-27b');
  assert.equal(groqCalls.at(-1).body.messages.at(-1).content[1].image_url.url,'data:image/png;base64,AQID');
  t=setup();t.env.CHAT_AI_DAILY_JOBS='1';
  await queueDeepAI(t.env,t.ctx,t.source('budget-one'),t.request());await t.flush();
  const denied=await queueDeepAI(t.env,t.ctx,t.source('budget-two','@deepAi hi',null,'other'),t.request('192.0.2.88'));
  assert.equal(denied.state,'limited');assert.equal(t.calls.length,1);
} finally {globalThis.fetch=nativeFetch}
console.log('PASS: R2 vision routing, bounded image payload, one vision call and configurable daily job budget');
