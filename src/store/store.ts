import type { Action, AppState, VoiceSlice } from "./types";
import { reduce } from "./reduce";
import { DEFAULT_SETTINGS } from "../settings/settings";

export interface Store {
  getState(): AppState;
  dispatch(action: Action): void;
  subscribe(fn: () => void): () => void;
}

export function emptyVoice(): VoiceSlice {
  return {
    guildId: null,
    channelId: null,
    status: "idle",
    error: null,
    selfMute: false,
    selfDeaf: false,
    muteBeforeDeaf: false,
    selfSpeaking: false,
    speaking: {},
    states: {},
    privacyCode: null,
    pttWarning: null,
    micError: null,
  };
}

export function emptyState(): AppState {
  return {
    me: null,
    connection: "disconnected",
    guilds: {},
    guildOrder: [],
    channels: {},
    privateChannelIds: [],
    users: {},
    members: {},
    messages: {},
    readState: {},
    guildSettings: { mutedGuilds: [], mutedChannels: [] },
    presences: {},
    typing: {},
    memberLists: {},
    subscribedChannels: {},
    voice: emptyVoice(),
    outbox: {},
    ui: { selectedGuildId: null, selectedChannelId: null, focus: "guilds", membersVisible: true, collapsedCategories: [] },
    settings: { ...DEFAULT_SETTINGS },
    notices: {},
  };
}

export function createStore(initial: AppState = emptyState()): Store {
  let state = initial;
  const listeners = new Set<() => void>();

  return {
    getState(): AppState {
      return state;
    },
    dispatch(action: Action): void {
      const next = reduce(state, action);
      if (next === state) return;
      state = next;
      for (const listener of [...listeners]) listener();
    },
    subscribe(fn: () => void): () => void {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}
