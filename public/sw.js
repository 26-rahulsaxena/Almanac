// Service worker: shows reminder notifications and handles their Snooze / Done buttons.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : {};
  event.waitUntil(
    self.registration.showNotification(data.title || "Almanac", {
      body: data.body,
      tag: data.id || "almanac",
      renotify: true,
      requireInteraction: !!data.id, // reminders stay on screen until you act on them
      icon: "/icon/large",
      badge: "/icon/small",
      data: { id: data.id },
      // iPhone ignores these buttons; tapping the notification opens the app instead.
      actions: data.id
        ? [
            { action: "snooze", title: "Snooze 5 min" },
            { action: "done", title: "Done" },
          ]
        : [],
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const id = event.notification.data && event.notification.data.id;
  const action = event.action || "open";
  event.waitUntil(
    (async () => {
      if (id) {
        await fetch("/api/reminders/ack", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, action }),
        }).catch(() => {});
      }
      if (action !== "open") return;
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
      return open ? open.focus() : self.clients.openWindow("/");
    })(),
  );
});
