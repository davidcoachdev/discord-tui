import { afterAll, beforeAll, expect, test } from "bun:test";
import { ImageRenderable, type Renderable, type ScrollBoxRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { join } from "node:path";

import { buildDemoStore, DEMO } from "../../scripts/demo-state";
import { animationScheduler } from "../../src/images/animation";
import { selectMessages } from "../../src/store/selectors";
import type { ApiEmbed, Message } from "../../src/store/types";
import { MessageItem } from "../../src/ui/components/MessageItem";
import { THEMES } from "../../src/ui/theme";

// Sin red: el cache de imágenes usa globalThis.fetch y acá devuelve el GIF de 3 cuadros local.
const GIF = new Uint8Array(await Bun.file(join(import.meta.dir, "..", "fixtures", "images", "sample.gif")).arrayBuffer());
const requests: string[] = [];
const realFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = (async (input: string | URL | Request) => {
    requests.push(String(input));
    return new Response(GIF, { status: 200 });
  }) as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

function images(node: Renderable): ImageRenderable[] {
  const own = node instanceof ImageRenderable ? [node] : [];
  return [...own, ...node.getChildren().flatMap((child) => images(child as Renderable))];
}

let seq = 0;
function gifMessage(extra: Partial<Message> = {}): { message: Message; state: ReturnType<ReturnType<typeof buildDemoStore>["getState"]> } {
  const state = buildDemoStore().getState();
  const base = selectMessages(state, DEMO.general)[0]!;
  seq++;
  const message: Message = {
    ...base,
    id: `9000000000000000${seq}`,
    content: "",
    reactions: [],
    embeds: [],
    stickers: [],
    poll: null,
    attachments: [
      {
        id: `8000000000000000${seq}`,
        filename: "baile.gif",
        size: GIF.byteLength,
        url: `https://cdn.discordapp.com/attachments/1/${seq}/baile.gif`,
        proxy_url: `https://cdn.discordapp.com/attachments/1/${seq}/baile.gif`,
        content_type: "image/gif",
        width: 64,
        height: 64,
      },
    ],
    ...extra,
  };
  return { message, state };
}

async function render(message: Message, state: ReturnType<ReturnType<typeof buildDemoStore>["getState"]>, animate: boolean) {
  const r = await testRender(
    () => <MessageItem message={message} state={state} theme={THEMES.dark} guildId={DEMO.guild} grouped={false} images animate={animate} />,
    { width: 80, height: 16 },
  );
  await r.renderOnce();
  return r;
}

/** Junta las fuentes distintas que tuvo la imagen durante `ms` (dibujando como lo haría la app). */
async function sourcesOver(r: Awaited<ReturnType<typeof render>>, ms: number): Promise<Set<unknown>> {
  const seen = new Set<unknown>();
  const end = Date.now() + ms;
  while (Date.now() < end) {
    await Bun.sleep(20);
    await r.renderOnce();
    const img = images(r.renderer.root)[0];
    if (img?.source !== undefined) seen.add(img.source);
  }
  return seen;
}

test("an animated GIF attachment cycles its frames with images on", async () => {
  const { message, state } = gifMessage();
  const r = await render(message, state, true);
  const seen = await sourcesOver(r, 450);
  expect(images(r.renderer.root)).toHaveLength(1);
  // 3 cuadros a 100 ms: en 450 ms tienen que haberse visto varios cuadros distintos.
  expect(seen.size).toBeGreaterThanOrEqual(3);
  expect(images(r.renderer.root)[0]!.loadError).toBeNull();
  expect(animationScheduler.size).toBe(1);
  r.renderer.destroy();
  await Bun.sleep(10);
  expect(animationScheduler.size).toBe(0); // desmontado → deja de animar
});

test("animateImages=false keeps the single first-frame image of today", async () => {
  const { message, state } = gifMessage();
  const r = await render(message, state, false);
  const seen = await sourcesOver(r, 300);
  expect(seen.size).toBe(1);
  expect([...seen][0]).toBeInstanceOf(Uint8Array);
  expect(animationScheduler.size).toBe(0);
  r.renderer.destroy();
});

test("animated custom emoji reactions and GIF stickers animate too", async () => {
  const { message, state } = gifMessage({
    attachments: [],
    stickers: [{ id: "100000000000000700", name: "baile", formatType: 4 }],
    reactions: [{ emoji: { id: "100000000000000701", name: "party", animated: true }, count: 1, me: false }],
  });
  const r = await render(message, state, true);
  await sourcesOver(r, 150);
  expect(images(r.renderer.root)).toHaveLength(2);
  expect(animationScheduler.size).toBe(2);
  r.renderer.destroy();
  await Bun.sleep(10);
  expect(animationScheduler.size).toBe(0);
});

test("gifv embed without a GIF variant: still thumbnail can't load from Tenor, shows ▶ GIF that opens the link", async () => {
  const embed = {
    type: "gifv",
    url: "https://tenor.com/view/baile-123",
    provider: { name: "Tenor", url: "https://tenor.co" },
    thumbnail: { url: "https://media.tenor.com/x/AAAAe/baile.png", proxy_url: "https://images-ext-1.discordapp.net/external/x/baile.png", width: 64, height: 64 },
    video: { url: "https://media.tenor.com/x/AAAPo/baile.mp4", width: 64, height: 64 },
  } as ApiEmbed;
  const opened: string[] = [];
  const { message, state } = gifMessage({ attachments: [], embeds: [embed] });
  const before = requests.length;
  const r = await testRender(
    () => (
      <MessageItem message={message} state={state} theme={THEMES.dark} guildId={DEMO.guild} grouped={false} images animate onOpen={(u) => opened.push(u)} />
    ),
    { width: 80, height: 16 },
  );
  await r.renderOnce();
  const frame = r.captureCharFrame();
  expect(frame).toContain("▶ GIF");
  expect(images(r.renderer.root)).toHaveLength(0);
  expect(requests.length).toBe(before); // ningún host fuera de la allowlist
  const row = frame.split("\n").findIndex((line) => line.includes("▶ GIF"));
  const col = frame.split("\n")[row]!.indexOf("▶");
  await r.mockMouse.click(col + 2, row);
  expect(opened).toEqual(["https://tenor.com/view/baile-123"]);
  r.renderer.destroy();
});

test("gifv embed whose image is a GIF on the media proxy animates", async () => {
  const embed = {
    type: "gifv",
    url: "https://giphy.com/gifs/baile",
    provider: { name: "GIPHY" },
    thumbnail: { url: "https://media.giphy.com/media/x/giphy.gif", proxy_url: "https://media.discordapp.net/external/x/giphy.gif", width: 64, height: 64 },
  } as ApiEmbed;
  const { message, state } = gifMessage({ attachments: [], embeds: [embed] });
  const r = await render(message, state, true);
  const seen = await sourcesOver(r, 350);
  expect(seen.size).toBeGreaterThanOrEqual(2);
  expect(r.captureCharFrame()).not.toContain("▶ GIF");
  r.renderer.destroy();
});

test("a GIF scrolled out of its scrollbox holds its frame until it is visible", async () => {
  const { message, state } = gifMessage();
  let box: ScrollBoxRenderable | undefined;
  const r = await testRender(
    () => (
      <scrollbox ref={(el: ScrollBoxRenderable) => (box = el)} width={80} height={6}>
        <box height={30}>
          <text>relleno</text>
        </box>
        <MessageItem message={message} state={state} theme={THEMES.dark} guildId={DEMO.guild} grouped={false} images animate />
      </scrollbox>
    ),
    { width: 80, height: 16 },
  );
  await r.renderOnce();
  await sourcesOver(r, 100); // carga y decodifica
  const hidden = await sourcesOver(r, 350);
  expect(hidden.size).toBe(1);
  box!.scrollTo(1000);
  const shown = await sourcesOver(r, 350);
  expect(shown.size).toBeGreaterThanOrEqual(2);
  r.renderer.destroy();
});
