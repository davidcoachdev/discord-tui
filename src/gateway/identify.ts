import type { ClientProps, SuperProperties } from "../client-props/props";
import type { Secret } from "../secret";

export const GATEWAY_CAPABILITIES = 1734653;

export interface IdentifyPayload {
  op: 2;
  d: {
    token: string;
    capabilities: number;
    properties: SuperProperties;
    presence: { status: string; since: number; activities: unknown[]; afk: boolean };
    compress: false;
    client_state: { guild_versions: Record<string, unknown> };
    qos_token: null;
  };
}

export type IdentifyPresence = IdentifyPayload["d"]["presence"];

const DEFAULT_PRESENCE: IdentifyPresence = { status: "online", since: 0, activities: [], afk: false };

/** `presence` es el estado propio elegido (también al re-identificar después de una reconexión). */
export function buildIdentify(token: Secret, props: ClientProps, presence: IdentifyPresence = DEFAULT_PRESENCE): IdentifyPayload {
  return {
    op: 2,
    d: {
      token: token.reveal(),
      capabilities: GATEWAY_CAPABILITIES,
      properties: props.superProperties(),
      presence: { status: presence.status, since: presence.since, activities: [...presence.activities], afk: presence.afk },
      compress: false,
      client_state: { guild_versions: {} },
      qos_token: null,
    },
  };
}
