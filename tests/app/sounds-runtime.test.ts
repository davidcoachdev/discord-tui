import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.XDG_STATE_HOME = mkdtempSync(join(tmpdir(), "discord-tui-sounds-state-"));
process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), "discord-tui-sounds-config-"));

import { createRuntime } from "../../src/app/runtime";
import { createClientProps } from "../../src/client-props/props";
import { Secret } from "../../src/secret";
import type { Cue } from "../../src/sounds/synth";
import { selectMessages } from "../../src/store/selectors";
import { startFakeGateway, type FakeGateway } from "../fakes/fake-gateway";
import { fakeToken } from "../helpers/fake-token";

const readyBase = JSON.parse(readFileSync(join(import.meta.dir, "..", "..", "fixtures", "gateway", "READY-1.json"), "utf8"));
const ME = "100000000000000010";
const GUILD = "100000000000000001";
const TEXT = "100000000000000002";
const VOICE = "100000000000000003";
const OTHER = "100000000000000020";
const THIRD = "100000000000000021";

async function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("timeout");
    await Bun.sleep(5);
  }
}

const immediateTimer = ((fn: () => void) => {
  fn();
  return 0;
}) as unknown as typeof setTimeout;

function setup() {
  let fake: FakeGateway;
  fake = startFakeGateway({ onIdentify: () => fake.dispatch("READY", { ...readyBase.d, resume_gateway_url: fake.url }) });
  const cues: Cue[] = [];
  const notified: string[] = [];
  const runtime = createRuntime({
    session: { token: new Secret(fakeToken()), userId: ME, buildNumber: 663810 },
    me: { id: ME, username: "user1" },
    props: createClientProps({ buildNumber: 663810 }),
    url: fake.url,
    fetch: (async () => Response.json([])) as unknown as typeof fetch,
    setTimer: immediateTimer,
    random: () => 0.5,
    sounds: { play: (cue) => void cues.push(cue) },
    notify: (title) => void notified.push(title),
  });
  return { fake: fake!, runtime, cues, notified };
}

let seq = 0;
function vsu(fake: FakeGateway, userId: string, channelId: string | null) {
  seq += 1;
  fake.dispatch("VOICE_STATE_UPDATE", { guild_id: GUILD, user_id: userId, channel_id: channelId, session_id: `s${seq}` });
}

test("VOICE_STATE_UPDATE in my channel → userJoin/userLeave; never for me, other channels or the READY_SUPPLEMENTAL load", async () => {
  const { fake, runtime, cues } = setup();
  try {
    runtime.start();
    await waitFor(() => runtime.store.getState().connection === "ready");
    runtime.store.dispatch({ type: "voice/joining", guildId: GUILD, channelId: VOICE });
    runtime.store.dispatch({ type: "voice/status", status: "connected" });
    expect(cues).toEqual(["join"]);

    // La carga inicial trae gente que ya estaba en el canal: no suena.
    fake.dispatch("READY_SUPPLEMENTAL", {
      guilds: [{ id: GUILD, voice_states: [{ user_id: OTHER, channel_id: VOICE }] }],
      merged_members: [],
    });
    await waitFor(() => runtime.store.getState().voice.states[GUILD]?.[OTHER] !== undefined);

    vsu(fake, ME, VOICE);
    vsu(fake, THIRD, "100000000000000099");
    vsu(fake, THIRD, VOICE);
    await waitFor(() => runtime.store.getState().voice.states[GUILD]?.[THIRD]?.channelId === VOICE);
    vsu(fake, OTHER, null);
    await waitFor(() => runtime.store.getState().voice.states[GUILD]?.[OTHER] === undefined);
    expect(cues).toEqual(["join", "userJoin", "userLeave"]);
  } finally {
    await runtime.stop();
    fake.stop();
  }
});

test("a mention plays `message` only when you are not looking at that channel (same rule as the notification)", async () => {
  const { fake, runtime, cues, notified } = setup();
  const mention = (id: string) => ({
    id,
    channel_id: TEXT,
    guild_id: GUILD,
    author: { id: OTHER, username: "otro" },
    content: `hola <@${ME}>`,
    timestamp: "2026-11-06T12:00:00.000000+00:00",
    edited_timestamp: null,
    attachments: [],
    embeds: [],
    mentions: [{ id: ME, username: "user1" }],
    mention_everyone: false,
    referenced_message: null,
    reactions: [],
  });
  try {
    runtime.start();
    await waitFor(() => runtime.store.getState().connection === "ready");
    runtime.store.dispatch({ type: "ui/selectChannel", id: TEXT });
    fake.dispatch("MESSAGE_CREATE", mention("100000000000000500"));
    await waitFor(() => selectMessages(runtime.store.getState(), TEXT).length === 1);
    expect(cues).toEqual([]);

    runtime.store.dispatch({ type: "ui/selectChannel", id: VOICE });
    fake.dispatch("MESSAGE_CREATE", mention("100000000000000501"));
    await waitFor(() => selectMessages(runtime.store.getState(), TEXT).length === 2);
    expect(cues).toEqual(["message"]);
    expect(notified).toHaveLength(1);
  } finally {
    await runtime.stop();
    fake.stop();
  }
});
