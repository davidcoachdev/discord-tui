import { describe, expect, test } from "bun:test";

import { createStore, emptyState } from "../../src/store/store";

describe("notices", () => {
  test("same key accumulates count instead of stacking", () => {
    const store = createStore(emptyState());
    store.dispatch({ type: "notice/push", key: "rest-error", level: "warn", text: "no se pudo enviar: 500" });
    store.dispatch({ type: "notice/push", key: "rest-error", level: "warn", text: "no se pudo enviar: 500" });
    const notices = Object.values(store.getState().notices);
    expect(notices).toHaveLength(1);
    expect(notices[0]?.count).toBe(2);
  });

  test("dismiss removes a notice", () => {
    const store = createStore(emptyState());
    store.dispatch({ type: "notice/push", key: "a", level: "info", text: "x" });
    const [id] = Object.keys(store.getState().notices);
    store.dispatch({ type: "notice/dismiss", id: id! });
    expect(Object.keys(store.getState().notices)).toHaveLength(0);
  });

  test("different keys create different notices", () => {
    const store = createStore(emptyState());
    store.dispatch({ type: "notice/push", key: "a", level: "info", text: "x" });
    store.dispatch({ type: "notice/push", key: "b", level: "info", text: "y" });
    expect(Object.keys(store.getState().notices)).toHaveLength(2);
  });

  test("errors stay until dismissed, info expires after 6 s (sweep action)", () => {
    const store = createStore(emptyState());
    store.dispatch({ type: "notice/push", key: "err", level: "error", text: "e" });
    store.dispatch({ type: "notice/push", key: "info", level: "info", text: "i" });
    store.dispatch({ type: "notice/sweep", now: Date.now() + 7000 });
    const notices = Object.values(store.getState().notices);
    expect(notices).toHaveLength(1);
    expect(notices[0]?.level).toBe("error");
  });
});
