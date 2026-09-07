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

    // Password-protected sections
    if (url.pathname === "/api/check-password" && request.method === "POST") {
      try {
        const { section, password } = await request.json();

        const passwords = {
          people: env.PEOPLE_PASSWORD,
          memories: env.MEMORIES_PASSWORD,
          music: env.MUSIC_PASSWORD,
          socials: env.SOCIALS_PASSWORD,
          random: env.RANDOM_PASSWORD
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
