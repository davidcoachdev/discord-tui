import { expect, test } from "bun:test";

import { isAllowedImageHost, stickerView } from "../../src/images/cdn";

const ID = "100000000000000700";

test("PNG and APNG stickers load as .png from the media proxy, GIF as .gif", () => {
  for (const formatType of [1, 2]) {
    const view = stickerView({ id: ID, name: "wave", formatType }, "kitty");
    expect(view).toMatchObject({ kind: "image", url: `https://media.discordapp.net/stickers/${ID}.png?size=160`, label: "🏷 wave" });
  }
  const gif = stickerView({ id: ID, name: "baile", formatType: 4 }, "kitty");
  expect(gif.kind === "image" && gif.url).toBe(`https://media.discordapp.net/stickers/${ID}.gif?size=160`);
  if (gif.kind === "image") expect(isAllowedImageHost(gif.url)).toBe(true);
});

test("Lottie, unknown formats, odd ids or images off fall back to the 🏷 chip", () => {
  expect(stickerView({ id: ID, name: "lottie", formatType: 3 }, "kitty")).toEqual({ kind: "label", label: "🏷 lottie" });
  expect(stickerView({ id: ID, name: "raro", formatType: 9 }, "kitty").kind).toBe("label");
  expect(stickerView({ id: "../x", name: "x", formatType: 1 }, "kitty").kind).toBe("label");
  expect(stickerView({ id: ID, name: "wave", formatType: 1 }, "links")).toEqual({ kind: "label", label: "🏷 wave" });
});
