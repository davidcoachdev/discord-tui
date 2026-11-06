import { createCliRenderer, resolveImageRenderProtocol } from "@opentui/core";
import { render, useKeyboard, useRenderer, type JSX } from "@opentui/solid";
import { join } from "node:path";

const images = join(import.meta.dir, "..", "tests", "fixtures", "images");
const png = join(images, "sample.png");
const gif = join(images, "sample.gif");

function Spike(): JSX.Element {
  const renderer = useRenderer();
  const protocol = resolveImageRenderProtocol("auto", renderer.capabilities ?? null, true);

  useKeyboard((key) => {
    if (key.name === "q") {
      renderer.destroy();
      void renderer.closed.then(() => process.exit(0));
    }
  });

  return (
    <box flexDirection="column" padding={1} gap={1}>
      <text>{`protocolo: ${protocol} kitty=${renderer.capabilities?.kitty_graphics ?? false}`}</text>
      <image source={png} protocol="auto" fit="fit" width={64} height={64} />
      <image source={gif} protocol="auto" fit="fit" width={64} height={64} />
      <text>q para salir</text>
    </box>
  );
}

const renderer = await createCliRenderer({ useKittyKeyboard: { events: true } });
await render(() => <Spike />, renderer);
