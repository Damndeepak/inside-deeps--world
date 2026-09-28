function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
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
  return [
    "real_chat_user=" + encodeURIComponent(id),
    "Path=/",
    "Max-Age=31536000",
    "HttpOnly",
    "Secure",
    "SameSite=Lax"
  ].join("; ");
}

async function ensureRealChatTables(env) {
  if (!env.DB) {
    throw new Error("DB binding is missing");
  }

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
    LIMIT 1
  `).bind(id).first();
}

function validUsername(username) {
  return /^[a-z0-9_]{3,24}$/.test(username);
}

function userData(user) {
  if (!user) return null;

  return {
    id: user.id,
    name: user.name,
    username: user.username,
    bio: user.bio || "",
    avatar_url: user.avatar_url || "",
    created_at: user.created_at,
    last_seen_at: user.last_seen_at
  };
}

export async function handleRealChat(request, env, url) {
  if (!url.pathname.startsWith("/api/real-chat/")) {
    return null;
  }

  try {
    await ensureRealChatTables(env);

    if (url.pathname === "/api/real-chat/me" && request.method === "GET") {
      const user = await getUser(env, request);

      if (!user) {
        return json({
          success: true,
          connected: false,
          user: null
        });
      }

      const now = new Date().toISOString();

      await env.DB.prepare(`
        UPDATE real_chat_users
        SET last_seen_at = ?
        WHERE id = ?
      `).bind(now, user.id).run();

      user.last_seen_at = now;

      return json({
        success: true,
        connected: true,
        user: userData(user)
      });
    }

    if (url.pathname === "/api/real-chat/register" && request.method === "POST") {
      const body = await request.json().catch(() => null);

      if (!body || typeof body !== "object") {
        return json({
          success: false,
          error: "Invalid request body."
        }, 400);
      }

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

      if (!validUsername(username)) {
        return json({
          success: false,
          error: "Username must be 3-24 characters using letters, numbers or underscores."
        }, 400);
      }

      const currentId = getCookie(request, "real_chat_user");

      const taken = await env.DB.prepare(`
        SELECT id
        FROM real_chat_users
        WHERE username = ?
        LIMIT 1
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
          SELECT id
          FROM real_chat_users
          WHERE id = ?
          LIMIT 1
        `).bind(currentId).first();

        if (existing) {
          await env.DB.prepare(`
            UPDATE real_chat_users
            SET name = ?, username = ?, bio = ?, last_seen_at = ?
            WHERE id = ?
          `).bind(
            name,
            username,
            bio,
            now,
            currentId
          ).run();

          const updated = await env.DB.prepare(`
            SELECT id, name, username, bio, avatar_url, created_at, last_seen_at
            FROM real_chat_users
            WHERE id = ?
          `).bind(currentId).first();

          return json({
            success: true,
            user: userData(updated)
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
          bio,
          avatar_url: "",
          created_at: now,
          last_seen_at: now
        }
      }, 200, {
        "Set-Cookie": sessionCookie(id)
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

      let result;

      if (!q) {
        result = await env.DB.prepare(`
          SELECT id, name, username, bio, avatar_url, last_seen_at
          FROM real_chat_users
          WHERE id != ?
          ORDER BY name ASC
          LIMIT 100
        `).bind(me.id).all();
      } else {
        const search = q.toLowerCase().replace(/^@/, "");

        result = await env.DB.prepare(`
          SELECT id, name, username, bio, avatar_url, last_seen_at
          FROM real_chat_users
          WHERE id != ?
            AND (
              lower(name) LIKE ?
              OR lower(username) LIKE ?
            )
          ORDER BY name ASC
          LIMIT 20
        `).bind(
          me.id,
          `%${search}%`,
          `%${search}%`
        ).all();
      }

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
      const otherId = typeof body.user_id === "string" ? body.user_id : "";

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
        LIMIT 1
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
        `).bind(id, userA, userB, now, now).run();

        conversation = { id };
      }

      return json({
        success: true,
        conversation: {
          id: conversation.id,
          user: userData(other)
        }
      });
    }

    if (
      url.pathname === "/api/real-chat/conversations" &&
      request.method === "GET"
    ) {
      const me = await getUser(env, request);

      if (!me) {
        return json({
          success: false,
          error: "Register your name first."
        }, 401);
      }

      const result = await env.DB.prepare(`
        SELECT
          c.id,
          c.updated_at,
          CASE
            WHEN c.user_a_id = ? THEN c.user_b_id
            ELSE c.user_a_id
          END AS other_id,
          u.name AS other_name,
          u.username AS other_username,
          u.bio AS other_bio,
          u.avatar_url AS other_avatar
        FROM real_chat_conversations c
        JOIN real_chat_users u
          ON u.id = CASE
            WHEN c.user_a_id = ? THEN c.user_b_id
            ELSE c.user_a_id
          END
        WHERE c.user_a_id = ? OR c.user_b_id = ?
        ORDER BY c.updated_at DESC
      `).bind(me.id, me.id, me.id, me.id).all();

      return json({
        success: true,
        conversations: result.results || []
      });
    }

    const messagesMatch = url.pathname.match(/^\/api\/real-chat\/messages\/([^/]+)$/);

    if (messagesMatch && request.method === "GET") {
      const me = await getUser(env, request);
      const conversationId = messagesMatch[1];

      if (!me) {
        return json({
          success: false,
          error: "Register your name first."
        }, 401);
      }

      const conversation = await env.DB.prepare(`
        SELECT id
        FROM real_chat_conversations
        WHERE id = ?
          AND (user_a_id = ? OR user_b_id = ?)
        LIMIT 1
      `).bind(conversationId, me.id, me.id).first();

      if (!conversation) {
        return json({
          success: false,
          error: "Conversation not found."
        }, 404);
      }

      const requestedLimit = Number(url.searchParams.get("limit")) || 50;
      const limit = Math.min(Math.max(requestedLimit, 1), 100);

      const result = await env.DB.prepare(`
        SELECT
          m.id,
          m.sender_id,
          u.name AS sender_name,
          u.username AS sender_username,
          m.message,
          m.message_type,
          m.reply_to_id,
          m.edited_at,
          m.deleted_at,
          m.created_at,
          COALESCE(
            (
              SELECT GROUP_CONCAT(
                r.reaction || ':' || r.user_id,
                '||'
              )
              FROM real_chat_reactions r
              WHERE r.message_id = m.id
            ),
            ''
          ) AS reactions
        FROM real_chat_messages m
        JOIN real_chat_users u ON u.id = m.sender_id
        WHERE m.conversation_id = ?
        ORDER BY m.created_at DESC
        LIMIT ?
      `).bind(conversationId, limit).all();

      const now = new Date().toISOString();

      await env.DB.prepare(`
        INSERT INTO real_chat_reads
        (conversation_id, user_id, last_read_at)
        VALUES (?, ?, ?)
        ON CONFLICT(conversation_id, user_id)
        DO UPDATE SET last_read_at = excluded.last_read_at
      `).bind(conversationId, me.id, now).run();

      await env.DB.prepare(`
        UPDATE real_chat_users
        SET last_seen_at = ?
        WHERE id = ?
      `).bind(now, me.id).run();

      return json({
        success: true,
        messages: (result.results || []).reverse()
      });
    }

    if (messagesMatch && request.method === "POST") {
      const me = await getUser(env, request);
      const conversationId = messagesMatch[1];

      if (!me) {
        return json({
          success: false,
          error: "Register your name first."
        }, 401);
      }

      const conversation = await env.DB.prepare(`
        SELECT id
        FROM real_chat_conversations
        WHERE id = ?
          AND (user_a_id = ? OR user_b_id = ?)
        LIMIT 1
      `).bind(conversationId, me.id, me.id).first();

      if (!conversation) {
        return json({
          success: false,
          error: "Conversation not found."
        }, 404);
      }

      const body = await request.json().catch(() => ({}));
      const message = typeof body.message === "string" ? body.message.trim() : "";
      const replyToId = typeof body.reply_to_id === "string" ? body.reply_to_id : null;

      if (!message || message.length > 5000) {
        return json({
          success: false,
          error: "Message must contain 1-5000 characters."
        }, 400);
      }

      if (replyToId) {
        const reply = await env.DB.prepare(`
          SELECT id
          FROM real_chat_messages
          WHERE id = ? AND conversation_id = ?
          LIMIT 1
        `).bind(replyToId, conversationId).first();

        if (!reply) {
          return json({
            success: false,
            error: "Reply target not found."
          }, 400);
        }
      }

      const id = crypto.randomUUID();
      const now = new Date().toISOString();

      await env.DB.prepare(`
        INSERT INTO real_chat_messages
        (id, conversation_id, sender_id, message, message_type, reply_to_id, created_at)
        VALUES (?, ?, ?, ?, 'text', ?, ?)
      `).bind(id, conversationId, me.id, message, replyToId, now).run();

      await env.DB.prepare(`
        UPDATE real_chat_conversations
        SET updated_at = ?
        WHERE id = ?
      `).bind(now, conversationId).run();

      return json({
        success: true,
        message: {
          id,
          conversation_id: conversationId,
          sender_id: me.id,
          sender_name: me.name,
          sender_username: me.username,
          message,
          message_type: "text",
          reply_to_id: replyToId,
          edited_at: null,
          deleted_at: null,
          created_at: now
        }
      });
    }

    const messageMatch = url.pathname.match(/^\/api\/real-chat\/message\/([^/]+)$/);

    if (messageMatch && request.method === "PATCH") {
      const me = await getUser(env, request);
      const messageId = messageMatch[1];

      if (!me) {
        return json({
          success: false,
          error: "Register your name first."
        }, 401);
      }

      const body = await request.json().catch(() => ({}));
      const message = typeof body.message === "string" ? body.message.trim() : "";

      if (!message || message.length > 5000) {
        return json({
          success: false,
          error: "Message must contain 1-5000 characters."
        }, 400);
      }

      const existing = await env.DB.prepare(`
        SELECT id
        FROM real_chat_messages
        WHERE id = ? AND sender_id = ? AND deleted_at IS NULL
        LIMIT 1
      `).bind(messageId, me.id).first();

      if (!existing) {
        return json({
          success: false,
          error: "Message not found."
        }, 404);
      }

      const now = new Date().toISOString();

      await env.DB.prepare(`
        UPDATE real_chat_messages
        SET message = ?, edited_at = ?
        WHERE id = ?
      `).bind(message, now, messageId).run();

      return json({
        success: true,
        edited_at: now
      });
    }

    if (messageMatch && request.method === "DELETE") {
      const me = await getUser(env, request);
      const messageId = messageMatch[1];

      if (!me) {
        return json({
          success: false,
          error: "Register your name first."
        }, 401);
      }

      const existing = await env.DB.prepare(`
        SELECT id
        FROM real_chat_messages
        WHERE id = ? AND sender_id = ? AND deleted_at IS NULL
        LIMIT 1
      `).bind(messageId, me.id).first();

      if (!existing) {
        return json({
          success: false,
          error: "Message not found."
        }, 404);
      }

      const now = new Date().toISOString();

      await env.DB.prepare(`
        UPDATE real_chat_messages
        SET message = NULL, deleted_at = ?
        WHERE id = ?
      `).bind(now, messageId).run();

      return json({
        success: true,
        deleted_at: now
      });
    }

    const reactionMatch = url.pathname.match(/^\/api\/real-chat\/message\/([^/]+)\/react$/);

    if (reactionMatch && request.method === "POST") {
      const me = await getUser(env, request);
      const messageId = reactionMatch[1];

      if (!me) {
        return json({
          success: false,
          error: "Register your name first."
        }, 401);
      }

      const body = await request.json().catch(() => ({}));
      const reaction = typeof body.reaction === "string" ? body.reaction.trim() : "";
      const allowed = ["❤️", "😂", "😭", "😭‍🔥", "👍🏻", "💀"];

      if (!allowed.includes(reaction)) {
        return json({
          success: false,
          error: "Unsupported reaction."
        }, 400);
      }

      const message = await env.DB.prepare(`
        SELECT id, conversation_id
        FROM real_chat_messages
        WHERE id = ?
        LIMIT 1
      `).bind(messageId).first();

      if (!message) {
        return json({
          success: false,
          error: "Message not found."
        }, 404);
      }

      const access = await env.DB.prepare(`
        SELECT id
        FROM real_chat_conversations
        WHERE id = ?
          AND (user_a_id = ? OR user_b_id = ?)
        LIMIT 1
      `).bind(message.conversation_id, me.id, me.id).first();

      if (!access) {
        return json({
          success: false,
          error: "You cannot react to this message."
        }, 403);
      }

      const existing = await env.DB.prepare(`
        SELECT message_id
        FROM real_chat_reactions
        WHERE message_id = ? AND user_id = ? AND reaction = ?
        LIMIT 1
      `).bind(messageId, me.id, reaction).first();

      if (existing) {
        await env.DB.prepare(`
          DELETE FROM real_chat_reactions
          WHERE message_id = ? AND user_id = ? AND reaction = ?
        `).bind(messageId, me.id, reaction).run();
      } else {
        await env.DB.prepare(`
          INSERT INTO real_chat_reactions
          (message_id, user_id, reaction, created_at)
          VALUES (?, ?, ?, ?)
        `).bind(messageId, me.id, reaction, new Date().toISOString()).run();
      }

      return json({ success: true });
    }

    return null;
  } catch (error) {
    return json({
      success: false,
      error: error.message || "Internal server error"
    }, 500);
  }
}
