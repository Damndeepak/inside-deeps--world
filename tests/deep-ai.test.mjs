import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { webcrypto } from 'node:crypto';
import worker from '../src/index.js';
import { DEEP_AI_ID, DEEP_AI_MODEL, mentionsDeepAI, queueDeepAI, deepAIStatus } from '../src/deep-ai.js';
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
assert.equal(t.calls[0].input.max_tokens, 200);
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

// Requests racing on different isolates/users still share one atomic global cap.
t = setup();
const claims = await Promise.all(Array.from({ length: 65 }, (_, i) => queueDeepAI(t.env, t.ctx, t.source('race-' + i, '@deepAi hello', null, 'user-' + i), t.request('192.0.2.' + i))));
await t.flush();
assert.equal(claims.filter(v => v.state === 'pending').length, 60);
assert.equal(t.calls.length, 60, 'Global daily cap includes pending and failed attempts');
assert.ok(t.env.DB.sqlite.prepare('SELECT ip_hash FROM chat_ai_jobs LIMIT 1').get().ip_hash.match(/^[a-f0-9]{64}$/));

// Per-user daily limits survive cooldowns; resetting a cookie cannot bypass the IP cap.
for (const kind of ['user', 'ip']) {
  t = setup(); const start = realNow();
  try {
    for (let i = 0; i < 22; i++) {
      Date.now = () => start + i * 21000;
      const user = kind === 'user' ? 'visitor' : 'fresh-' + i;
      const result = await queueDeepAI(t.env, t.ctx, t.source('budget-' + i, '@deepAi hi', null, user), t.request());
      assert.equal(result.state, i < (kind === 'user' ? 10 : 20) ? 'pending' : 'limited');
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
console.log('PASS: DeepAI mention/reply routing, private context isolation, idempotency, atomic quota, outage handling, and unforgeable bot badge');
