import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";

import type { Actions } from "../../src/actions";
import { App } from "../../src/ui/App";
import { buildDemoStore, demoActions, DEMO } from "../../scripts/demo-state";

/** Acciones de la demo (cambian el store como las reales) que además anotan cada llamada. */
function setup() {
  const store = buildDemoStore();
  const base = demoActions(store);
  const calls: string[] = [];
  const log =
    <A extends unknown[], R>(name: string, fn: (...args: A) => R) =>
    (...args: A): R => {
      calls.push(`${name}${args.length ? ":" + args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(":") : ""}`);
      return fn(...args);
    };
  const voice = base.voice!;
  const actions: Actions = {
    ...base,
    selectGuild: log("selectGuild", base.selectGuild),
    openChannel: log("openChannel", base.openChannel),
    loadOlder: log("loadOlder", base.loadOlder),
    send: log("send", base.send),
    remove: log("remove", base.remove),
    toggleReaction: log("react", base.toggleReaction),
    openUrl: log("openUrl", () => {}),
    voice: {
      ...voice,
      toggleVoice: log("toggleVoice", voice.toggleVoice),
      leaveVoice: log("leaveVoice", voice.leaveVoice),
      toggleMute: log("mute", voice.toggleMute),
      toggleDeaf: log("deaf", voice.toggleDeaf),
      toggleInputMode: log("inputMode", voice.toggleInputMode),
    },
  };
  return { store, actions, calls };
}

type Harness = Awaited<ReturnType<typeof render>>;

async function render(s: ReturnType<typeof setup>, deps: any = {}) {
  const r = await testRender(() => <App store={s.store} actions={s.actions} onQuit={() => {}} deps={deps} />, {
    width: 160,
    height: 50,
  });
  await r.renderOnce();
  return r;
}

/** Celda (x, y) del centro del texto en pantalla, contando emojis como 2 columnas. */
function find(frame: string, text: string, nth = 0): { x: number; y: number } {
  const lines = frame.split("\n");
  if (nth < 0) {
    const total = lines.reduce((n, line) => n + line.split(text).length - 1, 0);
    nth = total + nth;
  }
  let seen = 0;
  for (let y = 0; y < lines.length; y += 1) {
    let from = 0;
    for (;;) {
      const index = lines[y]!.indexOf(text, from);
      if (index === -1) break;
      if (seen === nth) {
        const x = Bun.stringWidth(lines[y]!.slice(0, index)) + Math.floor(Bun.stringWidth(text) / 2);
        return { x, y };
      }
      seen += 1;
      from = index + 1;
    }
  }
  throw new Error(`no encontré "${text}" en pantalla`);
}

async function click(h: Harness, text: string, nth = 0): Promise<void> {
  const { x, y } = find(h.captureCharFrame(), text, nth);
  await h.mockMouse.click(x, y);
  await h.renderOnce();
  await Bun.sleep(5);
  await h.renderOnce();
}

test("click on a server selects it and focuses the channel list", async () => {
  const s = setup();
  const h = await render(s);
  await click(h, "Midjourney");
  expect(s.calls).toContain("selectGuild:910000000000000003");
  expect(s.store.getState().ui.focus).toBe("channels");
});

test("click on a text channel opens it and focuses the messages", async () => {
  const s = setup();
  const h = await render(s);
  await click(h, "🐸-memes");
  expect(s.calls).toContain("openChannel:920000000000000005");
  expect(s.store.getState().ui.focus).toBe("messages");
});

test("click on a voice channel opens its chat without joining; the 🎧 button or a double click joins", async () => {
  const s = setup();
  const h = await render(s);
  await click(h, "Sala 1");
  expect(s.calls).toContain(`openChannel:${DEMO.voice}`);
  expect(s.calls.filter((c) => c.startsWith("toggleVoice"))).toHaveLength(0);
  expect(h.captureCharFrame()).toContain("llamada de voz");

  await click(h, "🎧");
  expect(s.calls.filter((c) => c.startsWith("toggleVoice"))).toEqual([`toggleVoice:${DEMO.voice}`]);
  await Bun.sleep(450);
  await h.renderOnce();

  const { x, y } = find(h.captureCharFrame(), "Sala 2");
  await h.mockMouse.click(x, y);
  await h.mockMouse.click(x, y);
  await h.renderOnce();
  expect(s.calls).toContain(`toggleVoice:${DEMO.voice2}`);
});

