export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    function getUserId(request) {
      const cookies = request.headers.get("Cookie") || "";
      const match = cookies.match(/(?:^|;\s*)deep_user=([^;]+)/);
      return match ? match[1] : null;
    }

    async function getUser(userId) {
      if (!userId) return null;

      return await env.DB
        .prepare("SELECT id, username FROM users WHERE id = ?")
        .bind(userId)
        .first();
    }

    async function ensureMainConversation(userId) {
      let main = await env.DB
        .prepare("SELECT id FROM conversations ORDER BY created_at ASC LIMIT 1")
        .first();

      if (!main) {
        const id = crypto.randomUUID();

        await env.DB
          .prepare(
            "INSERT INTO conversations (id, user_id, created_at) VALUES (?, ?, ?)"
          )
          .bind(id, userId, new Date().toISOString())
          .run();

        return id;
      }

      const mainId = main.id;

      await env.DB
        .prepare(
          "UPDATE messages SET conversation_id = ? WHERE conversation_id != ?"
        )
        .bind(mainId, mainId)
        .run();

      await env.DB
        .prepare("DELETE FROM conversations WHERE id != ?")
        .bind(mainId)
        .run();

      return mainId;
    }

    // Last.fm: public "now playing" for Deep (API key stays server-side).
    // Remembers the last detected Now Playing track in its own D1 table so it
    // can still be shown (playing: false) when nothing is playing.
    if (url.pathname === "/api/lastfm/now-playing" && request.method === "GET") {
      const headers = { "Cache-Control": "no-store" };
      const offline = { connected: false, playing: false, track: null };

      if (!env.LASTFM_API_KEY || !env.LASTFM_USERNAME) {
        return Response.json(offline, { headers });
      }

      // Isolated storage: touches only the lastfm_last_track table.
      // Failures here never break the endpoint.
      async function ensureLastfmTable() {
        await env.DB.prepare(`
          CREATE TABLE IF NOT EXISTS lastfm_last_track (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            name TEXT NOT NULL,
            artist TEXT NOT NULL,
            album TEXT NOT NULL,
            image TEXT NOT NULL,
            url TEXT NOT NULL,
            updated_at TEXT NOT NULL
          )
        `).run();
      }

      async function saveLastTrack(track) {
        try {
          await ensureLastfmTable();
          // Only writes when the track actually changed.
          await env.DB.prepare(`
            INSERT INTO lastfm_last_track (id, name, artist, album, image, url, updated_at)
            VALUES (1, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              name = excluded.name,
              artist = excluded.artist,
              album = excluded.album,
              image = excluded.image,
              url = excluded.url,
              updated_at = excluded.updated_at
            WHERE lastfm_last_track.name != excluded.name
               OR lastfm_last_track.artist != excluded.artist
               OR lastfm_last_track.album != excluded.album
          `).bind(
            track.name,
            track.artist,
            track.album,
            track.image,
            track.url,
            new Date().toISOString()
          ).run();
        } catch {}
      }

      async function loadLastTrack() {
        try {
          await ensureLastfmTable();
          const row = await env.DB
            .prepare("SELECT name, artist, album, image, url FROM lastfm_last_track WHERE id = 1")
            .first();
          if (!row) return null;
          return {
            name: row.name,
            artist: row.artist,
            album: row.album,
            image: row.image,
            url: row.url
          };
        } catch {
          return null;
        }
      }

      try {
        const api = new URL("https://ws.audioscrobbler.com/2.0/");
        api.searchParams.set("method", "user.getrecenttracks");
        api.searchParams.set("user", env.LASTFM_USERNAME);
        api.searchParams.set("api_key", env.LASTFM_API_KEY);
        api.searchParams.set("format", "json");
        api.searchParams.set("limit", "1");

        const response = await fetch(api.toString(), {
          cf: { cacheTtl: 5, cacheEverything: true }
        });
        if (!response.ok) {
          return Response.json(offline, { status: 502, headers });
        }

        const data = await response.json();
        if (data?.error) {
          return Response.json(offline, { status: 502, headers });
        }

        const raw = data?.recenttracks?.track;
        const item = Array.isArray(raw) ? raw[0] : raw;

        if (!item || item["@attr"]?.nowplaying !== "true") {
          return Response.json(
            { connected: true, playing: false, track: await loadLastTrack() },
            { headers }
          );
        }

        const images = Array.isArray(item.image) ? item.image : [];
        const image =
          (images.find(i => i.size === "extralarge") ||
            images[images.length - 1] ||
            {})["#text"] || "";

        const track = {
          name: item.name || "Unknown track",
          artist: item.artist?.["#text"] || item.artist?.name || "",
          album: item.album?.["#text"] || "",
          image,
          url: item.url || ""
        };

        await saveLastTrack(track);

        return Response.json(
          { connected: true, playing: true, track },
          { headers }
        );
      } catch {
        return Response.json(offline, { status: 502, headers });
      }
    }

    // ---------------------------------------------------------------
    // Last.fm: visitors can connect their own Last.fm account.
    // Only the verified username is stored (own table, hashed owner
    // token). Session keys and the shared secret are never stored/exposed.
    // ---------------------------------------------------------------
    const LFM_MAX_USERS = 15;
    const LFM_USER_RE = /^[A-Za-z0-9_-]{2,15}$/;

    async function lfmMd5(text) {
      const buf = await crypto.subtle.digest("MD5", new TextEncoder().encode(text));
      return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
    }

    async function lfmSha256(text) {
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
      return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
    }

    async function lfmEnsureConnTable() {
      await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS lastfm_connections (
          username TEXT PRIMARY KEY COLLATE NOCASE,
          owner_hash TEXT NOT NULL,
          connected_at TEXT NOT NULL
        )
      `).run();
    }

    function lfmOwnerCookie(request) {
      const cookies = request.headers.get("Cookie") || "";
      const m = cookies.match(/(?:^|;\s*)lfm_owner=([A-Za-z0-9_-]{20,100})/);
      return m ? m[1] : null;
    }

    function lfmMessagePage(title, text, status) {
      return new Response(`<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{margin:0;background:#080808;color:#fff;font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;text-align:center}main{max-width:420px;padding:32px}h1{font-size:26px;margin:0 0 10px}p{color:#aaa;line-height:1.6}a{color:#fff}</style></head>
<body><main><h1>${title}</h1><p>${text}</p><p><a href="/">back to Inside Deep's World</a></p></main></body></html>`, {
        status,
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }
      });
    }

    // Step 1: send the visitor to Last.fm to approve access
    if (url.pathname === "/lastfm/login" && request.method === "GET") {
      if (!env.LASTFM_API_KEY || !env.LASTFM_SHARED_SECRET) {
        return lfmMessagePage("Not available", "Last.fm login is not set up yet.", 503);
      }
      const auth = new URL("https://www.last.fm/api/auth/");
      auth.searchParams.set("api_key", env.LASTFM_API_KEY);
      auth.searchParams.set("cb", `${url.origin}/lastfm/callback`);
      return Response.redirect(auth.toString(), 302);
    }

    // Step 2: Last.fm sends the visitor back with a token; verify who they are
    if (url.pathname === "/lastfm/callback" && request.method === "GET") {
      try {
        if (!env.LASTFM_API_KEY || !env.LASTFM_SHARED_SECRET) {
          return lfmMessagePage("Not available", "Last.fm login is not set up yet.", 503);
        }

        const token = url.searchParams.get("token") || "";
        if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) {
          return lfmMessagePage("Could not connect", "Missing or invalid Last.fm token. Please try again.", 400);
        }

        const sig = await lfmMd5(
          "api_key" + env.LASTFM_API_KEY +
          "method" + "auth.getSession" +
          "token" + token +
          env.LASTFM_SHARED_SECRET
        );

        const api = new URL("https://ws.audioscrobbler.com/2.0/");
        api.searchParams.set("method", "auth.getSession");
        api.searchParams.set("api_key", env.LASTFM_API_KEY);
        api.searchParams.set("token", token);
        api.searchParams.set("api_sig", sig);
        api.searchParams.set("format", "json");

        const res = await fetch(api.toString());
        const data = await res.json().catch(() => null);
        const username = data?.session?.name;

        if (!res.ok || !username || !LFM_USER_RE.test(username)) {
          return lfmMessagePage("Could not connect", "Last.fm did not confirm your account. Please try again.", 502);
        }

        await lfmEnsureConnTable();

        const existing = await env.DB
          .prepare("SELECT username FROM lastfm_connections WHERE username = ?")
          .bind(username)
          .first();

        if (!existing) {
          const count = await env.DB
            .prepare("SELECT COUNT(*) AS n FROM lastfm_connections")
            .first();
          if (Number(count?.n || 0) >= LFM_MAX_USERS) {
            return lfmMessagePage("List is full", "The list is full right now. Please try again later.", 409);
          }
        }

        const bytes = new Uint8Array(32);
        crypto.getRandomValues(bytes);
        const ownerToken = [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
        const ownerHash = await lfmSha256(ownerToken);

        await env.DB.prepare(`
          INSERT INTO lastfm_connections (username, owner_hash, connected_at)
          VALUES (?, ?, ?)
          ON CONFLICT(username) DO UPDATE SET
            owner_hash = excluded.owner_hash,
            connected_at = excluded.connected_at
        `).bind(username, ownerHash, new Date().toISOString()).run();

        return new Response(null, {
          status: 302,
          headers: {
            "Location": "/",
            "Cache-Control": "no-store",
            "Set-Cookie": `lfm_owner=${ownerToken}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`
          }
        });
      } catch {
        return lfmMessagePage("Something went wrong", "Could not connect Last.fm right now. Please try again.", 500);
      }
    }

    // Who am I? (used for the Connect / Disconnect button)
    if (url.pathname === "/api/lastfm/me" && request.method === "GET") {
      const headers = { "Cache-Control": "no-store" };
      try {
        const cookie = lfmOwnerCookie(request);
        if (!cookie) return Response.json({ connected: false }, { headers });

        await lfmEnsureConnTable();
        const row = await env.DB
          .prepare("SELECT username FROM lastfm_connections WHERE owner_hash = ?")
          .bind(await lfmSha256(cookie))
          .first();

        return Response.json(
          row ? { connected: true, username: row.username } : { connected: false },
          { headers }
        );
      } catch {
        return Response.json({ connected: false }, { headers });
      }
    }

    // Disconnect: only the browser that connected can remove its entry
    if (url.pathname === "/api/lastfm/disconnect" && request.method === "POST") {
      const headers = {
        "Cache-Control": "no-store",
        "Set-Cookie": "lfm_owner=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax"
      };
      try {
        const cookie = lfmOwnerCookie(request);
        if (!cookie) return Response.json({ success: false }, { status: 401, headers });

        await lfmEnsureConnTable();
        await env.DB
          .prepare("DELETE FROM lastfm_connections WHERE owner_hash = ?")
          .bind(await lfmSha256(cookie))
          .run();

        return Response.json({ success: true }, { headers });
      } catch {
        return Response.json({ success: false }, { status: 500, headers });
      }
    }

    // Public list of connected listeners (username + now playing / last played)
    if (url.pathname === "/api/lastfm/listeners" && request.method === "GET") {
      const headers = { "Cache-Control": "no-store" };
      try {
        if (!env.LASTFM_API_KEY) {
          return Response.json({ listeners: [] }, { headers });
        }

        await lfmEnsureConnTable();
        const rows = await env.DB
          .prepare("SELECT username FROM lastfm_connections ORDER BY connected_at ASC LIMIT ?")
          .bind(LFM_MAX_USERS)
          .all();

        const owner = String(env.LASTFM_USERNAME || "").toLowerCase();
        const names = (rows.results || [])
          .map(r => r.username)
          .filter(n => n && n.toLowerCase() !== owner);

        const settled = await Promise.allSettled(names.map(async name => {
          const api = new URL("https://ws.audioscrobbler.com/2.0/");
          api.searchParams.set("method", "user.getrecenttracks");
          api.searchParams.set("user", name);
          api.searchParams.set("api_key", env.LASTFM_API_KEY);
          api.searchParams.set("format", "json");
          api.searchParams.set("limit", "1");

          const res = await fetch(api.toString(), {
            cf: { cacheTtl: 15, cacheEverything: true }
          });
          if (!res.ok) return null;
          const data = await res.json();
          if (data?.error) return null;

          const raw = data?.recenttracks?.track;
          const item = Array.isArray(raw) ? raw[0] : raw;
          const base = { username: name, profile: `https://www.last.fm/user/${encodeURIComponent(name)}` };
          if (!item) return { ...base, playing: false, track: null, played_at: null };

          const images = Array.isArray(item.image) ? item.image : [];
          const image =
            (images.find(i => i.size === "extralarge") ||
              images[images.length - 1] ||
              {})["#text"] || "";
          const uts = Number(item.date?.uts || 0);

          return {
            ...base,
            playing: item["@attr"]?.nowplaying === "true",
            track: {
              name: item.name || "Unknown track",
              artist: item.artist?.["#text"] || item.artist?.name || "",
              image,
              url: item.url || ""
            },
            played_at: uts > 0 ? uts : null
          };
        }));

        const listeners = settled
          .filter(s => s.status === "fulfilled" && s.value)
          .map(s => s.value)
          .sort((a, b) => Number(b.playing) - Number(a.playing));

        return Response.json({ listeners }, { headers });
      } catch {
        return Response.json({ listeners: [] }, { headers });
      }
    }

    // Password-protected sections
    if (url.pathname === "/api/check-password" && request.method === "POST") {
      try {
        const { section, password } = await request.json();

        const passwords = {
          people: env.PEOPLE_PASSWORD,
          memories: env.MEMORIES_PASSWORD,
          music: env.MUSIC_PASSWORD,
          socials: env.SOCIALS_PASSWORD,
          random: env.RANDOM_PASSWORD,
          "voice-notes": env.VOICE_NOTES_PASSWORD
        };

        if (!passwords[section]) {
          return Response.json({ success: false }, { status: 400 });
        }

        if (password !== passwords[section]) {
          return Response.json({ success: false }, { status: 401 });
        }

        return Response.json({ success: true });
      } catch {
        return Response.json({ success: false }, { status: 400 });
      }
    }

    // Get or create anonymous public username
    if (url.pathname === "/api/user" && request.method === "GET") {
      try {
        const userId = getUserId(request);
        const existingUser = await getUser(userId);

        if (existingUser) {
          return Response.json({
            success: true,
            user: existingUser
          });
        }

        const id = crypto.randomUUID();
        const username =
          "User" + Math.floor(100000 + Math.random() * 900000);

        await env.DB
          .prepare(
            "INSERT INTO users (id, username, created_at) VALUES (?, ?, ?)"
          )
          .bind(id, username, new Date().toISOString())
          .run();

        return new Response(
          JSON.stringify({
            success: true,
            user: { id, username }
          }),
          {
            headers: {
              "Content-Type": "application/json",
              "Set-Cookie": `deep_user=${id}; Path=/; Max-Age=31536000; SameSite=Lax`
            }
          }
        );
      } catch {
        return Response.json(
          {
            success: false,
            error: "Could not create user"
          },
          { status: 500 }
        );
      }
    }

    // GLOBAL GLITCH RUN LEADERBOARD
    // The table is created lazily so no separate D1 migration is required.
    if (
      url.pathname === "/api/arcade/leaderboard" &&
      (request.method === "GET" || request.method === "POST")
    ) {
      try {
        await env.DB.prepare(`
          CREATE TABLE IF NOT EXISTS arcade_scores (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            score INTEGER NOT NULL,
            player_key TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          )
        `).run();

        if (request.method === "GET") {
          const result = await env.DB
            .prepare(`
              SELECT name, score
              FROM arcade_scores
              ORDER BY score DESC, updated_at ASC
              LIMIT 5
            `)
            .all();

          return Response.json({
            success: true,
            leaderboard: result.results
          });
        }

        const body = await request.json();
        const name =
          typeof body.name === "string"
            ? body.name.trim().replace(/\s+/g, " ")
            : "";
        const score = Number(body.score);

        if (!name || name.length > 32) {
          return Response.json(
            { success: false, error: "Valid name is required" },
            { status: 400 }
          );
        }

        if (!Number.isSafeInteger(score) || score < 0 || score > 100000000) {
          return Response.json(
            { success: false, error: "Invalid score" },
            { status: 400 }
          );
        }

        const now = new Date().toISOString();

        // A browser keeps one player key. If the same player submits again,
        // only their personal best is retained.
        const playerKey =
          typeof body.player_key === "string" &&
          /^[a-zA-Z0-9_-]{16,80}$/.test(body.player_key)
            ? body.player_key
            : null;

        if (playerKey) {
          const existing = await env.DB
            .prepare(
              "SELECT id, score FROM arcade_scores WHERE player_key = ? LIMIT 1"
            )
            .bind(playerKey)
            .first();

          if (existing) {
            if (score > existing.score) {
              await env.DB
                .prepare(
                  "UPDATE arcade_scores SET name = ?, score = ?, updated_at = ? WHERE id = ?"
                )
                .bind(name, score, now, existing.id)
                .run();
            }
          } else {
            await env.DB
              .prepare(
                "INSERT INTO arcade_scores (name, score, player_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
              )
              .bind(name, score, playerKey, now, now)
              .run();
          }
        } else {
          // Fallback for older clients without a player key.
          const existing = await env.DB
            .prepare(
              "SELECT id, score FROM arcade_scores WHERE name = ? ORDER BY score DESC LIMIT 1"
            )
            .bind(name)
            .first();

          if (existing) {
            if (score > existing.score) {
              await env.DB
                .prepare(
                  "UPDATE arcade_scores SET score = ?, updated_at = ? WHERE id = ?"
                )
                .bind(score, now, existing.id)
                .run();
            }
          } else {
            await env.DB
              .prepare(
                "INSERT INTO arcade_scores (name, score, player_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
              )
              .bind(name, score, null, now, now)
              .run();
          }
        }

        const result = await env.DB
          .prepare(`
            SELECT name, score
            FROM arcade_scores
            ORDER BY score DESC, updated_at ASC
            LIMIT 5
          `)
          .all();

        return Response.json({
          success: true,
          leaderboard: result.results
        });
      } catch {
        return Response.json(
          { success: false, error: "Leaderboard unavailable" },
          { status: 500 }
        );
      }
    }

    // Return shared conversation ID
    if (url.pathname === "/api/conversations" && request.method === "POST") {
      try {
        const userId = getUserId(request);
        const user = await getUser(userId);

        if (!user) {
          return Response.json(
            { success: false, error: "User not found" },
            { status: 401 }
          );
        }

        const conversationId = await ensureMainConversation(user.id);

        return Response.json({
          success: true,
          conversation_id: conversationId
        });
      } catch {
        return Response.json(
          {
            success: false,
            error: "Could not create conversation"
          },
          { status: 500 }
        );
      }
    }

    // Send new message or reply
    if (url.pathname === "/api/messages" && request.method === "POST") {
      try {
        const userId = getUserId(request);
        const user = await getUser(userId);

        if (!user) {
          return Response.json(
            { success: false, error: "User not found" },
            { status: 401 }
          );
        }

        const body = await request.json();

        const message =
          typeof body.message === "string"
            ? body.message.trim()
            : "";

        const parentId = body.parent_id || null;

        if (!message) {
          return Response.json(
            { success: false, error: "Message is required" },
            { status: 400 }
          );
        }

        const conversationId = await ensureMainConversation(user.id);

        if (parentId) {
          const parent = await env.DB
            .prepare(
              "SELECT id FROM messages WHERE id = ? AND conversation_id = ?"
            )
            .bind(parentId, conversationId)
            .first();

          if (!parent) {
            return Response.json(
              {
                success: false,
                error: "Parent message not found"
              },
              { status: 400 }
            );
          }
        }

        const messageId = crypto.randomUUID();

        await env.DB
          .prepare(
            `INSERT INTO messages
            (id, conversation_id, sender_id, message, parent_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?)`
          )
          .bind(
            messageId,
            conversationId,
            user.id,
            message,
            parentId,
            new Date().toISOString()
          )
          .run();

        return Response.json({
          success: true,
          message_id: messageId,
          conversation_id: conversationId
        });
      } catch {
        return Response.json(
          {
            success: false,
            error: "Could not send message"
          },
          { status: 500 }
        );
      }
    }

    // Delete own message
    const messageMatch =
      url.pathname.match(/^\/api\/messages\/([^/]+)$/);

    if (messageMatch && request.method === "DELETE") {
      try {
        const userId = getUserId(request);

        if (!userId) {
          return Response.json(
            { success: false, error: "User not found" },
            { status: 401 }
          );
        }

        const messageId = messageMatch[1];

        const message = await env.DB
          .prepare(
            "SELECT id, sender_id FROM messages WHERE id = ?"
          )
          .bind(messageId)
          .first();

        if (!message) {
          return Response.json(
            {
              success: false,
              error: "Message not found"
            },
            { status: 404 }
          );
        }

        if (message.sender_id !== userId) {
          return Response.json(
            {
              success: false,
              error: "Not allowed"
            },
            { status: 403 }
          );
        }

        await env.DB
          .prepare(
            "UPDATE messages SET parent_id = NULL WHERE parent_id = ?"
          )
          .bind(messageId)
          .run();

        await env.DB
          .prepare("DELETE FROM messages WHERE id = ?")
          .bind(messageId)
          .run();

        return Response.json({ success: true });
      } catch {
        return Response.json(
          {
            success: false,
            error: "Could not delete message"
          },
          { status: 500 }
        );
      }
    }

    // Conversations list
    if (url.pathname === "/api/conversations" && request.method === "GET") {
      try {
        const userId = getUserId(request);

        if (!userId) {
          return Response.json({
            success: true,
            conversations: []
          });
        }

        const user = await getUser(userId);

        if (!user) {
          return Response.json({
            success: true,
            conversations: []
          });
        }

        const mainId = await ensureMainConversation(user.id);

        const result = await env.DB
          .prepare(
            `SELECT
              c.id,
              'All conversations' AS username,
              c.created_at,
              (
                SELECT m.message
                FROM messages m
                WHERE m.conversation_id = c.id
                ORDER BY m.created_at DESC
                LIMIT 1
              ) AS last_message,
              (
                SELECT m.created_at
                FROM messages m
                WHERE m.conversation_id = c.id
                ORDER BY m.created_at DESC
                LIMIT 1
              ) AS last_message_time,
              (
                SELECT COUNT(*)
                FROM messages m
                WHERE m.conversation_id = c.id
              ) AS message_count
            FROM conversations c
            WHERE c.id = ?`
          )
          .bind(mainId)
          .all();

        return Response.json({
          success: true,
          conversations: result.results
        });
      } catch {
        return Response.json(
          {
            success: false,
            error: "Could not load conversations"
          },
          { status: 500 }
        );
      }
    }

    // Load shared conversation
    const conversationMatch =
      url.pathname.match(/^\/api\/conversations\/([^/]+)$/);

    if (conversationMatch && request.method === "GET") {
      try {
        const userId = getUserId(request);
        const user = await getUser(userId);

        if (!user) {
          return Response.json(
            {
              success: false,
              error: "User not found"
            },
            { status: 401 }
          );
        }

        const mainId = await ensureMainConversation(user.id);

        const result = await env.DB
          .prepare(
            `SELECT
              m.id,
              m.message,
              m.parent_id,
              m.created_at,
              m.sender_id,
              u.username,
              pu.username AS parent_username
            FROM messages m
            JOIN users u ON u.id = m.sender_id
            LEFT JOIN messages pm ON pm.id = m.parent_id
            LEFT JOIN users pu ON pu.id = pm.sender_id
            WHERE m.conversation_id = ?
            ORDER BY m.created_at ASC`
          )
          .bind(mainId)
          .all();

        return Response.json({
          success: true,
          conversation_id: mainId,
          messages: result.results
        });
      } catch {
        return Response.json(
          {
            success: false,
            error: "Could not load messages"
          },
          { status: 500 }
        );
      }
    }

    return env.ASSETS.fetch(request);
  }
};
