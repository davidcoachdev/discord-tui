import { createActions, type Actions } from "../actions";
import { createIdlePresence } from "../actions/presence";
import type { Session } from "../auth/session";
import type { ClientProps } from "../client-props/props";
import { createGateway } from "../gateway/connection";
import { createHttp } from "../rest/http";
import { createRestClient } from "../rest/client";
import { log } from "../log/logger";
import { notify, notificationTitle, shouldNotify } from "../notify/notify";
import { attachSettingsPersistence } from "../settings/persist";
import type { Settings } from "../settings/settings";
import { selectMessages } from "../store/selectors";
import { createStore, type Store } from "../store/store";
import { createVoiceActions, type VoiceMedia } from "../actions/voice";
import { createVoiceAdapterCreator } from "../voice/adapter";
import { startCapture, startPlayback } from "../voice/audio-io";
import { createOpusCodec } from "../voice/opus";
import { createDjsVoiceSession, type VoiceSession } from "../voice/session";
import { createVad } from "../voice/vad";

export interface RuntimeDeps {
  session: Session;
  me: { id: string; username: string };
  props: ClientProps;
  url?: string;
  WebSocketImpl?: typeof WebSocket;
  fetch?: typeof fetch;
  setTimer?: typeof setTimeout;
  random?: () => number;
  initialSettings?: Settings;
  settingsPath?: string;
  voiceSession?: VoiceSession;
  voiceMedia?: VoiceMedia;
  kittyKeyboard?: () => boolean;
}

const defaultMedia: VoiceMedia = {
  startCapture,
  startPlayback,
  createCodec: () => createOpusCodec(),
  createVad: (opts) => createVad(opts),
};

export interface Runtime {
  store: Store;
  actions: Actions;
  start(): void;
  stop(): Promise<void>;
  onUnauthorized(fn: () => void): () => void;
  activity(): void;
}

export function createRuntime(deps: RuntimeDeps): Runtime {
  const store = createStore();
  const unauthorizedHandlers = new Set<() => void>();
  const notifyUnauthorized = (): void => {
    for (const handler of [...unauthorizedHandlers]) handler();
  };

  const http = createHttp({ props: deps.props, token: deps.session.token, fetch: deps.fetch });
  const rest = createRestClient({ http, onUnauthorized: notifyUnauthorized });
  const gateway = createGateway({
    token: deps.session.token,
    props: deps.props,
    url: deps.url,
    WebSocketImpl: deps.WebSocketImpl,
    setTimer: deps.setTimer,
    random: deps.random,
  });
  const voiceSession =
    deps.voiceSession ??
    createDjsVoiceSession({
      adapterCreator: createVoiceAdapterCreator({ gateway, meId: () => store.getState().me?.id ?? deps.me.id }),
      meId: () => store.getState().me?.id ?? deps.me.id,
    });
  const voice = createVoiceActions({
    store,
    session: voiceSession,
    media: deps.voiceMedia ?? defaultMedia,
    kittyKeyboard: deps.kittyKeyboard,
  });
  const actions = createActions({ store, rest, gateway, voice, fetch: deps.fetch });
  store.dispatch({ type: "connection", status: gateway.status });

  if (deps.initialSettings) store.dispatch({ type: "settings/loaded", settings: deps.initialSettings });
  const detachSettings = attachSettingsPersistence(store, { path: deps.settingsPath });

  gateway.on("status", (status) => store.dispatch({ type: "connection", status }));
  gateway.on("dispatch", (t, d) => {
    if (t === "READY" && d && typeof d === "object") {
      const firstGuild =
        (Array.isArray(d.guilds) ? d.guilds[0] : d.guilds && typeof d.guilds === "object" ? (() => { const k = Object.keys(d.guilds as object)[0]; return k !== undefined ? (d.guilds as any)[k] : undefined; })() : undefined);
      const firstChannel = firstGuild?.channels?.[0];
      log.info("ready.shape", {
        msg: JSON.stringify({
          dKeys: Object.keys(d).sort(),
          guildsType: Array.isArray(d.guilds) ? "array" : typeof d.guilds,
          guildKeys: firstGuild ? Object.keys(firstGuild).sort() : null,
          channelKeys: firstChannel ? Object.keys(firstChannel).sort() : null,
          hasGuildName: typeof firstGuild?.name,
          hasChannelName: typeof firstChannel?.name,
        }),
      });
    }
    try {
      store.dispatch({ type: "gw", t, d });
    } catch (error) {
      log.error("store.dispatch-failed", { error_name: error instanceof Error ? error.name : "unknown", t });
      return;
    }
    if (t === "MESSAGE_CREATE" && typeof d?.channel_id === "string" && typeof d?.id === "string") {
      const state = store.getState();
      const message = selectMessages(state, d.channel_id).find((candidate) => candidate.id === d.id);
      if (message && shouldNotify(state, message, state.ui.selectedChannelId)) {
        notify(notificationTitle(state, message), message.content.slice(0, 200));
      }
    }
  });

  let readySessions = 0;
  gateway.on("session", (kind) => {
    if (kind === "resumed") return;
    readySessions += 1;
    if (readySessions === 1) return;

    store.dispatch({ type: "messages/staleAll" });
    const open = store.getState().ui.selectedChannelId;
    if (open !== null) void actions.openChannel(open).catch(() => {});
  });

  gateway.on("fatal", (reason) => {
    store.dispatch({
      type: "notice/push",
      key: "identify-rejected",
      level: "error",
      text: "Discord rechazó la conexión (" + reason + "): puede que haya cambiado el protocolo. Revisá el log.",
    });
    notifyUnauthorized();
  });

  const idle = createIdlePresence({ gateway, settings: () => store.getState().settings });

  const noticeSweep = setInterval(() => {
    const now = Date.now();
    store.dispatch({ type: "notice/sweep", now });
    store.dispatch({ type: "typing/sweep", now });
  }, 1000);
  noticeSweep.unref?.();

  // Ack solo del canal abierto que estás mirando, con debounce (spec 7.8).
  let lastViewed = "";
  const offAck = store.subscribe(() => {
    const state = store.getState();
    const raw = state.ui.selectedChannelId;
    const channelId = raw !== null && state.channels[raw]?.type !== 2 && state.channels[raw]?.type !== 4 ? raw : null;
    const newest = channelId === null ? null : state.messages[channelId]?.ids.at(-1) ?? null;
    const key = `${channelId}:${newest}`;
    if (key === lastViewed) return;
    lastViewed = key;
    actions.viewing?.(channelId, newest);
  });

  return {
    store,
    actions,
    start(): void {
      gateway.connect();
      idle.activity();
    },
    async stop(): Promise<void> {
      clearInterval(noticeSweep);
      offAck();
      idle.stop();
      if (store.getState().voice.channelId !== null) {
        await Promise.race([voice.leaveVoice(), new Promise((resolve) => setTimeout(resolve, 1_500))]);
      }
      detachSettings();
      gateway.close();
    },
    activity(): void {
      idle.activity();
    },
    onUnauthorized(fn: () => void): () => void {
      unauthorizedHandlers.add(fn);
      return () => {
        unauthorizedHandlers.delete(fn);
      };
    },
  };
}
