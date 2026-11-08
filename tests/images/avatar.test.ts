import { expect, test } from "bun:test";
import { join } from "node:path";

import { avatarUrl, createAvatarLoader, decodeAvatar, defaultAvatarIndex, userAvatarUrl } from "../../src/images/avatar";
import { isAllowedImageHost } from "../../src/images/cdn";
import type { Animation } from "../../src/images/gif";
import { createFetchQueue } from "../../src/images/queue";
import { buildDemoStore, DEMO } from "../../scripts/demo-state";

const FIXTURES = join(import.meta.dir, "..", "fixtures", "images");
const GIF = new Uint8Array(await Bun.file(join(FIXTURES, "sample.gif")).arrayBuffer());
const PNG = new Uint8Array(await Bun.file(join(FIXTURES, "sample.png")).arrayBuffer());

const ID = "80351110224678912";
const HASH = "8342729096ea3675442027381ff50dfe";

test("avatarUrl: custom avatar as png at size 32 on the CDN", () => {
  const url = avatarUrl({ id: ID, avatar: HASH });
  expect(url).toBe(`https://cdn.discordapp.com/avatars/${ID}/${HASH}.png?size=32`);
  expect(isAllowedImageHost(url)).toBe(true);
});

test("avatarUrl: a_ hash is a gif only when animation is on", () => {
  const user = { id: ID, avatar: `a_${HASH}` };
  expect(avatarUrl(user, 32, { animate: true })).toBe(`https://cdn.discordapp.com/avatars/${ID}/a_${HASH}.gif?size=32`);
  expect(avatarUrl(user, 32, { animate: false })).toBe(`https://cdn.discordapp.com/avatars/${ID}/a_${HASH}.png?size=32`);
  expect(avatarUrl({ id: ID, avatar: HASH }, 32, { animate: true })).toEndWith(".png?size=32");
});

test("default avatar: (id >> 22) % 6 for the new username system, discriminator % 5 for the old one", () => {
  expect(defaultAvatarIndex({ id: ID })).toBe(Number((BigInt(ID) >> 22n) % 6n));
  expect(defaultAvatarIndex({ id: "175928847299117063" })).toBe(Number((175928847299117063n >> 22n) % 6n));
  expect(defaultAvatarIndex({ id: ID, discriminator: "0" })).toBe(Number((BigInt(ID) >> 22n) % 6n));
  expect(defaultAvatarIndex({ id: ID, discriminator: "1337" })).toBe(1337 % 5);
  expect(avatarUrl({ id: ID, avatar: null })).toBe(`https://cdn.discordapp.com/embed/avatars/${Number((BigInt(ID) >> 22n) % 6n)}.png`);
  expect(avatarUrl({ id: ID, avatar: null, discriminator: "0004" })).toBe("https://cdn.discordapp.com/embed/avatars/4.png");
});

test("guild member avatar wins over the user avatar", () => {
  const g = "81384788765712384";
  expect(avatarUrl({ id: ID, avatar: HASH }, 32, { guildId: g, memberAvatar: `a_${HASH}`, animate: true })).toBe(
    `https://cdn.discordapp.com/guilds/${g}/users/${ID}/avatars/a_${HASH}.gif?size=32`,
  );
  expect(avatarUrl({ id: ID, avatar: HASH }, 32, { guildId: null, memberAvatar: HASH })).toBe(`https://cdn.discordapp.com/avatars/${ID}/${HASH}.png?size=32`);
});

test("weird ids or hashes never leave the default avatar path", () => {
  expect(avatarUrl({ id: ID, avatar: "../../x" })).toStartWith("https://cdn.discordapp.com/embed/avatars/");
  expect(avatarUrl({ id: "../x", avatar: HASH })).toBe("https://cdn.discordapp.com/embed/avatars/0.png");
});

test("userAvatarUrl reads the member avatar from the store (GUILD_MEMBER_UPDATE) and the user one otherwise", () => {
  const store = buildDemoStore();
  const userId = "900000000000000101";
  store.dispatch({ type: "gw", t: "GUILD_MEMBER_UPDATE", d: { guild_id: DEMO.guild, user: { id: userId, username: "ragnar", avatar: HASH }, roles: [], avatar: `a_${HASH}` } });
  const state = store.getState();
  expect(state.members[DEMO.guild]?.[userId]?.avatar).toBe(`a_${HASH}`);
  expect(userAvatarUrl(state, userId, DEMO.guild, true)).toBe(`https://cdn.discordapp.com/guilds/${DEMO.guild}/users/${userId}/avatars/a_${HASH}.gif?size=32`);
  expect(userAvatarUrl(state, userId, null, true)).toBe(`https://cdn.discordapp.com/avatars/${userId}/${HASH}.png?size=32`);
});

