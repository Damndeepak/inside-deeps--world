export default {
  async fetch(request, env) {
    const url = new URL(request.url);

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

        const correctPassword = passwords[section];

        if (!correctPassword || password !== correctPassword) {
          return Response.json(
            { success: false },
            { status: 401 }
          );
        }

        const city = request.cf?.city || "Unknown";
        const country = request.cf?.country || "Unknown";
        const timestamp = new Date().toISOString();

        await env.LOGS_DB.prepare(
          `INSERT INTO access_logs (section, city, country, timestamp)
           VALUES (?, ?, ?, ?)`
        )
          .bind(section, city, country, timestamp)
          .run();

        return Response.json({ success: true });
      } catch (error) {
        return Response.json(
          { success: false },
          { status: 400 }
        );
      }
    }

    return env.ASSETS.fetch(request);
  }
};
