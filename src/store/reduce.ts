import type { Action, ApiMessage, AppState } from "./types";
import { applyReady, applyReadySupplemental } from "./reducers/ready";
import { compareSnowflakes } from "../util/snowflake";

function applyPage(
  state: AppState,
  channelId: string,
  messages: ApiMessage[],
  mode: "older" | "latest",
): AppState {
  const previous = state.messages[channelId] ?? {
    ids: [],
    byId: {},
    hasMoreBefore: true,
    loadingOlder: false,
    stale: false,
  };
  const byId = { ...previous.byId };
  const ids = new Set(previous.ids);
  for (const message of messages) {
    byId[message.id] = message;
    ids.add(message.id);
  }
  const ordered = [...ids].sort(compareSnowflakes);
  return {
    ...state,
    messages: {
      ...state.messages,
      [channelId]: {
        ...previous,
        ids: ordered,
        byId,
        loadingOlder: false,
        hasMoreBefore: mode === "older" ? messages.length >= 50 : previous.hasMoreBefore,
      },
    },
  };
}

export function reduce(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "gw":
      if (action.t === "READY") return applyReady(state, action.d);
      if (action.t === "READY_SUPPLEMENTAL") return applyReadySupplemental(state, action.d);
      return state;
    case "connection":
      return state.connection === action.status ? state : { ...state, connection: action.status };
    case "messages/page":
      return applyPage(state, action.channelId, action.messages, action.mode);
    case "ui/selectGuild":
      return { ...state, ui: { ...state.ui, selectedGuildId: action.id } };
    case "ui/selectChannel":
      return { ...state, ui: { ...state.ui, selectedChannelId: action.id } };
    case "ui/focus":
      return { ...state, ui: { ...state.ui, focus: action.focus } };
    case "ui/toggleMembers":
      return { ...state, ui: { ...state.ui, membersVisible: !state.ui.membersVisible } };
    default:
      return state;
  }
}