test("member avatars come from GUILD_MEMBER_LIST_UPDATE and legacy discriminators are kept", () => {
  const store = buildDemoStore();
  const id = "970000000000000001";
  store.dispatch({
    type: "gw",
    t: "GUILD_MEMBER_LIST_UPDATE",
    d: { guild_id: DEMO.guild, ops: [{ op: "SYNC", range: [0, 0], items: [{ member: { user: { id, username: "bot", discriminator: "0042", bot: true }, roles: [], avatar: HASH } }] }] },
  });
  const state = store.getState();
  expect(state.members[DEMO.guild]?.[id]?.avatar).toBe(HASH);
  expect(state.users[id]?.discriminator).toBe("0042");
  expect(state.users["900000000000000101"]?.discriminator).toBeUndefined();
});

test("decodeAvatar: 32×32 frames cut in a circle (animated GIF keeps its frames, PNG is one)", async () => {
  const gif = (await decodeAvatar(GIF))!;
  expect(gif.width).toBe(32);
  expect(gif.height).toBe(32);
  expect(gif.frames).toHaveLength(3);
  const alpha = (a: Animation, x: number, y: number): number => a.frames[0]!.rgba[(y * 32 + x) * 4 + 3]!;
  expect(alpha(gif, 0, 0)).toBe(0);
  expect(alpha(gif, 31, 31)).toBe(0);
  expect(alpha(gif, 16, 16)).toBe(255);
  const png = (await decodeAvatar(PNG))!;
  expect(png.frames).toHaveLength(1);
  expect(alpha(png, 0, 0)).toBe(0);
  expect(await decodeAvatar(new Uint8Array([1, 2, 3]))).toBeNull();
});

test("fetch queue: never more than the limit at once, in order, skipping jobs nobody wants anymore", async () => {
  const queue = createFetchQueue(6);
  let running = 0;
  let peak = 0;
  const started: number[] = [];
  const release: (() => void)[] = [];
  const job = (i: number) => () =>
    new Promise<number>((resolve) => {
      running++;
      peak = Math.max(peak, running);
      started.push(i);
      release.push(() => {
        running--;
        resolve(i);
      });
    });
  const results = Array.from({ length: 20 }, (_, i) => queue.run(job(i), () => i !== 7));
  await Bun.sleep(0);
  expect(queue.active).toBe(6);
  expect(queue.waiting).toBe(14);
  while (release.length > 0) {
    release.shift()!();
    await Bun.sleep(0);
  }
  expect(peak).toBe(6);
  expect(started).toEqual([...Array(20).keys()].filter((i) => i !== 7));
  expect(await results[7]).toBeNull();
  expect(await results[19]).toBe(19);
});

function loaderWith(opts: { fail?: boolean; maxBytes?: number; now?: () => number } = {}) {
  const fetched: string[] = [];
  let inFlight = 0;
  let peak = 0;
  const loader = createAvatarLoader({
    fetchBytes: async (url) => {
      fetched.push(url);
      inFlight++;
      peak = Math.max(peak, inFlight);
      await Bun.sleep(1);
      inFlight--;
      return opts.fail ? null : PNG;
    },
    decode: (bytes) => decodeAvatar(bytes),
    maxBytes: opts.maxBytes,
    now: opts.now,
  });
  return { loader, fetched, peak: () => peak };
}

test("300 avatars at once: at most 6 fetches in flight, the same URL fetched once", async () => {
  const { loader, fetched, peak } = loaderWith();
  const urls = Array.from({ length: 300 }, (_, i) => `https://cdn.discordapp.com/avatars/${9000 + i}/${HASH}.png?size=32`);
  const all = await Promise.all([...urls, ...urls.slice(0, 10)].map((u) => loader.get(u)));
  expect(peak()).toBe(6);
  expect(fetched).toHaveLength(300);
  expect(all.every((r) => r?.kind === "frames")).toBe(true);
  expect(loader.peek(urls[0]!)).toBe(all[0]!);
});

test("avatar budget: least recently used decoded avatars go first", async () => {
  const { loader } = loaderWith({ maxBytes: 3 * 32 * 32 * 4 });
  const url = (i: number): string => `https://cdn.discordapp.com/avatars/${i}/${HASH}.png?size=32`;
  for (let i = 1; i <= 4; i++) await loader.get(url(i));
  expect(loader.bytes).toBe(3 * 32 * 32 * 4);
  expect(loader.peek(url(1))).toBeNull();
  expect(loader.peek(url(4))).not.toBeNull();
});

test("a failed avatar is not asked again for a minute; an unwanted one is not fetched nor remembered", async () => {
  let now = 0;
  const failing = loaderWith({ fail: true, now: () => now });
  const url = `https://cdn.discordapp.com/avatars/1/${HASH}.png?size=32`;
  expect(await failing.loader.get(url)).toBeNull();
  expect(await failing.loader.get(url)).toBeNull();
  expect(failing.fetched).toHaveLength(1);
  now = 61_000;
  await failing.loader.get(url);
  expect(failing.fetched).toHaveLength(2);

  const ok = loaderWith();
  expect(await ok.loader.get(url, () => false)).toBeNull();
  expect(ok.fetched).toHaveLength(0);
  expect((await ok.loader.get(url))?.kind).toBe("frames");
});
