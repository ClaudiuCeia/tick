import { extname, join, normalize } from "node:path";

const ROOT = process.cwd();
const PORT = Number(process.env.PORT ?? "5179");
const transpiler = new Bun.Transpiler({ loader: "ts" });

const contentType = (ext: string): string => {
  switch (ext) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
    case ".mjs":
    case ".ts":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    default:
      return "application/octet-stream";
  }
};

const toFsPath = (pathname: string): string | null => {
  const decoded = decodeURIComponent(pathname);
  const cleaned = normalize(decoded).replace(/^([.][.][/\\])+/, "");
  const fullPath = join(ROOT, cleaned);
  if (!fullPath.startsWith(ROOT)) return null;
  return fullPath;
};

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/") {
      return Response.redirect(`${url.origin}/examples/hud-debug/index.html`, 302);
    }

    const fsPath = toFsPath(url.pathname);
    if (!fsPath) {
      return new Response("Forbidden", { status: 403 });
    }

    const file = Bun.file(fsPath);
    if (!(await file.exists())) {
      return new Response("Not found", { status: 404 });
    }

    const ext = extname(fsPath);
    const headers = new Headers({
      "content-type": contentType(ext),
      "cache-control": "no-store",
    });

    if (ext === ".ts") {
      const source = await file.text();
      const js = transpiler.transformSync(source);
      return new Response(js, { headers });
    }

    return new Response(file, { headers });
  },
});

console.log(`hud-debug: http://localhost:${PORT}/`);
