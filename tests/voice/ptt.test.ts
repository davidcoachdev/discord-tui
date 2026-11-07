import { describe, expect, test } from "bun:test";

import { createPtt } from "../../src/voice/ptt";

const WARNING = "tu terminal no avisa cuando soltás la tecla: el PTT funciona como interruptor";

describe("createPtt", () => {
  test("hold: press starts, repeats are ignored, release stops", () => {
    const ptt = createPtt({ kittyKeyboard: true });
    expect(ptt.mode).toBe("hold");
    expect(ptt.warning).toBeNull();
    ptt.onKey({ name: "space", eventType: "press" });
    expect(ptt.transmitting).toBe(true);
    ptt.onKey({ name: "space", eventType: "repeat" });
    ptt.onKey({ name: "space", eventType: "press", repeated: true });
    expect(ptt.transmitting).toBe(true);
    expect(ptt.mode).toBe("hold");
    ptt.onKey({ name: "space", eventType: "release" });
    expect(ptt.transmitting).toBe(false);
  });

  test("ignores keys other than space", () => {
    const ptt = createPtt({ kittyKeyboard: true });
    ptt.onKey({ name: "a", eventType: "press" });
    expect(ptt.transmitting).toBe(false);
  });

  test("no kitty keyboard: toggle mode with warning", () => {
    const ptt = createPtt({ kittyKeyboard: false });
    expect(ptt.mode).toBe("toggle");
    expect(ptt.warning).toBe(WARNING);
    ptt.onKey({ name: "space", eventType: "press" });
    expect(ptt.transmitting).toBe(true);
    ptt.onKey({ name: "space", eventType: "release" });
    expect(ptt.transmitting).toBe(true);
    ptt.onKey({ name: "space", eventType: "press", repeated: true });
    expect(ptt.transmitting).toBe(true);
    ptt.onKey({ name: "space", eventType: "press" });
    expect(ptt.transmitting).toBe(false);
  });

  test("press, press without release switches to toggle", () => {
    const ptt = createPtt({ kittyKeyboard: true });
    let changes = 0;
    ptt.onChange(() => {
      changes += 1;
    });
    ptt.onKey({ name: "space", eventType: "press" });
    ptt.onKey({ name: "space", eventType: "press" });
    expect(ptt.mode).toBe("toggle");
    expect(ptt.warning).toBe(WARNING);
    expect(ptt.transmitting).toBe(false);
    expect(changes).toBe(2);
  });

  test("onChange unsubscribe and reset", () => {
    const ptt = createPtt({ kittyKeyboard: true });
    let changes = 0;
    const off = ptt.onChange(() => {
      changes += 1;
    });
    ptt.onKey({ name: "space", eventType: "press" });
    expect(changes).toBe(1);
    ptt.reset();
    expect(ptt.transmitting).toBe(false);
    expect(changes).toBe(2);
    off();
    ptt.onKey({ name: "space", eventType: "press" });
    expect(changes).toBe(2);
  });
});
