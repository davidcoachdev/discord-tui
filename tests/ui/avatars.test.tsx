import { afterAll, beforeAll, expect, test } from "bun:test";
import { ImageRenderable, type Renderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { join } from "node:path";

import { buildDemoStore, demoActions, DEMO } from "../../scripts/demo-state";
import { createAvatarLoader, decodeAvatar } from "../../src/images/avatar";
import { selectMessages } from "../../src/store/selectors";
import { App } from "../../src/ui/App";
import { Avatar, avatarInitial } from "../../src/ui/components/Avatar";
import { MentionPopup } from "../../src/ui/components/Composer";
import { MessageItem } from "../../src/ui/components/MessageItem";
import { THEMES } from "../../src/ui/theme";

// Sin red: los avatares salen de globalThis.fetch, que acá devuelve el PNG local y anota la URL.
const PNG = new Uint8Array(await Bun.file(join(import.meta.dir, "..", "fixtures", "images", "sample.png")).arrayBuffer());
const requests: string[] = [];
const realFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = (async (input: string | URL | Request) => {
    requests.push(String(input));
    return new Response(PNG, { status: 200 });
  }) as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

function images(node: Renderable): ImageRenderable[] {
  const own = node instanceof ImageRenderable ? [node] : [];
  return [...own, ...node.getChildren().flatMap((child) => images(child as Renderable))];
}

async function settle(r: { renderOnce(): Promise<void> }, ms = 150): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    await r.renderOnce();
    await Bun.sleep(10);
  }
  await r.renderOnce();
}

let seq = 0;
const hash = (): string => `${(++seq).toString(16).padStart(8, "0")}${"ab".repeat(12)}`;

test("initial: one letter plus a space, or a wide grapheme, always 2 cells", () => {
  expect(avatarInitial("gon")).toBe("G ");
  expect(avatarInitial("  ñandú")).toBe("Ñ ");
  expect(avatarInitial("💜 cin")).toBe("💜");
  expect(avatarInitial("")).toBe("? ");
});

test("without a URL (images off) the avatar is the initial on a name color, no image", async () => {
  const r = await testRender(
    () => (
      <box flexDirection="row">
        <Avatar userId="900000000000000101" name="ramiro" url={null} theme={THEMES.dark} />
        <text>|</text>
      </box>
    ),
    { width: 20, height: 3 },
  );
  await r.renderOnce();
  expect(r.captureCharFrame().split("\n")[0]).toStartWith("R |");
  expect(images(r.renderer.root)).toHaveLength(0);
});

test("with a URL the image replaces the initial in the same 2 cells (no layout jump)", async () => {
  const fetched: string[] = [];
  const loader = createAvatarLoader({ fetchBytes: async (u) => (fetched.push(u), PNG), decode: (b) => decodeAvatar(b) });
  const url = `https://cdn.discordapp.com/avatars/900000000000000101/${hash()}.png?size=32`;
  const r = await testRender(
    () => (
      <box flexDirection="row">
        <Avatar userId="900000000000000101" name="ramiro" url={url} theme={THEMES.dark} loader={loader} />
        <text>|after</text>
      </box>
    ),
    { width: 20, height: 3 },
  );
  await r.renderOnce();
  const before = r.captureCharFrame().split("\n")[0]!.indexOf("|after");
  await settle(r);
  expect(fetched).toEqual([url]);
  const found = images(r.renderer.root);
  expect(found).toHaveLength(1);
  expect(found[0]!.width).toBe(2);
  expect(found[0]!.height).toBe(1);
  expect(r.captureCharFrame().split("\n")[0]!.indexOf("|after")).toBe(before);
});

test("message header: avatar before the author on non-grouped messages only, hidden with avatars off", async () => {
  const state = buildDemoStore().getState();
  const message = selectMessages(state, DEMO.general).find((m) => m.authorId === "900000000000000101")!;
  const frame = async (grouped: boolean, avatars: boolean): Promise<string> => {
    const r = await testRender(
      () => <MessageItem message={message} state={state} theme={THEMES.dark} guildId={DEMO.guild} grouped={grouped} avatars={avatars} />,
      { width: 60, height: 6 },
    );
    await r.renderOnce();
    return r.captureCharFrame();
  };
  expect(await frame(false, true)).toMatch(/R {2}Ramiro {2}\d\d:\d\d/);
  expect(await frame(false, false)).toMatch(/^ Ramiro {2}\d\d:\d\d/m);
  const grouped = await frame(true, true);
  expect(grouped).not.toContain("Ramiro");
  expect(grouped).not.toMatch(/^ R {2}/m);
});

function app(opts: { images?: boolean; showAvatars?: boolean; width?: number } = {}) {
  const store = buildDemoStore();
  if (opts.showAvatars === false) store.dispatch({ type: "settings/set", patch: { showAvatars: false } });
  const actions = demoActions(store);
  return { store, actions, render: () => testRender(() => <App store={store} actions={actions} onQuit={() => {}} images={opts.images} />, { width: opts.width ?? 160, height: 45 }) };
}

