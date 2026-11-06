import type { AppState, ChannelState, MemberState, OverwriteState, RoleState, UserState } from "../types";

function toUser(raw: any): UserState {
  return {
    id: raw.id,
    username: raw.username ?? raw.id,
    globalName: raw.global_name ?? null,
    avatar: raw.avatar ?? null,
    bot: raw.bot === true,
  };
}

function toRole(raw: any): RoleState {
  return {
    id: raw.id,
    name: raw.name ?? raw.id,
    color: typeof raw.color === "number" ? raw.color : 0,
    position: typeof raw.position === "number" ? raw.position : 0,
    permissions: typeof raw.permissions === "string" ? raw.permissions : "0",
  };
}

function toOverwrite(raw: any): OverwriteState {
  return {
    id: raw.id,
    type: typeof raw.type === "number" ? raw.type : 0,
    allow: typeof raw.allow === "string" ? raw.allow : "0",
    deny: typeof raw.deny === "string" ? raw.deny : "0",
  };
}

function toChannel(raw: any, guildId: string | null): ChannelState {
  return {
    id: raw.id,
    guildId,
    name: raw.name ?? raw.id,
    type: typeof raw.type === "number" ? raw.type : 0,
    position: typeof raw.position === "number" ? raw.position : 0,
    parentId: raw.parent_id ?? null,
    permissionOverwrites: Array.isArray(raw.permission_overwrites) ? raw.permission_overwrites.map(toOverwrite) : [],
    lastMessageId: raw.last_message_id ?? null,
  };
}

export function applyReady(state: AppState, d: any): AppState {
  const users: Record<string, UserState> = { ...state.users };
  const rememberUser = (raw: any): UserState | null => {
    if (!raw || typeof raw.id !== "string") return null;
    const user = toUser(raw);
    users[user.id] = user;
    return user;
  };

  for (const raw of d.users ?? []) rememberUser(raw);

  const guilds = { ...state.guilds };
  const guildOrder: string[] = [];
  const channels = { ...state.channels };
  const members = { ...state.members };
  const presences = { ...state.presences };

  for (const rawGuild of d.guilds ?? []) {
    guildOrder.push(rawGuild.id);
    guilds[rawGuild.id] = {
      id: rawGuild.id,
      name: rawGuild.name ?? rawGuild.id,
      icon: rawGuild.icon ?? null,
      ownerId: rawGuild.owner_id ?? "",
      roles: (rawGuild.roles ?? []).map(toRole),
      emojis: (rawGuild.emojis ?? []).map((emoji: any) => ({
        id: emoji.id ?? "",
        name: emoji.name ?? "",
        animated: emoji.animated === true,
      })),
    };

    const guildMembers: Record<string, MemberState> = {};
    for (const rawMember of rawGuild.members ?? []) {
      guildMembers[rawMember.user_id] = {
        userId: rawMember.user_id,
        guildId: rawGuild.id,
        roles: Array.isArray(rawMember.roles) ? rawMember.roles : [],
        nick: rawMember.nick ?? null,
      };
      if (rawMember.user) rememberUser(rawMember.user);
    }
    members[rawGuild.id] = guildMembers;

    for (const rawPresence of rawGuild.presences ?? []) {
      presences[rawPresence.user_id] = {
        status: rawPresence.status ?? "offline",
        activities: Array.isArray(rawPresence.activities) ? rawPresence.activities : [],
      };
    }

    for (const rawChannel of rawGuild.channels ?? []) {
      channels[rawChannel.id] = toChannel(rawChannel, rawGuild.id);
    }
  }

  const privateChannelIds: string[] = [];
  for (const rawChannel of d.private_channels ?? []) {
    const recipients = (rawChannel.recipients ?? []) as any[];
    for (const recipient of recipients) rememberUser(recipient);
    const name =
      rawChannel.type === 3
        ? recipients.map((recipient) => recipient.global_name ?? recipient.username ?? "?").join(", ") || "grupo"
        : recipients[0]?.global_name ?? recipients[0]?.username ?? "DM";
    channels[rawChannel.id] = { ...toChannel(rawChannel, null), name };
    privateChannelIds.push(rawChannel.id);
  }

  const readState = { ...state.readState };
  for (const raw of d.read_state ?? []) {
    readState[raw.id] = {
      lastAckedId: raw.last_message_id ?? null,
      mentionCount: typeof raw.mention_count === "number" ? raw.mention_count : 0,
    };
  }

  const mutedGuilds = [...state.guildSettings.mutedGuilds];
  const mutedChannels = [...state.guildSettings.mutedChannels];
  for (const raw of d.user_guild_settings ?? []) {
    if (raw.muted === true && typeof raw.guild_id === "string" && !mutedGuilds.includes(raw.guild_id)) {
      mutedGuilds.push(raw.guild_id);
    }
    for (const override of raw.channel_overrides ?? []) {
      if (override.muted === true && typeof override.channel_id === "string" && !mutedChannels.includes(override.channel_id)) {
        mutedChannels.push(override.channel_id);
      }
    }
  }

  const me = d.user ? { id: d.user.id, username: d.user.global_name ?? d.user.username ?? d.user.id } : state.me;

  return {
    ...state,
    me,
    guilds,
    guildOrder,
    channels,
    privateChannelIds,
    users,
    members,
    readState,
    guildSettings: { mutedGuilds, mutedChannels },
    presences,
  };
}

export function applyReadySupplemental(state: AppState, d: any): AppState {
  let next = state;
  const users = { ...state.users };
  for (const raw of d.users ?? []) {
    if (raw?.id) users[raw.id] = toUser(raw);
  }
  const channels = { ...state.channels };
  const privateChannelIds = [...state.privateChannelIds];
  for (const raw of d.lazy_private_channels ?? []) {
    const recipients = (raw.recipients ?? []) as any[];
    for (const recipient of recipients) {
      if (recipient?.id) users[recipient.id] = toUser(recipient);
    }
    const name =
      raw.type === 3
        ? recipients.map((recipient) => recipient.global_name ?? recipient.username ?? "?").join(", ") || "grupo"
        : recipients[0]?.global_name ?? recipients[0]?.username ?? "DM";
    channels[raw.id] = { ...toChannel(raw, null), name };
    if (!privateChannelIds.includes(raw.id)) privateChannelIds.push(raw.id);
  }

  const presences = { ...state.presences };
  for (const raw of d.presences ?? []) {
    if (raw?.user_id) presences[raw.user_id] = { status: raw.status ?? "offline", activities: raw.activities ?? [] };
  }

  return { ...next, users, channels, privateChannelIds, presences };
}
