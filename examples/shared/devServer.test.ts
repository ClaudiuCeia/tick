import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPublicPathResolver } from "./devServer.ts";

let root = "";
let outside = "";

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "tick-dev-server-root-"));
  outside = await mkdtemp(join(tmpdir(), "tick-dev-server-outside-"));
  await mkdir(join(root, "examples/demo/assets"), { recursive: true });
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "index.ts"), "export {};\n");
  await writeFile(join(root, "src/public.ts"), "export {};\n");
  await writeFile(join(root, "examples/demo/index.html"), "<!doctype html>\n");
  await writeFile(join(root, "examples/demo/assets/sprite.svg"), "<svg/>\n");
  await writeFile(join(root, "package.json"), "{}\n");
  await writeFile(join(root, ".env"), "SECRET=value\n");
  await writeFile(join(outside, "secret.txt"), "secret\n");
  await symlink(join(root, "package.json"), join(root, "examples/demo/package-link.json"));
  await symlink(join(outside, "secret.txt"), join(root, "examples/demo/outside-link.txt"));
});

afterAll(async () => {
  await Promise.all([
    rm(root, { recursive: true, force: true }),
    rm(outside, { recursive: true, force: true }),
  ]);
});

describe("example dev server public path policy", () => {
  test("allows only example assets, source modules, and the root facade", async () => {
    const resolvePath = createPublicPathResolver(root);

    expect((await resolvePath("/index.ts")).ok).toBe(true);
    expect((await resolvePath("/src/public.ts")).ok).toBe(true);
    expect((await resolvePath("/examples/demo/index.html")).ok).toBe(true);
    expect((await resolvePath("/examples/demo/assets/sprite.svg")).ok).toBe(true);
    expect(await resolvePath("/README.md")).toEqual({ ok: false, status: 403 });
    expect(await resolvePath("/package.json")).toEqual({ ok: false, status: 403 });
  });

  test("rejects dot paths, sensitive names, encoded traversal, and symlink escapes", async () => {
    const resolvePath = createPublicPathResolver(root);

    expect(await resolvePath("/examples/.env")).toEqual({ ok: false, status: 403 });
    expect(await resolvePath("/examples/%2eenv")).toEqual({ ok: false, status: 403 });
    expect(await resolvePath("/examples/demo/%2e%2e/%2e%2e/package.json")).toEqual({
      ok: false,
      status: 403,
    });
    expect(await resolvePath("/examples/demo/%70ackage.json")).toEqual({
      ok: false,
      status: 403,
    });
    expect(await resolvePath("/examples/demo/package-link.json")).toEqual({
      ok: false,
      status: 403,
    });
    expect(await resolvePath("/examples/demo/outside-link.txt")).toEqual({
      ok: false,
      status: 403,
    });
  });
});
