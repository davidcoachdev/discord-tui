import { expect, test } from "bun:test";

import { createAckScheduler } from "../../src/actions/ack";
import { createTypingNotifier } from "../../src/actions/typing";

test("typing: 1 request for 20 keystrokes within 8 s, a 2nd after 8 s, none for empty text", () => {
  let now = 0;
  const calls: string[] = [];
  const notifier = createTypingNotifier({
    postTyping: async (channelId) => {
      calls.push(channelId);
    },
    now: () => now,
  });

  for (let index = 0; index < 20; index += 1) notifier.onKeystroke("ch", "hola");
  expect(calls).toHaveLength(1);

  now = 8000;
  notifier.onKeystroke("ch", "hola");
  expect(calls).toHaveLength(2);

  notifier.onKeystroke("ch", "");
  expect(calls).toHaveLength(2);
});

test("typing onSent resets the throttle", () => {
  let now = 0;
  const calls: string[] = [];
  const notifier = createTypingNotifier({ postTyping: async (c) => {
      calls.push(c);
    }, now: () => now });

  notifier.onKeystroke("ch", "hola");
  notifier.onSent("ch");
  notifier.onKeystroke("ch", "hola");
  expect(calls).toHaveLength(2);
});

test("ack: debounced to one request, only for the viewed channel", async () => {
  const calls: Array<[string, string]> = [];
  const scheduler = createAckScheduler({ postAck: async (c, m, _token) => { calls.push([c, m]); return { token: null }; }, debounceMs: 20 });

  scheduler.viewing("ch", "100000000000000100");
  scheduler.viewing("ch", "100000000000000101");
  scheduler.viewing("ch", "100000000000000100");
  await Bun.sleep(50);
  expect(calls).toEqual([["ch", "100000000000000100"]]);
});

test("ack: leaving the channel before the debounce cancels it", async () => {
  const calls: string[] = [];
  const scheduler = createAckScheduler({ postAck: async () => { calls.push("ack"); return { token: null }; }, debounceMs: 20 });

  scheduler.viewing("ch", "100000000000000100");
  scheduler.viewing(null, null);
  await Bun.sleep(50);
  expect(calls).toHaveLength(0);
});

test("ack: no ack when the newest visible is not newer than the last acked", async () => {
  const calls: string[] = [];
  const scheduler = createAckScheduler({ postAck: async () => { calls.push("ack"); return { token: null }; }, debounceMs: 20 });

  scheduler.viewing("ch", "100000000000000101");
  await Bun.sleep(30);
  scheduler.viewing("ch", "100000000000000100");
  await Bun.sleep(30);
  expect(calls).toHaveLength(1);
});
