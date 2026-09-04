export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Homepage
    if (url.pathname === "/") {
      return env.ASSETS.fetch(request);
    }

    // Section password API
    if (url.pathname === "/api/check-password" && request.method === "POST") {
      const body = await request.json();

      const passwords = {
        people: env.PEOPLE_PASSWORD,
        memories: env.MEMORIES_PASSWORD,
        music: env.MUSIC_PASSWORD,
        socials: env.SOCIALS_PASSWORD,
        random: env.RANDOM_PASSWORD
      };

      const correctPassword = passwords[body.section];

      if (!correctPassword || body.password !== correctPassword) {
        return Response.json(
          { success: false },
          { status: 401 }
        );
      }

      return Response.json({ success: true });
    }

    return new Response("Not Found", { status: 404 });
  }
};
