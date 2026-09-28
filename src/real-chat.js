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
        // No search query: return all users except current user
        result = await env.DB.prepare(`
          SELECT id, name, username, bio, avatar_url, last_seen_at
          FROM real_chat_users
          WHERE id != ?
          ORDER BY name ASC
          LIMIT 100
        `).bind(me.id).all();
      } else {
        // With search query: filter by name or username
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