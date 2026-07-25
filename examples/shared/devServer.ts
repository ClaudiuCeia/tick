import { realpathSync } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";

const ROOT = realpathSync(resolve(import.meta.dir, "../.."));
const transpiler = new Bun.Transpiler({ loader: "ts" });

export type ExampleServerOptions = {
  name: string;
  port: number;
};

export type PublicPathResult = { ok: true; fsPath: string } | { ok: false; status: 403 | 404 };

const SENSITIVE_NAMES = new Set([
  "agents.md",
  "bun.lock",
  "bun.lockb",
  "node_modules",
  "package-lock.json",
  "package.json",
  "pnpm-lock.yaml",
  "tsconfig.json",
  "yarn.lock",
]);

const contentType = (extension: string): string => {
  switch (extension) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
    case ".mjs":
    case ".ts":
      return "text/javascript; charset=utf-8";
    case ".json":
    case ".map":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml; charset=utf-8";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".avif":
      return "image/avif";
    case ".ico":
      return "image/x-icon";
    case ".ttf":
      return "font/ttf";
    case ".otf":
      return "font/otf";
    case ".woff":
      return "font/woff";
    case ".woff2":
      return "font/woff2";
    case ".wav":
      return "audio/wav";
    case ".mp3":
      return "audio/mpeg";
    case ".ogg":
      return "audio/ogg";
    case ".wasm":
      return "application/wasm";
    default:
      return "application/octet-stream";
  }
};

const isInside = (root: string, path: string): boolean => {
  const fromRoot = relative(root, path);
  return (
    fromRoot === "" ||
    (fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot))
  );
};

const decodePublicPath = (pathname: string): string | null => {
  try {
    const decoded = decodeURIComponent(pathname).replaceAll("\\", "/");
    if (!decoded.startsWith("/") || decoded.includes("\0")) return null;

    const segments = decoded.split("/").filter(Boolean);
    if (
      segments.some(
        (segment) =>
          segment === "." ||
          segment === ".." ||
          segment.startsWith(".") ||
          SENSITIVE_NAMES.has(segment.toLowerCase()) ||
          /\.(?:key|pem)$/i.test(segment),
      )
    ) {
      return null;
    }

    if (
      decoded === "/index.ts" ||
      decoded.startsWith("/examples/") ||
      decoded.startsWith("/src/")
    ) {
      return decoded;
    }
    return null;
  } catch {
    return null;
  }
};

export const createPublicPathResolver = (root: string = ROOT) => {
  const canonicalRoot = realpathSync(root);

  return async (pathname: string): Promise<PublicPathResult> => {
    const publicPath = decodePublicPath(pathname);
    if (!publicPath) return { ok: false, status: 403 };

    const requestedPath = resolve(canonicalRoot, `.${publicPath}`);
    if (!isInside(canonicalRoot, requestedPath)) return { ok: false, status: 403 };

    let fsPath: string;
    try {
      fsPath = await realpath(requestedPath);
    } catch {
      return { ok: false, status: 404 };
    }
    if (!isInside(canonicalRoot, fsPath)) return { ok: false, status: 403 };

    const canonicalPublicPath = `/${relative(canonicalRoot, fsPath).split(sep).join("/")}`;
    if (!decodePublicPath(canonicalPublicPath)) return { ok: false, status: 403 };
    if (!(await stat(fsPath)).isFile()) return { ok: false, status: 404 };

    return { ok: true, fsPath };
  };
};

export const resolvePublicPath = createPublicPathResolver();

export const serveExample = ({ name, port }: ExampleServerOptions): void => {
  const activePort = Number(process.env.PORT ?? port);

  Bun.serve({
    hostname: "127.0.0.1",
    port: activePort,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/") {
        return Response.redirect(`${url.origin}/examples/${name}/index.html`, 302);
      }

      const resolved = await resolvePublicPath(url.pathname);
      if (!resolved.ok) {
        return new Response(resolved.status === 403 ? "Forbidden" : "Not found", {
          status: resolved.status,
        });
      }

      const extension = extname(resolved.fsPath).toLowerCase();
      const headers = new Headers({
        "content-type": contentType(extension),
        "cache-control": "no-store",
      });
      const file = Bun.file(resolved.fsPath);

      if (extension === ".ts") {
        const source = await file.text();
        return new Response(transpiler.transformSync(source), { headers });
      }

      return new Response(file, { headers });
    },
  });

  console.log(`${name}: http://127.0.0.1:${activePort}/`);
};
