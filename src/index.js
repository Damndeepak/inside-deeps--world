export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // =========================
    // PASSWORD CHECK
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

      } catch {
        return Response.json(
          { success: false },
          { status: 400 }
        );
      }
    }


    // =========================
    // USER
    // =========================

    if (
      url.pathname === "/api/user" &&
      request.method === "GET"
    ) {
      try {
        const cookies =
          request.headers.get("Cookie") || "";

        const match =
          cookies.match(/deep_user=([^;]+)/);

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
          Math.floor(
            100000 + Math.random() * 900000
          );

        await env.DB
          .prepare(
            `INSERT INTO users
            (id, username, created_at)
            VALUES (?, ?, ?)`
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
              "Content-Type":
                "application/json",
              "Set-Cookie":
                `deep_user=${id}; Path=/; Max-Age=31536000; SameSite=Lax`
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


    // =========================
    // CREATE CONVERSATION
    // =========================

    if (
      url.pathname === "/api/conversations" &&
      request.method === "POST"
    ) {
      try {
        const cookies =
          request.headers.get("Cookie") || "";

        const match =
          cookies.match(/deep_user=([^;]+)/);

        if (!match) {
          return Response.json(
            {
              success: false,
              error: "User not found"
            },
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
            {
              success: false,
              error: "User not found"
            },
            { status: 401 }
          );
        }

        /*
          We use ONE existing conversation as the
          shared conversation container.

          If none exists, create one.
        */

        const existing =
          await env.DB
            .prepare(
              `SELECT id
               FROM conversations
               ORDER BY created_at ASC
               LIMIT 1`
            )
            .first();

        if (existing) {
          return Response.json({
            success: true,
            conversation_id: "all"
          });
        }

        const conversationId =
          crypto.randomUUID();

        await env.DB
          .prepare(
            `INSERT INTO conversations
            (id, user_id, created_at)
            VALUES (?, ?, ?)`
          )
          .bind(
            conversationId,
            user.id,
            new Date().toISOString()
          )
          .run();

        return Response.json({
          success: true,
          conversation_id: "all"
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


    // =========================
    // SEND MESSAGE
    // =========================

    if (
      url.pathname === "/api/messages" &&
      request.method === "POST"
    ) {
      try {
        const cookies =
          request.headers.get("Cookie") || "";

        const match =
          cookies.match(/deep_user=([^;]+)/);

        if (!match) {
          return Response.json(
            {
              success: false,
              error: "User not found"
            },
            { status: 401 }
          );
        }

        const {
          conversation_id,
          message,
          parent_id
        } = await request.json();

        if (
          !conversation_id ||
          !message ||
          !message.trim()
        ) {
          return Response.json(
            {
              success: false,
              error: "Message is required"
            },
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
            {
              success: false,
              error: "User not found"
            },
            { status: 401 }
          );
        }

        /*
          "all" means the shared conversation.

          Find the real conversation where the
          message will be stored.
        */

        let realConversation;

        if (conversation_id === "all") {
          realConversation =
            await env.DB
              .prepare(
                `SELECT id
                 FROM conversations
                 ORDER BY created_at ASC
                 LIMIT 1`
              )
              .first();

          /*
            Safety fallback if database has no
            conversation yet.
          */

          if (!realConversation) {
            const newConversationId =
              crypto.randomUUID();

            await env.DB
              .prepare(
                `INSERT INTO conversations
                (id, user_id, created_at)
                VALUES (?, ?, ?)`
              )
              .bind(
                newConversationId,
                user.id,
                new Date().toISOString()
              )
              .run();

            realConversation = {
              id: newConversationId
            };
          }

        } else {
          realConversation =
            await env.DB
              .prepare(
                `SELECT id
                 FROM conversations
                 WHERE id = ?`
              )
              .bind(conversation_id)
              .first();
        }

        if (!realConversation) {
          return Response.json(
            {
              success: false,
              error: "Conversation not found"
            },
            { status: 404 }
          );
        }


        // =========================
        // REPLY VALIDATION
        // =========================

        if (parent_id) {
          const parent =
            await env.DB
              .prepare(
                `SELECT id
                 FROM messages
                 WHERE id = ?`
              )
              .bind(parent_id)
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


        // =========================
        // INSERT MESSAGE
        // =========================

        const messageId =
          crypto.randomUUID();

        await env.DB
          .prepare(
            `INSERT INTO messages
            (
              id,
              conversation_id,
              sender_id,
              message,
              parent_id,
              created_at
            )
            VALUES (?, ?, ?, ?, ?, ?)`
          )
          .bind(
            messageId,
            realConversation.id,
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


    // =========================
    // DELETE MESSAGE
    // =========================

    const messageMatch =
      url.pathname.match(
        /^\/api\/messages\/([^/]+)$/
      );

    if (
      messageMatch &&
      request.method === "DELETE"
    ) {
      try {
        const cookies =
          request.headers.get("Cookie") || "";

        const match =
          cookies.match(/deep_user=([^;]+)/);

        if (!match) {
          return Response.json(
            {
              success: false,
              error: "User not found"
            },
            { status: 401 }
          );
        }

        const messageId =
          messageMatch[1];

        const message =
          await env.DB
            .prepare(
              `SELECT id, sender_id
               FROM messages
               WHERE id = ?`
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

        if (message.sender_id !== match[1]) {
          return Response.json(
            {
              success: false,
              error: "Not allowed"
            },
            { status: 403 }
          );
        }


        /*
          If this message has replies,
          turn those replies into root messages
          before deleting the parent.

          This prevents replies from disappearing.
        */

        await env.DB
          .prepare(
            `UPDATE messages
             SET parent_id = NULL
             WHERE parent_id = ?`
          )
          .bind(messageId)
          .run();

        await env.DB
          .prepare(
            `DELETE FROM messages
             WHERE id = ?`
          )
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


    // =========================
    // GET ALL CONVERSATIONS
    // =========================

    if (
      url.pathname === "/api/conversations" &&
      request.method === "GET"
    ) {
      try {

        /*
          IMPORTANT:

          Instead of returning every individual
          conversation as a separate box, return
          ONE shared conversation.
        */

        const latest =
          await env.DB
            .prepare(
              `SELECT
                m.message,
                m.created_at,
                u.username
               FROM messages m
               JOIN users u
                 ON u.id = m.sender_id
               ORDER BY m.created_at DESC
               LIMIT 1`
            )
            .first();

        return Response.json({
          success: true,

          conversations: [
            {
              id: "all",
              username: "Everyone",
              created_at:
                latest?.created_at ||
                new Date().toISOString(),

              last_message:
                latest?.message ||
                "No messages yet",

              last_message_time:
                latest?.created_at || null
            }
          ]
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


    // =========================
    // GET SHARED CONVERSATION
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
        const requestedId =
          conversationMatch[1];

        let result;

        if (requestedId === "all") {

          /*
            Load EVERY message from EVERY
            existing conversation.

            This is what makes the whole thing
            one shared conversation.
          */

          result =
            await env.DB
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

                 JOIN users u
                   ON u.id = m.sender_id

                 LEFT JOIN messages pm
                   ON pm.id = m.parent_id

                 LEFT JOIN users pu
                   ON pu.id = pm.sender_id

                 ORDER BY m.created_at ASC`
              )
              .all();

        } else {

          result =
            await env.DB
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

                 JOIN users u
                   ON u.id = m.sender_id

                 LEFT JOIN messages pm
                   ON pm.id = m.parent_id

                 LEFT JOIN users pu
                   ON pu.id = pm.sender_id

                 WHERE m.conversation_id = ?

                 ORDER BY m.created_at ASC`
              )
              .bind(requestedId)
              .all();
        }

        return Response.json({
          success: true,
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


    // =========================
    // ASSETS
    // =========================

    return env.ASSETS.fetch(request);
  }
};
