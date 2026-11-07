import type { DiscordGatewayAdapterCreator, DiscordGatewayAdapterLibraryMethods } from "@discordjs/voice";

import type { Gateway } from "../gateway/connection";

export interface Op4Data {
  guild_id: string;
  channel_id: string | null;
  self_mute: boolean;
  self_deaf: boolean;
}

/** Op 4 con la forma que manda el cliente oficial (fixtures/browser/op4-join.json). */
export function toOfficialOp4(d: Op4Data): Record<string, unknown> {
  return {
    guild_id: d.guild_id,
    channel_id: d.channel_id,
    self_mute: d.self_mute,
    self_deaf: d.self_deaf,
  };
}

export interface AdapterGateway {
  send: Gateway["send"];
  readonly status: Gateway["status"];
  on(ev: "dispatch", fn: (t: string, d: any) => void): () => void;
}

/**
 * Ata `@discordjs/voice` a nuestro gateway: el op 4 sale por nuestro WS y los
 * VOICE_STATE_UPDATE (solo los propios) y VOICE_SERVER_UPDATE del guild vuelven a la librería.
 */
export function createVoiceAdapterCreator(deps: {
  gateway: AdapterGateway;
  meId: () => string | null;
}): (guildId: string) => DiscordGatewayAdapterCreator {
  return (guildId: string) =>
    (methods: DiscordGatewayAdapterLibraryMethods) => {
      const off = deps.gateway.on("dispatch", (t: string, d: any) => {
        if (!d || typeof d !== "object" || d.guild_id !== guildId) return;
        if (t === "VOICE_STATE_UPDATE") {
          if (d.user_id !== deps.meId()) return;
          methods.onVoiceStateUpdate(d);
        } else if (t === "VOICE_SERVER_UPDATE") {
          methods.onVoiceServerUpdate(d);
        }
      });
      return {
        sendPayload(payload: any): boolean {
          if (deps.gateway.status !== "ready") return false;
          const d = payload?.d ?? {};
          deps.gateway.send(
            4,
            toOfficialOp4({
              guild_id: String(d.guild_id ?? guildId),
              channel_id: d.channel_id ?? null,
              self_mute: d.self_mute === true,
              self_deaf: d.self_deaf === true,
            }),
          );
          return true;
        },
        destroy(): void {
          off();
        },
      };
    };
}
