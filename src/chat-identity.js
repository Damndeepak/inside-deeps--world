import { IDENTITY_SYMBOLS, IDENTITY_COLORS } from '../public/chat-identity.js';
const ready = new WeakMap();
export async function ensureIdentitySchema(db) {
  if (!ready.has(db)) ready.set(db, (async () => {
    await db.prepare("CREATE TABLE IF NOT EXISTS chat_identity (user_id TEXT PRIMARY KEY, symbol TEXT NOT NULL DEFAULT '', color TEXT NOT NULL DEFAULT 'lavender', revision INTEGER NOT NULL DEFAULT 0)").run();
    await db.prepare('CREATE TABLE IF NOT EXISTS deeplist_identity_links (channel_id TEXT PRIMARY KEY, user_id TEXT NOT NULL)').run();
    await db.prepare('CREATE INDEX IF NOT EXISTS deeplist_identity_user ON deeplist_identity_links(user_id)').run();
  })().catch(error => { ready.delete(db); throw error; }));
  await ready.get(db);
}
export function validIdentity(symbol, color) {
  return IDENTITY_SYMBOLS.includes(symbol) && typeof color === 'string' && Object.hasOwn(IDENTITY_COLORS, color);
}
export async function identityFor(db, userId) {
  await ensureIdentitySchema(db);
  return await db.prepare('SELECT symbol,color FROM chat_identity WHERE user_id=?').bind(userId).first() || {symbol:'',color:'lavender'};
}
// A link is created only for the current browser's own music connection and an
// explicitly saved chat identity. Public responses never include the user ID.
export async function linkChatIdentity(request, db, {channel, owner = false} = {}) {
  const uid = (request.headers.get('Cookie') || '').match(/(?:^|;\s*)deep_user=([^;]+)/)?.[1];
  if (!uid) return;
  await ensureIdentitySchema(db);
  if (!await db.prepare('SELECT user_id FROM chat_identity WHERE user_id=?').bind(uid).first()) return;
  const statements = [];
  if (channel) statements.push(db.prepare(`INSERT INTO deeplist_identity_links(channel_id,user_id)
    SELECT ?,id FROM users WHERE id=? ON CONFLICT(channel_id) DO UPDATE SET user_id=excluded.user_id`).bind(channel, uid));
  else {
    const raw = (request.headers.get('Cookie') || '').match(/(?:^|;\s*)__Host-deeplist=([a-f0-9]{64})(?:;|$)/)?.[1];
    if (raw && await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='deeplist_visitors'").first()) {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
      const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
      statements.push(db.prepare(`INSERT INTO deeplist_identity_links(channel_id,user_id)
        SELECT channel_id,? FROM deeplist_visitors WHERE browser_hash=?
        ON CONFLICT(channel_id) DO UPDATE SET user_id=excluded.user_id`).bind(uid, hash));
    }
  }
  if (owner) statements.push(db.prepare(`INSERT INTO deeplist_identity_links(channel_id,user_id)
    SELECT 'owner',id FROM users WHERE id=? ON CONFLICT(channel_id) DO UPDATE SET user_id=excluded.user_id`).bind(uid));
  if (statements.length) await db.batch(statements);
}
