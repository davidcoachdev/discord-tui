import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";

import type { Actions } from "../../src/actions";
import { App } from "../../src/ui/App";
import { buildDemoStore, demoActions, DEMO } from "../../scripts/demo-state";
import { DEMO_POLL_ID } from "../../scripts/demo/polls";

function setup() {
  const store = buildDemoStore();
  const votes: string[] = [];
  const actions: Actions = {
    ...demoActions(store),
    votePoll: async (channelId, messageId, answerId) => void votes.push(`${channelId}:${messageId}:${answerId}`),
  };
  return { store, actions, votes };
}

async function render(s: ReturnType<typeof setup>) {
  // Alto de sobra para que entre todo #general, encuesta incluida.
  const h = await testRender(() => <App store={s.store} actions={s.actions} onQuit={() => {}} />, { width: 160, height: 80 });
  await h.renderOnce();
  return h;
}

function at(frame: string, text: string): { x: number; y: number } {
  const lines = frame.split("\n");
  const y = lines.findIndex((line) => line.includes(text));
  if (y === -1) throw new Error(`no encontré "${text}" en pantalla`);
  const line = lines[y]!;
  return { x: Bun.stringWidth(line.slice(0, line.indexOf(text))) + 1, y };
}

const frameLines = (frame: string): string[] => frame.split("\n");

test("a poll renders the question, a bar, count and % per answer, my vote and the footer", async () => {
  const h = await render(setup());
  const frame = h.captureCharFrame();
  expect(frame).toContain("📊 ¿Qué jugamos el viernes?");
  const row = (text: string) => frameLines(frame).find((line) => line.includes(text))!;
  expect(row("Mu Online")).toMatch(/5\s+56% ███████░░░░░/);
  expect(row("Ajedrez")).toMatch(/✓ ♟️ Ajedrez\s+3\s+33% ████░░░░░░░░/);
  expect(row("Nada, a programar")).toMatch(/1\s+11% █░░░░░░░░░░░/);
  expect(frame).toContain("9 votos · termina en 5 h");
});

test("a poll or sticker without text does not leave an empty line under the author", async () => {
  const h = await render(setup());
  const lines = frameLines(h.captureCharFrame());
  const header = lines.findIndex((line) => /dfuentes {2}\d\d:\d\d/.test(line));
  expect(lines[header + 1]).toContain("╭─");
  const sticker = lines.findIndex((line) => /Celes💜 {2}\d\d:\d\d/.test(line));
  expect(lines[sticker + 1]).toContain("🏷 Wumpus saluda");
});

test("clicking an answer votes for it; 1-9 on the selected poll votes too", async () => {
  const s = setup();
  const h = await render(s);
  const { x, y } = at(h.captureCharFrame(), "Mu Online");
  await h.mockMouse.click(x, y);
  await h.renderOnce();
  expect(s.votes).toEqual([`${DEMO.general}:${DEMO_POLL_ID}:1`]);

  // El click en la respuesta no selecciona el mensaje; se lo selecciona con click en el autor.
  const author = at(h.captureCharFrame(), "¿Qué jugamos");
  await h.mockMouse.click(author.x, author.y);
  await h.renderOnce();
  h.mockInput.pressKey("3");
  await h.renderOnce();
  expect(s.votes).toEqual([`${DEMO.general}:${DEMO_POLL_ID}:1`, `${DEMO.general}:${DEMO_POLL_ID}:3`]);
});

test("a finished poll shows terminada and clicking an answer does nothing", async () => {
  const s = setup();
  s.store.dispatch({
    type: "gw",
    t: "MESSAGE_UPDATE",
    d: {
      id: DEMO_POLL_ID,
      channel_id: DEMO.general,
      poll: {
        ...(s.store.getState().messages[DEMO.general]!.byId[DEMO_POLL_ID] as any).poll,
        results: { is_finalized: true, answer_counts: [{ id: 1, count: 6, me_voted: false }] },
      },
    },
  });
  const h = await render(s);
  expect(h.captureCharFrame()).toContain("6 votos · terminada");
  const { x, y } = at(h.captureCharFrame(), "Mu Online");
  await h.mockMouse.click(x, y);
  await h.renderOnce();
  expect(s.votes).toEqual([]);
});

test("a live vote event updates the bars", async () => {
  const s = setup();
  const h = await render(s);
  s.store.dispatch({
    type: "gw",
    t: "MESSAGE_POLL_VOTE_ADD",
    d: { user_id: DEMO.me, channel_id: DEMO.general, message_id: DEMO_POLL_ID, answer_id: 3 },
  });
  await h.renderOnce();
  const row = frameLines(h.captureCharFrame()).find((line) => line.includes("Nada, a programar"))!;
  expect(row).toMatch(/✓ Nada, a programar\s+2\s+20%/);
  expect(h.captureCharFrame()).toContain("10 votos");
});
