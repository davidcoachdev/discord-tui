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

export function buildIdentify(token: Secret, props: ClientProps): IdentifyPayload {
  return {
    op: 2,
    d: {
      token: token.reveal(),
      capabilities: GATEWAY_CAPABILITIES,
      properties: props.superProperties(),
      presence: { status: "online", since: 0, activities: [], afk: false },
      compress: false,
      client_state: { guild_versions: {} },
      qos_token: null,
    },
  };
}
