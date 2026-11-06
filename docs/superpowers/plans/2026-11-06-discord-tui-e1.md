# discord-tui E1 (login): plan de implementación

> **Para el agente ejecutor (DeepSeek V4 Pro en dsh):** tarea por tarea, en orden. TDD: test que falla → mínimo código → test en verde. Antes de tildar un `- [ ]` corrés la verificación y pegás la salida. Al cerrar cada tarea: commit **y** `git push origin main`. Los **🧍 Paso de Gon** los hace Gon: frenás, le pasás el paso y esperás. Nunca leés el token ni `session.json`, nunca corrés `scripts/leak-check.ts` (ver `AGENTS.md`). Ante la duda, preguntás.

**Goal:** loguearse con QR (remote auth v2) o pegando el token, guardar la sesión en `~/.config/discord-tui/session.json` con modo 0600 y entrar directo en los arranques siguientes.

**Architecture:** `auth/` tiene la máquina de estados del remote auth (WS inyectable, probada contra un servidor falso que sigue la spec 6.5), la cripto RSA-OAEP con WebCrypto y el archivo de sesión. `client-props/` arma `X-Super-Properties` y headers. `rest/http.ts` es un `fetch` mínimo con esos headers; E2 le pone colas arriba. La UI de login es una pantalla OpenTUI que solo escucha eventos de `RemoteAuth`.

**Tech Stack:** lo de E0, más WebCrypto y `WebSocket` de Bun (con `headers`), `@opentui/qrcode` 0.8.2 (`registerQRCode()` + elemento `qr_code`).

**Spec:** `docs/superpowers/specs/2026-11-06-discord-tui-design.md` (6.4, 6.5, 8, 9/E1).

## Global Constraints

- Las de E0 (versiones exactas, `Secret`, logger con lista blanca, `fakeToken()`, nada de literales con forma de token).
- Remote auth: `wss://remote-auth-gateway.discord.gg/?v=2` con header `Origin: https://discord.com` (spec 6.5). El `WebSocket` de Bun acepta `{ headers }` y manda ese Origin (probado local por nosotros el 2026-11-06 contra un `Bun.serve`).
- RSA-OAEP 2048, e=65537, SHA-256 (hash y MGF1), sin label. QR = `https://discord.com/ra/<fingerprint>`. `nonce` va en base64url sin padding.
- REST base `https://discord.com/api/v9`. Login: `POST /users/@me/remote-auth/login` con `{ ticket }`. Validación del token: `GET /users/@me`.
- Captcha: si la respuesta trae `captcha_key` o `captcha_sitekey`, **no se intenta resolver**; se muestra literal `Discord pidió captcha, pegá el token` y se pasa a pegar el token.
- Sesión: `~/.config/discord-tui/session.json` creada con `open(..., 0o600)` (nunca chmod después), carpeta 0700; si el modo no es 600 al arrancar, el programa se niega a arrancar. Contenido: `{ "version": 1, "token", "user_id", "client_build_number" }`.
- Client properties: `os: "Linux"`, `browser: "Chrome"`, `release_channel: "stable"`, `browser_user_agent` === header `User-Agent`, `client_heartbeat_session_id` se regenera cada 30 min. Headers en cada request: `X-Super-Properties`, `X-Discord-Locale`, `X-Debug-Options: bugReporterEnabled`, `User-Agent`. **Nunca** `Authorization` hacia hosts que no sean `discord.com`.
- Errores de red: se loguea solo `method`, `route`, `status`, `code` (spec 8).

## Review Focus

- Teléfono que escanea y después **cancela**: llega `cancel` y close 1000; la pantalla vuelve a un QR nuevo, no queda colgada (Task 5).
- QR que expira mientras Gon mira (close 4003): se genera un par de claves nuevo y un QR nuevo, sin reiniciar la app (Task 5).
- Token pegado con espacios, comillas o el prefijo `Bearer `/`Bot `: se limpia espacios y comillas; con prefijo se rechaza con un mensaje (Discord de usuario no usa prefijo) (Task 6).
- `session.json` corrupto (JSON inválido) o de otra versión: se trata como "sin sesión" y se muestra el login, sin tirar el contenido en pantalla (Task 3).
- Sin red al arrancar con sesión guardada: no se borra la sesión; se muestra `sin conexión, reintentando` (la validación da error de red, no 401) (Task 7).

