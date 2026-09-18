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

    // Spotify helpers for Deep's public Now Playing widget
    const SPOTIFY_CLIENT_ID = "264932447e374f16a25be5599d97abc6";
    const SPOTIFY_REDIRECT_URI = `${url.origin}/spotify/callback`;

    function base64UrlEncode(bytes) {
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");
    }

    function randomString(length = 64) {
      const bytes = new Uint8Array(length);
      crypto.getRandomValues(bytes);
      return base64UrlEncode(bytes);
    }

    async function spotifyCodeChallenge(verifier) {
      const data = new TextEncoder().encode(verifier);
      const digest = await crypto.subtle.digest("SHA-256", data);
      return base64UrlEncode(new Uint8Array(digest));
    }

    async function ensureSpotifyTables() {
      await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS spotify_auth (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          refresh_token TEXT NOT NULL,
          access_token TEXT,
          expires_at INTEGER,
          updated_at TEXT NOT NULL
        )
      `).run();

      await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS spotify_oauth_state (
          state TEXT PRIMARY KEY,
          verifier TEXT NOT NULL,
          created_at INTEGER NOT NULL
        )
      `).run();
    }

    async function refreshSpotifyAccessToken(auth) {
      if (!auth?.refresh_token) return null;

      const response = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: auth.refresh_token,
          client_id: SPOTIFY_CLIENT_ID
        })
      });

      if (!response.ok) return null;

      const token = await response.json();
      const accessToken = token.access_token;
      if (!accessToken) return null;

      const refreshToken = token.refresh_token || auth.refresh_token;
      const expiresAt = Date.now() + Number(token.expires_in || 3600) * 1000;

      await env.DB.prepare(`
        UPDATE spotify_auth
        SET refresh_token = ?, access_token = ?, expires_at = ?, updated_at = ?
        WHERE id = 1
      `).bind(
        refreshToken,
        accessToken,
        expiresAt,
        new Date().toISOString()
      ).run();

      return accessToken;
    }

    async function getSpotifyAccessToken() {
      const auth = await env.DB
        .prepare("SELECT refresh_token, access_token, expires_at FROM spotify_auth WHERE id = 1")
        .first();

      if (!auth) return null;

      if (auth.access_token && Number(auth.expires_at || 0) > Date.now() + 60000) {
        return auth.access_token;
      }

      return await refreshSpotifyAccessToken(auth);
    }

    // Spotify: one-time Deep account connection
    if (url.pathname === "/spotify/login" && request.method === "GET") {
      try {
        await ensureSpotifyTables();

        const setupKey = url.searchParams.get("key") || "";
        if (!env.SPOTIFY_SETUP_KEY || setupKey !== env.SPOTIFY_SETUP_KEY) {
          return new Response("Not found", { status: 404 });
        }

        const state = randomString(32);
        const verifier = randomString(64);
        const challenge = await spotifyCodeChallenge(verifier);

        await env.DB.prepare(
          "INSERT INTO spotify_oauth_state (state, verifier, created_at) VALUES (?, ?, ?)"
        ).bind(state, verifier, Date.now()).run();

        const authorize = new URL("https://accounts.spotify.com/authorize");
        authorize.searchParams.set("response_type", "code");
        authorize.searchParams.set("client_id", SPOTIFY_CLIENT_ID);
        authorize.searchParams.set("scope", "user-read-currently-playing user-read-playback-state");
        authorize.searchParams.set("redirect_uri", SPOTIFY_REDIRECT_URI);
        authorize.searchParams.set("state", state);
        authorize.searchParams.set("code_challenge_method", "S256");
        authorize.searchParams.set("code_challenge", challenge);

        return Response.redirect(authorize.toString(), 302);
      } catch {
        return new Response("Spotify setup unavailable", { status: 500 });
      }
    }

    // Spotify OAuth callback. This is only used by Deep during the one-time setup.
    if (url.pathname === "/spotify/callback" && request.method === "GET") {
      try {
        await ensureSpotifyTables();

        const error = url.searchParams.get("error");
        if (error) {
          return new Response(`Spotify authorization failed: ${error}`, { status: 400 });
        }

        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        if (!code || !state) {
          return new Response("Missing Spotify authorization data", { status: 400 });
        }

        const saved = await env.DB
          .prepare("SELECT verifier FROM spotify_oauth_state WHERE state = ? LIMIT 1")
          .bind(state)
          .first();

        if (!saved) {
          return new Response("Invalid or expired Spotify authorization", { status: 400 });
        }

        await env.DB.prepare("DELETE FROM spotify_oauth_state WHERE state = ?").bind(state).run();

        const tokenResponse = await fetch("https://accounts.spotify.com/api/token", {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded"
          },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: SPOTIFY_REDIRECT_URI,
            client_id: SPOTIFY_CLIENT_ID,
            code_verifier: saved.verifier
          })
        });

        if (!tokenResponse.ok) {
          return new Response("Could not connect Spotify", { status: 502 });
        }

        const token = await tokenResponse.json();
        if (!token.refresh_token) {
          return new Response("Spotify did not return a refresh token", { status: 502 });
        }

        const expiresAt = Date.now() + Number(token.expires_in || 3600) * 1000;

        await env.DB.prepare(`
          INSERT INTO spotify_auth (id, refresh_token, access_token, expires_at, updated_at)
          VALUES (1, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            refresh_token = excluded.refresh_token,
            access_token = excluded.access_token,
            expires_at = excluded.expires_at,
            updated_at = excluded.updated_at
        `).bind(
          token.refresh_token,
          token.access_token || null,
          expiresAt,
          new Date().toISOString()
        ).run();

        return new Response(`<!doctype html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Spotify Connected</title>
<style>body{margin:0;background:#080808;color:#fff;font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;text-align:center}main{max-width:420px;padding:32px}h1{font-size:28px;margin:0 0 10px}p{color:#aaa;line-height:1.6}a{color:#fff}</style></head>
<body><main><h1>Spotify connected.</h1><p>Deep's Spotify is now linked. Everyone visiting the site can see what's playing.</p><p><a href="/">back to Inside Deep's World</a></p></main></body></html>`, {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }
        });
      } catch {
        return new Response("Spotify callback failed", { status: 500 });
      }
    }

    // Public endpoint: returns only Deep's current playback metadata.
    if (url.pathname === "/api/spotify/now-playing" && request.method === "GET") {
      try {
        await ensureSpotifyTables();

        let accessToken = await getSpotifyAccessToken();
        if (!accessToken) {
          return Response.json(
            { connected: false, playing: false },
            { headers: { "Cache-Control": "no-store" } }
          );
        }

        let response = await fetch("https://api.spotify.com/v1/me/player", {
          headers: { Authorization: `Bearer ${accessToken}` }
        });

        if (response.status === 401) {
          const auth = await env.DB
            .prepare("SELECT refresh_token, access_token, expires_at FROM spotify_auth WHERE id = 1")
            .first();
          accessToken = await refreshSpotifyAccessToken(auth);

          if (!accessToken) {
            return Response.json(
              { connected: false, playing: false },
              { headers: { "Cache-Control": "no-store" } }
            );
          }

          response = await fetch("https://api.spotify.com/v1/me/player", {
            headers: { Authorization: `Bearer ${accessToken}` }
          });
        }

        if (response.status === 204) {
          return Response.json(
            { connected: true, playing: false },
            { headers: { "Cache-Control": "no-store" } }
          );
        }

        if (!response.ok) {
          return Response.json(
            { connected: true, playing: false },
            { headers: { "Cache-Control": "no-store" } }
          );
        }

        const data = await response.json();
        const item = data?.item;

        if (!item) {
          return Response.json(
            { connected: true, playing: false },
            { headers: { "Cache-Control": "no-store" } }
          );
        }

        return Response.json({
          connected: true,
          playing: Boolean(data.is_playing),
          progress_ms: Number(data.progress_ms || 0),
          duration_ms: Number(item.duration_ms || 0),
          track: {
            name: item.name || "Unknown track",
            artists: Array.isArray(item.artists)
              ? item.artists.map(artist => artist.name).filter(Boolean)
              : [],
            album: item.album?.name || "",
            image: item.album?.images?.[0]?.url || "",
            spotify_url: item.external_urls?.spotify || ""
          }
        }, {
          headers: { "Cache-Control": "no-store" }
        });
      } catch {
        return Response.json(
          { connected: false, playing: false },
          { status: 500, headers: { "Cache-Control": "no-store" } }
        );
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
