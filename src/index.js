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

    // GLOBAL GLITCH RUN LEADERBOARD
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

        // Get global top 5
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
            {
              success: false,
              error: "Valid name is required"
            },
            { status: 400 }
          );
        }

        if (
          !Number.isSafeInteger(score) ||
          score < 0 ||
          score > 100000000
        ) {
          return Response.json(
            {
              success: false,
              error: "Invalid score"
            },
            { status: 400 }
          );
        }

        const now = new Date().toISOString();

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
                .bind(
                  name,
                  score,
                  now,
                  existing.id
                )
                .run();
            }
          } else {
            await env.DB
              .prepare(
                "INSERT INTO arcade_scores (name, score, player_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
              )
              .bind(
                name,
                score,
                playerKey,
                now,
                now
              )
              .run();
          }
        } else {
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
                .bind(
                  score,
                  now,
                  existing.id
                )
                .run();
            }
          } else {
            await env.DB
              .prepare(
                "INSERT INTO arcade_scores (name, score, player_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
              )
              .bind(
                name,
                score,
                null,
                now,
                now
              )
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
          {
            success: false,
            error: "Leaderboard unavailable"
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
            {
              success: false,
              error: "User not found"
            },
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
            {
              success: false,
              error: "User not found"
            },
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
            {
              success: false,
              error: "Message is required"
            },
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
            {
              success: false,
              error: "User not found"
            },
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

        return Response.json({
          success: true
        });
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