test("member list, voice participants and DM rows show the avatar after the presence/speaking dot", async () => {
  const s = app();
  const r = await s.render();
  await r.renderOnce();
  const frame = r.captureCharFrame();
  expect(frame).toContain("│ ● G  Gon");
  expect(frame).toContain("○ B  bruno_7712");
  expect(frame).toMatch(/○ R {2}Ramiro +📺/);
  expect(frame).toMatch(/○ P {2}Pepa +🙉/);
  s.store.dispatch({ type: "ui/selectGuild", id: "@dms" });
  await r.renderOnce();
  expect(r.captureCharFrame()).toMatch(/[●○] C {2}Celes💜/);
});

test("showAvatars=false hides them everywhere and the old layout comes back", async () => {
  const s = app({ showAvatars: false });
  const r = await s.render();
  await r.renderOnce();
  const frame = r.captureCharFrame();
  expect(frame).toContain("│ ● Gon");
  expect(frame).toMatch(/○ Ramiro +📺/);
  expect(frame).not.toMatch(/R {2}Ramiro/);
  s.store.dispatch({ type: "ui/selectGuild", id: "@dms" });
  await r.renderOnce();
  expect(r.captureCharFrame()).toMatch(/[●○] Celes💜/);
});

test("long names are cut with … instead of wrapping (participant, member and DM rows)", async () => {
  const s = app();
  const long = "Ramirosson Lothbrok el Vikingo del Norte";
  s.store.dispatch({ type: "gw", t: "GUILD_MEMBER_UPDATE", d: { guild_id: DEMO.guild, user: { id: "900000000000000101", username: "ramiro", global_name: long }, roles: [], nick: long } });
  const r = await s.render();
  await r.renderOnce();
  const lines = r.captureCharFrame().split("\n");
  const voiceRow = lines.find((l) => l.includes("○ R  Ramirosson"))!;
  expect(voiceRow).toContain("…");
  expect(voiceRow).toContain("📺");
  expect(lines.find((l) => l.includes("● R  Ramirosson"))).toContain("…");
  // Los encabezados de los mensajes sí muestran el nombre entero; las columnas angostas no.
  const sides = lines.map((l) => [...l].slice(0, 56).join("") + [...l].slice(-26).join(""));
  expect(sides.some((l) => l.includes("Norte") || l.includes("Vikingo"))).toBe(false);

  s.store.dispatch({ type: "gw", t: "GUILD_MEMBER_UPDATE", d: { guild_id: DEMO.guild, user: { id: "900000000000000102", username: "celes", global_name: long }, roles: [] } });
  s.store.dispatch({ type: "ui/selectGuild", id: "@dms" });
  await r.renderOnce();
  const dm = r.captureCharFrame().split("\n").find((l) => /[●○] R {2}Ramirosson/.test(l))!;
  expect(dm).toContain("…");
  expect(dm).not.toContain("Vikingo");
});

test("images on: only avatars on screen are fetched, through the CDN, and become images", async () => {
  const s = app({ images: true });
  const tag = hash().slice(0, 8);
  const items = Array.from({ length: 120 }, (_, i) =>
    i === 0
      ? { group: { id: "online", count: 119 } }
      : { member: { user: { id: `98${String(i).padStart(16, "0")}`, username: `p${i}`, avatar: `${tag}${String(i).padStart(24, "0")}` }, roles: [], presence: { status: "online" } } },
  );
  s.store.dispatch({ type: "gw", t: "GUILD_MEMBER_LIST_UPDATE", d: { guild_id: DEMO.guild, id: "everyone", member_count: 119, online_count: 119, ops: [{ op: "SYNC", range: [0, 119], items }] } });
  const start = requests.length;
  const r = await s.render();
  await settle(r, 400);
  const mine = requests.slice(start).filter((u) => u.includes(`/${tag}`));
  expect(mine.length).toBeGreaterThan(10);
  expect(mine.length).toBeLessThan(50);
  expect(mine.every((u) => u.startsWith("https://cdn.discordapp.com/avatars/98") && u.endsWith(".png?size=32"))).toBe(true);
  expect(images(r.renderer.root).length).toBeGreaterThan(10);
});

test("mention popup: avatar before each candidate when avatars are on", async () => {
  const candidates = [{ userId: "900000000000000101", label: "Ramiro", secondary: "ramiro" }];
  const r = await testRender(() => <MentionPopup candidates={candidates} index={0} theme={THEMES.dark} avatar={() => null} />, { width: 50, height: 4 });
  await r.renderOnce();
  expect(r.captureCharFrame()).toContain("│ R  Ramiro  ramiro");
  const plain = await testRender(() => <MentionPopup candidates={candidates} index={0} theme={THEMES.dark} />, { width: 50, height: 4 });
  await plain.renderOnce();
  expect(plain.captureCharFrame()).toContain("│ Ramiro  ramiro");
});
