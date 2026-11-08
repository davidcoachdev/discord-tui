import { expect, test } from "bun:test";
import { join } from "node:path";

import { createFrameCache } from "../../src/images/frames";
import { decodeAnimated, isGif, isWebp, limitFrames, normalizeDelay, type Animation, type Frame } from "../../src/images/gif";

const fixture = async (name: string): Promise<Uint8Array> =>
  new Uint8Array(await Bun.file(join(import.meta.dir, "..", "fixtures", "images", name)).arrayBuffer());

test("sample.gif decodes to 3 RGBA frames with their delays", async () => {
  const gif = await fixture("sample.gif");
  expect(isGif(gif)).toBe(true);
  const anim = await decodeAnimated(gif, 640, 640);
  expect(anim).not.toBeNull();
  expect(anim!.width).toBe(64);
  expect(anim!.height).toBe(64);
  expect(anim!.frames).toHaveLength(3);
  expect(anim!.frames.map((f) => f.delayMs)).toEqual([100, 100, 100]);
  for (const frame of anim!.frames) expect(frame.rgba.byteLength).toBe(64 * 64 * 4);
  // Los cuadros son distintos entre sí (si no, no habría animación).
  expect(Buffer.from(anim!.frames[0]!.rgba).equals(Buffer.from(anim!.frames[1]!.rgba))).toBe(false);
  expect(anim!.bytes).toBe(3 * 64 * 64 * 4);
});

test("frames are downscaled to the pixel box before keeping them", async () => {
  const anim = await decodeAnimated(await fixture("sample.gif"), 20, 40);
  expect([anim!.width, anim!.height]).toEqual([20, 20]);
  expect(anim!.frames[0]!.rgba.byteLength).toBe(20 * 20 * 4);
});

test("a PNG, a broken GIF or garbage is not an animation (caller keeps the still image)", async () => {
  expect(await decodeAnimated(await fixture("sample.png"), 100, 100)).toBeNull();
  expect(await decodeAnimated(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 2, 3]), 100, 100)).toBeNull();
  expect(await decodeAnimated(new Uint8Array([1, 2, 3]), 100, 100)).toBeNull();
  expect(isWebp(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))).toBe(true);
});

test("delays: 0–10 ms play at 100 ms like browsers, never faster than 25 fps", () => {
  expect(normalizeDelay(0)).toBe(100);
  expect(normalizeDelay(10)).toBe(100);
  expect(normalizeDelay(undefined)).toBe(100);
  expect(normalizeDelay(20)).toBe(40);
  expect(normalizeDelay(70)).toBe(70);
});

const frames = (n: number, delay: number, size = 4): Frame[] =>
  Array.from({ length: n }, (_, i) => ({ rgba: new Uint8Array(size).fill(i), delayMs: delay }));

test("limitFrames: cuts at 10 s, then subsamples to the frame and byte caps keeping total time", () => {
  expect(limitFrames(frames(400, 50), 4)).toHaveLength(100); // 400×50 ms = 20 s → 200 cuadros → tope 150 → uno de cada 2
  const byTime = limitFrames(frames(30, 1000), 4);
  expect(byTime).toHaveLength(10);
  const byBytes = limitFrames(frames(10, 100), 1000, { maxFrames: 150, maxDurationMs: 10_000, maxBytes: 3000 });
  expect(byBytes).toHaveLength(3); // 3 por bytes → step 4 → 0,4,8
  expect(byBytes.map((f) => f.delayMs)).toEqual([400, 400, 200]);
  expect(byBytes.map((f) => f.rgba[0])).toEqual([0, 4, 8]);
});

function fakeAnimation(bytes: number): Animation {
  return { width: 1, height: 1, frames: frames(2, 100), bytes };
}

test("frame cache: one decode per url+size, LRU eviction past the byte cap, failures are not remembered", async () => {
  const decoded: string[] = [];
  let online = true;
  const cache = createFrameCache({
    load: async (url) => (online ? new TextEncoder().encode(url) : null),
    decode: async (bytes, w, h) => {
      decoded.push(`${new TextDecoder().decode(bytes)} ${w}x${h}`);
      return fakeAnimation(40);
    },
    maxBytes: 100,
  });
  const a = await cache.get("https://cdn.discordapp.com/a.gif", 4, 2);
  expect(await cache.get("https://cdn.discordapp.com/a.gif", 4, 2)).toBe(a);
  expect(decoded).toEqual(["https://cdn.discordapp.com/a.gif 40x40"]);
  await Promise.all([cache.get("https://cdn.discordapp.com/b.gif", 4, 2), cache.get("https://cdn.discordapp.com/b.gif", 4, 2)]);
  expect(decoded).toHaveLength(2); // pedidos simultáneos comparten el decode
  expect(cache.bytes).toBe(80);
  await cache.get("https://cdn.discordapp.com/c.gif", 4, 2); // 120 > 100: sale la menos usada (a)
  expect(cache.bytes).toBe(80);
  await cache.get("https://cdn.discordapp.com/a.gif", 4, 2);
  expect(decoded.filter((d) => d.startsWith("https://cdn.discordapp.com/a.gif"))).toHaveLength(2);

  online = false;
  expect(await cache.get("https://cdn.discordapp.com/d.gif", 4, 2)).toBeNull();
  online = true;
  expect(await cache.get("https://cdn.discordapp.com/d.gif", 4, 2)).not.toBeNull();
});

test("frame cache: an animation bigger than the whole cap is not kept", async () => {
  const cache = createFrameCache({ load: async () => new Uint8Array([1]), decode: async () => fakeAnimation(500), maxBytes: 100 });
  expect(await cache.get("https://cdn.discordapp.com/x.gif", 4, 2)).toBeNull();
  expect(cache.bytes).toBe(0);
});
