import type { APIAttachment, APIEmbed, APIMessage } from "discord-api-types/v9";

import type { GatewayStatus } from "../gateway/connection";

export type ApiMessage = APIMessage;
export type ApiAttachment = APIAttachment;
export type ApiEmbed = APIEmbed;

export interface UserState {
  id: string;
  username: string;
  globalName: string | null;
  avatar: string | null;
  bot: boolean;
}

export interface RoleState {
  id: string;
  name: string;
  color: number;
  position: number;
  permissions: string;
}

export interface OverwriteState {
  id: string;
  type: number;
  allow: string;
  deny: string;
}

export interface ChannelState {
  id: string;
  guildId: string | null;
  name: string;
  type: number;
  position: number;
  parentId: string | null;
  permissionOverwrites: OverwriteState[];
  lastMessageId: string | null;
}

export interface GuildState {
  id: string;
  name: string;
  icon: string | null;
  ownerId: string;
  roles: RoleState[];
  emojis: { id: string; name: string; animated: boolean }[];
}

export interface MemberState {
  userId: string;
  guildId: string;
  roles: string[];
  nick: string | null;
}

export interface Message {
  id: string;
  channelId: string;
  authorId: string;
  content: string;
  timestamp: string;
  editedTimestamp: string | null;
  attachments: ApiAttachment[];
  embeds: ApiEmbed[];
  mentionIds: string[];
  mentionsMe: boolean;
  referenced: { id: string; authorId: string; content: string } | null;
  reactions: { emoji: { id: string | null; name: string }; count: number; me: boolean }[];
  nonce: string | null;
}

export interface MessageSlice {
  ids: string[];
  byId: Record<string, ApiMessage>;
  hasMoreBefore: boolean;
  loadingOlder: boolean;
  stale: boolean;
}

export interface ReadState {
  lastAckedId: string | null;
  mentionCount: number;
}

export interface PresenceState {
  status: string;
  activities: unknown[];
}

export type Focus = "guilds" | "channels" | "messages" | "members" | "composer";

export interface PendingAttachment {
  filename: string;
  mime: string;
  bytes: Uint8Array;
}

export interface OutboxItem {
  nonce: string;
  channelId: string;
  content: string;
  replyTo: string | null;
  attachments: PendingAttachment[];
  state: "pending" | "sent" | "failed";
  error: string | null;
  createdAt: number;
}

export interface AppState {
  me: { id: string; username: string } | null;
  connection: GatewayStatus;
  guilds: Record<string, GuildState>;
  guildOrder: string[];
  channels: Record<string, ChannelState>;
  privateChannelIds: string[];
  users: Record<string, UserState>;
  members: Record<string, Record<string, MemberState>>;
  messages: Record<string, MessageSlice>;
  readState: Record<string, ReadState>;
  guildSettings: { mutedGuilds: string[]; mutedChannels: string[] };
  presences: Record<string, PresenceState>;
  typing: Record<string, string[]>;
  outbox: Record<string, OutboxItem>;
  ui: {
    selectedGuildId: string | "@dms" | null;
    selectedChannelId: string | null;
    focus: Focus;
    membersVisible: boolean;
  };
}

export type Action =
  | { type: "gw"; t: string; d: any }
  | { type: "connection"; status: GatewayStatus }
  | { type: "messages/page"; channelId: string; messages: ApiMessage[]; mode: "older" | "latest" }
  | { type: "messages/loading"; channelId: string; loading: boolean }
  | { type: "messages/staleAll" }
  | { type: "ui/selectGuild"; id: string | "@dms" }
  | { type: "ui/selectChannel"; id: string }
  | { type: "ui/focus"; focus: Focus }
  | { type: "ui/toggleMembers" }
  | { type: "outbox/enqueue"; item: OutboxItem }
  | { type: "outbox/sent"; nonce: string; messageId: string }
  | { type: "outbox/failed"; nonce: string; error: string }
  | { type: "outbox/retry"; nonce: string };
