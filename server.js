const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const webpush = require("web-push");

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, "data");
const SUBSCRIPTIONS_FILE = path.join(DATA_DIR, "subscriptions.json");
const MAX_BODY_BYTES = 100 * 1024;
const recentTestRequests = new Map();

const mimeTypes = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/manifest+json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".mp4": "video/mp4",
    ".ico": "image/x-icon"
};

const pushConfigured = Boolean(
    process.env.VAPID_PUBLIC_KEY &&
    process.env.VAPID_PRIVATE_KEY &&
    process.env.VAPID_SUBJECT
);

if (pushConfigured) {
    try {
        webpush.setVapidDetails(
            process.env.VAPID_SUBJECT,
            process.env.VAPID_PUBLIC_KEY,
            process.env.VAPID_PRIVATE_KEY
        );
    } catch (error) {
        console.error("No fue posible configurar Web Push:", error.message);
    }
}

function sendJson(res, statusCode, data) {
    res.writeHead(statusCode, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
    });
    res.end(JSON.stringify(data));
}

function readJson(req) {
    return new Promise((resolve, reject) => {
        let body = "";
        let tooLarge = false;

        req.on("data", (chunk) => {
            body += chunk.toString("utf8");
            if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) {
                tooLarge = true;
            }
        });

        req.on("end", () => {
            if (tooLarge) {
                reject(new Error("BODY_TOO_LARGE"));
                return;
            }
            try {
                resolve(JSON.parse(body || "{}"));
            } catch {
                reject(new Error("INVALID_JSON"));
            }
        });

        req.on("error", reject);
    });
}

async function readSubscriptions() {
    try {
        const content = await fs.promises.readFile(SUBSCRIPTIONS_FILE, "utf8");
        const subscriptions = JSON.parse(content);
        return Array.isArray(subscriptions) ? subscriptions : [];
    } catch (error) {
        if (error.code === "ENOENT") return [];
        console.error("No fue posible leer las suscripciones push:", error.message);
        throw error;
    }
}

async function writeSubscriptions(subscriptions) {
    await fs.promises.mkdir(DATA_DIR, { recursive: true });
    const temporaryFile = SUBSCRIPTIONS_FILE + ".tmp";
    await fs.promises.writeFile(temporaryFile, JSON.stringify(subscriptions, null, 2), {
        encoding: "utf8",
        mode: 0o600
    });
    await fs.promises.rename(temporaryFile, SUBSCRIPTIONS_FILE);
}

function validSubscription(subscription) {
    if (!subscription || typeof subscription.endpoint !== "string" || !subscription.keys) return false;
    try {
        const endpoint = new URL(subscription.endpoint);
        return endpoint.protocol === "https:"
            && typeof subscription.keys.p256dh === "string"
            && typeof subscription.keys.auth === "string";
    } catch {
        return false;
    }
}

function authorizedForBroadcast(req) {
    const expected = process.env.PUSH_ADMIN_TOKEN || "";
    const header = req.headers.authorization || "";
    const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!expected || !provided || expected.length !== provided.length) return false;
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
}


const SUPABASE_AUTH_URL = "https://pjayxdpuseaidlovkrpz.supabase.co/auth/v1/user";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_iRaiRLXFVCIkKevN-PqZng_Gaxe1sw8";

async function authenticatedUser(req) {
    const header = req.headers.authorization || "";
    if (typeof header !== "string" || !header.startsWith("Bearer ")) return null;
    const accessToken = header.slice(7).trim();
    if (!accessToken || accessToken.length > 8192) return null;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);
    try {
        const response = await fetch(SUPABASE_AUTH_URL, {
            headers: {
                apikey: SUPABASE_PUBLISHABLE_KEY,
                Authorization: "Bearer " + accessToken
            },
            cache: "no-store",
            signal: controller.signal
        });
        if (!response.ok) return null;
        const user = await response.json();
        return /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(user?.id || "") ? user.id : null;
    } catch (error) {
        console.warn("No se pudo comprobar la sesión del dispositivo.", error.message);
        return null;
    } finally {
        clearTimeout(timeout);
    }
}

