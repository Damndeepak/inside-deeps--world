import {ensureIdentitySchema} from './chat-identity.js';
import { listeningSchema, listeningWrites } from './deeplist-stats.js';
import { handleConnect } from "./deeplist-connect.js";
import { handleVisitorDeeplist } from "./deeplist-visitors.js";
const ready = new WeakMap();
const headers = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' };
const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers });
const hash = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b => b.toString(16).padStart(2, '0')).join('');
async function schema(db) {
  if (!ready.has(db)) ready.set(db, Promise.all([db.prepare('CREATE TABLE IF NOT EXISTS deeplist_bridge (id INTEGER PRIMARY KEY CHECK(id=1), token_hash TEXT, payload TEXT, updated_at INTEGER)').run(), db.prepare('CREATE TABLE IF NOT EXISTS deeplist_plays (session_id TEXT PRIMARY KEY, track_id TEXT NOT NULL, name TEXT NOT NULL, artist TEXT NOT NULL, played_at INTEGER NOT NULL)').run()]).then(() => db.prepare('CREATE INDEX IF NOT EXISTS deeplist_plays_time ON deeplist_plays(played_at)').run()).catch(e => { ready.delete(db); throw e; }));
  await ready.get(db);
}
export function validateState(data) {
  if (!data || !/^[A-Za-z0-9_-]{11}$/.test(data.id) || typeof data.title !== 'string' || data.title.length > 300 || typeof data.artist !== 'string' || data.artist.length > 500 || !Number.isFinite(data.position) || data.position < 0 || data.position > 86400000 || !Number.isFinite(data.duration) || data.duration < 0 || data.duration > 86400000 || typeof data.playing !== 'boolean') return null;
  const out = { id: data.id, title: data.title, artist: data.artist, position: data.position, duration: data.duration, playing: data.playing, offset: Number.isFinite(data.offset) ? Math.max(-60000, Math.min(60000, data.offset)) : 0 };
  if (data.lines !== undefined) {
    if (!Array.isArray(data.lines) || data.lines.length > 800) return null;
    let previous = -1, chars = 0;
    out.lines = [];
    for (const line of data.lines) {
      if (!line || !Number.isFinite(line.time) || line.time < previous || line.time < 0 || line.time > 86400000 || typeof line.text !== 'string' || line.text.length > 1200) return null;
      previous = line.time; chars += line.text.length;
      const clean = { time: line.time, text: line.text };
      if (line.words !== undefined) {
        if (!Array.isArray(line.words) || line.words.length > 200) return null;
        clean.words = [];
        for (const word of line.words) {
          if (!word || typeof word.text !== 'string' || word.text.length > 200 || !Number.isFinite(word.start) || !Number.isFinite(word.end) || word.start < 0 || word.end < word.start || word.end > 86400000) return null;
          clean.words.push({ text: word.text, start: word.start, end: word.end });
        }
      }
      out.lines.push(clean);
    }
    if (chars > 60000) return null;
  }
  return out;
}
export function listeningSession(state, old, lastUpdate, now, createId = () => crypto.randomUUID()) {
  const previous = old?._history;
  const replay = old?.id === state.id && state.playing && state.position < 3000 && old.duration > 6000 && old.position >= old.duration - 3000;
  if (!previous || old.id !== state.id || replay) return { session: createId(), started: now, listened: 0 };
  const elapsed = Math.max(0, now - lastUpdate);
  return { ...previous, listened: previous.listened + (old.playing && elapsed <= 15000 ? elapsed : 0) };
}
function publicState(state) { const { _history, ...rest } = state; return rest; }
function historyTrack(row) { return { name: row.name, artist: row.artist, played_at: row.played_at, plays: row.plays ?? null, image: `https://i.ytimg.com/vi/${row.track_id}/hqdefault.jpg`, url: `https://www.youtube.com/watch?v=${row.track_id}` }; }
export async function handleDeeplist(request, env, isAdmin) {
  const path = new URL(request.url).pathname;
  if (!path.startsWith('/api/deeplist/')) return null;
  if (!env.DB) return reply({ error: 'storage_unavailable' }, 503);
  await schema(env.DB);
  await ensureIdentitySchema(env.DB);
  await listeningSchema(env.DB);
  const connectResponse = await handleConnect(request, env, isAdmin, hash);
  if (connectResponse) return connectResponse;
  const visitorResponse = await handleVisitorDeeplist(request, env, {hash, validateState, publicState});
  if (visitorResponse) return visitorResponse;
  if (['/api/deeplist/history', '/api/deeplist/on-repeat'].includes(path) && request.method === 'GET') {
    const repeat = path.endsWith('on-repeat');
    const rows = repeat
      ? await env.DB.prepare('SELECT track_id, MAX(name) AS name, MAX(artist) AS artist, MAX(played_at) AS played_at, COUNT(*) AS plays FROM deeplist_plays WHERE played_at >= ? GROUP BY track_id ORDER BY plays DESC, played_at DESC LIMIT 15').bind(Math.floor(Date.now()/1000)-7*86400).all()
      : await env.DB.prepare('SELECT track_id, name, artist, played_at FROM deeplist_plays ORDER BY played_at DESC, session_id DESC LIMIT 10').all();
    return reply({ success: true, configured: true, source: 'deeplist', period: repeat ? '7day' : null, tracks: rows.results.map(historyTrack) });
  }
  if (path === '/api/deeplist/pair' && request.method === 'POST') {
    if (!await isAdmin(request)) return reply({ error: 'admin_required' }, 403);
    const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
    await env.DB.prepare('INSERT INTO deeplist_bridge(id, token_hash, payload, updated_at) VALUES(1, ?, NULL, 0) ON CONFLICT(id) DO UPDATE SET token_hash=excluded.token_hash, payload=NULL, updated_at=0').bind(await hash(token)).run();
    return reply({ token, website: new URL(request.url).origin });
  }
  if (path === '/api/deeplist/pair' && request.method === 'DELETE') {
    if (!await isAdmin(request)) return reply({ error: 'admin_required' }, 403);
    await env.DB.prepare('DELETE FROM deeplist_bridge WHERE id=1').run();
    return reply({ success: true });
  }
  if (path === '/api/deeplist/state' && request.method === 'POST') {
    const token = (request.headers.get('Authorization') || '').replace(/^Bearer /, '');
    if (!/^[a-f0-9]{64}$/.test(token)) return reply({ error: 'pairing_required' }, 401);
    const tokenHash = await hash(token);
    const row = await env.DB.prepare('SELECT token_hash, payload, updated_at FROM deeplist_bridge WHERE id=1').first();
    if (!row || row.token_hash !== tokenHash) return reply({ error: 'pairing_required' }, 401);
    if ((Number(request.headers.get('Content-Length')) || 0) > 180000) return reply({ error: 'payload_too_large' }, 413);
    const reader = request.body?.getReader();
    if (!reader) return reply({ error: 'invalid_state' }, 400);
    let size = 0, text = '', decoder = new TextDecoder();
    while (true) { const {value, done} = await reader.read(); if (done) break; size += value.byteLength; if (size > 180000) { await reader.cancel(); return reply({ error: 'payload_too_large' }, 413); } text += decoder.decode(value, {stream:true}); }
    text += decoder.decode();
    let raw; try { raw = JSON.parse(text); } catch { return reply({ error: 'invalid_json' }, 400); }
    const state = validateState(raw);
    if (!state) return reply({ error: 'invalid_state' }, 400);
    let old; try { old = JSON.parse(row.payload || 'null'); } catch {}
    if (state.lines === undefined) {
      state.lines = old?.id === state.id ? old.lines || [] : [];
      state.lyricsVersion = old?.id === state.id ? old.lyricsVersion : undefined;
    }
    if (!state.lyricsVersion) state.lyricsVersion = state.id + ':' + await hash(JSON.stringify(state.lines));
    const now = Date.now();
    state._history = listeningSession(state, old, row.updated_at, now);
    const writes = await env.DB.batch([...listeningWrites(env.DB, 'owner', tokenHash, state, now), env.DB.prepare('UPDATE deeplist_bridge SET payload=?, updated_at=? WHERE id=1 AND token_hash=? AND updated_at<=?').bind(JSON.stringify(state), now, tokenHash, now)]);
    const result = writes.at(-1);
    if (!result.meta?.changes) return reply({ error: 'pairing_required' }, 401);
    const threshold = state.duration > 0 ? Math.min(30000, state.duration / 2) : 30000;
    if (state._history.listened >= threshold) {
      await env.DB.prepare("INSERT OR IGNORE INTO deeplist_plays(session_id, track_id, name, artist, played_at) SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM deeplist_bridge WHERE id=1 AND token_hash=? AND json_extract(payload, '$._history.session')=?)")
        .bind(state._history.session, state.id, state.title, state.artist, Math.floor(state._history.started/1000), tokenHash, state._history.session).run();
    }
    return reply({ connected: true, serverNow: now });
  }
  if (path === '/api/deeplist/state' && request.method === 'GET') {
    const row = await env.DB.prepare('SELECT payload, updated_at FROM deeplist_bridge WHERE id=1').first();
    const now = Date.now();
    if (!row?.payload || now - row.updated_at > 15000) return reply({ connected: false, serverNow: now });
    let state; try { state = JSON.parse(row.payload); } catch { return reply({ connected: false, serverNow: now }); }
    if (new URL(request.url).searchParams.get('lyricsVersion') === state.lyricsVersion) delete state.lines;
    return reply({ connected: true, state: publicState(state), receivedAt: row.updated_at, serverNow: now });
  }
  return reply({ error: 'not_found' }, 404);
}
