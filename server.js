const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

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

const server = http.createServer((req, res) => {
    let requestPath;
    try {
        requestPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
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
        res.writeHead(200, {
            "Content-Type": mimeTypes[ext] || "application/octet-stream",
            "X-Content-Type-Options": "nosniff"
        });
        res.end(data);
    });
});

server.listen(PORT, "0.0.0.0", () => {
    console.log(`MediCore PWA disponible en el puerto ${PORT}`);
});