function authorizedForNoticeWebhook(req) {
    const expected = process.env.PUSH_WEBHOOK_TOKEN || "";
    const provided = req.headers["x-medicore-webhook-token"] || "";
    if (typeof provided !== "string" || !expected || !provided || provided.length !== expected.length) return false;
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
}

async function sendUserNotification(userId, message) {
    const subscriptions = await readSubscriptions();
    const devices = subscriptions.filter((item) => item.userId === userId);
    const expiredEndpoints = new Set();
    let sent = 0;
    let failed = 0;
    await Promise.all(devices.map(async (device) => {
        try {
            await webpush.sendNotification(device, JSON.stringify({
                title: "MediCore · Citas",
                body: message,
                url: "/#avisos-citas"
            }));
            sent += 1;
        } catch (error) {
            failed += 1;
            if ([404, 410].includes(error.statusCode)) {
                expiredEndpoints.add(device.endpoint);
            } else {
                console.warn("No se pudo enviar un aviso push.", error.statusCode || error.message);
            }
        }
    }));
    if (expiredEndpoints.size) {
        await writeSubscriptions(subscriptions.filter((item) => !expiredEndpoints.has(item.endpoint)));
    }
    return { sent, failed, subscribedDevices: devices.length };
}

function clientKey(req) {
    // The address is used only for a small in-memory limit on test notifications.
    return req.socket.remoteAddress || "unknown";
}