test("the big Entrar a voz button in a voice channel joins, and then leaves", async () => {
  const s = setup();
  s.store.dispatch({ type: "ui/selectChannel", id: DEMO.voice2 });
  const h = await render(s);
  await click(h, "🔊 Entrar a voz");
  expect(s.calls).toContain(`toggleVoice:${DEMO.voice2}`);
  await Bun.sleep(450);
  await h.renderOnce();
  await click(h, "✕ Salir de la llamada");
  expect(s.calls.filter((c) => c.startsWith("toggleVoice")).length).toBe(2);
});

test("click on a category collapses and expands it", async () => {
  const s = setup();
  const h = await render(s);
  expect(h.captureCharFrame()).toContain("👋-bienvenida");
  await click(h, "INFORMACIÓN");
  expect(h.captureCharFrame()).not.toContain("👋-bienvenida");
  expect(h.captureCharFrame()).toContain("› 📌 INFORMACIÓN");
  await click(h, "INFORMACIÓN");
  expect(h.captureCharFrame()).toContain("👋-bienvenida");
});

test("click on a voice participant shows the volume control and − / + change it", async () => {
  const s = setup();
  const h = await render(s);
  await click(h, "○ Ragnar");
  expect(h.captureCharFrame()).toContain("vol");
  await click(h, " − ");
  await click(h, " − ");
  expect(s.store.getState().settings.userVolumes["900000000000000101"]).toBe(80);
  await click(h, " + ");
  expect(s.store.getState().settings.userVolumes["900000000000000101"]).toBe(90);
});

test("click selects a message and its action bar replies, edits, deletes with confirmation and reacts", async () => {
  const s = setup();
  const h = await render(s);
  await click(h, "esto es una cita");
  expect(h.captureCharFrame()).toContain("↩ responder");
  expect(h.captureCharFrame()).toContain("✎ editar");

  await click(h, "↩ responder");
  expect(h.captureCharFrame()).toContain("respondiendo a @Gon");
  h.mockInput.pressKeys(["\u001b[27u"]);
  await h.renderOnce();

  await click(h, "✎ editar");
  expect(h.captureCharFrame()).toContain(" editando ");
  h.mockInput.pressKeys(["\u001b[27u"]);
  await h.renderOnce();

  await click(h, "🗑 borrar");
  expect(h.captureCharFrame()).toContain("¿Borrar este mensaje?");
  await click(h, "sí, borrar");
  expect(s.calls).toContain("remove:920000000000000002:930000000000001009");
});

test("reaccionar opens the emoji picker and an emoji click reacts", async () => {
  const s = setup();
  const h = await render(s);
  await click(h, "estás trabajando en ese juego");
  await click(h, "😀 reaccionar");
  await h.mockInput.typeText("fi");
  await h.renderOnce();
  await click(h, "🔥  fire");
  expect(s.calls.some((c) => c.startsWith("react:920000000000000002:930000000000001010") && c.includes("🔥"))).toBe(true);
});

test("others' messages have no edit/delete buttons", async () => {
  const s = setup();
  const h = await render(s);
  await click(h, "estás trabajando en ese juego");
  expect(h.captureCharFrame()).toContain("↩ responder");
  expect(h.captureCharFrame()).not.toContain("✎ editar");
});

test("click on an existing reaction toggles it", async () => {
  const s = setup();
  const h = await render(s);
  await click(h, "😂 3");
  expect(s.calls.some((c) => c.startsWith("react:920000000000000002:930000000000001008") && c.includes("😂"))).toBe(true);
});