---

### Task 1: Spike del `client_build_number` [sin verificar en spec 6.4]

**Files:**
- Create: `src/client-props/build-number.ts`, `docs/protocol-notes.md`
- Test: `tests/client-props/build-number.test.ts`, `tests/fixtures/web/app-shell.html` (HTML mínimo armado a mano)

**Interfaces:**
- Produces: `extractBuildNumber(js: string): number | null`; `fetchBuildNumber(deps: { fetch: typeof fetch; cached?: number }): Promise<{ value: number; source: "live" | "cache" | "fallback" }>`; `FALLBACK_BUILD_NUMBER: number`.

Este request **no lleva token**: `GET https://discord.com/app` y los `.js` que referencia son públicos, así que el agente sí lo puede correr.

- [x] **Step 1: Spike (criterio pass/fail).** Escribir `scripts/spike-build-number.ts` que baja `https://discord.com/app`, lista los `<script src="/assets/...js">` y busca en cada uno `/buildNumber["']?\s*[:=]\s*["']?(\d{5,7})/` (también `build_number`). Run: `bun scripts/spike-build-number.ts`. **Pass:** imprime un número de 5 a 7 dígitos en menos de 10 s. **Fail:** no lo encuentra en ningún asset. En los dos casos se anota en `docs/protocol-notes.md`, sección "client_build_number", el método que anduvo, la fecha y el número.

```text
$ time bun scripts/spike-build-number.ts
663810

real    0m0.273s
```

Resultado: **pass**. El número está en el HTML de `/app`, en `window.GLOBAL_ENV` (`"BUILD_NUMBER":"663810"`); el spike lo lee de ahí y deja el escaneo de assets como respaldo. Documentado en `docs/protocol-notes.md` (método, fecha 2026-11-06 y número).
- [x] **Step 2: Fallback si falla (el que nombra la spec):** se usa el último cacheado en `session.json`, y si no hay, `FALLBACK_BUILD_NUMBER` con el número que Gon copia de su navegador en E1.5. Hasta E1.5 `FALLBACK_BUILD_NUMBER` es el número que haya dado el spike, o el que Gon lea en DevTools si el spike falló (**🧍 Paso de Gon**: en Chrome, `discord.com/app` → DevTools → Network → cualquier request a `/api/v9` → copiar el valor del header `X-Super-Properties` → en la consola de DevTools correr `JSON.parse(atob("<valor>")).client_build_number` y pasarle solo ese número al agente).

El spike pasó, así que `FALLBACK_BUILD_NUMBER = 663810` y no hizo falta el paso de Gon.
- [x] **Step 3: Tests**

```ts
test("extractBuildNumber finds the number in a minified asset", () => {
  expect(extractBuildNumber('x={buildNumber:"412345",y:1}')).toBe(412345);
  expect(extractBuildNumber("nothing here")).toBeNull();
});
test("fetchBuildNumber falls back to cache, then to the constant", async () => {
  const failing = async () => { throw new TypeError("network"); };
  expect(await fetchBuildNumber({ fetch: failing as any, cached: 400000 })).toEqual({ value: 400000, source: "cache" });
  expect((await fetchBuildNumber({ fetch: failing as any })).source).toBe("fallback");
});
```

- [x] **Step 4:** implementar con timeout de 10 s (`AbortSignal.timeout(10_000)`). Run: `bun test tests/client-props` · Expected: PASS.

```text
$ bun test tests/client-props
 4 pass
 0 fail
 6 expect() calls
Ran 4 tests across 1 file. [119.00ms]

$ bun test && bun run typecheck
 17 pass
 0 fail
 32 expect() calls
Ran 17 tests across 6 files. [282.00ms]
$ tsc --noEmit   # sin salida, código 0
```

- [x] **Step 5:** commit `feat(e1): client build number discovery` + push.

---

### Task 2: Client properties y `rest/http.ts`

**Files:**
- Create: `src/client-props/props.ts`, `src/rest/http.ts`, `src/rest/errors.ts`
- Test: `tests/client-props/props.test.ts`, `tests/rest/http.test.ts`, `tests/fakes/fake-http.ts`

