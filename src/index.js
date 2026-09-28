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

    async function ensureUserForSpotify(request) {
      const existingId = getUserId(request);
      const existing = await getUser(existingId);

      if (existing) {
        return {
          user: existing,
          setCookie: null
        };
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

      return {
        user: {
          id,
          username
        },
        setCookie:
          `deep_user=${id}; Path=/; Max-Age=31536000; SameSite=Lax; Secure`
      };
    }

    async function ensureMainConversation(userId) {
      let main = await env.DB
        .prepare(
          "SELECT id FROM conversations ORDER BY created_at ASC LIMIT 1"
        )
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

    /*
     * ============================================================
     * SPOTIFY
     * ============================================================
     *
     * Website limit:
     *   10 connected site users.
     *
     * Spotify Development Mode may impose its own lower limit.
     *
     * Tokens NEVER go to the browser.
     */

    const SPOTIFY_CLIENT_ID =
      "264932447e374f16a25be5599d97abc6";

    const SPOTIFY_REDIRECT_URI =
      `${url.origin}/spotify/callback`;

    const SPOTIFY_MAX_USERS = 10;

    const SPOTIFY_SCOPES = [
      "user-read-private",
      "user-read-currently-playing",
      "user-read-playback-state",
      "user-read-recently-played"
    ].join(" ");

    function base64UrlEncode(bytes) {
      let binary = "";

      for (const byte of bytes) {
        binary += String.fromCharCode(byte);
      }

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

      const digest = await crypto.subtle.digest(
        "SHA-256",
        data
      );

      return base64UrlEncode(
        new Uint8Array(digest)
      );
    }

    async function ensureSpotifyTables() {
      /*
       * One row per connected website user.
       *
       * The old spotify_auth table is intentionally left alone.
       * We simply stop using it.
       */
      await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS spotify_accounts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          site_user_id TEXT NOT NULL UNIQUE,
          spotify_account_id TEXT NOT NULL UNIQUE,
          spotify_user_id TEXT,
          display_name TEXT,
          spotify_url TEXT,
          image_url TEXT,
          refresh_token TEXT NOT NULL,
          access_token TEXT,
          expires_at INTEGER,
          authorized_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          last_track_name TEXT,
          last_track_artists TEXT,
          last_track_album TEXT,
          last_track_image TEXT,
          last_track_url TEXT,
          last_played_at TEXT,
          needs_reauth INTEGER NOT NULL DEFAULT 0
        )
      `).run();

      await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS spotify_oauth_state (
          state TEXT PRIMARY KEY,
          verifier TEXT NOT NULL,
          user_id TEXT NOT NULL,
          created_at INTEGER NOT NULL
        )
      `).run();

      /*
       * Existing installations may already have the old state table
       * without user_id.
       */
      try {
        const columns = await env.DB
          .prepare("PRAGMA table_info(spotify_oauth_state)")
          .all();

        const hasUserId = columns.results?.some(
          column => column.name === "user_id"
        );

        if (!hasUserId) {
          await env.DB.prepare(
            "ALTER TABLE spotify_oauth_state ADD COLUMN user_id TEXT"
          ).run();
        }
      } catch {
        /*
         * If migration isn't needed, continue normally.
         */
      }

      /*
       * Remove OAuth states older than 15 minutes.
       */
      await env.DB
        .prepare(
          "DELETE FROM spotify_oauth_state WHERE created_at < ?"
        )
        .bind(Date.now() - 15 * 60 * 1000)
        .run();
    }

    async function getSpotifyAccountBySiteUser(userId) {
      if (!userId) return null;

      return await env.DB
        .prepare(
          `SELECT *
           FROM spotify_accounts
           WHERE site_user_id = ?
           LIMIT 1`
        )
        .bind(userId)
        .first();
    }

    async function countSpotifyAccounts() {
      const row = await env.DB
        .prepare(
          "SELECT COUNT(*) AS count FROM spotify_accounts"
        )
        .first();

      return Number(row?.count || 0);
    }

    function spotifyTrackFromItem(item) {
      if (!item) return null;

      return {
        name: item.name || "Unknown track",
        artists: Array.isArray(item.artists)
          ? item.artists
              .map(artist => artist?.name)
              .filter(Boolean)
          : [],
        album: item.album?.name || "",
        image: item.album?.images?.[0]?.url || "",
        spotify_url:
          item.external_urls?.spotify || "",
        duration_ms:
          Number(item.duration_ms || 0)
      };
    }

    async function refreshSpotifyAccessToken(account) {
      if (!account?.refresh_token) {
        return null;
      }

      const response = await fetch(
        "https://accounts.spotify.com/api/token",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/x-www-form-urlencoded"
          },
          body: new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: account.refresh_token,
            client_id: SPOTIFY_CLIENT_ID
          })
        }
      );

      if (!response.ok) {
        let body = null;

        try {
          body = await response.json();
        } catch {
          body = null;
        }

        /*
         * Spotify returns invalid_grant when a refresh token
         * has expired/revoked.
         */
        if (
          response.status === 400 &&
          body?.error === "invalid_grant"
        ) {
          await env.DB
            .prepare(`
              UPDATE spotify_accounts
              SET
                access_token = NULL,
                expires_at = NULL,
                needs_reauth = 1,
                updated_at = ?
              WHERE id = ?
            `)
            .bind(
              new Date().toISOString(),
              account.id
            )
            .run();
        }

        return null;
      }

      const token = await response.json();

      const accessToken = token.access_token;

      if (!accessToken) {
        return null;
      }

      const refreshToken =
        token.refresh_token ||
        account.refresh_token;

      const expiresAt =
        Date.now() +
        Number(token.expires_in || 3600) * 1000;

      await env.DB
        .prepare(`
          UPDATE spotify_accounts
          SET
            refresh_token = ?,
            access_token = ?,
            expires_at = ?,
            needs_reauth = 0,
            updated_at = ?
          WHERE id = ?
        `)
        .bind(
          refreshToken,
          accessToken,
          expiresAt,
          new Date().toISOString(),
          account.id
        )
        .run();

      return accessToken;
    }

    async function getSpotifyAccessToken(account) {
      if (!account) {
        return null;
      }

      if (Number(account.needs_reauth || 0) === 1) {
        return null;
      }

      if (
        account.access_token &&
        Number(account.expires_at || 0) >
          Date.now() + 60000
      ) {
        return account.access_token;
      }

      return await refreshSpotifyAccessToken(account);
    }

    async function spotifyFetch(account, endpoint) {
      let accessToken =
        await getSpotifyAccessToken(account);

      if (!accessToken) {
        return {
          response: null,
          data: null,
          accessToken: null
        };
      }

      let response = await fetch(
        `https://api.spotify.com/v1${endpoint}`,
        {
          headers: {
            Authorization:
              `Bearer ${accessToken}`
          }
        }
      );

      /*
       * Token expired unexpectedly.
       * Refresh once, then retry once.
       */
      if (response.status === 401) {
        const freshAccount =
          await env.DB
            .prepare(
              "SELECT * FROM spotify_accounts WHERE id = ?"
            )
            .bind(account.id)
            .first();

        accessToken =
          await refreshSpotifyAccessToken(
            freshAccount
          );

        if (!accessToken) {
          return {
            response,
            data: null,
            accessToken: null
          };
        }

        response = await fetch(
          `https://api.spotify.com/v1${endpoint}`,
          {
            headers: {
              Authorization:
                `Bearer ${accessToken}`
            }
          }
        );
      }

      let data = null;

      try {
        if (response.status !== 204) {
          data = await response.json();
        }
      } catch {
        data = null;
      }

      return {
        response,
        data,
        accessToken
      };
    }

    async function saveLastPlayed(
      account,
      track,
      playedAt
    ) {
      if (!track) return;

      await env.DB
        .prepare(`
          UPDATE spotify_accounts
          SET
            last_track_name = ?,
            last_track_artists = ?,
            last_track_album = ?,
            last_track_image = ?,
            last_track_url = ?,
            last_played_at = ?,
            updated_at = ?
          WHERE id = ?
        `)
        .bind(
          track.name,
          JSON.stringify(track.artists || []),
          track.album || "",
          track.image || "",
          track.spotify_url || "",
          playedAt || new Date().toISOString(),
          new Date().toISOString(),
          account.id
        )
        .run();
    }

    async function updateSpotifyPlayback(account) {
      const current = await spotifyFetch(
        account,
        "/me/player"
      );

      /*
       * 204 means Spotify currently has no playback state.
       */
      if (
        !current.response ||
        current.response.status === 204
      ) {
        /*
         * Try recently played so the UI still has
         * a last played track.
         */
        const recent =
          await spotifyFetch(
            account,
            "/me/player/recently-played?limit=1"
          );

        const item =
          recent.data?.items?.[0];

        if (item?.track) {
          const track =
            spotifyTrackFromItem(item.track);

          await saveLastPlayed(
            account,
            track,
            item.played_at ||
              new Date().toISOString()
          );

          return {
            playing: false,
            track: null
          };
        }

        return {
          playing: false,
          track: null
        };
      }

      /*
       * Spotify returned an API error.
       */
      if (!current.response.ok) {
        return {
          playing: false,
          track: null
        };
      }

      const item = current.data?.item;

      if (!item) {
        const recent =
          await spotifyFetch(
            account,
            "/me/player/recently-played?limit=1"
          );

        const recentItem =
          recent.data?.items?.[0];

        if (recentItem?.track) {
          const recentTrack =
            spotifyTrackFromItem(
              recentItem.track
            );

          await saveLastPlayed(
            account,
            recentTrack,
            recentItem.played_at ||
              new Date().toISOString()
          );
        }

        return {
          playing: false,
          track: null
        };
      }

      const track =
        spotifyTrackFromItem(item);

      /*
       * Save whatever track is currently active.
       * This gives us a persistent "last played" value
       * even after playback stops.
       */
      if (track) {
        await saveLastPlayed(
          account,
          track,
          new Date().toISOString()
        );
      }

      return {
        playing:
          Boolean(current.data?.is_playing),
        progress_ms:
          Number(current.data?.progress_ms || 0),
        track
      };
    }

    /*
     * ============================================================
     * SPOTIFY LOGIN
     * ============================================================
     */

    if (
      url.pathname === "/spotify/login" &&
      request.method === "GET"
    ) {
      try {
        await ensureSpotifyTables();

        const userResult =
          await ensureUserForSpotify(request);

        const user = userResult.user;

        const existing =
          await getSpotifyAccountBySiteUser(
            user.id
          );

        /*
         * If this site user is already connected,
         * reconnecting is allowed and will update the
         * same database row.
         *
         * If not connected, enforce the 10-account
         * website limit.
         */
        if (!existing) {
          const count =
            await countSpotifyAccounts();

          if (count >= SPOTIFY_MAX_USERS) {
            return new Response(
              `<!doctype html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Spotify connections full</title>
<style>
body{
  margin:0;
  background:#080808;
  color:#fff;
  font-family:system-ui,sans-serif;
  display:grid;
  place-items:center;
  min-height:100vh;
  text-align:center
}
main{
  max-width:440px;
  padding:32px
}
h1{
  font-size:26px;
  margin:0 0 12px
}
p{
  color:#aaa;
  line-height:1.6
}
a{
  color:#fff
}
</style>
</head>
<body>
<main>
<h1>Spotify slots are full.</h1>
<p>All 10 Spotify connection slots are currently being used.</p>
<p>Someone needs to disconnect before a new account can connect.</p>
<p><a href="/">back to Inside Deep's World</a></p>
</main>
</body>
</html>`,
              {
                status: 409,
                headers: {
                  "Content-Type":
                    "text/html; charset=utf-8",
                  "Cache-Control": "no-store"
                }
              }
            );
          }
        }

        const state =
          randomString(32);

        const verifier =
          randomString(64);

        const challenge =
          await spotifyCodeChallenge(
            verifier
          );

        await env.DB
          .prepare(`
            INSERT INTO spotify_oauth_state
            (state, verifier, user_id, created_at)
            VALUES (?, ?, ?, ?)
          `)
          .bind(
            state,
            verifier,
            user.id,
            Date.now()
          )
          .run();

        const authorize =
          new URL(
            "https://accounts.spotify.com/authorize"
          );

        authorize.searchParams.set(
          "response_type",
          "code"
        );

        authorize.searchParams.set(
          "client_id",
          SPOTIFY_CLIENT_ID
        );

        authorize.searchParams.set(
          "scope",
          SPOTIFY_SCOPES
        );

        authorize.searchParams.set(
          "redirect_uri",
          SPOTIFY_REDIRECT_URI
        );

        authorize.searchParams.set(
          "state",
          state
        );

        authorize.searchParams.set(
          "code_challenge_method",
          "S256"
        );

        authorize.searchParams.set(
          "code_challenge",
          challenge
        );

        const headers = {
          "Cache-Control":
            "no-store"
        };

        if (userResult.setCookie) {
          headers["Set-Cookie"] =
            userResult.setCookie;
        }

        headers.Location =
          authorize.toString();

        return new Response(null, {
          status: 302,
          headers
        });
      } catch {
        return new Response(
          "Spotify login unavailable",
          { status: 500 }
        );
      }
    }

    /*
     * ============================================================
     * SPOTIFY CALLBACK
     * ============================================================
     */

    if (
      url.pathname === "/spotify/callback" &&
      request.method === "GET"
    ) {
      try {
        await ensureSpotifyTables();

        const error =
          url.searchParams.get("error");

        const state =
          url.searchParams.get("state");

        if (error) {
          return new Response(
            `Spotify authorization failed: ${error}`,
            { status: 400 }
          );
        }

        const code =
          url.searchParams.get("code");

        if (!code || !state) {
          return new Response(
            "Missing Spotify authorization data",
            { status: 400 }
          );
        }

        const saved =
          await env.DB
            .prepare(`
              SELECT state, verifier, user_id
              FROM spotify_oauth_state
              WHERE state = ?
              LIMIT 1
            `)
            .bind(state)
            .first();

        if (!saved || !saved.user_id) {
          return new Response(
            "Invalid or expired Spotify authorization",
            { status: 400 }
          );
        }

        await env.DB
          .prepare(
            "DELETE FROM spotify_oauth_state WHERE state = ?"
          )
          .bind(state)
          .run();

        /*
         * If this is a brand-new site user, make sure the
         * 10-slot limit is checked again at callback time.
         */
        const existing =
          await getSpotifyAccountBySiteUser(
            saved.user_id
          );

        if (!existing) {
          const count =
            await countSpotifyAccounts();

          if (count >= SPOTIFY_MAX_USERS) {
            return new Response(
              `<!doctype html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Spotify slots full</title>
<style>
body{
  margin:0;
  background:#080808;
  color:#fff;
  font-family:system-ui,sans-serif;
  display:grid;
  place-items:center;
  min-height:100vh;
  text-align:center
}
main{
  max-width:440px;
  padding