async function handleApi(req, res, pathname) {
    if (req.method === "GET" && pathname === "/api/config") {
        sendJson(res, 200, {
            pushEnabled: pushConfigured,
            vapidPublicKey: pushConfigured ? process.env.VAPID_PUBLIC_KEY : ""
        });
        return true;
    }

    if (req.method === "POST" && pathname === "/api/push/subscribe") {
        if (!pushConfigured) {
            sendJson(res, 503, { error: "El servicio de notificaciones no está configurado." });
            return true;
        }
        const userId = await authenticatedUser(req);
        if (!userId) {
            sendJson(res, 401, { error: "Inicia sesión para activar las notificaciones de tus citas." });
            return true;
        }
        let subscription;
        try {
            subscription = await readJson(req);
        } catch (error) {
            sendJson(res, error.message === "BODY_TOO_LARGE" ? 413 : 400, {
                error: "El contenido de la suscripción no es válido."
            });
            return true;
        }
        if (!validSubscription(subscription)) {
            sendJson(res, 400, { error: "La suscripción push no es válida." });
            return true;
        }
        try {
            const subscriptions = await readSubscriptions();
            const existing = subscriptions.find((item) => item.endpoint === subscription.endpoint);
            const safeSubscription = {
                endpoint: subscription.endpoint,
                expirationTime: subscription.expirationTime || null,
                keys: {
                    p256dh: subscription.keys.p256dh,
                    auth: subscription.keys.auth
                },
                userId,
                createdAt: existing ? existing.createdAt : new Date().toISOString()
            };
            const updated = subscriptions.filter((item) => item.endpoint !== subscription.endpoint);
            updated.push(safeSubscription);
            await writeSubscriptions(updated);
            sendJson(res, existing ? 200 : 201, { ok: true, linked: true });
        } catch (error) {
            console.error("No se pudo guardar una suscripción push:", error.message);
            sendJson(res, 500, { error: "No se pudo guardar la suscripción." });
        }
        return true;
    }

    if (req.method === "DELETE" && pathname === "/api/push/subscribe") {
        const userId = await authenticatedUser(req);
        if (!userId) {
            sendJson(res, 401, { error: "Inicia sesión para desactivar las notificaciones." });
            return true;
        }
        let body;
        try {
            body = await readJson(req);
        } catch {
            sendJson(res, 400, { error: "La solicitud no es válida." });
            return true;
        }
        if (typeof body.endpoint !== "string") {
            sendJson(res, 400, { error: "Falta el dispositivo." });
            return true;
        }
        try {
            const subscriptions = await readSubscriptions();
            await writeSubscriptions(subscriptions.filter((item) =>
                item.endpoint !== body.endpoint || item.userId !== userId));
            sendJson(res, 200, { ok: true });
        } catch (error) {
            sendJson(res, 500, { error: "No se pudo desactivar la suscripción." });
        }
        return true;
    }

    if (req.method === "POST" && pathname === "/api/push/test") {
        if (!pushConfigured) {
            sendJson(res, 503, { error: "El servicio de notificaciones no está configurado." });
            return true;
        }
        const userId = await authenticatedUser(req);
        if (!userId) {
            sendJson(res, 401, { error: "Inicia sesión para probar tus notificaciones." });
            return true;
        }
        const now = Date.now();
        const key = userId;
        const lastRequest = recentTestRequests.get(key) || 0;
        if (now - lastRequest < 60000) {
            sendJson(res, 429, { error: "Espera un minuto antes de volver a enviar una prueba." });
            return true;
        }
        let body;
        try {
            body = await readJson(req);
        } catch {
            sendJson(res, 400, { error: "La solicitud de prueba no es válida." });
            return true;
        }
        if (typeof body.endpoint !== "string") {
            sendJson(res, 400, { error: "Falta el dispositivo." });
            return true;
        }
        try {
            const subscriptions = await readSubscriptions();
            const subscription = subscriptions.find((item) => item.endpoint === body.endpoint && item.userId === userId);
            if (!subscription) {
                sendJson(res, 404, { error: "Este dispositivo no está vinculado a tu cuenta." });
                return true;
            }
            recentTestRequests.set(key, now);
            await webpush.sendNotification(subscription, JSON.stringify({
                title: "MediCore",
                body: "Las notificaciones de tus citas están activas en este dispositivo.",
                url: "/#avisos-citas"
            }));
            sendJson(res, 200, { ok: true });
        } catch (error) {
            if ([404, 410].includes(error.statusCode)) {
                const subscriptions = await readSubscriptions().catch(() => []);
                await writeSubscriptions(subscriptions.filter((item) => item.endpoint !== body.endpoint)).catch(() => {});
                sendJson(res, 410, { error: "Tu suscripción caducó. Activa las notificaciones de nuevo." });
            } else {
                console.error("Falló la notificación de prueba:", error.message);
                sendJson(res, 502, { error: "No se pudo enviar la notificación de prueba." });
            }
        }
        return true;
    }

    if (req.method === "POST" && pathname === "/api/push/appointment-notice") {
        if (!authorizedForNoticeWebhook(req)) {
            sendJson(res, 401, { error: "No autorizado." });
            return true;
        }
        if (!pushConfigured) {
            sendJson(res, 503, { error: "Las notificaciones push no están configuradas." });
            return true;
        }
        let body;
        try {
            body = await readJson(req);
        } catch {
            sendJson(res, 400, { error: "Aviso inválido." });
            return true;
        }
        const userId = typeof body.user_id === "string" ? body.user_id : "";
        const message = typeof body.message === "string" ? body.message.trim().slice(0, 250) : "";
        if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(userId) || !message) {
            sendJson(res, 400, { error: "Los datos del aviso no son válidos." });
            return true;
        }
        try {
            const result = await sendUserNotification(userId, message);
            sendJson(res, 200, { ok: true, ...result });
        } catch (error) {
            console.error("Falló la entrega de avisos de citas:", error.message);
            sendJson(res, 500, { error: "No se pudo entregar el aviso." });
        }
        return true;
    }

    if (req.method === "POST" && pathname === "/api/push/send") {
        if (!process.env.PUSH_ADMIN_TOKEN) {
            sendJson(res, 503, { error: "Falta configurar PUSH_ADMIN_TOKEN en el servidor." });
            return true;
        }
        if (!authorizedForBroadcast(req)) {
            sendJson(res, 401, { error: "No autorizado." });
            return true;
        }
        if (!pushConfigured) {
            sendJson(res, 503, { error: "El servicio de notificaciones no está configurado." });
            return true;
        }

        let body;
        try {
            body = await readJson(req);
        } catch {
            sendJson(res, 400, { error: "El contenido de la notificación no es válido." });
            return true;
        }

        const title = typeof body.title === "string" ? body.title.trim().slice(0, 120) : "";
        const message = typeof body.body === "string" ? body.body.trim().slice(0, 500) : "";
        const requestedUrl = typeof body.url === "string" ? body.url : "/";
        const targetUrl = requestedUrl.startsWith("/") && !requestedUrl.startsWith("//")
            && !requestedUrl.includes("..") ? requestedUrl : "/";

        if (!title || !message) {
            sendJson(res, 400, { error: "Incluye title y body en la notificación." });
            return true;
        }

        try {
            const subscriptions = await readSubscriptions();
            let sent = 0;
            let failed = 0;
            const expiredEndpoints = new Set();

            await Promise.all(subscriptions.map(async (subscription) => {
                try {
                    await webpush.sendNotification(subscription, JSON.stringify({
                        title,
                        body: message,
                        url: targetUrl
                    }));
                    sent += 1;
                } catch (error) {
                    failed += 1;
                    if (error.statusCode === 404 || error.statusCode === 410) {
                        expiredEndpoints.add(subscription.endpoint);
                    } else {
                        console.error("Falló el envío push a un suscriptor:", error.statusCode || error.message);
                    }
                }
            }));

            if (expiredEndpoints.size) {
                await writeSubscriptions(subscriptions.filter((item) => !expiredEndpoints.has(item.endpoint)));
            }

            sendJson(res, 200, {
                ok: true,
                sent,
                failed,
                removedExpired: expiredEndpoints.size
            });
        } catch (error) {
            console.error("No se pudo enviar la notificación:", error.message);
            sendJson(res, 500, { error: "No se pudo completar el envío de notificaciones." });
        }
        return true;
    }

    if (pathname.startsWith("/api/")) {
        sendJson(res, 404, { error: "Ruta API no encontrada." });
        return true;
    }

    return false;
}