test("click on an attachment or an embed title opens it in the browser", async () => {
  const s = setup();
  const h = await render(s);
  await click(h, "📎 captura-20261107.png");
  expect(s.calls).toContain("openUrl:https://cdn.discordapp.com/x.png");
  await click(h, "OpenTUI", 0);
  expect(s.calls).toContain("openUrl:https://github.com/sst/opentui");
});

test("wheel up at the top of the channel loads older messages", async () => {
  const s = setup();
  const h = await render(s);
  const { x, y } = find(h.captureCharFrame(), "Diablo pero");
  for (let i = 0; i < 40; i += 1) await h.mockMouse.scroll(x, y, "up");
  await h.renderOnce();
  expect(s.calls).toContain(`loadOlder:${DEMO.general}`);
});

test("composer: click writes, 📎 asks for a path, 📋 pastes, ✕ removes an attachment", async () => {
  const s = setup();
  const h = await render(s, {
    readClipboardImage: async () => ({ bytes: new Uint8Array(4), mime: "image/png", filename: "captura.png" }),
    readClipboardText: async () => null,
  });
  await click(h, "i para escribir en");
  expect(h.captureCharFrame()).toContain(" INSERT ");
  h.mockInput.pressKeys(["\u001b[27u"]);
  await h.renderOnce();
  await click(h, "📋 pegar");
  expect(h.captureCharFrame()).toContain("📎 captura.png");
  await click(h, " ✕ ");
  expect(h.captureCharFrame()).not.toContain("📎 captura.png");
  await click(h, "📎 adjuntar");
  expect(h.captureCharFrame()).toContain("path ❯");
});

test("click on a mention suggestion picks it", async () => {
  const s = setup();
  const h = await render(s);
  h.mockInput.pressKey("i");
  await h.mockInput.typeText("hola @");
  await h.renderOnce();
  await click(h, " djromoro", -1); // el del cartel de sugerencias, no el de la lista de miembros
  h.mockInput.pressEnter();
  await h.renderOnce();
  expect(s.calls.find((c) => c.startsWith("send:"))).toBe(`send:${DEMO.general}:hola <@900000000000000103> :{}`);
});

test("click on a member mentions it in the composer", async () => {
  const s = setup();
  const h = await render(s);
  await click(h, "● CinLo💜");
  h.mockInput.pressEnter();
  await h.renderOnce();
  expect(s.calls.find((c) => c.startsWith("send:"))).toBe(`send:${DEMO.general}:<@900000000000000102> :{}`);
});

test("voice bar buttons: mute, deafen, mode and leave", async () => {
  const s = setup();
  const h = await render(s);
  await s.actions.voice!.toggleVoice(DEMO.voice);
  await h.renderOnce();
  await click(h, "🎙 mic");
  expect(h.captureCharFrame()).toContain("🎙 muteado");
  await click(h, "🎧 audio");
  expect(h.captureCharFrame()).toContain("🎧 sordo");
  await click(h, "🎚 VAD");
  expect(s.store.getState().settings.inputMode).toBe("push_to_talk");
  await click(h, "✕ salir");
  expect(s.calls).toEqual(expect.arrayContaining(["mute", "deaf", "inputMode", "leaveVoice"]));
  expect(s.store.getState().voice.channelId).toBeNull();
});

