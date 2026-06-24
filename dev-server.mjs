import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = __dirname;
const port = Number(process.env.PORT || 5173);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

function safeJoin(base, requestPath) {
  const decoded = decodeURIComponent(requestPath.split("?")[0] || "/");
  const clean = decoded.replace(/\\/g, "/");
  const withoutNull = clean.replace(/\0/g, "");
  const target = path.normalize(path.join(base, withoutNull));
  if (!target.startsWith(base)) return null;
  return target;
}

async function fileExists(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function resolvePath(requestPath) {
  if (requestPath === "/" || requestPath === "") return path.join(rootDir, "index.html");

  const asIs = safeJoin(rootDir, requestPath);
  if (!asIs) return null;

  if (await fileExists(asIs)) return asIs;

  if (!path.extname(asIs)) {
    const html = asIs + ".html";
    if (await fileExists(html)) return html;
    const indexHtml = path.join(asIs, "index.html");
    if (await fileExists(indexHtml)) return indexHtml;
  }

  return null;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const filePath = await resolvePath(url.pathname);
    if (!filePath) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.setHeader("Content-Type", MIME[ext] || "application/octet-stream");
    // Keep dev behavior predictable; service-worker.js already has no-cache on hosting.
    res.setHeader("Cache-Control", "no-cache");

    const data = await fs.readFile(filePath);
    res.statusCode = 200;
    res.end(data);
  } catch (err) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end(`Server error: ${err?.message || err}`);
  }
});

server.listen(port, "127.0.0.1", () => {
  // eslint-disable-next-line no-console
  console.log(`HealthPath dev server: http://127.0.0.1:${port}/`);
});

