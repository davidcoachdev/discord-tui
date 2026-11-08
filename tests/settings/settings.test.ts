import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DEFAULT_SETTINGS, loadSettings, normalizeSettings, saveSettings } from "../../src/settings/settings";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "discord-tui-settings-"));
  return fn(dir);
}

describe("settings", () => {
  test("missing file gives defaults", async () => {
    await withTempDir(async (dir) => {
      expect(await loadSettings({ path: join(dir, "settings.json") })).toEqual(DEFAULT_SETTINGS);
    });
  });

  test("invalid fields fall back one by one", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "settings.json");
      await writeFile(
        path,
        JSON.stringify({ inputMode: "loud", theme: "light", userVolumes: { "1": 900, "2": 50 } }),
      );
      const settings = await loadSettings({ path });
      expect(settings).toMatchObject({
        inputMode: "voice_activity",
        theme: "light",
        userVolumes: { "2": 50 },
      });
    });
  });

  test("Go Live settings: defaults to ask + 720p30, keeps valid values, drops invalid ones", () => {
    expect(normalizeSettings({})).toMatchObject({ streamMonitor: null, streamQuality: "720p30" });
    expect(normalizeSettings({ streamMonitor: "DP-1", streamQuality: "1080p30" })).toMatchObject({ streamMonitor: "DP-1", streamQuality: "1080p30" });
    expect(normalizeSettings({ streamMonitor: 3, streamQuality: "4k60" })).toMatchObject({ streamMonitor: null, streamQuality: "720p30" });
  });

  test("broken JSON gives defaults", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "settings.json");
      await writeFile(path, "{no es json");
      expect(await loadSettings({ path })).toEqual(DEFAULT_SETTINGS);
    });
  });

  test("vadSensitivity is clamped to [-60, -20]", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "settings.json");
      await writeFile(path, JSON.stringify({ vadSensitivity: -90 }));
      expect((await loadSettings({ path })).vadSensitivity).toBe(-60);
      await writeFile(path, JSON.stringify({ vadSensitivity: 10 }));
      expect((await loadSettings({ path })).vadSensitivity).toBe(-20);
    });
  });

  test("saved with mode 0600 and never contains a token-like string", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "settings.json");
      await saveSettings(DEFAULT_SETTINGS, { path });
      const mode = (await stat(path)).mode & 0o777;
      expect(mode).toBe(0o600);
      const body = await readFile(path, "utf8");
      expect(body).not.toMatch(/[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{25,}/);
    });
  });

  test("save then load round-trips the values", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "settings.json");
      const settings = { ...DEFAULT_SETTINGS, theme: "light" as const, inputMode: "push_to_talk" as const };
      await saveSettings(settings, { path });
      expect(await loadSettings({ path })).toEqual(settings);
    });
  });
});

describe("settings persistence in the store", () => {
  test("settings/set updates the store immediately", async () => {
    const { createStore, emptyState } = await import("../../src/store/store");
    const store = createStore(emptyState());
    store.dispatch({ type: "settings/set", patch: { theme: "light" } });
    expect(store.getState().settings.theme).toBe("light");
  });

  test("settings/set persists after the debounce", async () => {
    const { createStore, emptyState } = await import("../../src/store/store");
    const { attachSettingsPersistence } = await import("../../src/settings/persist");
    await withTempDir(async (dir) => {
      const path = join(dir, "settings.json");
      const store = createStore(emptyState());
      attachSettingsPersistence(store, { path, debounceMs: 20 });
      store.dispatch({ type: "settings/set", patch: { theme: "light" } });
      store.dispatch({ type: "settings/set", patch: { idleAfterMinutes: null } });
      await Bun.sleep(80);
      const saved = await loadSettings({ path });
      expect(saved.theme).toBe("light");
      expect(saved.idleAfterMinutes).toBeNull();
    });
  });

  test("an invalid patch is normalized before it reaches the store", async () => {
    const { createStore, emptyState } = await import("../../src/store/store");
    const store = createStore(emptyState());
    store.dispatch({ type: "settings/set", patch: { vadSensitivity: -200 } });
    expect(store.getState().settings.vadSensitivity).toBe(-60);
  });

  test("status defaults to online, keeps the four valid values and drops anything else", () => {
    expect(DEFAULT_SETTINGS.status).toBe("online");
    for (const status of ["online", "idle", "dnd", "invisible"] as const) {
      expect(normalizeSettings({ status }).status).toBe(status);
    }
    for (const status of ["offline", "unknown", "DND", 3, null]) {
      expect(normalizeSettings({ status, theme: "light" })).toMatchObject({ status: "online", theme: "light" });
    }
  });
});
