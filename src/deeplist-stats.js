const ready = new WeakMap();
const zoneOffset = 330 * 60000;
export function monthKey(now) { return new Date(now + zoneOffset).toISOString().slice(0, 7); }
function monthStart(key) {
  const [year, month] = key.split('-').map(Number);
  return Date.UTC(year, month - 1, 1) - zoneOffset;
}
export async function listeningSchema(db) {
  if (!ready.has(db)) ready.set(db, (async () => {
    await db.prepare('CREATE TABLE IF NOT EXISTS deeplist_listening_clock (channel_id TEXT PRIMARY KEY, session_hash TEXT NOT NULL, last_at INTEGER NOT NULL, first_at INTEGER NOT NULL, playing INTEGER NOT NULL, track_id TEXT NOT NULL, position INTEGER NOT NULL)').run();
    await db.prepare('CREATE TABLE IF NOT EXISTS deeplist_listening_months (channel_id TEXT NOT NULL, month TEXT NOT NULL, listened_ms INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(channel_id,month))').run();
  })().catch(error => { ready.delete(db); throw error; }));
  await ready.get(db);
}
// These statements run in the same D1 transaction as the authenticated snapshot write.
// Server time, not seek distance or a client-supplied clock, determines listening time.
export function listeningWrites(db, channel, tokenHash, state, now) {
  const owner = channel === 'owner';
  const guard = owner ? 'EXISTS (SELECT 1 FROM deeplist_bridge WHERE id=1 AND token_hash=?)'
    : 'EXISTS (SELECT 1 FROM deeplist_visitors WHERE channel_id=c.channel_id AND token_hash=?)';
  const months = [...new Set([monthKey(now - 15000), monthKey(now)])];
  const statements = months.map(month => {
    const start = monthStart(month), [year, number] = month.split('-').map(Number);
    const end = Date.UTC(year, number, 1) - zoneOffset;
    return db.prepare(`INSERT INTO deeplist_listening_months(channel_id,month,listened_ms)
      SELECT c.channel_id,?,MAX(0,MIN(c.last_at+MIN(?-c.last_at,CASE WHEN c.track_id=? THEN MAX(0,?-c.position) ELSE ?-c.last_at END),?)-MAX(c.last_at,?)) FROM deeplist_listening_clock c
      WHERE c.channel_id=? AND c.session_hash=? AND c.playing=1 AND ?>c.last_at AND ?-c.last_at<=15000
        AND (c.track_id<>? OR ?>c.position) AND ${guard}
      ON CONFLICT(channel_id,month) DO UPDATE SET listened_ms=listened_ms+excluded.listened_ms`)
      .bind(month, now, state.id, state.position, now, end, start, channel, tokenHash, now, now, state.id, state.position, tokenHash);
  });
  const clockGuard = owner ? 'EXISTS (SELECT 1 FROM deeplist_bridge WHERE id=1 AND token_hash=?)'
    : 'EXISTS (SELECT 1 FROM deeplist_visitors WHERE channel_id=? AND token_hash=?)';
  statements.push(db.prepare(`INSERT INTO deeplist_listening_clock(channel_id,session_hash,last_at,first_at,playing,track_id,position)
    SELECT ?,?,?,?,?,?,? WHERE ${clockGuard}
    ON CONFLICT(channel_id) DO UPDATE SET session_hash=excluded.session_hash,last_at=excluded.last_at,
      playing=excluded.playing,track_id=excluded.track_id,position=excluded.position
    WHERE excluded.last_at>=deeplist_listening_clock.last_at OR excluded.session_hash<>deeplist_listening_clock.session_hash`)
    .bind(channel, tokenHash, now, now, Number(state.playing), state.id, state.position, ...(owner ? [tokenHash] : [channel, tokenHash])));
  return statements;
}
export async function publicListeningStats(db, now, month = monthKey(now)) {
  const result = await db.prepare(`WITH visible AS (
    SELECT 'owner' AS channel_id,'Deepu' AS label FROM deeplist_bridge WHERE id=1 AND token_hash IS NOT NULL AND payload IS NOT NULL
    UNION ALL
    SELECT v.channel_id,COALESCE(NULLIF(n.display_name,''),'Listener · '||SUBSTR(v.channel_id,1,6))
      FROM deeplist_visitors v LEFT JOIN deeplist_visitor_names n ON n.channel_id=v.channel_id
      WHERE v.token_hash IS NOT NULL AND v.payload IS NOT NULL
    ) SELECT v.channel_id,v.label,c.first_at,
      COALESCE(SUM(m.listened_ms),0) AS total_ms,
      COALESCE(SUM(CASE WHEN m.month=? THEN m.listened_ms ELSE 0 END),0) AS month_ms
      FROM visible v LEFT JOIN deeplist_listening_clock c ON c.channel_id=v.channel_id
      LEFT JOIN deeplist_listening_months m ON m.channel_id=v.channel_id
      GROUP BY v.channel_id ORDER BY total_ms DESC,v.channel_id`).bind(month).all();
  return result.results.map(row => ({ channel: row.channel_id, label: row.label,
    totalMs: row.total_ms, monthMs: row.month_ms, trackingSince: row.first_at || null,
    player: row.channel_id === 'owner' ? '/deeplist.html' : '/deeplist.html?user=' + row.channel_id }));
}