**Interfaces:**
- Produces:
  - `CHROME_UA: string` (un UA real de Chrome estable sobre Linux; E1.5 lo reemplaza por el que trae la captura de Gon).
  - `createClientProps(opts: { buildNumber: number; locale?: string; now?: () => number }): ClientProps` con `superProperties(): SuperProperties` (regenera `client_heartbeat_session_id` si pasaron 30 min), `encoded(): string` (base64 del JSON), `headers(): Record<string, string>`.
  - `createHttp(deps: { props: ClientProps; token?: Secret; baseUrl?: string; fetch?: typeof fetch }): Http` con `request<T>(method: string, path: string, body?: unknown): Promise<T>`. Errores: `HttpError { status; code?: number; route: string }`, `UnauthorizedError extends HttpError` (401), `CaptchaRequiredError` (cuerpo con `captcha_key` o `captcha_sitekey`), `NetworkError`.
  - `startFakeHttp(handler: (req: Request) => Response | Promise<Response>): { url: string; requests: Request[]; stop(): void }` en `tests/fakes/fake-http.ts`.

- [ ] **Step 1: Tests que fallan**

```ts
test("browser_user_agent matches the User-Agent header", () => {
  const p = createClientProps({ buildNumber: 400000 });
  expect(p.superProperties().browser_user_agent).toBe(p.headers()["User-Agent"]);
  expect(p.superProperties()).toMatchObject({ os: "Linux", browser: "Chrome", release_channel: "stable", client_build_number: 400000 });
});
test("heartbeat session id rotates after 30 minutes", () => {
  let now = 0; const p = createClientProps({ buildNumber: 1, now: () => now });
  const a = p.superProperties().client_heartbeat_session_id;
  now = 29 * 60_000; expect(p.superProperties().client_heartbeat_session_id).toBe(a);
  now = 30 * 60_000 + 1; expect(p.superProperties().client_heartbeat_session_id).not.toBe(a);
});
test("X-Super-Properties is sent on every request and decodes to the same object", async () => { /* fake-http */ });
test("Authorization carries the raw token, no prefix", async () => {
  // createHttp({ token: new Secret(fakeToken()) }) → requests[0].headers.get("authorization") === fakeToken()
});
test("401 throws UnauthorizedError and the log line has only method, route, status", async () => {
  expect(findTokenLike(logFile)).toEqual([]);
  expect(logFile).not.toContain("authorization");
});
test("captcha body throws CaptchaRequiredError", async () => {
  // handler → 400 { captcha_key: ["captcha-required"], captcha_sitekey: "x" }
});
```

- [ ] **Step 2:** Run `bun test tests/client-props tests/rest` · Expected: FAIL.
- [ ] **Step 3:** implementar. La ruta que se loguea es la plantilla con los ids reemplazados por `:id` (`/channels/:id/messages`), nunca la query string.
- [ ] **Step 4:** Run `bun test && bun run typecheck` · Expected: PASS.
- [ ] **Step 5:** commit `feat(e1): client properties and minimal http client` + push.

---

### Task 3: Archivo de sesión 0600

**Files:**
- Create: `src/auth/session.ts`
- Test: `tests/auth/session.test.ts`

**Interfaces:**
- Consumes: `sessionPath()`, `configDir()` (E0 Task 2), `Secret`.
- Produces: `type Session = { token: Secret; userId: string; buildNumber: number | null }`; `saveSession(s: Session): Promise<void>`; `loadSession(): Promise<Session | null>`; `deleteSession(): Promise<boolean>`; `class SessionPermissionError extends Error { mode: number }`.

- [ ] **Step 1: Tests que fallan** (todos con `XDG_CONFIG_HOME` en una carpeta temporal)

```ts
test("saveSession creates file 0600 and dir 0700 from the start", async () => {
  await saveSession({ token: new Secret(fakeToken()), userId: "1", buildNumber: 400000 });
  expect(statSync(sessionPath()).mode & 0o777).toBe(0o600);
  expect(statSync(configDir()).mode & 0o777).toBe(0o700);
});
test("loadSession round-trips and returns a Secret", async () => {
  const s = await loadSession();
  expect(s!.token).toBeInstanceOf(Secret);
  expect(s!.token.reveal()).toBe(fakeToken());
});
test("loadSession refuses a file that is not 0600", async () => {
  chmodSync(sessionPath(), 0o644);
  await expect(loadSession()).rejects.toBeInstanceOf(SessionPermissionError);
});
test("missing, corrupt or wrong-version session returns null without echoing content", async () => {
  // archivo con "{no json" (modo 600) → null; { version: 2 } → null
});
test("deleteSession removes the file", async () => { expect(await deleteSession()).toBe(true); expect(existsSync(sessionPath())).toBe(false); });
```

