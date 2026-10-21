const CACHE_NAME = "medicore-pwa-v6";
const APP_SHELL = [
    "./",
    "./index.html",
    "./style.css",
    "./script.js",
    "./doctor.js",
    "./manifest.json",
    "./offline.html",
    "./assets/icon-192.png",
    "./assets/icon-512.png",
    "./assets/apple-touch-icon.png"
];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(APP_SHELL))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(
                keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
            ))
            .then(() => self.clients.claim())
    );
});

// Procesa notificaciones push enviadas por el servidor.
self.addEventListener("push", (event) => {
    let payload = {};
    try {
        payload = event.data ? event.data.json() : {};
    } catch {
        payload = { body: event.data ? event.data.text() : "" };
    }

    const title = typeof payload.title === "string" && payload.title.length
        ? payload.title.slice(0, 120)
        : "MediCore";
    const body = typeof payload.body === "string"
        ? payload.body.slice(0, 500)
        : "Tienes una nueva notificación.";
    const target = typeof payload.url === "string" && payload.url.startsWith("/")
        && !payload.url.startsWith("//")
        ? payload.url
        : "/";

    event.waitUntil(
        self.registration.showNotification(title, {
            body,
            icon: "./assets/icon-192.png",
            badge: "./assets/icon-192.png",
            tag: "medicore-notification",
            data: { url: target }
        })
    );
});

self.addEventListener("notificationclick", (event) => {
    event.notification.close();
    const requested = event.notification.data && event.notification.data.url
        ? event.notification.data.url
        : "/";
    const targetUrl = new URL(
        requested.startsWith("/") && !requested.startsWith("//") ? requested : "/",
        self.location.origin
    );

    event.waitUntil(
        self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
            const appClient = clients.find((client) => new URL(client.url).origin === self.location.origin);
            if (appClient) {
                return appClient.navigate(targetUrl.href).then((client) => (client || appClient).focus());
            }
            return self.clients.openWindow(targetUrl.href);
        })
    );
});

self.addEventListener("fetch", (event) => {
    const request = event.request;
    if (request.method !== "GET") return;

    const requestUrl = new URL(request.url);
    if (requestUrl.origin !== self.location.origin) return;

    // Nunca guardar en caché respuestas de API, claves públicas o resultados que cambian.
    if (requestUrl.pathname.startsWith("/api/")) return;

    if (request.mode === "navigate") {
        event.respondWith(
            fetch(request).then((response) => {
                const copy = response.clone();
                event.waitUntil(
                    caches.open(CACHE_NAME).then((cache) => cache.put("./index.html", copy))
                );
                return response;
            }).catch(async () => {
                return await caches.match("./index.html")
                    || await caches.match("./")
                    || await caches.match("./offline.html");
            })
        );
        return;
    }

    event.respondWith(
        caches.match(request).then((cached) => {
            if (cached) return cached;
            return fetch(request).then((response) => {
                if (response && response.status === 200) {
                    const copy = response.clone();
                    event.waitUntil(
                        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
                    );
                }
                return response;
            });
        })
    );
});
