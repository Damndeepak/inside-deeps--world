import { ensureFeatures, handleFeatures } from "./features.js";

export default {
  async fetch(request, env, ctx) {
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

    // Timed lyrics belong to the full-song mode; iTunes preview offsets are unknown.
    if (url.pathname === "/api/lastfm/lyrics" && request.method === "GET") {
      const track = (url.searchParams.get("track") || "").trim();
      const artist = (url.searchParams.get("artist") || "").trim();
      const album = (url.searchParams.get("album") || "").trim();
      const wantedDuration = Number(url.searchParams.get("duration")) || 0;
      if (!track || !artist || track.length > 200 || artist.length > 200 || album.length > 300) {
        return Response.json({ lyrics: null }, { status: 400, headers: { "Cache-Control": "no-store" } });
      }
      const normalize = value => String(value || "").normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "").toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
      const title = value => String(value || "")
        .replace(/\s*[([]\s*(?:feat\.?|ft\.?|featuring)\s+[^)\]]*[)\]]/gi, "")
        .replace(/\s+(?:feat\.?|ft\.?|featuring)\s+.*$/i, "").trim();
      const leadArtist = value => String(value || "").split(/\s+(?:feat\.?|ft\.?|featuring)\s+/i)[0].trim();
      if (!normalize(title(track)) || !normalize(leadArtist(artist))) {
        return Response.json({ lyrics: null }, { status: 400, headers: { "Cache-Control": "no-store" } });
      }
      try {
        const search = new URL("https://lrclib.net/api/search");
        search.searchParams.set("track_name", title(track));
        search.searchParams.set("artist_name", leadArtist(artist));
        const response = await fetch(search.toString(), {
          headers: { "User-Agent": "InsideDeepsWorld/1.0 (Last.fm lyrics card)" },
          signal: AbortSignal.timeout(6000), cf: { cacheTtl: 3600, cacheEverything: true }
        });
        if (!response.ok) throw new Error("Lyrics provider unavailable");
        const data = await response.json();
        let best = null, score = -1;
        for (const item of Array.isArray(data) ? data : []) {
          if (normalize(title(item.trackName)) !== normalize(title(track)) ||
              normalize(leadArtist(item.artistName)) !== normalize(leadArtist(artist))) continue;
          const plain = typeof item.plainLyrics === "string" ? item.plainLyrics.trim() : "";
          const timed = typeof item.syncedLyrics === "string" ? item.syncedLyrics : "";
          const text = plain || timed.split(/\r?\n/).map(line => line
            .replace(/^(?:\s*\[\d+:\d+(?:[.:]\d+)?\])+\s*/, "")
            .replace(/^\s*\[(?:ar|al|ti|by|offset|length|re|ve):[^\]]*\]\s*$/i, "")).join("\n").trim();
          if (!text && !item.instrumental) continue;
          const duration = Number(item.duration) || null;
          const value = (album && normalize(item.albumName) === normalize(album) ? 4 : 0) + (plain ? 2 : 0) +
            (wantedDuration && duration && Math.abs(duration - wantedDuration) <= 3 ? 10 : 0) + (wantedDuration && timed ? 3 : 0);
          if (value > score) { best = { lyrics: text || null, syncedLyrics: timed.trim() || null, duration, instrumental: !!item.instrumental, source: "LRCLIB" }; score = value; }
        }
        return Response.json(best || { lyrics: null, syncedLyrics: null, duration: null, instrumental: false, source: "LRCLIB" }, {
          headers: { "Cache-Control": "public, max-age=600" }
        });
      } catch {
        return Response.json({ lyrics: null, unavailable: true }, {
          status: 502, headers: { "Cache-Control": "no-store" }
        });
      }
    }

    // Full-song lookup: the API key stays server-side; cache contains public metadata only.
    if (url.pathname === "/api/lastfm/full-song" && request.method === "GET") {
      const track = (url.searchParams.get("track") || "").trim();
      const artist = (url.searchParams.get("artist") || "").trim();
      const reply = (body, status = 200, ttl = 600) => Response.json(body, {
        status, headers: { "Cache-Control": ttl ? `public, max-age=${ttl}` : "no-store" }
      });
      if (!track || !artist || track.length > 200 || artist.length > 200) return reply({ video: null }, 400, 0);
      if (!env.YOUTUBE_API_KEY) return reply({ video: null, configured: false }, 200, 0);
      const norm = s => String(s || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
        .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
      const credits = s => String(s || "").replace(/\s*[([]\s*(?:feat\.?|ft\.?|featuring)\s+[^)\]]*[)\]]/gi, "")
        .replace(/\s+(?:feat\.?|ft\.?|featuring)\s+.*$/i, "").trim();
      const cleanTitle = s => credits(String(s || "").replace(/&amp;/gi, "&").replace(/&#39;|&apos;/gi, "'")
        .replace(/&quot;/gi, '"').replace(/\b(?:official\s+)?(?:music\s+video|audio|video|visualizer|lyric\s+video|lyrics|hd|4k)\b/gi, ""));
      const nt = norm(credits(track)), na = norm(credits(artist));
      if (!nt || !na) return reply({ video: null }, 400, 0);
      const cacheKey = new Request(`${url.origin}/__full_song_cache?v=1&track=${encodeURIComponent(nt)}&artist=${encodeURIComponent(na)}`);
      const cache = typeof caches !== "undefined" ? caches.default : null;
      const cached = cache && await cache.match(cacheKey);
      if (cached) return cached;
      try {
        const query = new URL("https://www.googleapis.com/youtube/v3/search");
        for (const [k, v] of Object.entries({ part: "snippet", q: `${artist} ${track}`, type: "video", maxResults: "10",
          videoEmbeddable: "true", videoSyndicated: "true", key: env.YOUTUBE_API_KEY })) query.searchParams.set(k, v);
        const search = await fetch(query, { signal: AbortSignal.timeout(7000) });
        if (!search.ok) throw new Error("YouTube search unavailable");
        const data = await search.json();
        const candidates = [];
        for (const item of data.items || []) {
          const id = item.id?.videoId, s = item.snippet || {}, raw = norm(s.title), title = norm(cleanTitle(s.title));
          if (!/^[A-Za-z0-9_-]{11}$/.test(id || "")) continue;
          const versions = ["remix", "live", "cover", "karaoke", "slowed", "sped", "reverb", "reaction", "nightcore"];
          if (versions.some(word => new RegExp(`\\b${word}\\b`).test(raw) && !new RegExp(`\\b${word}\\b`).test(nt))) continue;
          const channel = norm(s.channelTitle).replace(/\s+/g, ""), artistKey = na.replace(/\s+/g, "");
          const officialChannel = [artistKey, `${artistKey}vevo`, `${artistKey}topic`, `${artistKey}official`].includes(channel);
          // Conservative matching: artist-owned/Topic channel plus an exact cleaned title.
          if (!officialChannel || ![nt, `${na} ${nt}`, `${nt} ${na}`].includes(title)) continue;
          const score = (channel.endsWith("topic") ? 8 : 0) + (/official audio/i.test(s.title) ? 6 : 0) + (/official/i.test(s.title) ? 2 : 0);
          candidates.push({ id, title: s.title, channel: s.channelTitle, score });
        }
        let video = null;
        if (candidates.length) {
          const detailsUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
          for (const [k, v] of Object.entries({ part: "contentDetails,status,snippet", id: candidates.map(x => x.id).join(","), key: env.YOUTUBE_API_KEY })) detailsUrl.searchParams.set(k, v);
          const detailsResponse = await fetch(detailsUrl, { signal: AbortSignal.timeout(7000) });
          if (!detailsResponse.ok) throw new Error("YouTube details unavailable");
          const details = await detailsResponse.json();
          const eligible = candidates.map(candidate => {
            const d = (details.items || []).find(x => x.id === candidate.id);
            const m = d?.contentDetails?.duration?.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/);
            const duration = m ? Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0) : 0;
            if (!duration || duration > 1800 || !d.status?.embeddable || d.status.privacyStatus !== "public" ||
                (d.snippet?.liveBroadcastContent && d.snippet.liveBroadcastContent !== "none")) return null;
            return { ...candidate, duration };
          }).filter(Boolean).sort((a, b) => b.score - a.score);
          if (eligible.length) { const { score, ...chosen } = eligible[0]; video = { ...chosen, url: `https://www.youtube.com/watch?v=${chosen.id}` }; }
        }
        const result = reply({ video, configured: true }, 200, video ? 86400 : 3600);
        if (cache) { const write = cache.put(cacheKey, result.clone()); if (ctx?.waitUntil) ctx.waitUntil(write); else await write; }
        return result;
      } catch {
        return reply({ video: null, unavailable: true }, 502, 0);
      }
    }

    // Preview lookup is independent of Last.fm credentials and all database state.
    if (url.pathname === "/api/lastfm/preview" && request.method === "GET") {
      const track = (url.searchParams.get("track") || "").trim();
      const artist = (url.searchParams.get("artist") || "").trim();
      const reply = (body, status = 200, ttl = 0) => Response.json(body, {
        status, headers: { "Cache-Control": ttl ? `public, max-age=${ttl}` : "no-store" }
      });
      if (!track || !artist || track.length > 200 || artist.length > 200) return reply({ preview: null, reason: "bad_input" }, 400);
      const normalize = value => String(value || "").normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "").toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
      // Guest credits and punctuation can differ; recording/version labels must still match.
      const titleKey = value => normalize(String(value || "")
        .replace(/\s*[([]\s*(?:feat\.?|ft\.?|featuring)\s+[^)\]]*[)\]]/gi, "")
        .replace(/\s+(?:feat\.?|ft\.?|featuring)\s+.*$/i, "")).replace(/\s/g, "");
      const artistKey = value => normalize(String(value || "")
        .split(/\s+(?:feat\.?|ft\.?|featuring)\s+/i)[0]).replace(/^the\s+/, "").replace(/\s/g, "");
      const wantedTitle = titleKey(track), wantedArtist = artistKey(artist);
      const safeHTTPS = value => {
        try { const parsed = new URL(value); return parsed.protocol === "https:" ? parsed.href : ""; }
        catch { return ""; }
      };
      if (!wantedTitle || !wantedArtist) return reply({ preview: null, reason: "bad_input" }, 400);
      // Versioned, success-only cache. Never retain Apple errors or old negative results.
      const cache = typeof caches !== "undefined" ? caches.default : null;
      const cacheKey = new Request(`${url.origin}/__preview_cache?v=2&track=${encodeURIComponent(wantedTitle)}&artist=${encodeURIComponent(wantedArtist)}`);
      try { const hit = cache && await cache.match(cacheKey); if (hit) return hit; } catch { /* Cache failure must not prevent lookup. */ }
      const diagnostics = [];
      for (const country of ["IN", "US"]) {
        const debug = { country, status: null, resultCount: 0, rejected: { kind: 0, url: 0, title: 0, artist: 0 } };
        diagnostics.push(debug);
        try {
          const search = new URL("https://itunes.apple.com/search");
          for (const [k, v] of Object.entries({ term: track + " " + artist, media: "music", entity: "song", country, limit: "50" })) search.searchParams.set(k, v);
          const response = await fetch(search.toString(), {
            signal: AbortSignal.timeout(12000), cache: "no-store", cf: { cacheTtl: 0, cacheEverything: false }
          });
          debug.status = response.status;
          if (!response.ok) { debug.error = "provider_error"; continue; }
          const data = await response.json();
          if (!Array.isArray(data.results)) { debug.error = "provider_error"; continue; }
          debug.resultCount = data.results.length;
          let best = null, bestScore = -1;
          for (const item of data.results) {
            if (item.kind !== "song") { debug.rejected.kind++; continue; }
            if (!safeHTTPS(item.previewUrl)) { debug.rejected.url++; continue; }
            if (titleKey(item.trackName) !== wantedTitle) { debug.rejected.title++; continue; }
            if (artistKey(item.artistName) !== wantedArtist) { debug.rejected.artist++; continue; }
            const score = (normalize(item.trackName) === normalize(track) ? 4 : 0) + (normalize(item.artistName) === normalize(artist) ? 2 : 0);
            if (score > bestScore) { best = item; bestScore = score; }
          }
          if (!best) continue;
          const result = reply({ preview: {
            url: safeHTTPS(best.previewUrl), track: best.trackName, artist: best.artistName,
            album: best.collectionName || "", storeUrl: safeHTTPS(best.trackViewUrl), duration: 30
          }, reason: null, country, diagnostics }, 200, 600);
          if (cache) {
            const write = cache.put(cacheKey, result.clone()).catch(() => {});
            if (ctx?.waitUntil) ctx.waitUntil(write); else await write;
          }
          return result;
        } catch (error) {
          debug.error = error.name === "TimeoutError" || error.name === "AbortError" ? "timeout" : "provider_error";
        }
      }
      const failed = diagnostics.filter(item => item.error);
      const reason = failed.length ? (failed.every(item => item.error === "timeout") ? "timeout" : "provider_error") : "no_match";
      return reply({ preview: null, reason, unavailable: !!failed.length, diagnostics }, failed.length ? 502 : 200);
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

        // Safe to log: no session key, no secret
        console.log("LASTFM getSession", JSON.stringify({
          httpStatus: res.status,
          error: data?.error,
          message: data?.message,
          username: username || null,
          usernameOk: username ? LFM_USER_RE.test(username) : null
        }));

        if (!username) {
          const msg = data?.error === 14
            ? "Last.fm did not get your approval. Please click 'Yes, allow access' and try again."
            : data?.error === 4 || data?.error === 15
              ? "This login link expired or was already used. Please start again."
              : "Last.fm did not confirm your account. Please try again.";
          return lfmMessagePage("Could not connect", msg, 502);
        }
        if (!LFM_USER_RE.test(username)) {
          return lfmMessagePage("Could not connect", "This Last.fm username format isn't supported yet.", 400);
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

    // ---------------------------------------------------------------
    // Chat v2 (additive): read-only feed, polling state, image sharing
    // (R2), inline delete, admin delete. Never alters or drops existing
    // message data. Old /api/messages and /api/conversations routes are
    // left exactly as they were.
    // ---------------------------------------------------------------
    const CHAT_MAX_TEXT = 1000;
    const CHAT_MAX_IMAGE_BYTES = 8 * 1024 * 1024;
    const CHAT_MAX_UPLOAD_BYTES = 8.5 * 1024 * 1024;
    const CHAT_MSG_LIMIT = { count: 20, windowMs: 5 * 60 * 1000 };
    const CHAT_IMG_LIMIT = { count: 10, windowMs: 60 * 60 * 1000 };
    const chatHeaders = { "Cache-Control": "no-store" };

    async function ensureChatSchema() {
      if (globalThis.__chatSchemaReady) return;
      await env.DB.batch([
        env.DB.prepare(`
          CREATE TABLE IF NOT EXISTS message_images (
            message_id TEXT PRIMARY KEY,
            r2_key TEXT NOT NULL,
            content_type TEXT NOT NULL,
            size INTEGER NOT NULL,
            created_at TEXT NOT NULL
          )
        `),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at)"),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_messages_sender_created ON messages(sender_id, created_at)")
      ]);
      globalThis.__chatSchemaReady = true;
    }

    function chatSniffImage(bytes) {
      const b = bytes;
      if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
      if (b.length > 7 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
          b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
      if (b.length > 5 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 &&
          (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61) return "image/gif";
      if (b.length > 11 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
          b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
      return null;
    }

    async function chatIsAdmin(request) {
      const given = request.headers.get("X-Admin-Key") || "";
      const real = env.ADMIN_KEY || "";
      if (real.length < 12 || !given) return false;
      const enc = new TextEncoder();
      const [a, b] = await Promise.all([
        crypto.subtle.digest("SHA-256", enc.encode(given)),
        crypto.subtle.digest("SHA-256", enc.encode(real))
      ]);
      const x = new Uint8Array(a), y = new Uint8Array(b);
      let diff = 0;
      for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
      return diff === 0;
    }


    // ---------------------------------------------------------------
    // Push notifications (additive). Payload-less Web Push signed with
    // VAPID; the service worker fetches the newest message itself.
    // Keys are generated once and kept in D1 (no secrets to paste).
    // ---------------------------------------------------------------
    const b64u = (buf) => {
      let s = "";
      const u = new Uint8Array(buf);
      for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
      return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    };
    const b64uToBytes = (str) => {
      const p = str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4);
      const bin = atob(p);
      return Uint8Array.from(bin, c => c.charCodeAt(0));
    };

    async function ensurePushSchema() {
      if (globalThis.__pushSchemaReady) return;
      await env.DB.batch([
        env.DB.prepare(`
          CREATE TABLE IF NOT EXISTS push_subscriptions (
            endpoint TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            created_at TEXT NOT NULL
          )
        `),
        env.DB.prepare(`
          CREATE TABLE IF NOT EXISTS push_config (
            k TEXT PRIMARY KEY,
            v TEXT NOT NULL
          )
        `)
      ]);
      await env.DB
        .prepare("CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id)")
        .run();
      globalThis.__pushSchemaReady = true;
    }

    async function getVapid() {
      if (globalThis.__vapid) return globalThis.__vapid;
      await ensurePushSchema();
      let row = await env.DB.prepare("SELECT v FROM push_config WHERE k = 'vapid'").first();
      let jwk;
      if (row) {
        jwk = JSON.parse(row.v);
      } else {
        const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
        jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
        await env.DB
          .prepare("INSERT OR IGNORE INTO push_config (k, v) VALUES ('vapid', ?)")
          .bind(JSON.stringify(jwk))
          .run();
        row = await env.DB.prepare("SELECT v FROM push_config WHERE k = 'vapid'").first();
        jwk = JSON.parse(row.v);
      }
      const key = await crypto.subtle.importKey(
        "jwk",
        { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, d: jwk.d, ext: true },
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["sign"]
      );
      const x = b64uToBytes(jwk.x), y = b64uToBytes(jwk.y);
      const raw = new Uint8Array(65);
      raw[0] = 4; raw.set(x, 1); raw.set(y, 33);
      globalThis.__vapid = { key, publicKey: b64u(raw) };
      return globalThis.__vapid;
    }

    async function sendPush(endpoint, vapid) {
      const aud = new URL(endpoint).origin;
      const enc = new TextEncoder();
      const header = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
      const claims = b64u(enc.encode(JSON.stringify({
        aud,
        exp: Math.floor(Date.now() / 1000) + 12 * 3600,
        sub: url.origin
      })));
      const sig = await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        vapid.key,
        enc.encode(header + "." + claims)
      );
      const jwt = header + "." + claims + "." + b64u(sig);
      return fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: "vapid t=" + jwt + ", k=" + vapid.publicKey,
          TTL: "86400",
          Urgency: "high",
          "Content-Length": "0"
        }
      });
    }

    async function notifyChat(senderId) {
      try {
        await ensurePushSchema();
        const rows = await env.DB
          .prepare("SELECT endpoint FROM push_subscriptions WHERE user_id != ? LIMIT 200")
          .bind(senderId)
          .all();
        const subs = rows.results || [];
        if (!subs.length) return;
        const vapid = await getVapid();
        await Promise.all(subs.map(async (s) => {
          try {
            const r = await sendPush(s.endpoint, vapid);
            if (r.status === 404 || r.status === 410) {
              await env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").bind(s.endpoint).run();
            }
          } catch {}
        }));
      } catch {}
    }

    if (url.pathname === "/api/push/key" && request.method === "GET") {
      try {
        const v = await getVapid();
        return Response.json({ success: true, key: v.publicKey }, { headers: chatHeaders });
      } catch {
        return Response.json({ success: false }, { status: 500, headers: chatHeaders });
      }
    }

    if (url.pathname === "/api/push/subscribe" && request.method === "POST") {
      try {
        const user = await getUser(getUserId(request));
        if (!user) return Response.json({ success: false, error: "Not signed in" }, { status: 401, headers: chatHeaders });
        const body = await request.json();
        const endpoint = typeof body.endpoint === "string" ? body.endpoint : "";
        let ok = false;
        try { ok = new URL(endpoint).protocol === "https:" && endpoint.length < 1000; } catch {}
        if (!ok) return Response.json({ success: false, error: "Bad subscription" }, { status: 400, headers: chatHeaders });
        await ensurePushSchema();
        const count = await env.DB
          .prepare("SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?")
          .bind(user.id)
          .first();
        if (Number(count?.n || 0) >= 5) {
          return Response.json({ success: false, error: "Too many devices" }, { status: 429, headers: chatHeaders });
        }
        await env.DB
          .prepare("INSERT OR REPLACE INTO push_subscriptions (endpoint, user_id, created_at) VALUES (?, ?, ?)")
          .bind(endpoint, user.id, new Date().toISOString())
          .run();
        return Response.json({ success: true }, { headers: chatHeaders });
      } catch {
        return Response.json({ success: false }, { status: 500, headers: chatHeaders });
      }
    }

    if (url.pathname === "/api/push/unsubscribe" && request.method === "POST") {
      try {
        const user = await getUser(getUserId(request));
        if (!user) return Response.json({ success: false }, { status: 401, headers: chatHeaders });
        const body = await request.json();
        await ensurePushSchema();
        await env.DB
          .prepare("DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?")
          .bind(String(body.endpoint || ""), user.id)
          .run();
        return Response.json({ success: true }, { headers: chatHeaders });
      } catch {
        return Response.json({ success: false }, { status: 500, headers: chatHeaders });
      }
    }

    // Read receipts: isolated from all existing message tables.
    async function ensureReadSchema() {
      await env.DB.prepare(`CREATE TABLE IF NOT EXISTS chat_reads (
        user_id TEXT PRIMARY KEY, last_seen_at TEXT NOT NULL, updated_at TEXT NOT NULL
      )`).run();
    }

    if (url.pathname === "/api/chat/seen" && request.method === "POST") {
      try {
        const origin = request.headers.get("Origin");
        if (origin && origin !== url.origin) return Response.json({ success: false }, { status: 403, headers: chatHeaders });
        const user = await getUser(getUserId(request));
        if (!user) return Response.json({ success: false }, { status: 401, headers: chatHeaders });
        const { upto } = await request.json();
        const time = typeof upto === "string" ? Date.parse(upto) : NaN;
        if (!Number.isFinite(time) || new Date(time).toISOString() !== upto || time > Date.now()) {
          return Response.json({ success: false, error: "Invalid seen timestamp" }, { status: 400, headers: chatHeaders });
        }
        const exists = await env.DB.prepare("SELECT id FROM messages WHERE created_at = ? LIMIT 1").bind(upto).first();
        if (!exists) return Response.json({ success: false, error: "Message not found" }, { status: 400, headers: chatHeaders });
        await ensureReadSchema();
        const now = new Date().toISOString();
        const result = await env.DB.prepare(`INSERT INTO chat_reads (user_id, last_seen_at, updated_at)
          VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET
          last_seen_at = MAX(chat_reads.last_seen_at, excluded.last_seen_at),
          updated_at = excluded.updated_at
          WHERE chat_reads.updated_at <= ?`)
          .bind(user.id, upto, now, new Date(Date.now() - 3000).toISOString()).run();
        if (!result.meta.changes) return Response.json({ success: false }, {
          status: 429, headers: { ...chatHeaders, "Retry-After": "3" }
        });
        return Response.json({ success: true }, { headers: chatHeaders });
      } catch {
        return Response.json({ success: false }, { status: 400, headers: chatHeaders });
      }
    }

    if (url.pathname === "/api/chat/admin/seen" && request.method === "GET") {
      if (!await chatIsAdmin(request)) return Response.json({ success: false }, { status: 403, headers: chatHeaders });
      try {
        await ensureReadSchema();
        const rows = await env.DB.prepare(`SELECT u.username, r.last_seen_at
          FROM chat_reads r JOIN users u ON u.id = r.user_id ORDER BY r.last_seen_at DESC`).all();
        return Response.json({ success: true, readers: rows.results }, { headers: chatHeaders });
      } catch {
        return Response.json({ success: false }, { status: 500, headers: chatHeaders });
      }
    }

    // Light check used by the page to know when something changed
    if (url.pathname === "/api/chat/state" && request.method === "GET") {
      try {
        await ensureChatSchema();
        const row = await env.DB
          .prepare("SELECT COUNT(*) AS n, MAX(created_at) AS latest FROM messages")
          .first();
        return Response.json(
          { success: true, count: Number(row?.n || 0), latest: row?.latest || null },
          { headers: chatHeaders }
        );
      } catch {
        return Response.json({ success: false }, { status: 500, headers: chatHeaders });
      }
    }

    // Read-only feed: no writes, no merging. Shows every message in the table.
    if (url.pathname === "/api/chat" && request.method === "GET") {
      try {
        await ensureChatSchema();
        await ensureFeatures(env.DB);
        const userId = getUserId(request);
        const me = userId ? await getUser(userId) : null;

        const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "100", 10) || 100, 1), 200);
        const before = url.searchParams.get("before");

        const result = await env.DB
          .prepare(`
            SELECT
              m.id,
              m.message,
              m.parent_id,
              m.created_at,
              m.sender_id,
              COALESCE(u.username, 'Unknown') AS username,
              (mi.message_id IS NOT NULL) AS has_image,
              (ma.message_id IS NOT NULL) AS has_audio,
              pm.id AS p_id,
              pm.sender_id AS p_sender_id,
              COALESCE(pu.username, 'Unknown') AS p_username,
              SUBSTR(pm.message, 1, 80) AS p_snippet,
              (pmi.message_id IS NOT NULL) AS p_has_image
            FROM messages m
            LEFT JOIN users u ON u.id = m.sender_id
            LEFT JOIN message_images mi ON mi.message_id = m.id
            LEFT JOIN message_audio ma ON ma.message_id = m.id
            LEFT JOIN messages pm ON pm.id = m.parent_id
            LEFT JOIN users pu ON pu.id = pm.sender_id
            LEFT JOIN message_images pmi ON pmi.message_id = pm.id
            ${before ? "WHERE m.created_at < ?" : ""}
            ORDER BY m.created_at DESC, m.id DESC
            LIMIT ?
          `)
          .bind(...(before ? [before, limit + 1] : [limit + 1]))
          .all();

        const rows = result.results || [];
        const hasMore = rows.length > limit;
        const page = rows.slice(0, limit).reverse();

        const messages = page.map(r => ({
          id: r.id,
          message: r.message || "",
          created_at: r.created_at,
          username: r.username,
          mine: Boolean(userId) && r.sender_id === userId,
          image: Boolean(r.has_image),
          audio: Boolean(r.has_audio),
          parent: r.parent_id
            ? (r.p_id
                ? {
                    id: r.p_id,
                    username: r.p_username,
                    snippet: r.p_snippet || "",
                    image: Boolean(r.p_has_image)
                  }
                : { id: r.parent_id, deleted: true })
            : null
        }));

        return Response.json({
          success: true,
          me: me ? { username: me.username } : null,
          has_more: hasMore,
          messages
        }, { headers: chatHeaders });
      } catch {
        return Response.json(
          { success: false, error: "Could not load chat" },
          { status: 500, headers: chatHeaders }
        );
      }
    }

    // Send a message (text and/or one image)
    if (url.pathname === "/api/chat/send" && request.method === "POST") {
      let storedKey = null;
      try {
        const userId = getUserId(request);
        const user = await getUser(userId);
        if (!user) {
          return Response.json({ success: false, error: "User not found" }, { status: 401, headers: chatHeaders });
        }

        await ensureChatSchema();

        const declared = Number(request.headers.get("Content-Length") || 0);
        if (declared > CHAT_MAX_UPLOAD_BYTES) {
          return Response.json({ success: false, error: "Image is too large" }, { status: 413, headers: chatHeaders });
        }

        let text = "";
        let parentId = null;
        let file = null;

        const ctype = request.headers.get("Content-Type") || "";
        if (ctype.includes("multipart/form-data")) {
          const form = await request.formData();
          text = typeof form.get("message") === "string" ? form.get("message").trim() : "";
          parentId = typeof form.get("parent_id") === "string" && form.get("parent_id") ? form.get("parent_id") : null;
          const f = form.get("image");
          if (f && typeof f === "object" && typeof f.arrayBuffer === "function" && f.size > 0) file = f;
        } else {
          const body = await request.json();
          text = typeof body.message === "string" ? body.message.trim() : "";
          parentId = body.parent_id || null;
        }

        if (text.length > CHAT_MAX_TEXT) {
          return Response.json({ success: false, error: "Message is too long" }, { status: 400, headers: chatHeaders });
        }
        if (!text && !file) {
          return Response.json({ success: false, error: "Message is required" }, { status: 400, headers: chatHeaders });
        }

        // Spam limits
        const now = Date.now();
        const msgCount = await env.DB
          .prepare("SELECT COUNT(*) AS n FROM messages WHERE sender_id = ? AND created_at > ?")
          .bind(user.id, new Date(now - CHAT_MSG_LIMIT.windowMs).toISOString())
          .first();
        if (Number(msgCount?.n || 0) >= CHAT_MSG_LIMIT.count) {
          return Response.json({ success: false, error: "Slow down a little" }, { status: 429, headers: chatHeaders });
        }

        let bytes = null;
        let imageType = null;
        if (file) {
          if (!env.CHAT_IMAGES) {
            return Response.json({ success: false, error: "Images are not enabled yet" }, { status: 503, headers: chatHeaders });
          }
          if (file.size > CHAT_MAX_IMAGE_BYTES) {
            return Response.json({ success: false, error: "Image is too large" }, { status: 413, headers: chatHeaders });
          }
          bytes = new Uint8Array(await file.arrayBuffer());
          imageType = chatSniffImage(bytes);
          if (!imageType) {
            return Response.json({ success: false, error: "Only JPG, PNG, WebP or GIF images" }, { status: 415, headers: chatHeaders });
          }

          const imgCount = await env.DB
            .prepare(`
              SELECT COUNT(*) AS n
              FROM message_images mi
              JOIN messages m ON m.id = mi.message_id
              WHERE m.sender_id = ? AND mi.created_at > ?
            `)
            .bind(user.id, new Date(now - CHAT_IMG_LIMIT.windowMs).toISOString())
            .first();
          if (Number(imgCount?.n || 0) >= CHAT_IMG_LIMIT.count) {
            return Response.json({ success: false, error: "Image limit reached, try later" }, { status: 429, headers: chatHeaders });
          }
        }

        if (parentId) {
          const parent = await env.DB
            .prepare("SELECT id FROM messages WHERE id = ?")
            .bind(parentId)
            .first();
          if (!parent) {
            return Response.json({ success: false, error: "Parent message not found" }, { status: 400, headers: chatHeaders });
          }
        }

        // Main conversation (read-only lookup; created only if none exists)
        let main = await env.DB
          .prepare("SELECT id FROM conversations ORDER BY created_at ASC LIMIT 1")
          .first();
        let conversationId = main?.id;
        if (!conversationId) {
          conversationId = crypto.randomUUID();
          await env.DB
            .prepare("INSERT INTO conversations (id, user_id, created_at) VALUES (?, ?, ?)")
            .bind(conversationId, user.id, new Date().toISOString())
            .run();
        }

        const messageId = crypto.randomUUID();
        const createdAt = new Date().toISOString();

        const statements = [
          env.DB
            .prepare(`
              INSERT INTO messages (id, conversation_id, sender_id, message, parent_id, created_at)
              VALUES (?, ?, ?, ?, ?, ?)
            `)
            .bind(messageId, conversationId, user.id, text, parentId, createdAt)
        ];

        if (file) {
          storedKey = `chat/${messageId}`;
          await env.CHAT_IMAGES.put(storedKey, bytes, { httpMetadata: { contentType: imageType } });
          statements.push(
            env.DB
              .prepare(`
                INSERT INTO message_images (message_id, r2_key, content_type, size, created_at)
                VALUES (?, ?, ?, ?, ?)
              `)
              .bind(messageId, storedKey, imageType, bytes.length, createdAt)
          );
        }

        await env.DB.batch(statements);

        if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(notifyChat(user.id));

        return Response.json({
          success: true,
          message_id: messageId,
          created_at: createdAt,
          image: Boolean(file)
        }, { headers: chatHeaders });
      } catch {
        if (storedKey && env.CHAT_IMAGES) {
          try { await env.CHAT_IMAGES.delete(storedKey); } catch {}
        }
        return Response.json(
          { success: false, error: "Could not send message" },
          { status: 500, headers: chatHeaders }
        );
      }
    }

    // Serve a message's image
    const chatImageMatch = url.pathname.match(/^\/api\/chat\/image\/([A-Za-z0-9_-]{1,64})$/);
    if (chatImageMatch && request.method === "GET") {
      try {
        if (!env.CHAT_IMAGES) return new Response("Not found", { status: 404 });
        await ensureChatSchema();

        const row = await env.DB
          .prepare("SELECT r2_key, content_type FROM message_images WHERE message_id = ?")
          .bind(chatImageMatch[1])
          .first();
        if (!row) return new Response("Not found", { status: 404 });

        const object = await env.CHAT_IMAGES.get(row.r2_key);
        if (!object) return new Response("Not found", { status: 404 });

        return new Response(object.body, {
          headers: {
            "Content-Type": row.content_type,
            "Cache-Control": "public, max-age=86400",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; sandbox"
          }
        });
      } catch {
        return new Response("Not found", { status: 404 });
      }
    }

    // Is this browser an admin? (page shows delete buttons on every message)
    if (url.pathname === "/api/chat/admin/check" && request.method === "GET") {
      return Response.json({ admin: await chatIsAdmin(request) }, { headers: chatHeaders });
    }

    // Delete a message (+ its image). Owner or admin only.
    const chatDeleteMatch = url.pathname.match(/^\/api\/chat\/message\/([A-Za-z0-9_-]{1,64})$/);
    if (chatDeleteMatch && request.method === "DELETE") {
      try {
        const userId = getUserId(request);
        const admin = await chatIsAdmin(request);
        if (!userId && !admin) {
          return Response.json({ success: false, error: "User not found" }, { status: 401, headers: chatHeaders });
        }

        await ensureChatSchema();

        const messageId = chatDeleteMatch[1];
        const msg = await env.DB
          .prepare("SELECT id, sender_id FROM messages WHERE id = ?")
          .bind(messageId)
          .first();
        if (!msg) {
          return Response.json({ success: false, error: "Message not found" }, { status: 404, headers: chatHeaders });
        }
        if (!admin && msg.sender_id !== userId) {
          return Response.json({ success: false, error: "Not allowed" }, { status: 403, headers: chatHeaders });
        }

        const img = await env.DB
          .prepare("SELECT r2_key FROM message_images WHERE message_id = ?")
          .bind(messageId)
          .first();
        if (img && env.CHAT_IMAGES) {
          try { await env.CHAT_IMAGES.delete(img.r2_key); } catch {}
        }

        await ensureFeatures(env.DB);
        const audio = await env.DB.prepare("SELECT r2_key FROM message_audio WHERE message_id = ?").bind(messageId).first();
        if (audio && env.CHAT_IMAGES) await env.CHAT_IMAGES.delete(audio.r2_key);
        await env.DB.batch([
          env.DB.prepare("DELETE FROM message_audio WHERE message_id = ?").bind(messageId),
          env.DB.prepare("DELETE FROM message_reactions WHERE message_id = ?").bind(messageId),
          env.DB.prepare("DELETE FROM message_images WHERE message_id = ?").bind(messageId),
          env.DB.prepare("DELETE FROM messages WHERE id = ?").bind(messageId)
        ]);

        return Response.json({ success: true }, { headers: chatHeaders });
      } catch {
        return Response.json({ success: false, error: "Could not delete message" }, { status: 500, headers: chatHeaders });
      }
    }

    const featureResponse = await handleFeatures(request, env, ctx, { getUser, getUserId, chatIsAdmin, ensureChatSchema, notifyChat, chatSniffImage });
    if (featureResponse) return featureResponse;

    return env.ASSETS.fetch(request);
  }
};




