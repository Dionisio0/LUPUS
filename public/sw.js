// public/sw.js
self.addEventListener("push", (event) => {
  let data = {
    title: "Lupus",
    body: "È il tuo turno! Apri l'app.",
    vibrate: [300, 100, 300, 100, 300],
  };

  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: "/icon.png",
    vibrate: data.vibrate || [300, 100, 300, 100, 300],
    tag: "role-turn",
    renotify: true,
  };

  event.waitUntil(
    self.registration.showNotification(data.title || "Lupus", options),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ("focus" in client) return client.focus();
        }
        if (clients.openWindow) return clients.openWindow("/");
      }),
  );
});
