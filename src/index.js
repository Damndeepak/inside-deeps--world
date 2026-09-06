export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // =========================
    // EXISTING PASSWORD SYSTEM
    // =========================
    if (
      url.pathname === "/api/check-password" &&
      request.method === "POST"
    ) {
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
          return Response.json(
            { success: false },
            { status: 400 }
          );
        }

        if (password !== passwords[section]) {
          return Response.json(
            { success: false },
            { status: 401 }
          );
        }

        return Response.json({
          success: true
        });

      } catch (error) {
        return Response.json(
          { success: false },
          { status: 400 }
        );
      }
    }

    // =========================
    // GET /api/user
    // =========================
    if (
      url.pathname === "/api/user" &&
      request.method === "GET"
    ) {
      try {
        const cookies = request.headers.get("Cookie") || "";
        const match = cookies.match(/deep_user=([^;]+)/);

        if (match) {
          const user = await env.DB
            .prepare(
              "SELECT id, username FROM users WHERE id = ?"
            )
            .bind(match[1])
            .first();

          if (user) {
            return Response.json({
              success: true,
              user
            });
          }
        }

        const id = crypto.randomUUID();
        const username =
          "User" +
          Math.floor(100000 + Math.random() * 900000);

        await env.DB
          .prepare(
            "INSERT INTO users (id, username, created_at) VALUES (?, ?, ?)"
          )
          .bind(
            id,
            username,
            new Date().toISOString()
          )
          .run();

        return new Response(
          JSON.stringify({
            success: true,
            user: {
              id,
              username
            }
          }),
          {
            headers: {
              "Content-Type": "application/json",
              "Set-Cookie": `deep_user=${id}; Path=/; Max-Age=31536000; SameSite=Lax`
            }
          }
        );

      } catch (error) {
        return Response.json(
          {
            success: false,
            error: "Could not create user"
          },
          { status: 500 }
        );
      }
    }

    // =========================
    // POST /api/conversations
    // =========================
    if (
      url.pathname === "/api/conversations" &&
      request.method === "POST"
    ) {
      try {
        const cookies = request.headers.get("Cookie") || "";
        const match = cookies.match(/deep_user=([^;]+)/);

        if (!match) {
          return Response.json(
            { success: false, error: "User not found" },
            { status: 401 }
          );
        }

        const user = await env.DB
          .prepare(
            "SELECT id FROM users WHERE id = ?"
          )
          .bind(match[1])
          .first();

        if (!user) {
          return Response.json(
            { success: false, error: "User not found" },
            { status: 401 }
          );
        }

        const conversationId = crypto.randomUUID();

        await env.DB
          .prepare(
            "INSERT INTO conversations (id, user_id, created_at) VALUES (?, ?, ?)"
          )
          .bind(
            conversationId,
            user.id,
            new Date().toISOString()
          )
          .run();

        return Response.json({
          success: true,
          conversation_id: conversationId
        });

      } catch (error) {
        return Response.json(
          {
            success: false,
            error: "Could not create conversation"
          },
          { status: 500 }
        );
      }
    }

    // =========================
    // POST /api/messages
    // =========================
    if (
      url.pathname === "/api/messages" &&
      request.method === "POST"
    ) {
      try {
        const cookies = request.headers.get("Cookie") || "";
        const match = cookies.match(/deep_user=([^;]+)/);

        if (!match) {
          return Response.json(
            { success: false, error: "User not found" },
            { status: 401 }
          );
        }

        const { conversation_id, message, parent_id } =
          await request.json();

        if (
          !conversation_id ||
          !message ||
          !message.trim()
        ) {
          return Response.json(
            { success: false, error: "Message is required" },
            { status: 400 }
          );
        }

        const user = await env.DB
          .prepare(
            "SELECT id FROM users WHERE id = ?"
          )
          .bind(match[1])
          .first();

        if (!user) {
          return Response.json(
            { success: false, error: "User not found" },
            { status: 401 }
          );
        }

        const conversation = await env.DB
          .prepare(
            "SELECT id FROM conversations WHERE id = ?"
          )
          .bind(conversation_id)
          .first();

        if (!conversation) {
          return Response.json(
            { success: false, error: "Conversation not found" },
            { status: 404 }
          );
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
            conversation_id,
            user.id,
            message.trim(),
            parent_id || null,
            new Date().toISOString()
          )
          .run();

        return Response.json({
          success: true,
          message_id: messageId
        });

      } catch (error) {
        return Response.json(
          {
            success: false,
            error: "Could not send message"
          },
          { status: 500 }
        );
      }
    }

    // =========================
    // GET /api/conversations
    // =========================
    if (
      url.pathname === "/api/conversations" &&
      request.method === "GET"
    ) {
      try {
        const result = await env.DB
          .prepare(`
            SELECT
              c.id,
              u.username,
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
              ) AS last_message_time
            FROM conversations c
            JOIN users u ON u.id = c.user_id
            ORDER BY c.created_at DESC
          `)
          .all();

        return Response.json({
          success: true,
          conversations: result.results
        });

      } catch (error) {
        return Response.json(
          {
            success: false,
            error: "Could not load conversations"
          },
          { status: 500 }
        );
      }
    }

    // =========================
    // GET /api/conversations/:id
    // =========================
    const conversationMatch =
      url.pathname.match(
        /^\/api\/conversations\/([^/]+)$/
      );

    if (
      conversationMatch &&
      request.method === "GET"
    ) {
      try {
        const conversationId =
          conversationMatch[1];

        const result = await env.DB
          .prepare(`
            SELECT
              m.id,
              m.message,
              m.parent_id,
              m.created_at,
              u.username
            FROM messages m
            JOIN users u ON u.id = m.sender_id
            WHERE m.conversation_id = ?
            ORDER BY m.created_at ASC
          `)
          .bind(conversationId)
          .all();

        return Response.json({
          success: true,
          messages: result.results
        });

      } catch (error) {
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