const server = http.createServer(async (req, res) => {
    let requestUrl;
    try {
        requestUrl = new URL(req.url, "http://localhost");
    } catch {
        res.writeHead(400);
        res.end("Solicitud inválida");
        return;
    }

    // Railway termina TLS en el proxy; redirigir solicitudes HTTP al dominio de producción.
    const forwardedProto = req.headers["x-forwarded-proto"];
    const host = req.headers.host || "";
    if (forwardedProto === "http" && host === "medicore-awp-production.up.railway.app") {
        res.writeHead(308, { Location: "https://" + host + req.url });
        res.end();
        return;
    }

    if (await handleApi(req, res, requestUrl.pathname)) return;

    let requestPath;
    try {
        requestPath = decodeURIComponent(requestUrl.pathname);
    } catch {
        res.writeHead(400);
        res.end("Solicitud inválida");
        return;
    }

    if (requestPath === "/") requestPath = "/index.html";

    const safePath = path.resolve(ROOT, "." + requestPath);
    if (!safePath.startsWith(ROOT + path.sep) && safePath !== ROOT) {
        res.writeHead(403);
        res.end("Acceso denegado");
        return;
    }

    fs.readFile(safePath, (error, data) => {
        if (error) {
            res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
            res.end("404 - Archivo no encontrado");
            return;
        }

        const ext = path.extname(safePath).toLowerCase();
        const headers = {
            "Content-Type": mimeTypes[ext] || "application/octet-stream",
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "strict-origin-when-cross-origin"
        };
        if (requestPath === "/sw.js" || requestPath === "/manifest.json") {
            headers["Cache-Control"] = "no-cache";
        }
        res.writeHead(200, headers);
        res.end(data);
    });
});

fs.promises.mkdir(DATA_DIR, { recursive: true }).catch((error) => {
    console.error("No se pudo preparar el directorio de datos:", error.message);
});

server.listen(PORT, "0.0.0.0", () => {
    console.log("MediCore PWA disponible en el puerto " + PORT);
});
