import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { formatBytes, readAttachmentFromPath } from "../../src/uploads/file";

let dir = "";

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "discord-tui-upload-"));
  await writeFile(join(dir, "foto.PNG"), new Uint8Array([1, 2, 3]));
  await writeFile(join(dir, "notas.txt"), "hola");
  await writeFile(join(dir, "raro.xyz"), "?");
  await writeFile(join(dir, "grande.bin"), new Uint8Array(10 * 1024 * 1024 + 1));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("reads bytes, mime from extension and basename", async () => {
  const a = await readAttachmentFromPath(join(dir, "foto.PNG"));
  expect(a).toEqual({ filename: "foto.PNG", mime: "image/png", bytes: new Uint8Array([1, 2, 3]) });
  expect((await readAttachmentFromPath(join(dir, "notas.txt"))).mime).toBe("text/plain");
  expect((await readAttachmentFromPath(join(dir, "raro.xyz"))).mime).toBe("application/octet-stream");
});

test("trims whitespace and surrounding quotes", async () => {
  const a = await readAttachmentFromPath(`  '${join(dir, "notas.txt")}'  `);
  expect(a.filename).toBe("notas.txt");
  const b = await readAttachmentFromPath(`"${join(dir, "notas.txt")}"\n`);
  expect(b.filename).toBe("notas.txt");
});

test("expands leading ~ to HOME", async () => {
  const prev = process.env.HOME;
  process.env.HOME = dir;
  try {
    const a = await readAttachmentFromPath("~/notas.txt");
    expect(a.filename).toBe("notas.txt");
  } finally {
    process.env.HOME = prev;
  }
});

test("errors: no existe, es una carpeta, pesa más de 10 MiB", async () => {
  await expect(readAttachmentFromPath(join(dir, "nada.png"))).rejects.toThrow(new Error("no existe"));
  await expect(readAttachmentFromPath(dir)).rejects.toThrow(new Error("es una carpeta"));
  await expect(readAttachmentFromPath(join(dir, "grande.bin"))).rejects.toThrow(new Error("pesa más de 10 MiB"));
});

test("formatBytes", () => {
  expect(formatBytes(512)).toBe("512 B");
  expect(formatBytes(120 * 1024)).toBe("120 KB");
  expect(formatBytes(1.5 * 1024 * 1024)).toBe("1.5 MB");
});