test("status bar buttons open the switcher, settings and help; clicks outside close overlays", async () => {
  const s = setup();
  const h = await render(s);
  await click(h, "? ayuda");
  expect(h.captureCharFrame()).toContain("Ayuda ·");
  await h.mockMouse.click(2, 48);
  await h.renderOnce();
  expect(h.captureCharFrame()).not.toContain("Ayuda ·");

  await click(h, "⌕ Ctrl-k saltar");
  expect(h.captureCharFrame()).toContain("Saltar a…");
  await click(h, "#🐸-memes");
  expect(s.store.getState().ui.selectedChannelId).toBe("920000000000000005");
  expect(h.captureCharFrame()).not.toContain("Saltar a…");

  await click(h, "⌕ Ctrl-k saltar");
  await h.mockMouse.click(2, 48);
  await h.renderOnce();
  expect(h.captureCharFrame()).not.toContain("Saltar a…");

  await click(h, "⚙ settings");
  expect(h.captureCharFrame()).toContain(" Settings ");
  await click(h, "tema: oscuro");
  expect(s.store.getState().settings.theme).toBe("light");
  await click(h, "sensibilidad");
  await click(h, "▶", 2);
  expect(typeof s.store.getState().settings.vadSensitivity).toBe("number");
  await h.mockMouse.click(2, 48);
  await h.renderOnce();
  expect(h.captureCharFrame()).not.toContain(" Settings ");
});

test("hovering a server, a channel or a message highlights it", async () => {
  const s = setup();
  const h = await render(s);
  const bgAt = (text: string): string => {
    const { y } = find(h.captureCharFrame(), text);
    const spans = (h as any).captureSpans().lines[y].spans as { text: string; bg: { toString(): string } }[];
    return spans.find((span) => span.text.includes(text.trim().split(" ")[0]!))!.bg.toString();
  };
  for (const target of ["Midjourney", "🎥-youtube", "Diablo pero"]) {
    const before = bgAt(target);
    const { x, y } = find(h.captureCharFrame(), target);
    await h.mockMouse.moveTo(x, y);
    await h.renderOnce();
    expect(bgAt(target)).not.toBe(before);
    await h.mockMouse.moveTo(2, 48);
    await h.renderOnce();
  }
});

test("direct messages: ordered by activity with presence, click opens the chat and the panel shows its people", async () => {
  const s = setup();
  const h = await render(s);
  await click(h, "✉ Mensajes");
  const frame = h.captureCharFrame();
  const order = ["Los del ajedrez", "CinLo💜", "Ragnar, djromoro", "PmmR", "zero"].map((name) => frame.indexOf(name));
  expect(order.every((at, i) => at > -1 && (i === 0 || at > order[i - 1]!))).toBe(true);
  await click(h, "● CinLo💜");
  const opened = h.captureCharFrame();
  expect(opened).toContain("@ CinLo💜");
  expect(opened).toContain("jaja ¿en serio en la terminal?");
  expect(opened).toContain("EN ESTE CHAT — 2");
  expect(opened).toContain("i para escribirle a @CinLo💜");
});

test("voice channels have their own chat and you can write there without joining", async () => {
  const s = setup();
  const h = await render(s);
  await click(h, "Sala 1");
  expect(s.calls).toContain(`openChannel:${DEMO.voice}`);
  expect(h.captureCharFrame()).toContain("i para escribir en el chat de 🔊 Sala 1");
  h.mockInput.pressKey("i");
  await h.mockInput.typeText("hola desde la sala");
  h.mockInput.pressEnter();
  await h.renderOnce();
  expect(s.calls.find((c) => c.startsWith("send:"))).toBe(`send:${DEMO.voice}:hola desde la sala:{}`);
  expect(h.captureCharFrame()).toContain("hola desde la sala");
  expect(s.calls.filter((c) => c.startsWith("toggleVoice"))).toHaveLength(0);
});

test("a voice channel's chat can be read without joining (Ctrl-k) and the strip offers to join", async () => {
  const s = setup();
  const h = await render(s);
  h.mockInput.pressKey("k", { ctrl: true });
  await h.mockInput.typeText("sala 2");
  h.mockInput.pressEnter();
  await h.renderOnce();
  expect(s.calls).toContain(`openChannel:${DEMO.voice2}`);
  expect(s.calls.filter((c) => c.startsWith("toggleVoice"))).toHaveLength(0);
  expect(h.captureCharFrame()).toContain("llamada de voz");
  await click(h, "🔊 Entrar a voz");
  expect(s.calls).toContain(`toggleVoice:${DEMO.voice2}`);
});
