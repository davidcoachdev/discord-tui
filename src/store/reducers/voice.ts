import type { AppState, VoiceMemberState, VoiceSlice } from "../types";

function toVoiceMember(raw: any): VoiceMemberState | null {
  if (typeof raw?.channel_id !== "string") return null;
  return {
    channelId: raw.channel_id,
    mute: raw.mute === true,
    deaf: raw.deaf === true,
    selfMute: raw.self_mute === true,
    selfDeaf: raw.self_deaf === true,
    selfVideo: raw.self_video === true,
    selfStream: raw.self_stream === true,
  };
}

function withVoice(state: AppState, patch: Partial<VoiceSlice>): AppState {
  return { ...state, voice: { ...state.voice, ...patch } };
}

/**
 * Quién está en qué canal de voz al conectar. Para cuentas de usuario el READY trae los guilds "lazy" sin
 * `voice_states`: llegan en READY_SUPPLEMENTAL (`guilds: [{ id, voice_states, … }]`, mismo orden que READY).
 * Se mezcla por guild, así sirve para los dos eventos.
 */
export function applyReadyVoiceStates(state: AppState, d: any): AppState {
  const guilds: any[] = Array.isArray(d?.guilds) ? d.guilds : [];
  const states: VoiceSlice["states"] = { ...state.voice.states };
  let users = state.users;
  let members = state.members;
  for (const guild of guilds) {
    if (typeof guild?.id !== "string" || !Array.isArray(guild.voice_states)) continue;
    const byUser: Record<string, VoiceMemberState> = {};
    for (const raw of guild.voice_states) {
      const member = toVoiceMember(raw);
      if (!member || typeof raw.user_id !== "string") continue;
      byUser[raw.user_id] = member;
      const user = raw.member?.user;
      if (user?.id && !users[user.id]) {
        users = {
          ...users,
          [user.id]: { id: user.id, username: user.username ?? user.id, globalName: user.global_name ?? null, avatar: user.avatar ?? null, bot: user.bot === true },
        };
      }
      if (raw.member && !members[guild.id]?.[raw.user_id]) {
        members = {
          ...members,
          [guild.id]: {
            ...(members[guild.id] ?? {}),
            [raw.user_id]: { userId: raw.user_id, guildId: guild.id, roles: raw.member.roles ?? [], nick: raw.member.nick ?? null },
          },
        };
      }
    }
    states[guild.id] = byUser;
  }
  return { ...state, users, members, voice: { ...state.voice, states } };
}

/** READY_SUPPLEMENTAL: `merged_members[i]` son los miembros del guild `guilds[i]` (sirve para los nombres). */
export function applySupplementalMembers(state: AppState, d: any): AppState {
  const guilds: any[] = Array.isArray(d?.guilds) ? d.guilds : [];
  const merged: any[] = Array.isArray(d?.merged_members) ? d.merged_members : [];
  if (merged.length === 0) return state;
  const members = { ...state.members };
  guilds.forEach((guild, index) => {
    const list = merged[index];
    if (typeof guild?.id !== "string" || !Array.isArray(list)) return;
    const byUser = { ...(members[guild.id] ?? {}) };
    for (const raw of list) {
      if (typeof raw?.user_id !== "string") continue;
      byUser[raw.user_id] = {
        userId: raw.user_id,
        guildId: guild.id,
        roles: Array.isArray(raw.roles) ? raw.roles : byUser[raw.user_id]?.roles ?? [],
        nick: raw.nick ?? byUser[raw.user_id]?.nick ?? null,
      };
    }
    members[guild.id] = byUser;
  });
  return { ...state, members };
}

export function applyVoiceStateUpdate(state: AppState, d: any): AppState {
  const guildId = d?.guild_id;
  const userId = d?.user_id;
  if (typeof guildId !== "string" || typeof userId !== "string") return state;

  let users = state.users;
  const rawUser = d.member?.user;
  if (rawUser?.id && !users[rawUser.id]) {
    users = {
      ...users,
      [rawUser.id]: {
        id: rawUser.id,
        username: rawUser.username ?? rawUser.id,
        globalName: rawUser.global_name ?? null,
        avatar: rawUser.avatar ?? null,
        bot: rawUser.bot === true,
      },
    };
  }

  const guildStates = { ...(state.voice.states[guildId] ?? {}) };
  const member = toVoiceMember(d);
  if (member) guildStates[userId] = member;
  else delete guildStates[userId];

  let voice: VoiceSlice = { ...state.voice, states: { ...state.voice.states, [guildId]: guildStates } };
  if (!member && voice.speaking[userId]) {
    const speaking = { ...voice.speaking };
    delete speaking[userId];
    voice = { ...voice, speaking };
  }
  return { ...state, users, voice };
}

export function reduceVoiceAction(state: AppState, action: any): AppState {
  switch (action.type) {
    case "voice/joining":
      return withVoice(state, {
        guildId: action.guildId,
        channelId: action.channelId,
        status: "joining",
        error: null,
        speaking: {},
        selfSpeaking: false,
        privacyCode: null,
      });
    case "voice/status":
      return withVoice(state, { status: action.status, error: action.error ?? (action.status === "error" ? state.voice.error : null) });
    case "voice/left":
      return withVoice(state, {
        guildId: null,
        channelId: null,
        status: action.error ? "error" : "idle",
        error: action.error ?? null,
        speaking: {},
        selfSpeaking: false,
        privacyCode: null,
        micError: null,
        stream: { status: "idle", monitor: null, error: null },
        // El aviso de por qué se cortó lo deja el watcher (notice); la vista se cierra.
        watch: { status: "idle", userId: null, error: null },
      });
    case "voice/moved":
      return withVoice(state, { channelId: action.channelId, speaking: {} });
    case "voice/flags":
      return withVoice(state, { selfMute: action.selfMute, selfDeaf: action.selfDeaf, muteBeforeDeaf: action.muteBeforeDeaf });
    case "voice/selfSpeaking":
      return state.voice.selfSpeaking === action.on ? state : withVoice(state, { selfSpeaking: action.on });
    case "voice/speaking": {
      const has = state.voice.speaking[action.userId] === true;
      if (has === action.on) return state;
      const speaking = { ...state.voice.speaking };
      if (action.on) speaking[action.userId] = true;
      else delete speaking[action.userId];
      return withVoice(state, { speaking });
    }
    case "voice/privacyCode":
      return state.voice.privacyCode === action.code ? state : withVoice(state, { privacyCode: action.code });
    case "voice/pttWarning":
      return withVoice(state, { pttWarning: action.warning });
    case "voice/outputLabel":
      return withVoice(state, { outputLabel: action.label });
    case "voice/micError":
      return withVoice(state, { micError: action.error });
    case "voice/stream":
      return withVoice(state, { stream: { ...state.voice.stream, ...action.patch } });
    case "voice/watch":
      return withVoice(state, { watch: { ...state.voice.watch, ...action.patch } });
    default:
      return state;
  }
}
