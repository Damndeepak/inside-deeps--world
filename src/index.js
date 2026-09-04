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

        return Response.json({ success: true });

      } catch {
        return Response.json(
          { success: false },
          { status: 400 }
        );
      }
    }

    return env.ASSETS.fetch(request);
  }
};