- [ ] **Step 2:** Run `bun test tests/auth/session.test.ts` · Expected: FAIL.
- [ ] **Step 3:** implementar. Escritura atómica: `open(tmp, "wx", 0o600)` en la misma carpeta, write, fsync, `rename` sobre `session.json`.
- [ ] **Step 4:** Run `bun test && bun run typecheck` · Expected: PASS.
- [ ] **Step 5:** commit `feat(e1): session file with 0600 permissions` + push.

---

### Task 4: Cripto del remote auth

**Files:**
- Create: `src/auth/ra-crypto.ts`
- Test: `tests/auth/ra-crypto.test.ts`

**Interfaces:**
- Produces: `generateRaKeys(): Promise<RaKeys>` con `RaKeys = { publicSpkiB64: string; fingerprint: string; decrypt(b64: string): Promise<Uint8Array> }`; `fingerprintOf(spkiDer: Uint8Array): string` (SHA-256, base64url sin padding); `toBase64Url(bytes: Uint8Array): string`.

- [ ] **Step 1: Tests que fallan**

```ts
test("fingerprintOf is sha256 base64url without padding", () => {
  expect(fingerprintOf(new Uint8Array([1, 2, 3]))).toBe("A5BYxvLAy0ksUzsKTRTvd8wPeKvMztUofYShogEc-4E");
});
test("decrypt reverses RSA-OAEP SHA-256 encryption with the exported public key", async () => {
  const k = await generateRaKeys();
  // importar publicSpkiB64 como RSA-OAEP SHA-256 y cifrar "hola"
  expect(new TextDecoder().decode(await k.decrypt(cipherB64))).toBe("hola");
});
test("fingerprint matches the exported key", async () => {
  const k = await generateRaKeys();
  expect(k.fingerprint).toBe(fingerprintOf(Buffer.from(k.publicSpkiB64, "base64")));
});
```

- [ ] **Step 2–4:** correr (FAIL), implementar con `crypto.subtle.generateKey({ name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1,0,1]), hash: "SHA-256" }, false, ["decrypt","encrypt"])`, correr `bun test tests/auth` (PASS).
- [ ] **Step 5:** commit `feat(e1): remote auth crypto` + push.

---

### Task 5: Máquina de estados del remote auth contra un WS falso

**Files:**
- Create: `src/auth/remote-auth.ts`
- Create: `tests/fakes/fake-remote-auth.ts`
- Test: `tests/auth/remote-auth.test.ts`

**Interfaces:**
- Consumes: `generateRaKeys` (Task 4), `Http` (Task 2).
- Produces:
  - `type RaEvent = { type: "qr"; url: string } | { type: "scanned"; username: string } | { type: "token"; token: Secret; userId: string } | { type: "captcha" } | { type: "cancelled" } | { type: "error"; reason: string }`.
  - `createRemoteAuth(deps: { http: Http; wsUrl?: string; makeKeys?: typeof generateRaKeys; WebSocketImpl?: typeof WebSocket }): { start(): void; stop(): void; on(fn: (e: RaEvent) => void): () => void }`.
  - `startFakeRemoteAuth(script: FakeRaScript): { url: string; received: any[]; stop(): void }`: servidor `Bun.serve` que hace el rol del gateway según spec 6.5 (`hello` → espera `init` → manda `nonce_proof` cifrado con la clave recibida → verifica el `nonce` → `pending_remote_init` → `pending_ticket` → `pending_login` o `cancel`), con opciones para mandar un fingerprint incorrecto, cerrar con 4003, dejar de mandar `heartbeat_ack`, y registrar el header `Origin`.

- [ ] **Step 1: Tests que fallan**

