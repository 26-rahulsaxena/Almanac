// Service worker: shows reminder and deadline notifications and handles their buttons.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// iPhone ignores notification buttons; tapping the notification opens the app instead.
function buttons(data) {
  if (data.kind === "checkin" && data.ask === "start") return [{ action: "doing", title: "Doing it now" }, { action: "open", title: "Open" }];
  if (data.kind === "checkin") return [{ action: "done", title: "Yes, done" }, { action: "more", title: "Need 30 more min" }];
  if (data.id) return [{ action: "snooze", title: "Snooze 5 min" }, { action: "done", title: "Done" }];
  return [];
}

self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : {};
  // An open Almanac tab shows reminders full screen right away instead of waiting for its next check.
  const tell = self.clients.matchAll({ type: "window" }).then((cs) => cs.forEach((c) => c.postMessage("check-alerts")));
  const show = self.registration.showNotification(data.title || "Almanac", {
    body: data.body,
    tag: data.id || data.kind || "almanac",
    renotify: true,
    requireInteraction: !!data.id, // reminders and check-ins stay on screen until you act on them
    icon: "/icon/large",
    badge: "/icon/small",
    data: { id: data.id, kind: data.kind || "reminder" },
    actions: buttons(data),
  });
  event.waitUntil(Promise.all([tell, show]));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const { id, kind } = event.notification.data || {};
  const action = event.action || "open";
  const answer = kind === "checkin" ? "/api/priorities/answer" : "/api/reminders/ack";
  event.waitUntil(
    (async () => {
      if (id) {
        await fetch(answer, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, action }),
        }).catch(() => {});
      }
      if (action !== "open") return;
      const url = kind === "reminder" ? "/" : "/?priorities=1";
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (!open) return self.clients.openWindow(url);
      await open.focus();
      if (kind !== "reminder") open.postMessage("show-priorities");
    })(),
  );
});
