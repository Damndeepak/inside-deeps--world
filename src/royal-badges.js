const ready = new WeakMap();
const deeptiChannel = '0e7efa50-0661-44b0-bc86-bb289c6c2d43';

export async function ensureRoyalBadges(db) {
  if (!ready.has(db)) {
    const setup = db.batch([
      db.prepare("CREATE TABLE IF NOT EXISTS deeplist_badges (channel_id TEXT PRIMARY KEY, badge TEXT NOT NULL CHECK (badge IN ('','king','queen')))"),
      db.prepare('CREATE TABLE IF NOT EXISTS chat_admin_authors (user_id TEXT PRIMARY KEY)')
    ]).then(() => db.prepare("INSERT OR IGNORE INTO deeplist_badges(channel_id,badge) VALUES ('owner','king'), (?,'queen')").bind(deeptiChannel).run()).catch(error => { ready.delete(db); throw error; });
    ready.set(db, setup);
  }
  await ready.get(db);
}
