import { afterEach, expect, test } from "bun:test";

import { createVoiceAdapterCreator } from "../../src/voice/adapter";
import { SILENCE_FRAME } from "../../src/voice/constants";
import { createDjsVoiceSession, type VoiceSession } from "../../src/voice/session";
import { startFakeVoiceServer, type FakeVoiceServer } from "../fakes/fake-voice-server";

// El WS de voz va por wss:// (lo arma @discordjs/voice); el server falso usa un cert propio.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const GUILD = "100000000000000001";
const CHANNEL = "100000000000000003";
const ME = "100000000000000010";

function fakeMainGateway(server: FakeVoiceServer) {
  const listeners = new Set<(t: string, d: any) => void>();
  const sent: { op: number; d: any }[] = [];
  return {
    sent,
    status: "ready" as const,
    on(_ev: "dispatch", fn: (t: string, d: any) => void): () => void {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    send(op: number, d: any) {
      sent.push({ op, d });
      if (op !== 4) return;
      queueMicrotask(() => {
        for (const fn of [...listeners]) {
          fn("VOICE_STATE_UPDATE", { guild_id: GUILD, channel_id: d.channel_id, user_id: ME, session_id: "fake-session", self_mute: d.self_mute, self_deaf: d.self_deaf });
          if (d.channel_id !== null) {
            fn("VOICE_SERVER_UPDATE", { guild_id: GUILD, endpoint: server.endpoint, token: "fake-voice" });
          }
        }
      });
    },
  };
}

let server: FakeVoiceServer | null = null;
let session: VoiceSession | null = null;

afterEach(async () => {
  await session?.leave();
  session = null;
  server?.stop();
  server = null;
});

async function until(check: () => boolean, ms = 5_000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error("timeout");
    await Bun.sleep(10);
  }
}

test("@discordjs/voice in Bun: join through our adapter, send opus, receive opus, leave", async () => {
  server = await startFakeVoiceServer();
  const gateway = fakeMainGateway(server);
  session = createDjsVoiceSession({
    adapterCreator: createVoiceAdapterCreator({ gateway, meId: () => ME }),
    meId: () => ME,
  });
  const statuses: string[] = [];
  session.onStatus((s) => statuses.push(s));
  const heard: { userId: string; opus: Uint8Array }[] = [];
  session.onOpus((userId, opus) => heard.push({ userId, opus }));

  await session.join(GUILD, CHANNEL, { selfMute: false, selfDeaf: false });
  expect(statuses).toContain("connected");

  // op 4 por nuestro gateway con la forma oficial
  expect(gateway.sent[0]).toEqual({ op: 4, d: { guild_id: GUILD, channel_id: CHANNEL, self_mute: false, self_deaf: false } });
  // identify de voz con DAVE habilitado (si falta, Discord cierra con 4017)
  expect(server.identify.max_dave_protocol_version).toBeGreaterThanOrEqual(1);
  expect(server.selectProtocol.data.mode).toBe("aead_aes256_gcm_rtpsize");

  const frame = Uint8Array.of(0xfc, 0x01, 0x02, 0x03, 0x04);
  for (let i = 0; i < 3; i += 1) session.sendOpus(frame);
  session.sendOpus(SILENCE_FRAME);
  session.setSpeaking(false);
  await until(() => server!.received.length >= 4);
  expect([...server.received[0]!]).toEqual([...frame]);
  expect(server.speaking.map((s) => s.speaking)).toEqual([1, 0]);

  // audio de otra persona → onOpus con su user id
  for (let i = 0; i < 3; i += 1) server.sendAudioFrom("100000000000000011", 999, Uint8Array.of(0xfc, 9, 9, i));
  await until(() => heard.length >= 2);
  expect(heard[0]!.userId).toBe("100000000000000011");

  await session.leave();
  expect(gateway.sent.at(-1)).toEqual({ op: 4, d: { guild_id: GUILD, channel_id: null, self_mute: false, self_deaf: false } });
  expect(statuses.at(-1)).toBe("idle");
}, 15_000);

test("mute/deaf changes go out as a new op 4", async () => {
  server = await startFakeVoiceServer();
  const gateway = fakeMainGateway(server);
  session = createDjsVoiceSession({ adapterCreator: createVoiceAdapterCreator({ gateway, meId: () => ME }), meId: () => ME });
  await session.join(GUILD, CHANNEL, { selfMute: false, selfDeaf: false });
  session.setFlags({ selfMute: true, selfDeaf: true });
  expect(gateway.sent.at(-1)).toEqual({ op: 4, d: { guild_id: GUILD, channel_id: CHANNEL, self_mute: true, self_deaf: true } });
}, 15_000);

test("server closing with 4017 ends in error with the spanish message and no rejoin loop", async () => {
  server = await startFakeVoiceServer();
  const gateway = fakeMainGateway(server);
  session = createDjsVoiceSession({ adapterCreator: createVoiceAdapterCreator({ gateway, meId: () => ME }), meId: () => ME });
  const events: [string, string | undefined][] = [];
  session.onStatus((s, e) => events.push([s, e]));
  await session.join(GUILD, CHANNEL, { selfMute: false, selfDeaf: false });
  server.close(4017);
  await until(() => events.some(([s]) => s === "error"));
  expect(events.find(([s]) => s === "error")![1]).toBe("Discord exige cifrado E2EE (DAVE) y no se pudo negociar");
  await Bun.sleep(300);
  const joins = gateway.sent.filter((p) => p.d.channel_id !== null).length;
  expect(joins).toBeLessThanOrEqual(2);
  expect(gateway.sent.at(-1)!.d.channel_id).toBeNull();
}, 15_000);
