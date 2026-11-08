import { registerQRCode } from "@opentui/qrcode/solid";
import { useKeyboard, usePaste } from "@opentui/solid";
import { createSignal, onCleanup, onMount, Show, type JSX } from "solid-js";

import type { RaEvent } from "../../auth/remote-auth";
import { APP_NAME, APP_TAGLINE } from "../brand";
import { THEMES } from "../theme";

registerQRCode();

export interface LoginScreenProps {
  auth: { on(fn: (event: RaEvent) => void): () => void; start(): void };
  onPasteToken(raw: string): Promise<string | null>;
}

export function LoginScreen(props: LoginScreenProps): JSX.Element {
  const [username, setUsername] = createSignal<string | null>(null);
  const [qrUrl, setQrUrl] = createSignal<string | null>(null);
  const [captcha, setCaptcha] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [pastedChars, setPastedChars] = createSignal(0);

  async function paste(raw: string): Promise<void> {
    setPastedChars(raw.length);
    setError(await props.onPasteToken(raw));
  }

  async function pasteFromClipboard(): Promise<void> {
    try {
      const proc = Bun.spawn(["wl-paste", "--no-newline"], { stdout: "pipe", stderr: "ignore" });
      const text = await new Response(proc.stdout).text();
      await proc.exited;
      if (text) await paste(text);
    } catch {
      // sin wl-paste o sin portapapeles
    }
  }

  onMount(() => {
    const off = props.auth.on((event) => {
      switch (event.type) {
        case "qr":
          setQrUrl(event.url);
          setUsername(null);
          setCaptcha(false);
          break;
        case "scanned":
          setUsername(event.username);
          break;
        case "captcha":
          setCaptcha(true);
          break;
        case "error":
          setError(event.reason);
          break;
      }
    });
    onCleanup(off);
    props.auth.start();
  });

  usePaste((event) => {
    void paste(new TextDecoder().decode(event.bytes));
  });

  useKeyboard((key) => {
    if (key.name === "p" && !key.ctrl && !key.meta) void pasteFromClipboard();
  });

  return (
    <box flexDirection="column" width="100%" height="100%" padding={1} gap={1}>
      <box flexDirection="column" alignItems="center" width="100%">
        <ascii_font text={APP_NAME} font="block" color={THEMES.dark.brand.slice(0, 5)} />
        <text fg={THEMES.dark.header}>{`${APP_TAGLINE} · iniciá sesión con tu cuenta`}</text>
      </box>
      <Show when={qrUrl()}>
        <text>Escaneá el código con la app de Discord</text>
        <qr_code content={qrUrl()!} />
      </Show>
      <Show when={username()}>
        <text>{`¿Sos vos, ${username()}? Confirmá en el teléfono`}</text>
      </Show>
      <Show when={captcha()}>
        <text>Discord pidió captcha, pegá el token</text>
      </Show>
      <box flexDirection="column">
        <text>Abrí Discord en el navegador y andá a DevTools → Network.</text>
        <text>Filtrá requests a /api/v9 y recargá la página.</text>
        <text>Copiá el header Authorization y pegá el valor acá con Ctrl+Shift+V.</text>
        <text>Pegá tu token (p para pegar, se ve como ••••)</text>
        <text>{"•".repeat(pastedChars())}</text>
      </box>
      <Show when={error()}>
        <text>{error()}</text>
      </Show>
    </box>
  );
}
