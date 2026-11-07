import { expect, test } from "bun:test";

import { createActions } from "../../src/actions";
import { createClientProps } from "../../src/client-props/props";
import { reactionPath } from "../../src/emoji/common";
import { createRestClient } from "../../src/rest/client";
import { createHttp } from "../../src/rest/http";
import { createStore, emptyState } from "../../src/store/store";
import { startFakeHttp } from "../fakes/fake-http";

const CH = "100000000000000002";
const gateway = { send() {} } as never;

test("reactionPath", () => {
  expect(reactionPath({ id: null, name: "👍" })).toBe("%F0%9F%91%8D");
  expect(reactionPath({ id: "4", name: "kek" })).toBe("kek%3A4");
});

function makeStore(me: boolean) {
  const store = createStore(emptyState());
  store.dispatch({
    type: "gw",
    t: "MESSAGE_CREATE",
    d: {
      id: "100000000000000100",
      channel_id: CH,
      author: { id: "1" },
      content: "x",
      reactions: [{ emoji: { id: null, name: "👍" }, count: 1, me }],
    },
  });
  return store;
}

test("toggle sends PUT first time and DELETE when me is true", async () => {
  const fake = startFakeHttp(() => new Response(null, { status: 204 }));
  const http = createHttp({ props: createClientProps({ buildNumber: 1 }), baseUrl: fake.url });
  const rest = createRestClient({ http, onUnauthorized: () => {} });

  const putActions = createActions({ store: makeStore(false), rest, gateway: gateway as never });
  await putActions.toggleReaction(CH, "100000000000000100", { id: null, name: "👍" });
  expect(fake.requests[0]!.method).toBe("PUT");

  const delActions = createActions({ store: makeStore(true), rest, gateway: gateway as never });
  await delActions.toggleReaction(CH, "100000000000000100", { id: null, name: "👍" });
  expect(fake.requests[1]!.method).toBe("DELETE");
  expect(fake.requests[1]!.url).toContain("%F0%9F%91%8D");
  fake.stop();
});
