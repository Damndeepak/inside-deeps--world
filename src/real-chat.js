function json(data, status = 200, extraHeaders = {}) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...extraHeaders
    }
  });
}

function getCookie(request, name) {
  const cookies = request.headers.get("Cookie") || "";
  const match = cookies.match(
    new RegExp("(?:^|;\\s*)" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "=([^;]+)")
  );
  return match ? decodeURIComponent(match[1]) : null;
}

function sessionCookie(id) {
  return `real_chat_user=${encodeURIComponent(id)}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`;
}

async function ensureRealChatTables(env) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS real_chat_users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      username TEXT NOT NULL UNIQUE,
      bio TEXT NOT NULL DEFAULT '',
      avatar_url TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    )
  `).run();

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS real_chat_conversations (
      id TEXT PRIMARY KEY,
      user_a_id TEXT NOT NULL,
      user_b_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(user_a_id, user_b_id)
    )
  `).run();

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS real_chat_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      message TEXT,
      message_type TEXT NOT NULL DEFAULT 'text',
      reply_to_id TEXT,
      edited_at TEXT,
      deleted_at TEXT,
      created_at TEXT NOT NULL
    )
  `).run();

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS real_chat_reads (
      conversation_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      last_read_at TEXT NOT NULL,
      PRIMARY KEY (conversation_id, user_id)
    )
  `).run();

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS real_chat_reactions (
      message_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      reaction TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (message_id, user_id, reaction)
    )
  `).run();
}

async function getUser(env, request) {
  const id = getCookie(request, "real_chat_user");
  if (!id) return null;

  return await env.DB.prepare(`
    SELECT id, name, username, bio, avatar_url, created_at, last_seen_at
    FROM real_chat_users
    WHERE id = ?
  `).bind(id).first();
}

export async function handleRealChat(request, env, url) {
  if (!url.pathname.startsWith("/api/real-chat/")) return null;

  try {
    await ensureRealChatTables(env);

    if (url.pathname === "/api/real-chat/register" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));

      const name = typeof body.name === "string"
        ? body.name.trim().replace(/\s+/g, " ")
        : "";

      const username = typeof body.username === "string"
        ? body.username.trim().toLowerCase().replace(/^@/, "")
        : "";

      const bio = typeof body.bio === "string"
        ? body.bio.trim().replace(/\s+/g, " ").slice(0, 120)
        : "";

      if (name.length < 2 || name.length > 40) {
        return json({
          success: false,
          error: "Name must be between 2 and 40 characters."
        }, 400);
      }

      if (!/^[a-z0-9_]{3,24}$/.test(username)) {
        return json({
          success: false,
          error: "Username must be 3-24 characters using letters, numbers or underscores."
        }, 400);
      }

      const currentId = getCookie(request, "real_chat_user");

      const taken = await env.DB.prepare(`
        SELECT id FROM real_chat_users WHERE username = ? LIMIT 1
      `).bind(username).first();

      if (taken && taken.id !== currentId) {
        return json({
          success: false,
          error: "That username is already taken."
        }, 409);
      }

      const now = new Date().toISOString();

      if (currentId) {
        const existing = await env.DB.prepare(`
          SELECT id FROM real_chat_users WHERE id = ?
        `).bind(currentId).first();

        if (existing) {
          await env.DB.prepare(`
            UPDATE real_chat_users
            SET name = ?, username = ?, bio = ?, last_seen_at = ?
            WHERE id = ?
          `).bind(name, username, bio, now, currentId).run();

          return json({
            success: true,
            user: {
              id: currentId,
              name,
              username,
              bio
            }
          });
        }
      }

      const id = crypto.randomUUID();

      await env.DB.prepare(`
        INSERT INTO real_chat_users
        (id, name, username, bio, avatar_url, created_at, last_seen_at)
        VALUES (?, ?, ?, ?, '', ?, ?)
      `).bind(
        id,
        name,
        username,
        bio,
        now,
        now
      ).run();

      return json({
        success: true,
        user: {
          id,
          name,
          username,
          bio
        }
      }, 200, {
        "Set-Cookie": sessionCookie(id)
      });
    }

    if (url.pathname === "/api/real-chat/me" && request.method === "GET") {
      const user = await getUser(env, request);

      if (!user) {
        return json({
          success: true,
          connected: false
        });
      }

      await env.DB.prepare(`
        UPDATE real_chat_users
        SET last_seen_at = ?
        WHERE id = ?
      `).bind(new Date().toISOString(), user.id).run();

      return json({
        success: true,
        connected: true,
        user
      });
    }

    if (url.pathname === "/api/real-chat/users" && request.method === "GET") {
      const me = await getUser(env, request);

      if (!me) {
        return json({
          success: false,
          error: "Register your name first."
        }, 401);
      }

      const q = (url.searchParams.get("q") || "").trim();

      if (q.length < 1) {
        return json({
          success: true,
          users: []
        });
      }

      const result = await env.DB.prepare(`
        SELECT id, name, username, bio, avatar_url, last_seen_at
        FROM real_chat_users
        WHERE id != ?
          AND (name LIKE ? OR username LIKE ?)
        ORDER BY name ASC
        LIMIT 20
      `).bind(
        me.id,
        `%${q}%`,
        `%${q.toLowerCase().replace(/^@/, "")}%`
      ).all();

      return json({
        success: true,
        users: result.results || []
      });
    }

    if (
      url.pathname === "/api/real-chat/conversations" &&
      request.method === "POST"
    ) {
      const me = await getUser(env, request);

      if (!me) {
        return json({
          success: false,
          error: "Register your name first."
        }, 401);
      }

      const body = await request.json().catch(() => ({}));
      const otherId = typeof body.user_id === "string"
        ? body.user_id
        : "";

      if (!otherId || otherId === me.id) {
        return json({
          success: false,
          error: "Invalid user."
        }, 400);
      }

      const other = await env.DB.prepare(`
        SELECT id, name, username, bio, avatar_url, last_seen_at
        FROM real_chat_users
        WHERE id = ?
      `).bind(otherId).first();

      if (!other) {
        return json({
          success: false,
          error: "User not found."
        }, 404);
      }

      const [userA, userB] = [me.id, other.id].sort();

      let conversation = await env.DB.prepare(`
        SELECT id
        FROM real_chat_conversations
        WHERE user_a_id = ? AND user_b_id = ?
        LIMIT 1
      `).bind(userA, userB).first();

      if (!conversation) {
        const id = crypto.randomUUID();
        const now = new Date().toISOString();

        await env.DB.prepare(`
          INSERT INTO real_chat_conversations
          (id, user_a_id, user_b_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `).bind(
          id,
          userA,
          userB,
          now,
          now
        ).run();

        conversation = { id };
      }

      return json({
        success: true,
        conversation: {
          id: conversation.id,
          user: other
        }
      });
    }

    return json({
      success: false,
      error: "Real Chat endpoint not found."
    }, 404);

  } catch (error) {
    return json({
      success: false,
      error: "Real Chat is temporarily unavailable."
    }, 500);
  }
}
