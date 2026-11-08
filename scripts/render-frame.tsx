// Imprime un frame de la UI con el estado de demo, sin terminal ni red.
// Uso: W=160 H=45 KEYS="j,k,^k,ENTER,WAIT300" bun scripts/render-frame.tsx
// Teclas: letras, ENTER, S-ENTER, ESC, SPACE, left/right/up/down (^left: con Ctrl), home, end,
// delete, backspace, ^x (Ctrl-x), M-x (Alt-x), WAITms y TYPE:texto. Usa el protocolo de Kitty como la app.
import { testRender } from "@opentui/solid";

const NAMED: Record<string, string> = { home: "HOME", end: "END", delete: "DELETE", backspace: "BACKSPACE" };

import { App } from "../src/ui/App";
import { buildDemoStore, demoActions } from "./demo-state";

const store = buildDemoStore();
const actions = demoActions(store);
const W = Number(process.env.W ?? 160);
const H = Number(process.env.H ?? 45);
const { captureCharFrame, renderOnce, mockInput, renderer } = await testRender(
  () => <App store={store} actions={actions} onQuit={() => {}} />,
  { width: W, height: H, kittyKeyboard: true },
);
await renderOnce();
for (const k of (process.env.KEYS ?? "").split(",").filter(Boolean)) {
  if (k === "ENTER") mockInput.pressEnter();
  else if (k === "ESC") mockInput.pressKeys(["\u001b[27u"]);
  else if (k === "SPACE") mockInput.pressKey(" ");
  else if (k === "S-ENTER") mockInput.pressEnter({ shift: true });
  else if (/^\^?(left|right|up|down)$/.test(k)) mockInput.pressArrow(k.replace("^", "") as "left", { ctrl: k.startsWith("^") });
  else if (k in NAMED) mockInput.pressKey(NAMED[k]!);
  else if (k.startsWith("M-")) mockInput.pressKey(k.slice(2), { meta: true });
  else if (k.startsWith("^")) mockInput.pressKey(k.slice(1), { ctrl: true });
  else if (k.startsWith("WAIT")) await Bun.sleep(Number(k.slice(4)));
  else if (k.startsWith("TYPE:")) await mockInput.typeText(k.slice(5));
  else mockInput.pressKey(k);
  await renderOnce();
}
await renderOnce();
console.log(captureCharFrame());
renderer.destroy();
process.exit(0);
