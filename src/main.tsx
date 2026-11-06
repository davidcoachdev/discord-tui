import { createCliRenderer } from "@opentui/core";
import { render, useKeyboard } from "@opentui/solid";
import { createSignal, Match, onCleanup, onMount, Switch, type JSX } from "solid-js";

import { boot } from "./app/boot";
import { createRemoteAuth } from "./auth/remote-auth";
import { deleteSession, loadSession, saveSession, type Session } from "./auth/session";
import { normalizePastedToken, validateToken } from "./auth/token-login";
import { fetchBuildNumber } from "./client-props/build-number";
import { createClientProps } from "./client-props/props";
import { CaptchaRequiredError, UnauthorizedError } from "./rest/errors";
import { createHttp } from "./rest/http";
import type { Secret } from "./secret";
import { App } from "./ui/App";
import { LoginScreen } from "./ui/screens/LoginScreen";

export function assertTty(stream: { isTTY?: boolean }): string | null {
  return stream.isTTY ? null : "discord-tui necesita una terminal";
}

function LoginRoot(props: { buildNumber: number; onQuit: () => void }): JSX.Element {
  const clientProps = createClientProps({ buildNumber: props.buildNumber });
  const auth = createRemoteAuth({ http: createHttp({ props: clientProps }) });
  const [screen, setScreen] = createSignal<"login" | "main">("login");
  const [status, setStatus] = createSignal("");
  let lastName = "";

  async function finish(token: Secret, userId: string, username: string): Promise<void> {
    await saveSession({ token, userId, buildNumber: props.buildNumber });
    setStatus(`logueado como ${username}`);
    setScreen("main");
  }

  onMount(() => {
    const off = auth.on((event) => {
      if (event.type === "scanned") lastName = event.username;
      if (event.type === "token") void finish(event.token, event.userId, lastName);
    });
    onCleanup(off);
  });

  async function onPasteToken(raw: string): Promise<string | null> {
    const normalized = normalizePastedToken(raw);
    if (!normalized.ok) {
      if (normalized.reason === "empty") return "Pegá un token";
      if (normalized.reason === "prefixed") return "Sin prefijo Bot/Bearer: solo el token";
      return "Eso no parece un token de Discord";
    }
    try {
      const authed = createHttp({ props: clientProps, token: normalized.token });
      const me = await validateToken(normalized.token, authed);
      await finish(normalized.token, me.userId, me.username);
      return null;
    } catch (error) {
      if (error instanceof CaptchaRequiredError) return "Discord pidió captcha, pegá el token";
      if (error instanceof UnauthorizedError) return "Token rechazado";
      return "No se pudo validar el token";
    }
  }

  useKeyboard((key) => {
    if (screen() === "login" && key.name === "q" && !key.ctrl && !key.meta) props.onQuit();
  });

  return (
    <Switch>
      <Match when={screen() === "login"}>
        <LoginScreen auth={auth} onPasteToken={onPasteToken} />
      </Match>
      <Match when={screen() === "main"}>
        <App status={status()} onQuit={props.onQuit} />
      </Match>
    </Switch>
  );
}

async function main(): Promise<void> {
  const message = assertTty(process.stdout);
  if (message) {
    process.stderr.write(message + "\n");
    process.exit(1);
  }

  const { value: buildNumber } = await fetchBuildNumber({ fetch });
  const result = await boot(process.argv.slice(2), {
    loadSession,
    deleteSession,
    validate: async (session: Session) => {
      const http = createHttp({ props: createClientProps({ buildNumber }), token: session.token });
      const me = await validateToken(session.token, http);
      return { id: me.userId, username: me.username };
    },
  });

  if (result.kind === "logout-done") return process.exit(0);
  if (result.kind === "fatal") {
    process.stderr.write(result.message + "\n");
    return process.exit(1);
  }

  const renderer = await createCliRenderer({ useKittyKeyboard: { events: true } });
  const quit = (): void => {
    renderer.destroy();
    void renderer.closed.then(() => process.exit(0));
  };

  if (result.kind === "login") {
    await render(() => <LoginRoot buildNumber={buildNumber} onQuit={quit} />, renderer);
    return;
  }

  const status = result.kind === "main" ? `logueado como ${result.me.username}` : "sin conexión, reintentando";
  await render(() => <App status={status} onQuit={quit} />, renderer);
}

if (import.meta.main) await main();
