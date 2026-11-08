import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";

import type { Actions } from "../../src/actions";
import type { Store } from "../../src/store/store";
import { App } from "../../src/ui/App";
import { buildDemoStore, demoActions, DEMO } from "../../scripts/demo-state";

const DEVLAND = "920000000000000006";
const RAGNAR = "900000000000000101";

function raw(n: number, channel: string, content: string, author = RAGNAR) {
  return {
    id: `93000000000000${n}`,
    channel_id: channel,
    guild_id: DEMO.guild,
    author: { id: author, username: "ragnar", global_name: "Ragnar" },
    content,
    timestamp: new Date(Date.now() - (2000 - n) * 1000).toISOString(),
    edited_timestamp: null,
    attachments: [],
    embeds: [],
    mentions: [],
    mention_everyone: false,
    referenced_message: null,
    reactions: [],
  };
}

/** Páginas de 50 para #devland: 1051..1100 y después 1000..1049 (la 1000 es la última leída). */
function olderPage(store: Store, channel: string): unknown[] {
  const oldest = Number(store.getState().messages[channel]!.ids[0]!.slice(14));
  const from = oldest === 1101 ? 1051 : 1000;
  return Array.from({ length: 50 }, (_, i) => raw(from + i, channel, `viejo ${from + i}`));
}

function setup() {
  const store = buildDemoStore();
  const base = demoActions(store);
  const calls: string[] = [];
  const actions: Actions = {
    ...base,
    loadOlder: async (id) => {
      calls.push(`loadOlder:${id}`);
      store.dispatch({ type: "messages/page", channelId: id, messages: olderPage(store, id) as never, mode: "older" });
    },
  };
  return { store, actions, calls };
}

async function render(s: ReturnType<typeof setup>, width = 160, height = 50) {
  const r = await testRender(() => <App store={s.store} actions={s.actions} onQuit={() => {}} />, { width, height });
  await r.renderOnce();
  await settle(r);
  return r;
}

type Harness = Awaited<ReturnType<typeof render>>;

async function settle(h: { renderOnce(): Promise<void> }): Promise<void> {
  await h.renderOnce();
  await Bun.sleep(5);
  await h.renderOnce();
  await h.renderOnce();
}

function find(frame: string, text: string): { x: number; y: number } {
  const lines = frame.split("\n");
  for (let y = 0; y < lines.length; y += 1) {
    const index = lines[y]!.indexOf(text);
    if (index !== -1) return { x: Bun.stringWidth(lines[y]!.slice(0, index)) + Math.floor(Bun.stringWidth(text) / 2), y };
  }
  throw new Error(`no encontré "${text}" en pantalla`);
}

async function click(h: Harness, text: string): Promise<void> {
  const { x, y } = find(h.captureCharFrame(), text);
  await h.mockMouse.click(x, y);
  await settle(h);
}

const lineOf = (frame: string, text: string): number => frame.split("\n").findIndex((line) => line.includes(text));

test("the red divider goes right before the first unread message", async () => {
  const h = await render(setup());
  const frame = h.captureCharFrame();
  const divider = lineOf(frame, "──── mensajes nuevos ────");
  expect(divider).toBeGreaterThan(lineOf(frame, "como lo ves"));
  expect(divider).toBeLessThan(lineOf(frame, "pensé q te habías cambiado la foto"));
  // El primero de debajo del divisor lleva su encabezado.
  expect(frame.split("\n")[divider + 2]).toContain("CinLo💜  ");
});

test("on open the view sits on the first unread, not at the very bottom", async () => {
  const s = setup();
  // Mucho sin leer: no entra en pantalla.
  for (let n = 1011; n < 1040; n += 1) s.store.dispatch({ type: "gw", t: "MESSAGE_CREATE", d: raw(n, DEMO.general, `nuevo ${n}`) });
  s.store.dispatch({ type: "ui/selectChannel", id: DEMO.dm });
  s.store.dispatch({ type: "ui/selectChannel", id: DEMO.general });
  const h = await render(s, 160, 40);
  const frame = h.captureCharFrame();
  expect(frame).toContain("──── mensajes nuevos ────");
  expect(frame).toContain("pensé q te habías cambiado la foto");
  expect(frame).not.toContain("nuevo 1039");
});

