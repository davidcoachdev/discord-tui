import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";

import type { RaEvent } from "../../src/auth/remote-auth";
import { findTokenLike } from "../../src/security/token-pattern";
import { LoginScreen } from "../../src/ui/screens/LoginScreen";
import { fakeToken } from "../helpers/fake-token";

function fakeAuth() {
  let listener: ((event: RaEvent) => void) | null = null;
  return {
    auth: {
      on(fn: (event: RaEvent) => void) {
        listener = fn;
        return () => {
          listener = null;
        };
      },
      start() {},
    },
    emit(event: RaEvent) {
      listener?.(event);
    },
  };
}

test("shows the QR and the scan hint on qr event", async () => {
  const { auth, emit } = fakeAuth();
  const { captureCharFrame, renderOnce } = await testRender(
    () => <LoginScreen auth={auth} onPasteToken={async () => null} />,
    { width: 100, height: 30 },
  );
  emit({ type: "qr", url: "https://discord.com/ra/abc" });
  await renderOnce();
  expect(captureCharFrame()).toContain("Escaneá el código");
});

test("shows the username on scanned", async () => {
  const { auth, emit } = fakeAuth();
  const { captureCharFrame, renderOnce } = await testRender(
    () => <LoginScreen auth={auth} onPasteToken={async () => null} />,
    { width: 100, height: 30 },
  );
  emit({ type: "scanned", username: "gonfake" });
  await renderOnce();
  expect(captureCharFrame()).toContain("¿Sos vos, gonfake?");
});

test("captcha switches to the paste screen with the literal message", async () => {
  const { auth, emit } = fakeAuth();
  const { captureCharFrame, renderOnce } = await testRender(
    () => <LoginScreen auth={auth} onPasteToken={async () => null} />,
    { width: 100, height: 30 },
  );
  emit({ type: "captcha" });
  await renderOnce();
  expect(captureCharFrame()).toContain("Discord pidió captcha, pegá el token");
});

test("pasted token is masked on screen", async () => {
  const { auth } = fakeAuth();
  const { captureCharFrame, mockInput, renderOnce } = await testRender(
    () => <LoginScreen auth={auth} onPasteToken={async () => null} />,
    { width: 100, height: 30 },
  );
  await mockInput.pasteBracketedText(fakeToken());
  await renderOnce();
  expect(findTokenLike(captureCharFrame())).toEqual([]);
});
