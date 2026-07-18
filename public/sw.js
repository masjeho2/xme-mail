/* xme-mail service worker — Web Push + offline shell hint */
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {
    title: "Email baru",
    body: "Ada email masuk di xme-mail",
    url: "/dashboard/inbox",
    tag: "xme-mail",
  };

  try {
    if (event.data) {
      const parsed = event.data.json();
      data = { ...data, ...parsed };
    }
  } catch (_) {
    try {
      const text = event.data && event.data.text();
      if (text) data.body = text;
    } catch (_) {}
  }

  event.waitUntil(
    self.registration.showNotification(data.title || "Email baru", {
      body: data.body || "",
      icon: "/icons/icon-192.png?v=3",
      badge: "/icons/icon-192.png?v=3",
      tag: data.tag || "xme-mail",
      renotify: true,
      data: { url: data.url || "/dashboard/inbox" },
      vibrate: [120, 60, 120],
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/dashboard/inbox";
  const abs = new URL(target, self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          client.navigate(abs);
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(abs);
    })
  );
});
