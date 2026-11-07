import { createActions, type Actions } from "../actions";
import type { Session } from "../auth/session";
import type { ClientProps } from "../client-props/props";
import { createGateway } from "../gateway/connection";
import { createHttp } from "../rest/http";
import { createRestClient } from "../rest/client";
import { notify, notificationTitle, shouldNotify } from "../notify/notify";
import { selectMessages } from "../store/selectors";
import { createStore, type Store } from "../store/store";

export interface RuntimeDeps {
  session: Session;
  me: { id: string; username: string };
  props: ClientProps;
  url?: string;
  WebSocketImpl?: typeof WebSocket;
  fetch?: typeof fetch;
  setTimer?: typeof setTimeout;
  random?: () => number;
}

export interface Runtime {
  store: Store;
  actions: Actions;
  start(): void;
  stop(): void;
  onUnauthorized(fn: () => void): () => void;
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
  const actions = createActions({ store, rest, gateway });

  store.dispatch({ type: "connection", status: gateway.status });
  gateway.on("status", (status) => store.dispatch({ type: "connection", status }));
  gateway.on("dispatch", (t, d) => {
    store.dispatch({ type: "gw", t, d });
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

  gateway.on("fatal", () => notifyUnauthorized());

  return {
    store,
    actions,
    start(): void {
      gateway.connect();
    },
    stop(): void {
      gateway.close();
    },
    onUnauthorized(fn: () => void): () => void {
      unauthorizedHandlers.add(fn);
      return () => {
        unauthorizedHandlers.delete(fn);
      };
    },
  };
}
