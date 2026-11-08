import { patchSettingsProto } from "../rest/routes";
import type { RestClient } from "../rest/client";
import { log } from "../log/logger";
import { decodeBase64, encodeStatusPatch, readStatus, readStatusSettings } from "../proto/settings";
import type { OwnStatus } from "../settings/settings";
import type { Store } from "../store/store";
import type { IdlePresence } from "./presence";

export const STATUS_SYNC_NOTICE = "no se pudo sincronizar el estado con tus otros dispositivos";

/**
 * Tras un PATCH propio no se adopta lo que llegue por USER_SETTINGS_PROTO_UPDATE por este tiempo:
 * puede ser el eco de un estado anterior si se eligieron dos seguidos. **[nuestra]**
 */
export const ECHO_GRACE_MS = 5000;

/** `user_settings_proto_type` de PreloadedUserSettings (docs.discord.food, User Settings Proto Type). */
const PRELOADED = 1;

export interface StatusSync {
  /** READY: guarda el StatusSettings de la cuenta y adopta su estado si difiere del local. */
  ready(d: unknown): void;
  /** USER_SETTINGS_PROTO_UPDATE (otro dispositivo, o el eco de nuestro PATCH). */
  update(d: unknown): void;
  /** El usuario eligió un estado: lo escribe en PreloadedUserSettings para los otros dispositivos. */
  push(status: OwnStatus): Promise<void>;
}

/**
 * Estado propio compartido entre dispositivos por `PreloadedUserSettings.status`. El de la cuenta
 * manda: si llega uno distinto del local, se adopta (settings + op 3). Solo se escribe con `push`,
 * que sale de una elección del usuario.
 */
export function createStatusSync(deps: {
  store: Store;
  rest: RestClient;
  presence?: Pick<IdlePresence, "statusChanged">;
  now?: () => number;
}): StatusSync {
  const now = deps.now ?? Date.now;
  let inFlight = 0;
  let lastPushAt = -Infinity;
  /** StatusSettings conocido de la cuenta; null = todavía no sabemos (sin READY o proto ilegible). */
  let known: Uint8Array | null = null;

  function adopt(statusSettings: Uint8Array): void {
    const status = readStatus(statusSettings);
    if (status === null || status === deps.store.getState().settings.status) return;
    deps.store.dispatch({ type: "settings/set", patch: { status } });
    deps.presence?.statusChanged();
  }

  function warn(): void {
    deps.store.dispatch({ type: "notice/push", key: "status-sync", level: "warn", text: STATUS_SYNC_NOTICE });
  }

  return {
    ready(d): void {
      const raw = (d as { user_settings_proto?: unknown } | null)?.user_settings_proto;
      // Sin proto, la doc dice que valen los defaults (StatusSettings vacío).
      if (raw === undefined || raw === null || raw === "") {
        known = new Uint8Array();
        return;
      }
      const bytes = decodeBase64(raw);
      known = bytes === null ? null : readStatusSettings(bytes);
      if (known === null) {
        log.warn("settings-proto.unreadable", { t: "READY" });
        return;
      }
      adopt(known);
    },
    update(d): void {
      const payload = d as { settings?: { type?: unknown; proto?: unknown }; partial?: unknown } | null;
      if (payload?.settings?.type !== PRELOADED) return;
      const bytes = decodeBase64(payload.settings.proto);
      const incoming = bytes === null ? null : readStatusSettings(bytes);
      if (incoming === null) {
        log.warn("settings-proto.unreadable", { t: "USER_SETTINGS_PROTO_UPDATE" });
        return;
      }
      if (payload.partial === true) {
        // Parcial: se mergea con lo cacheado (en protobuf, concatenar es mergear).
        if (incoming.length === 0) return;
        if (known !== null) {
          const merged = new Uint8Array(known.length + incoming.length);
          merged.set(known);
          merged.set(incoming, known.length);
          known = merged;
        } else {
          known = incoming;
        }
      } else {
        known = incoming;
      }
      if (inFlight > 0 || now() - lastPushAt < ECHO_GRACE_MS) return;
      adopt(known);
    },
    async push(status): Promise<void> {
      if (known === null) {
        // Sin el StatusSettings de la cuenta, mandar solo `status` borraría el resto (estado personalizado).
        warn();
        return;
      }
      const patch = encodeStatusPatch(status, known);
      inFlight += 1;
      try {
        const response = await patchSettingsProto(deps.rest, PRELOADED, patch);
        known = readStatusSettings(decodeBase64(patch) ?? new Uint8Array()) ?? known;
        const bytes = decodeBase64(response?.settings);
        const confirmed = bytes === null ? null : readStatusSettings(bytes);
        if (confirmed !== null && confirmed.length > 0) known = confirmed;
      } catch (error) {
        log.warn("settings-proto.patch-failed", { error_name: error instanceof Error ? error.name : "unknown" });
        warn();
      } finally {
        inFlight -= 1;
        lastPushAt = now();
      }
    },
  };
}
