import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const distDir = path.join(projectRoot, "dist");
const indexPath = path.join(distDir, "index.html");
const PORT = Number(process.env.STATIC_PORT || 4173);
const HOST = process.env.STATIC_HOST || "127.0.0.1";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

if (!fs.existsSync(indexPath)) {
  console.error("Missing dist build. Run `npm run build` first.");
  process.exit(1);
}

function safeResolve(requestPath) {
  const cleanPath = decodeURIComponent(requestPath.split("?")[0]);
  const relativePath = cleanPath === "/" ? "/index.html" : cleanPath;
  const resolvedPath = path.resolve(distDir, `.${relativePath}`);
  return resolvedPath.startsWith(distDir) ? resolvedPath : null;
}

const server = http.createServer((req, res) => {
  const resolvedPath = safeResolve(req.url || "/");
  if (!resolvedPath) {
    res.writeHead(400);
    res.end("Bad request");
    return;
  }

  let filePath = resolvedPath;
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = indexPath;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = mimeTypes[ext] || "application/octet-stream";

  fs.readFile(filePath, (error, buffer) => {
    if (error) {
      res.writeHead(500);
      res.end("Unable to read file");
      return;
    }

    res.writeHead(200, { "Content-Type": contentType });
    res.end(buffer);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Static frontend ready at http://${HOST}:${PORT}`);
});
