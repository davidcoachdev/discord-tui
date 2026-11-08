import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";

import { App } from "../../src/ui/App";
import { splashStatus } from "../../src/ui/components/Splash";
import { buildDemoStore, demoActions } from "../../scripts/demo-state";

test("splash status words", () => {
  expect(splashStatus("connecting", 0)).toBe("conectando con Discord…");
  expect(splashStatus("identifying", 0)).toBe("iniciando sesión…");
  expect(splashStatus("ready", 12)).toBe("cargando 12 servidores…");
});

test("zcord splash shows while connecting, stays at least 1.2 s, then reveals the app", async () => {
  const store = buildDemoStore();
  store.dispatch({ type: "connection", status: "connecting" });
  const h = await testRender(() => <App store={store} actions={demoActions(store)} onQuit={() => {}} splash />, { width: 120, height: 30 });
  await h.renderOnce();
  expect(h.captureCharFrame()).toContain("███████╗");
  expect(h.captureCharFrame()).toContain("Discord en tu terminal");
  expect(h.captureCharFrame()).toContain("conectando con Discord…");
  store.dispatch({ type: "connection", status: "ready" });
  await h.renderOnce();
  expect(h.captureCharFrame()).toContain("Discord en tu terminal");
  await Bun.sleep(1300);
  await h.renderOnce();
  expect(h.captureCharFrame()).not.toContain("Discord en tu terminal");
  expect(h.captureCharFrame()).toContain("Servidores");
});

test("if the connection fails the splash goes away so the error is visible", async () => {
  const store = buildDemoStore();
  store.dispatch({ type: "connection", status: "connecting" });
  const h = await testRender(() => <App store={store} actions={demoActions(store)} onQuit={() => {}} splash />, { width: 120, height: 30 });
  await h.renderOnce();
  store.dispatch({ type: "connection", status: "disconnected" });
  await h.renderOnce();
  expect(h.captureCharFrame()).not.toContain("Discord en tu terminal");
});

test("tests and the plain App never show the splash", async () => {
  const store = buildDemoStore();
  const h = await testRender(() => <App store={store} actions={demoActions(store)} onQuit={() => {}} />, { width: 120, height: 30 });
  await h.renderOnce();
  expect(h.captureCharFrame()).not.toContain("Discord en tu terminal");
});
