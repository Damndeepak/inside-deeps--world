/* Inside Deep's World — service worker (push notifications only, no caching) */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    let title = "New message", body = "Open Inside Deep to read it", icon = "/icon-192.png";
    try {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      if (wins.some(c => c.visibilityState === "visible")) return;
      const r = await fetch("/api/chat?limit=1", { credentials: "same-origin", cache: "no-store" });
      const d = await r.json();
      const m = d && d.messages && d.messages[d.messages.length - 1];
      if (m) {
        title = "@" + m.username;
        body = m.message ? m.message.slice(0, 140) : (m.image ? "📷 Photo" : body);
      }
    } catch (e) {}
    await self.registration.showNotification(title, {
      body, icon, badge: "/favicon-32.png", tag: "chat", renotify: true, data: { url: "/#cxChat" }
    });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of wins) { if ("focus" in c) { await c.focus(); return; } }
    await self.clients.openWindow("/#cxChat");
  })());
});
