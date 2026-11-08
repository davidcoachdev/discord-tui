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
import { applyReaction } from "./reducers/reactions";
import {
  applyOutboxEnqueue,
  applyOutboxFailed,
  applyOutboxRetry,
  applyOutboxSent,
} from "./reducers/outbox";
import { applySettingsLoaded, applySettingsPatch } from "./reducers/settings";
import { applyNoticeDismiss, applyNoticePush, applyNoticeSweep } from "./reducers/notices";
import {
  applyMemberListUpdate,
  applyPresenceUpdate,
  applyTypingStart,
  applyTypingSweep,
  clearTypingFor,
} from "./reducers/members";
import {
  applyChannelDelete,
  applyChannelUpsert,
  applyGuildMemberUpdate,
  applyRecipient,
  ensureDmForMessage,
} from "./reducers/channels";
import { applyReadyVoiceStates, applySupplementalMembers, applyVoiceStateUpdate, reduceVoiceAction } from "./reducers/voice";

export function reduce(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "gw":
      switch (action.t) {
        case "READY":
          return applyReadyVoiceStates(applyReady(state, action.d), action.d);
        case "READY_SUPPLEMENTAL":
          return applySupplementalMembers(applyReadyVoiceStates(applyReadySupplemental(state, action.d), action.d), action.d);
        case "MESSAGE_CREATE": {
          let next = applyMessageCreate(ensureDmForMessage(state, action.d), action.d);
          if (typeof action.d?.author?.id === "string" && typeof action.d?.channel_id === "string") {
            next = clearTypingFor(next, action.d.channel_id, action.d.author.id);
          }
          if (typeof action.d?.nonce === "string" && action.d.nonce in next.outbox) {
            const outbox = { ...next.outbox };
            delete outbox[action.d.nonce];
            return { ...next, outbox };
          }
          return next;
        }
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
        case "MESSAGE_REACTION_ADD":
        case "MESSAGE_REACTION_REMOVE":
        case "MESSAGE_REACTION_REMOVE_ALL":
        case "MESSAGE_REACTION_REMOVE_EMOJI":
          return applyReaction(state, action.t, action.d);
        case "GUILD_MEMBER_LIST_UPDATE":
          return applyMemberListUpdate(state, action.d);
        case "PRESENCE_UPDATE":
          return applyPresenceUpdate(state, action.d);
        case "TYPING_START":
          return applyTypingStart(state, action.d);
        case "VOICE_STATE_UPDATE":
          return applyVoiceStateUpdate(state, action.d);
        case "CHANNEL_CREATE":
        case "CHANNEL_UPDATE":
          return applyChannelUpsert(state, action.d);
        case "CHANNEL_DELETE":
          return applyChannelDelete(state, action.d);
        case "CHANNEL_RECIPIENT_ADD":
        case "CHANNEL_RECIPIENT_REMOVE":
          return applyRecipient(state, action.t, action.d);
        case "GUILD_MEMBER_UPDATE":
          return applyGuildMemberUpdate(state, action.d);
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
    case "ui/toggleCategory": {
      const collapsed = state.ui.collapsedCategories.includes(action.id)
        ? state.ui.collapsedCategories.filter((id) => id !== action.id)
        : [...state.ui.collapsedCategories, action.id];
      return { ...state, ui: { ...state.ui, collapsedCategories: collapsed } };
    }
    case "ui/toggleMembers":
      return { ...state, ui: { ...state.ui, membersVisible: !state.ui.membersVisible } };
    case "outbox/enqueue":
      return applyOutboxEnqueue(state, action.item);
    case "outbox/sent":
      return applyOutboxSent(state, action.nonce);
    case "outbox/failed":
      return applyOutboxFailed(state, action.nonce, action.error);
    case "outbox/retry":
      return applyOutboxRetry(state, action.nonce);
    case "settings/set":
      return applySettingsPatch(state, action.patch);
    case "settings/loaded":
      return applySettingsLoaded(state, action.settings);
    case "notice/push":
      return applyNoticePush(state, action.key, action.level, action.text, Date.now());
    case "notice/dismiss":
      return applyNoticeDismiss(state, action.id);
    case "notice/sweep":
      return applyNoticeSweep(state, action.now);
    case "typing/sweep":
      return applyTypingSweep(state, action.now);
    case "members/subscribed": {
      // Otro canal, otra lista: lo que estaba más allá de 0-99 era de la lista anterior.
      const list = state.memberLists[action.guildId];
      const memberLists =
        list && list.length > 100 && state.subscribedChannels[action.guildId] !== action.channelId
          ? { ...state.memberLists, [action.guildId]: list.slice(0, 100) }
          : state.memberLists;
      return {
        ...state,
        memberLists,
        subscribedChannels: { ...state.subscribedChannels, [action.guildId]: action.channelId },
        subscribedRanges: { ...state.subscribedRanges, [action.guildId]: action.ranges ?? [[0, 99]] },
      };
    }
    case "members/resetSubscriptions":
      return { ...state, subscribedChannels: {}, subscribedRanges: {} };
    case "voice/joining":
    case "voice/status":
    case "voice/left":
    case "voice/moved":
    case "voice/flags":
    case "voice/selfSpeaking":
    case "voice/speaking":
    case "voice/privacyCode":
    case "voice/pttWarning":
    case "voice/micError":
      return reduceVoiceAction(state, action);
    default:
      return state;
  }
}
