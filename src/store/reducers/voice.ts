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

/** READY trae `voice_states` dentro de cada guild: quién está en qué canal al conectar. */
export function applyReadyVoiceStates(state: AppState, d: any): AppState {
  const guilds: any[] = Array.isArray(d?.guilds) ? d.guilds : [];
  const states: VoiceSlice["states"] = {};
  for (const guild of guilds) {
    if (typeof guild?.id !== "string" || !Array.isArray(guild.voice_states)) continue;
    const byUser: Record<string, VoiceMemberState> = {};
    for (const raw of guild.voice_states) {
      const member = toVoiceMember(raw);
      if (member && typeof raw.user_id === "string") byUser[raw.user_id] = member;
    }
    states[guild.id] = byUser;
  }
  return withVoice(state, { states });
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
    case "voice/micError":
      return withVoice(state, { micError: action.error });
    default:
      return state;
  }
}