```ts
test("happy path: qr → scanned → token", async () => {
  // fake con pending_ticket cuyo encrypted_user_payload = "1:0:av:gonfake"; http fake devuelve { encrypted_token } = cifrado de fakeToken()
  expect(events.map(e => e.type)).toEqual(["qr", "scanned", "token"]);
  expect(qr.url).toBe(`https://discord.com/ra/${fingerprint}`);
  expect(scanned.username).toBe("gonfake");
  expect(tokenEv.token.reveal()).toBe(fakeToken());
  expect(fake.originHeader).toBe("https://discord.com");
});
test("nonce_proof answer is base64url without padding", () => { expect(nonceSent).toMatch(/^[A-Za-z0-9_-]+$/); });
test("fingerprint mismatch reconnects with a fresh key pair", async () => { expect(fake.connections).toBe(2); });
test("close 4003 produces a new qr without restarting", async () => { expect(events.filter(e => e.type === "qr")).toHaveLength(2); });
test("cancel emits cancelled and then a new qr", async () => {});
test("missing heartbeat_ack reconnects", async () => { /* heartbeat_interval 50 ms en el fake */ });
test("captcha on login emits captcha and stops", async () => { /* http fake → CaptchaRequiredError */ });
test("4000/4001/4002 retry, 1000 after pending_login does not", async () => {});
```

- [ ] **Step 2:** Run `bun test tests/auth/remote-auth.test.ts` · Expected: FAIL.
- [ ] **Step 3:** implementar. Heartbeat: `{ op: "heartbeat" }` cada `heartbeat_interval`; si no llegó `heartbeat_ack` antes del siguiente, cierra y reconecta. Tope de reintentos: 5 seguidos, después `error`. El `userId` sale de `encrypted_user_payload` (`id:discriminator:avatar:username`).
- [ ] **Step 4:** Run `bun test && bun run typecheck` · Expected: PASS.
- [ ] **Step 5:** commit `feat(e1): remote auth state machine` + push.

---

### Task 6: Token pegado

**Files:**
- Create: `src/auth/token-login.ts`
- Test: `tests/auth/token-login.test.ts`

**Interfaces:**
- Produces: `normalizePastedToken(raw: string): { ok: true; token: Secret } | { ok: false; reason: "empty" | "prefixed" | "shape" }`; `validateToken(token: Secret, http: Http): Promise<{ userId: string; username: string }>` (`GET /users/@me`; 401 → `UnauthorizedError`).

- [ ] **Step 1: Tests**

```ts
test("trims spaces and quotes", () => {
  const r = normalizePastedToken(`  "${fakeToken()}"\n`);
  expect(r.ok && r.token.reveal()).toBe(fakeToken());
});
test("rejects Bearer/Bot prefixes and non-token shapes", () => {
  expect(normalizePastedToken(`Bot ${fakeToken()}`)).toEqual({ ok: false, reason: "prefixed" });
  expect(normalizePastedToken("hola")).toEqual({ ok: false, reason: "shape" });
});
test("validateToken returns user on 200 and throws UnauthorizedError on 401", async () => {});
```

- [ ] **Step 2–4:** FAIL → implementar → `bun test` PASS.
- [ ] **Step 5:** commit `feat(e1): pasted token login` + push.

---

### Task 7: Pantalla de login, arranque y `logout`

**Files:**
- Create: `src/ui/screens/LoginScreen.tsx`, `src/app/boot.ts`
- Modify: `src/main.tsx`, `src/ui/App.tsx` (StatusBar muestra `logueado como <username>`)
- Test: `tests/ui/login-screen.test.tsx`, `tests/app/boot.test.ts`

**Interfaces:**
- Consumes: `createRemoteAuth`, `normalizePastedToken`, `validateToken`, `saveSession`, `loadSession`, `deleteSession`.
- Produces:
  - `LoginScreen(props: { auth: { on(fn: (e: RaEvent) => void): () => void; start(): void }; onPasteToken(raw: string): Promise<string | null>; }): JSX.Element` (`onPasteToken` devuelve el mensaje de error o `null`).
  - `boot(argv: string[], deps: BootDeps): Promise<{ kind: "logout-done" } | { kind: "login" } | { kind: "main"; session: Session; me: { id: string; username: string } } | { kind: "offline"; session: Session } | { kind: "fatal"; message: string }>`.
  - Textos literales: `Escaneá el código con la app de Discord`, `¿Sos vos, <username>? Confirmá en el teléfono`, `Discord pidió captcha, pegá el token`, `Pegá tu token (p para pegar, se ve como ••••)`, `logueado como <username>`, `sin conexión, reintentando`, `session.json tiene permisos <modo>; tienen que ser 600. Corré: chmod 600 ~/.config/discord-tui/session.json`.
  - Pantalla de token: instrucciones en 3 líneas (DevTools → Network → un request a `/api/v9` → header `Authorization`). El input muestra `•` por carácter, nunca el texto.

- [ ] **Step 1: Tests**

```tsx
test("shows the QR and the scan hint on qr event", async () => { expect(frame).toContain("Escaneá el código"); });
test("shows the username on scanned", async () => { expect(frame).toContain("¿Sos vos, gonfake?"); });
test("captcha switches to the paste screen with the literal message", async () => { expect(frame).toContain("Discord pidió captcha, pegá el token"); });
test("pasted token is masked on screen", async () => {
  await mockInput.pasteBracketedText(fakeToken());
  expect(findTokenLike(captureCharFrame())).toEqual([]);
});
```

```ts
test("boot with a valid session goes to main", async () => {});
test("boot with session mode 644 is fatal with the chmod hint", async () => { expect(r).toMatchObject({ kind: "fatal" }); });
test("boot with 401 deletes nothing and goes to login", async () => {});
test("boot with network error keeps the session and returns offline", async () => {});
test("argv ['logout'] deletes the session", async () => { expect(r.kind).toBe("logout-done"); });
```

- [ ] **Step 2–4:** FAIL → implementar → `bun test && bun run typecheck` PASS. **[nuestra]** Con 401 al arrancar no se borra la sesión sola: se va al login y la sesión nueva la pisa.
- [ ] **Step 5:** commit `feat(e1): login screen, boot and logout` + push.

---

### Task 8: `scripts/leak-check.ts` y checkpoint E1

**Files:**
- Create: `scripts/leak-check.ts`
- Test: `tests/scripts/leak-check.test.ts`

**Interfaces:**
- Produces: `leakCheck(opts: { sessionFile: string; scanDirs: string[] }): Promise<{ filesScanned: number; matches: number; files: string[] }>`. La CLI imprime solo `OK: 0 coincidencias en N archivos` o `FALLA: K coincidencias en: <paths>`, y sale con código 1 si hay. Nunca imprime el token ni líneas.

Lo corre **solo Gon**. El agente solo lo prueba con una sesión falsa en una carpeta temporal.

- [ ] **Step 1: Test**

```ts
test("reports matches by file without printing the token", async () => {
  // sesión temporal con fakeToken(); un log temporal que lo contiene; otro que no
  expect(r).toMatchObject({ matches: 1, files: [leakyPath] });
  expect(stdout).not.toContain(fakeToken());
});
```

- [ ] **Step 2–4:** FAIL → implementar (por defecto escanea la carpeta de `logPath()` y los archivos del repo) → PASS. Agregar script `"leak-check": "bun scripts/leak-check.ts"`.
- [ ] **Step 5:** commit `feat(e1): leak-check script for Gon` + push.

- [ ] **Step 6: 🧍 Paso de Gon — login real (checkpoint E1)**

En Ghostty, sin tmux, desde `~/projects/discord-tui`:
1. `bun run dev` → ve un QR y `Escaneá el código con la app de Discord`.
2. Lo escanea con la app del teléfono → ve `¿Sos vos, <su usuario>?` → confirma en el teléfono → ve `logueado como <su usuario>` abajo. Si en cambio ve `Discord pidió captcha, pegá el token`: sigue las 3 líneas de la pantalla, pega el token con Ctrl+Shift+V y tiene que ver lo mismo.
3. `q`, y otra vez `bun run dev` → entra directo, sin QR.
4. `stat -c %a ~/.config/discord-tui/session.json` → `600`. `stat -c %a ~/.config/discord-tui` → `700`.
5. `bun run leak-check` → `OK: 0 coincidencias en N archivos`.
6. `bun run dev logout` → vuelve al prompt; `ls ~/.config/discord-tui/session.json` → "No such file". Volver a loguearse (paso 1-2) para seguir con E1.5.
7. Le pasa al agente solo: qué pasos dieron lo esperado, si hubo captcha, y si algo falló, las líneas de `~/.local/state/discord-tui/discord-tui.log` (ya vienen redactadas) **después** de que `bun run leak-check` dio OK.
