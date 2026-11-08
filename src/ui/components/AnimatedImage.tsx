import { ImageRenderable, NativeImagePool, ScrollBoxRenderable, type Renderable } from "@opentui/core";
import { useRenderer } from "@opentui/solid";
import { onCleanup, type JSX } from "solid-js";

import { animationScheduler, type Scheduler } from "../../images/animation";
import type { Animation } from "../../images/gif";

/** La imagen se cruza con la terminal y con cada scrollbox que la contiene. */
export function onScreen(el: Renderable, terminalHeight: number): boolean {
  if (el.isDestroyed || !el.visible) return false;
  const top = el.screenY;
  const bottom = top + el.height;
  if (bottom <= 0 || top >= terminalHeight) return false;
  for (let p = el.parent; p; p = p.parent) {
    if (p instanceof ScrollBoxRenderable && (bottom <= p.screenY || top >= p.screenY + p.height)) return false;
  }
  return true;
}

/**
 * GIF animado: un `<image>` al que se le cambia el cuadro desde el scheduler compartido (no pasa por
 * Solid, así la lista de mensajes no se vuelve a dibujar por cuadro). Los cuadros se suben con un
 * `NativeImagePool` que reusa 3 buffers nativos.
 */
export function AnimatedImage(props: { animation: Animation; cols: number; rows: number; scheduler?: Scheduler }): JSX.Element {
  const renderer = useRenderer();
  const animation = props.animation;
  let el: ImageRenderable | undefined;
  let pool: NativeImagePool | null = null;

  function show(index: number): void {
    if (!el || el.isDestroyed) return;
    const frame = animation.frames[index];
    if (!frame) return;
    try {
      pool ??= new NativeImagePool({ width: animation.width, height: animation.height, capacity: 3, owner: renderer.nativeScene.resourceContext });
      const image = pool.publishRgba(frame.rgba);
      if (!image) return; // los 3 buffers ocupados: se saltea este cuadro
      el.source = image; // el renderable se queda con su propia referencia
      image.dispose();
    } catch {
      // renderer cerrándose o buffer inválido: queda el último cuadro
    }
  }

  const handle = (props.scheduler ?? animationScheduler).add(
    animation.frames.map((f) => f.delayMs),
    show,
    () => el !== undefined && onScreen(el, renderer.height),
  );
  onCleanup(() => {
    handle.stop();
    pool?.dispose();
    pool = null;
  });

  return (
    <image
      ref={(node: ImageRenderable) => {
        el = node;
        show(0);
      }}
      width={props.cols}
      height={props.rows}
      fit="fit"
      protocol="auto"
    />
  );
}
