import { expect, test } from "bun:test";

import { createActions } from "../../src/actions";
import type { RestClient } from "../../src/rest/client";
import { createStore, emptyState } from "../../src/store/store";
import type { ApiPoll } from "../../src/store/types";

const CH = "100000000000000002";
const MSG = "100000000000000100";
const NOW = Date.parse("2026-11-07T12:00:00Z");

function setup(p: Partial<ApiPoll> = {}) {
  const store = createStore({ ...emptyState(), me: { id: "100000000000000010", username: "user1" } });
  store.dispatch({
    type: "gw",
    t: "MESSAGE_CREATE",
    d: {
      id: MSG,
      channel_id: CH,
      author: { id: "100000000000000011" },
      content: "",
      poll: {
        question: { text: "¿?" },
        answers: [1, 2, 3].map((id) => ({ answer_id: id, poll_media: { text: `r${id}` } })),
        expiry: "2026-11-08T12:00:00Z",
        allow_multiselect: false,
        results: { is_finalized: false, answer_counts: [{ id: 2, count: 1, me_voted: true }] },
        ...p,
      },
    },
  });
  const requests: { method: string; path: string; body: unknown }[] = [];
  const rest: RestClient = {
    closed: false,
    async request<T>(method: string, path: string, body?: unknown): Promise<T> {
      requests.push({ method, path, body });
      return undefined as T;
    },
  };
  const actions = createActions({ store, rest, gateway: { send() {} }, now: () => NOW });
  return { store, actions, requests };
}

test("single choice: PUT /channels/{c}/polls/{m}/answers/@me with the new answer, or [] to remove mine", async () => {
  const s = setup();
  await s.actions.votePoll!(CH, MSG, 1);
  await s.actions.votePoll!(CH, MSG, 2);
  expect(s.requests).toEqual([
    { method: "PUT", path: `/channels/${CH}/polls/${MSG}/answers/@me`, body: { answer_ids: [1] } },
    { method: "PUT", path: `/channels/${CH}/polls/${MSG}/answers/@me`, body: { answer_ids: [] } },
  ]);
});

test("multiselect toggles the answer against my current votes", async () => {
  const s = setup({ allow_multiselect: true });
  await s.actions.votePoll!(CH, MSG, 3);
  expect(s.requests[0]!.body).toEqual({ answer_ids: [2, 3] });
  await s.actions.votePoll!(CH, MSG, 2);
  expect(s.requests[1]!.body).toEqual({ answer_ids: [] });
});

test("finalized, expired or unknown polls send nothing and say so", async () => {
  for (const extra of [
    { results: { is_finalized: true, answer_counts: [] } },
    { expiry: "2026-11-07T11:00:00Z" },
  ] as Partial<ApiPoll>[]) {
    const s = setup(extra);
    await s.actions.votePoll!(CH, MSG, 1);
    expect(s.requests).toEqual([]);
    expect(Object.values(s.store.getState().notices).some((n) => n.text.includes("terminó"))).toBe(true);
  }
  const s = setup();
  await s.actions.votePoll!(CH, "100000000000000999", 1);
  await s.actions.votePoll!(CH, MSG, 9);
  expect(s.requests).toEqual([]);
});

test("a failed vote leaves a notice", async () => {
  const s = setup();
  const failing: RestClient = { closed: false, request: async () => Promise.reject(new Error("boom")) };
  const actions = createActions({ store: s.store, rest: failing, gateway: { send() {} }, now: () => NOW });
  await expect(actions.votePoll!(CH, MSG, 1)).rejects.toThrow("boom");
  expect(Object.values(s.store.getState().notices).some((n) => n.text.startsWith("no se pudo votar"))).toBe(true);
});
