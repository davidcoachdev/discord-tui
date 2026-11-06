import type { Action, ApiMessage, AppState } from "./types";
import { applyReady, applyReadySupplemental } from "./reducers/ready";
import {
  applyMessageCreate,
  applyMessageDelete,
  applyMessageDeleteBulk,
  applyMessageUpdate,
  applyPage,
} from "./reducers/messages";
import { applyChannelUnreadUpdate, applyMessageAck } from "./reducers/read-state";
import { compareSnowflakes } from "../util/snowflake";

export function reduce(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "gw":
      switch (action.t) {
        case "READY":
          return applyReady(state, action.d);
        case "READY_SUPPLEMENTAL":
          return applyReadySupplemental(state, action.d);
        case "MESSAGE_CREATE":
          return applyMessageCreate(state, action.d);
        case "MESSAGE_UPDATE":
          return applyMessageUpdate(state, action.d);
        case "MESSAGE_DELETE":
          return applyMessageDelete(state, action.d);
        case "MESSAGE_DELETE_BULK":
          return applyMessageDeleteBulk(state, action.d);
        case "MESSAGE_ACK":
          return applyMessageAck(state, action.d);
        case "CHANNEL_UNREAD_UPDATE":
          return applyChannelUnreadUpdate(state, action.d);
        default:
          return state;
      }
    case "connection":
      return state.connection === action.status ? state : { ...state, connection: action.status };
    case "messages/page":
      return applyPage(state, action.channelId, action.messages, action.mode);
    case "messages/loading": {
      const slice = state.messages[action.channelId];
      if (!slice) return state;
      return {
        ...state,
        messages: { ...state.messages, [action.channelId]: { ...slice, loadingOlder: action.loading } },
      };
    }
    case "messages/staleAll": {
      const messages = Object.fromEntries(
        Object.entries(state.messages).map(([channelId, slice]) => [channelId, { ...slice, stale: true }]),
      );
      return { ...state, messages };
    }
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
