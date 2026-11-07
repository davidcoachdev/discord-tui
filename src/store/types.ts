import type { APIAttachment, APIEmbed, APIMessage } from "discord-api-types/v9";

import type { GatewayStatus } from "../gateway/connection";
import type { Settings } from "../settings/settings";

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

export interface Notice {
  id: string;
  key: string;
  level: "info" | "warn" | "error";
  text: string;
  count: number;
  at: number;
}

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

export type MemberListRow = { kind: "group"; id: string; count: number } | { kind: "member"; userId: string };

export type VoiceStatus = "idle" | "joining" | "connected" | "reconnecting" | "error";

export interface VoiceMemberState {
  channelId: string;
  mute: boolean;
  deaf: boolean;
  selfMute: boolean;
  selfDeaf: boolean;
  selfVideo: boolean;
  selfStream: boolean;
}

export interface VoiceSlice {
  guildId: string | null;
  channelId: string | null;
  status: VoiceStatus;
  error: string | null;
  selfMute: boolean;
  selfDeaf: boolean;
  muteBeforeDeaf: boolean;
  selfSpeaking: boolean;
  speaking: Record<string, true>;
  /** guildId → userId → estado de voz (quién está en cada canal). */
  states: Record<string, Record<string, VoiceMemberState>>;
  privacyCode: string | null;
  pttWarning: string | null;
  micError: string | null;
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
  /** channelId → userId → vence (ms epoch). */
  typing: Record<string, Record<string, number>>;
  /** Lista de miembros por guild, como la manda GUILD_MEMBER_LIST_UPDATE (grupos y miembros en orden). */
  memberLists: Record<string, MemberListRow[]>;
  /** Último canal para el que se mandó op 37, por guild. */
  subscribedChannels: Record<string, string>;
  voice: VoiceSlice;
  outbox: Record<string, OutboxItem>;
  ui: {
    selectedGuildId: string | "@dms" | null;
    selectedChannelId: string | null;
    focus: Focus;
    membersVisible: boolean;
  };
  settings: Settings;
  notices: Record<string, Notice>;
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
  | { type: "outbox/retry"; nonce: string }
  | { type: "settings/set"; patch: Partial<Settings> }
  | { type: "settings/loaded"; settings: Settings }
  | { type: "notice/push"; key: string; level: Notice["level"]; text: string }
  | { type: "notice/dismiss"; id: string }
  | { type: "notice/sweep"; now: number }
  | { type: "typing/sweep"; now: number }
  | { type: "members/subscribed"; guildId: string; channelId: string }
  | { type: "voice/joining"; guildId: string; channelId: string }
  | { type: "voice/status"; status: VoiceStatus; error?: string | null }
  | { type: "voice/left"; error?: string | null }
  | { type: "voice/moved"; channelId: string }
  | { type: "voice/flags"; selfMute: boolean; selfDeaf: boolean; muteBeforeDeaf: boolean }
  | { type: "voice/selfSpeaking"; on: boolean }
  | { type: "voice/speaking"; userId: string; on: boolean }
  | { type: "voice/privacyCode"; code: string | null }
  | { type: "voice/pttWarning"; warning: string | null }
  | { type: "voice/micError"; error: string | null };