test("no divider when everything was read, nor for my own messages", async () => {
  const s = setup();
  s.store.dispatch({ type: "gw", t: "MESSAGE_ACK", d: { channel_id: DEMO.general, message_id: "930000000000001010" } });
  s.store.dispatch({ type: "ui/selectChannel", id: DEMO.dm });
  s.store.dispatch({ type: "ui/selectChannel", id: DEMO.general });
  const h = await render(s);
  await s.actions.send(DEMO.general, "mío");
  await settle(h);
  expect(h.captureCharFrame()).toContain("mío");
  expect(h.captureCharFrame()).not.toContain("mensajes nuevos");
});

test("more unread than loaded: the top bar loads older pages until the first unread and jumps there", async () => {
  const s = setup();
  s.store.dispatch({ type: "ui/selectChannel", id: DEVLAND });
  const h = await render(s);
  expect(h.captureCharFrame()).toContain("↑ 3+ mensajes nuevos desde");
  expect(h.captureCharFrame()).not.toContain("──── mensajes nuevos ────");
  expect(s.calls).toEqual([]);

  await click(h, "click o gn para saltar");
  await settle(h);
  expect(s.calls).toEqual([`loadOlder:${DEVLAND}`, `loadOlder:${DEVLAND}`]);
  const frame = h.captureCharFrame();
  expect(frame).not.toContain("↑ ");
  expect(frame).toContain("──── mensajes nuevos ────");
  expect(frame).toContain("viejo 1001");
  expect(lineOf(frame, "viejo 1001")).toBeGreaterThan(lineOf(frame, "──── mensajes nuevos ────"));
  // Queda seleccionado el primero sin leer: r responde a ése.
  h.mockInput.pressKey("r");
  await settle(h);
  expect(h.captureCharFrame()).toContain("respondiendo a @Ragnar: viejo 1001");
});

test("gn selects the first unread message of the open channel", async () => {
  const s = setup();
  const h = await render(s);
  h.mockInput.pressKey("g");
  h.mockInput.pressKey("n");
  await settle(h);
  h.mockInput.pressKey("r");
  await settle(h);
  expect(h.captureCharFrame()).toContain("respondiendo a @CinLo💜: pensé q te habías cambiado la foto");
  expect(s.calls).toEqual([]);
});

test("gn with nothing unread says so", async () => {
  const s = setup();
  s.store.dispatch({ type: "gw", t: "MESSAGE_ACK", d: { channel_id: DEMO.general, message_id: "930000000000001010" } });
  s.store.dispatch({ type: "ui/selectChannel", id: DEMO.dm });
  s.store.dispatch({ type: "ui/selectChannel", id: DEMO.general });
  const h = await render(s);
  h.mockInput.pressKey("g");
  h.mockInput.pressKey("n");
  await settle(h);
  expect(h.captureCharFrame()).toContain("no hay mensajes nuevos en este canal");
});

test("↓ ir al final appears when new messages arrive below an old selection, and goes to the bottom", async () => {
  const s = setup();
  const h = await render(s, 160, 40);
  for (let i = 0; i < 6; i += 1) h.mockInput.pressKey("k");
  await settle(h);
  expect(h.captureCharFrame()).not.toContain("↓ ir al final");

  for (let n = 1011; n < 1030; n += 1) s.store.dispatch({ type: "gw", t: "MESSAGE_CREATE", d: raw(n, DEMO.general, `llegó ${n}`) });
  await settle(h);
  expect(h.captureCharFrame()).toContain("↓ ir al final");
  expect(h.captureCharFrame()).not.toContain("llegó 1029");

  await click(h, "↓ ir al final");
  await settle(h);
  expect(h.captureCharFrame()).not.toContain("↓ ir al final");
  expect(h.captureCharFrame()).toContain("llegó 1029");
});

test("G goes to the bottom even after scrolling up with the wheel", async () => {
  const s = setup();
  const h = await render(s, 160, 40);
  for (let n = 1011; n < 1030; n += 1) s.store.dispatch({ type: "gw", t: "MESSAGE_CREATE", d: raw(n, DEMO.general, `llegó ${n}`) });
  await settle(h);
  expect(h.captureCharFrame()).toContain("llegó 1029");
  const { x, y } = find(h.captureCharFrame(), "llegó 1029");
  for (let i = 0; i < 20; i += 1) await h.mockMouse.scroll(x, y, "up");
  await settle(h);
  expect(h.captureCharFrame()).not.toContain("llegó 1029");
  h.mockInput.pressKey("G");
  await settle(h);
  expect(h.captureCharFrame()).toContain("llegó 1029");
});
