// Imprime un frame de la UI con el estado de demo, sin terminal ni red.
// Uso: W=160 H=45 KEYS="j,k,^k,ENTER,WAIT300" bun scripts/render-frame.tsx
import { testRender } from "@opentui/solid";

import { App } from "../src/ui/App";
import { buildDemoStore, demoActions } from "./demo-state";

const store = buildDemoStore();
const actions = demoActions(store);
const W = Number(process.env.W ?? 160);
const H = Number(process.env.H ?? 45);
const { captureCharFrame, renderOnce, mockInput, renderer } = await testRender(
  () => <App store={store} actions={actions} onQuit={() => {}} />,
  { width: W, height: H },
);
await renderOnce();
for (const k of (process.env.KEYS ?? "").split(",").filter(Boolean)) {
  if (k === "ENTER") mockInput.pressEnter();
  else if (k === "ESC") mockInput.pressKeys(["\u001b[27u"]);
  else if (k === "SPACE") mockInput.pressKey(" ");
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
