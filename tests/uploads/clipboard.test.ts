import { expect, test } from "bun:test";

import { readClipboardImage, readClipboardText } from "../../src/uploads/clipboard";

type FakeProc = { stdout: ReadableStream<Uint8Array> | null; exited: Promise<number> };

function proc(data: string | Uint8Array, code = 0): FakeProc {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return {
    stdout: new ReadableStream<Uint8Array>({
      start(controller): void {
        if (bytes.byteLength > 0) controller.enqueue(bytes);
        controller.close();
      },
    }),
    exited: Promise.resolve(code),
  };
}

const NOW = (): Date => new Date(2026, 10, 7, 9, 5, 3);

test("readClipboardImage picks png and reads it", async () => {
  const calls: string[][] = [];
  const png = new Uint8Array([137, 80, 78, 71]);
  const spawn = (cmd: string[]): FakeProc => {
    calls.push(cmd);
    if (cmd[1] === "--list-types") return proc("text/plain\nimage/jpeg\nimage/png\n");
    return proc(png);
  };
  const result = await readClipboardImage({ spawn, now: NOW });
  expect(calls).toEqual([["wl-paste", "--list-types"], ["wl-paste", "--type", "image/png"]]);
  expect(result).toEqual({ bytes: png, mime: "image/png", filename: "captura-20261107-090503.png" });
});

test("readClipboardImage uses jpg extension for jpeg", async () => {
  const spawn = (cmd: string[]): FakeProc => (cmd[1] === "--list-types" ? proc("image/jpeg\n") : proc("x"));
  const result = await readClipboardImage({ spawn, now: NOW });
  expect(result?.mime).toBe("image/jpeg");
  expect(result?.filename).toBe("captura-20261107-090503.jpg");
});

test("readClipboardImage returns null for text-only", async () => {
  const calls: string[][] = [];
  const spawn = (cmd: string[]): FakeProc => {
    calls.push(cmd);
    return proc("text/plain\nUTF8_STRING\n");
  };
  expect(await readClipboardImage({ spawn, now: NOW })).toBeNull();
  expect(calls).toHaveLength(1);
});

test("readClipboardImage returns null on non-zero exit, empty output or spawn error", async () => {
  expect(await readClipboardImage({ spawn: () => proc("", 1) })).toBeNull();
  expect(
    await readClipboardImage({
      spawn: (cmd) => (cmd[1] === "--list-types" ? proc("image/png\n") : proc(new Uint8Array())),
    }),
  ).toBeNull();
  expect(
    await readClipboardImage({
      spawn: (cmd) => (cmd[1] === "--list-types" ? proc("image/png\n") : proc("x", 1)),
    }),
  ).toBeNull();
  expect(
    await readClipboardImage({
      spawn: () => {
        throw new Error("ENOENT wl-paste");
      },
    }),
  ).toBeNull();
});

test("readClipboardText returns the text or null", async () => {
  const calls: string[][] = [];
  const text = await readClipboardText({
    spawn: (cmd) => {
      calls.push(cmd);
      return proc("hola mundo");
    },
  });
  expect(text).toBe("hola mundo");
  expect(calls).toEqual([["wl-paste", "--no-newline", "--type", "text/plain"]]);
  expect(await readClipboardText({ spawn: () => proc("", 1) })).toBeNull();
  expect(
    await readClipboardText({
      spawn: () => {
        throw new Error("no wayland");
      },
    }),
  ).toBeNull();
});
