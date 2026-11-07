import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createVoiceAdapterCreator, toOfficialOp4 } from "../../src/voice/adapter";
import { sanitizeVoiceDebug } from "../../src/voice/debug";
import { closeCodeMessage } from "../../src/voice/close-codes";
import { shapeOf } from "../helpers/shape";

const capturedOp4 = JSON.parse(readFileSync(join(import.meta.dir, "..", "..", "fixtures", "browser", "op4-join.json"), "utf8"));
const GUILD = "100000000000000001";
const ME = "100000000000000010";

function fakeGateway(status: "ready" | "connecting" = "ready") {
  const listeners = new Set<(t: string, d: any) => void>();
  const sent: { op: number; d: any }[] = [];
  return {
    sent,
    status,
    emit: (t: string, d: any) => listeners.forEach((fn) => fn(t, d)),
    on: (_ev: "dispatch", fn: (t: string, d: any) => void) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    send: (op: number, d: any) => {
      sent.push({ op, d });
    },
  };
}

test("op 4 through the adapter has the captured shape and explicit flags", () => {
  const gateway = fakeGateway();
  const adapter = createVoiceAdapterCreator({ gateway, meId: () => ME })(GUILD)({
    onVoiceServerUpdate: () => {},
    onVoiceStateUpdate: () => {},
    destroy: () => {},
  });
  expect(adapter.sendPayload({ op: 4, d: { guild_id: GUILD, channel_id: "3", self_mute: false, self_deaf: false } })).toBe(true);
  expect(shapeOf({ op: gateway.sent[0]!.op, d: gateway.sent[0]!.d })).toEqual(shapeOf(capturedOp4));
  expect(gateway.sent[0]!.d).toMatchObject({ self_mute: false, self_deaf: false });
  expect(toOfficialOp4({ guild_id: GUILD, channel_id: null, self_mute: true, self_deaf: true }).channel_id).toBeNull();
});

test("sendPayload returns false while the gateway is not ready", () => {
  const gateway = fakeGateway("connecting");
  const adapter = createVoiceAdapterCreator({ gateway, meId: () => ME })(GUILD)({
    onVoiceServerUpdate: () => {},
    onVoiceStateUpdate: () => {},
    destroy: () => {},
  });
  expect(adapter.sendPayload({ op: 4, d: { guild_id: GUILD, channel_id: "3" } })).toBe(false);
  expect(gateway.sent).toHaveLength(0);
});

test("only own VOICE_STATE_UPDATE and VOICE_SERVER_UPDATE of that guild reach the library; destroy unsubscribes", () => {
  const gateway = fakeGateway();
  const states: any[] = [];
  const servers: any[] = [];
  const adapter = createVoiceAdapterCreator({ gateway, meId: () => ME })(GUILD)({
    onVoiceServerUpdate: (d) => servers.push(d),
    onVoiceStateUpdate: (d) => states.push(d),
    destroy: () => {},
  });
  gateway.emit("VOICE_STATE_UPDATE", { guild_id: GUILD, user_id: "other", channel_id: "3" });
  gateway.emit("VOICE_STATE_UPDATE", { guild_id: "otro-guild", user_id: ME, channel_id: "3" });
  gateway.emit("VOICE_STATE_UPDATE", { guild_id: GUILD, user_id: ME, channel_id: "3", session_id: "s" });
  gateway.emit("VOICE_SERVER_UPDATE", { guild_id: GUILD, endpoint: "x", token: "y" });
  gateway.emit("VOICE_SERVER_UPDATE", { guild_id: "otro-guild", endpoint: "x", token: "y" });
  expect(states).toHaveLength(1);
  expect(servers).toHaveLength(1);
  adapter.destroy();
  gateway.emit("VOICE_SERVER_UPDATE", { guild_id: GUILD, endpoint: "x", token: "y" });
  expect(servers).toHaveLength(1);
});

test("sanitizeVoiceDebug drops payloads and tokens", () => {
  expect(sanitizeVoiceDebug('[WS] >> {"op":0,"d":{"token":"abc"}}')).toBeNull();
  expect(sanitizeVoiceDebug("[NW] [WS] token abc")).toBeNull();
  expect(sanitizeVoiceDebug("state change:\nfrom signalling\nto connecting")).not.toBeNull();
  expect(sanitizeVoiceDebug("[WS] closed with close code 4017")).not.toBeNull();
  expect(sanitizeVoiceDebug("algo cualquiera")).toBeNull();
});

test("close codes in spanish", () => {
  expect(closeCodeMessage(4014)).toBe("te desconectaron del canal");
  expect(closeCodeMessage(4017)).toBe("Discord exige cifrado E2EE (DAVE) y no se pudo negociar");
  expect(closeCodeMessage(4006)).toBe("la sesión de voz ya no es válida");
  expect(closeCodeMessage(4999)).toBe("se cortó la voz (código 4999)");
});
