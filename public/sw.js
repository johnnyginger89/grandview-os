/* Grandview OS service worker: shows push notifications and opens the right page when one is tapped. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Grandview OS", body: event.data ? event.data.text() : "" };
  }
  // Only paths inside the app ("//host" would leave it).
  const href = typeof data.href === "string" && /^\/(?!\/)/.test(data.href) ? data.href : "/";
  event.waitUntil(
    self.registration.showNotification(data.title || "Grandview OS", {
      body: data.body || "",
      icon: "/brand/symbol-blue.png",
      badge: "/brand/symbol-blue.png",
      tag: data.tag || undefined,
      data: { href },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const href = (event.notification.data && event.notification.data.href) || "/";
  const url = new URL(href, self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (new URL(w.url).origin === self.location.origin && "focus" in w) {
          // A window this worker doesn't control can't be sent elsewhere, so open the page instead.
          return w
            .focus()
            .then((c) => c.navigate(url))
            .catch(() => self.clients.openWindow(url));
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
