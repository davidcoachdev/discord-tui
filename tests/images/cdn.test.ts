import { expect, test } from "bun:test";

import { attachmentView, emojiUrl, isAllowedImageHost } from "../../src/images/cdn";
import { createImageCache } from "../../src/images/cache";

test("emojiUrl", () => {
  expect(emojiUrl("4", false)).toBe("https://cdn.discordapp.com/emojis/4.webp?size=48&quality=lossless");
  expect(emojiUrl("5", true)).toContain("&animated=true");
});

test("only discord CDN hosts over https are allowed", () => {
  expect(isAllowedImageHost("https://cdn.discordapp.com/a.png")).toBe(true);
  expect(isAllowedImageHost("https://media.discordapp.net/a.png")).toBe(true);
  expect(isAllowedImageHost("http://cdn.discordapp.com/a.png")).toBe(false);
  expect(isAllowedImageHost("https://evil.example/a.png")).toBe(false);
});

test("image cache never sends Authorization and refuses other hosts", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const cache = createImageCache({
    fetch: (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(new Uint8Array([1, 2, 3]));
    }) as never,
  });
  expect(await cache.get("https://evil.example/x.png")).toBeNull();
  expect(await cache.get("https://cdn.discordapp.com/x.png")).toEqual(new Uint8Array([1, 2, 3]));
  expect(await cache.get("https://cdn.discordapp.com/x.png")).toEqual(new Uint8Array([1, 2, 3]));
  expect(calls).toHaveLength(1);
  expect(JSON.stringify(calls[0]!.init ?? {}).toLowerCase()).not.toContain("authorization");
});

test("attachmentView keeps aspect ratio inside 40x12 and falls back to link", () => {
  const base = { filename: "a.png", size: 2048, url: "https://cdn.discordapp.com/a.png", proxy_url: "https://media.discordapp.net/a.png", content_type: "image/png", width: 800, height: 400 };
  const view = attachmentView(base, "kitty");
  expect(view).toMatchObject({ kind: "image", cols: 40 });
  expect(view.kind === "image" && view.rows <= 12).toBe(true);
  expect(attachmentView(base, "links")).toMatchObject({ kind: "link", label: "📎 a.png (2 KB)" });
  expect(attachmentView({ ...base, content_type: "application/pdf", filename: "doc.pdf" }, "kitty")).toMatchObject({ kind: "link" });
});
