import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";

import type { Actions } from "../../src/actions";
import type { RaEvent } from "../../src/auth/remote-auth";
import { Root } from "../../src/app/root";
import type { Runtime } from "../../src/app/runtime";
import { createClientProps } from "../../src/client-props/props";
import { DEFAULT_SETTINGS } from "../../src/settings/settings";
import { createStore, emptyState, type Store } from "../../src/store/store";

function fakeActions(): Actions {
  return {
    selectGuild: () => {},
    openChannel: async () => {},
    loadOlder: async () => {},
    focus: () => {},
    toggleMembers: () => {},
    send: async () => {},
    retry: async () => {},
    edit: async () => {},
    remove: async () => {},
    toggleReaction: async () => {},
  };
}

function fakeAuth() {
  let listener: ((event: RaEvent) => void) | null = null;
  let started = 0;
  return {
    auth: {
      on(fn: (event: RaEvent) => void) {
        listener = fn;
        return () => {
          listener = null;
        };
      },
      start() {
        started += 1;
      },
    },
    started: () => started,
    emit(event: RaEvent) {
      listener?.(event);
    },
  };
}

function fakeRuntime(store: Store, actions: Actions) {
  let handler: (() => void) | null = null;
  let startCount = 0;
  let stopCount = 0;
  const runtime: Runtime = {
    store,
    actions,
    start() {
      startCount += 1;
    },
    async stop() {
      stopCount += 1;
    },
    onUnauthorized(fn: () => void) {
      handler = fn;
      return () => {
        if (handler === fn) handler = null;
      };
    },
    activity() {},
  };
  return {
    runtime,
    startCount: () => startCount,
    stopCount: () => stopCount,
    fireUnauthorized() {
      handler?.();
    },
  };
}

test("unauthorized on a saved session stops the runtime and returns to the login screen", async () => {
  const store = createStore(emptyState());
  const actions = fakeActions();
  const { runtime, startCount, stopCount, fireUnauthorized } = fakeRuntime(store, actions);
  const { auth } = fakeAuth();
  const { captureCharFrame, renderOnce } = await testRender(
    () => (
      <Root
        buildNumber={400000}
        settings={DEFAULT_SETTINGS}
        clientProps={createClientProps({ buildNumber: 400000 })}
        initialRuntime={runtime}
        onQuit={() => {}}
        kittyKeyboard={() => true}
        auth={auth}
      />
    ),
    { width: 100, height: 30 },
  );
  await renderOnce();
  expect(startCount()).toBe(1);
  expect(captureCharFrame()).not.toContain("iniciá sesión");

  fireUnauthorized();
  await renderOnce();

  expect(stopCount()).toBe(1);
  expect(captureCharFrame()).toContain("iniciá sesión");
});

test("login path starts on the login screen and q quits with a null runtime", async () => {
  const { auth } = fakeAuth();
  let quitWith: Runtime | null | undefined;
  const { captureCharFrame, renderOnce, mockInput } = await testRender(
    () => (
      <Root
        buildNumber={400000}
        settings={DEFAULT_SETTINGS}
        clientProps={createClientProps({ buildNumber: 400000 })}
        initialRuntime={null}
        onQuit={(runtime) => {
          quitWith = runtime;
        }}
        kittyKeyboard={() => true}
        auth={auth}
      />
    ),
    { width: 100, height: 30 },
  );
  await renderOnce();
  expect(captureCharFrame()).toContain("iniciá sesión");

  mockInput.pressKey("q");
  await renderOnce();

  expect(quitWith).toBeNull();
});
