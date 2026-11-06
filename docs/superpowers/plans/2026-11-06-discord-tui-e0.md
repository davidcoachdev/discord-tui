# discord-tui E0 (esqueleto): plan de implementación

> **Para el agente ejecutor (DeepSeek V4 Pro en dsh):** este plan se ejecuta tarea por tarea, en orden, sin saltear ninguna. Cada tarea va con TDD: primero el test que falla, después el mínimo código que lo hace pasar y al final los tests en verde. Antes de tildar un `- [ ]` corrés el comando de verificación y pegás la salida debajo del paso. Al terminar cada tarea hacés commit **y** `git push origin main` (regla de Gon). Los pasos **🧍 Paso de Gon** no los hacés vos: frenás, le pasás a Gon el texto del paso y esperás su resultado. Nunca leés el token ni `~/.config/discord-tui/session.json` (ver `AGENTS.md`). Si un paso no se puede cumplir tal cual, frenás y preguntás. No improvises.

**Goal:** proyecto Bun + OpenTUI 0.8.2 fijado que dibuja un layout vacío de tres columnas, sale con `q`, y ya trae las defensas del token (tipo `Secret`, logger con lista blanca, test anti-filtración).

**Architecture:** TypeScript sobre Bun, UI con `@opentui/solid`. Desde el día uno existen `src/security/` (detector de strings con forma de token), `src/secret.ts` y `src/log/` (logger a archivo con campos permitidos), porque todas las etapas los usan.

**Tech Stack:** Bun 1.4.3, TypeScript 5.9.3 (solo typecheck), `@opentui/core` / `@opentui/solid` / `@opentui/keymap` / `@opentui/qrcode` 0.8.2, `solid-js` 1.9.18.

**Spec:** `docs/superpowers/specs/2026-11-06-discord-tui-design.md` (secciones 3, 5, 6.1, 7.5, 8 y 9/E0). Índice de planes: `docs/superpowers/plans/README.md`.

## Global Constraints

- Versiones exactas, siempre con `bun add --exact`: `@opentui/core@0.8.2`, `@opentui/solid@0.8.2`, `@opentui/keymap@0.8.2`, `@opentui/qrcode@0.8.2`, `solid-js@1.9.18`, dev: `typescript@5.9.3`, `@types/bun@1.4.4`. Nada de `^` ni `~` en `package.json`. **[nuestra]** TypeScript 5.9.3 y no 7.x: 7.0 salió hace días y solo lo usamos para `tsc --noEmit`.
- Runtime: Bun 1.4.3 local; `engines.bun` = `">=1.3.14"` (lo que pide `@opentui/core` 0.8.2, spec 3).
- UI: Solid (spec 7.5), JSX con `"jsx": "preserve"` y `"jsxImportSource": "@opentui/solid"`; `bunfig.toml` con `preload = ["@opentui/solid/preload"]` en la raíz **y** en `[test]`.
- Regla de capas (spec 5): `src/ui/**` nunca importa `src/gateway/**`, `src/rest/**` ni `fetch`; solo lee el store y llama a `actions`.
- Token (spec 8): nunca en logs, pantalla, errores, argumentos o env de subprocesos. En el código de tests **no se escribe ningún literal con forma de token**: se arma en runtime con `fakeToken()` (Task 1).
- Logs a archivo en `$XDG_STATE_HOME/discord-tui/discord-tui.log` (default `~/.local/state/discord-tui/`), nunca a stdout (stdout es de la TUI) **[nuestra]**.
- Prosa de la UI en español rioplatense; identificadores, tests y comandos en inglés.

## Review Focus

- Un string con forma de token dentro de un `Error.message` o un objeto anidado que se loguea: el log tiene que mostrar `[redacted]` (test en Task 2).
- `console.log(secret)`, `JSON.stringify({ t: secret })`, `String(secret)` y template strings: ninguno revela el valor (Task 2).
- Un archivo binario o enorme versionado en el repo no rompe el test anti-filtración (lo saltea por tamaño > 5 MiB o si tiene bytes NUL) (Task 1).
- La terminal muy chica (40x10): el layout no tira excepción y sigue saliendo con `q` (Task 3).
- `bun run dev` sin terminal (con la salida en un pipe o desde un script): sale con `discord-tui necesita una terminal` y código 1, en vez de colgarse o ensuciar el pipe (Task 3).

---

### Task 1: Esqueleto del repo, `AGENTS.md` y test anti-filtración

**Files:**
- Create: `package.json`, `bunfig.toml`, `tsconfig.json`, `.gitignore`, `AGENTS.md`
- Create: `src/security/token-pattern.ts`, `src/security/scan.ts`
- Create: `tests/helpers/fake-token.ts`
- Test: `tests/security/token-pattern.test.ts`, `tests/security/no-token-leak.test.ts`

**Interfaces:**
- Produces: `findTokenLike(text: string): string[]` y `TOKEN_PATTERNS: RegExp[]` en `src/security/token-pattern.ts`; `scanFiles(paths: string[]): Promise<string[]>` (devuelve `path:línea` de cada coincidencia) en `src/security/scan.ts`; `fakeToken(seed?: string): string` en `tests/helpers/fake-token.ts` (lo usan todos los tests que necesitan un token falso).

- [x] **Step 1: Crear el esqueleto**

`package.json` con `"type": "module"`, `"private": true`, `engines.bun ">=1.3.14"`, scripts: `"dev": "bun run src/main.tsx"`, `"test": "bun test"`, `"typecheck": "tsc --noEmit"`. Instalar con `bun add --exact` las versiones de Global Constraints. `.gitignore`: `node_modules/`, `*.log`, `.env*`, `captures-raw/`. `tsconfig.json`: `strict: true`, `noUncheckedIndexedAccess: true`, `module: "Preserve"`, `moduleResolution: "bundler"`, `types: ["bun"]`, jsx como en Global Constraints.

`AGENTS.md` (en español, corto) con estas reglas literales:
1. "Nunca leas, abras, imprimas ni copies el token de Discord ni `~/.config/discord-tui/session.json`. Nunca corras comandos que lo lean (`cat`, `jq`, `grep` sobre esa carpeta, `bun scripts/leak-check.ts`). Si una tarea parece pedirlo, frená y preguntale a Gon."
2. "Nunca veas payloads autenticados crudos. Trabajás solo con `fixtures/`, que Gon ya redactó."
3. "Toda prueba contra la cuenta real es un **🧍 Paso de Gon**: frenás y esperás su resultado."
4. "Después de cada tarea: `bun test`, `bun run typecheck`, commit y `git push origin main`."
5. "Versiones exactas (`bun add --exact`). No actualices dependencias sin que el plan lo diga."
6. "En tests, los tokens falsos se arman con `fakeToken()`; nunca escribas un literal con forma de token."
7. Cómo correr: `bun install`, `bun test`, `bun run typecheck`, `bun run dev`.

- [x] **Step 2: Escribir los tests que fallan**

```ts
// tests/security/token-pattern.test.ts
test("findTokenLike detects a runtime-built user token", () => {
  const t = fakeToken();
  expect(findTokenLike(`Authorization: ${t}`)).toEqual([t]);
});
test("findTokenLike detects mfa tokens", () => {
  const t = "mfa." + "x".repeat(84);
  expect(findTokenLike(t)).toEqual([t]);
});
test("findTokenLike ignores snowflakes, urls and base64 images", () => {
  expect(findTokenLike("123456789012345678 https://cdn.discordapp.com/a/b.png")).toEqual([]);
});
```

```ts
// tests/security/no-token-leak.test.ts
test("no tracked or untracked file in the repo contains a token-like string", async () => {
  // lista: `git ls-files -z` + `git ls-files -z --others --exclude-standard`
  // saltea archivos > 5 MiB o con bytes NUL
  expect(offenders).toEqual([]); // offenders: `${path}:${line}`, nunca el match
});
test("scanner skips files over 5 MiB and files with NUL bytes", async () => {
  // scanFiles([bigTmp, binTmp, textTmpWithFakeToken]) → solo reporta el de texto
});
```

`fakeToken(seed = "a")` devuelve `["MTAw".repeat(6), "G" + seed.repeat(5), "z".repeat(30)].join(".")` (24.6.30 caracteres).

- [x] **Step 3: Correr y ver que fallan**

Run: `bun test tests/security`
Expected: FAIL, `Cannot find module '../../src/security/token-pattern'`.

```text
$ bun test tests/security
error: Cannot find module '../../src/security/token-pattern' from '.../tests/security/token-pattern.test.ts'
error: Cannot find module '../../src/security/scan' from '.../tests/security/no-token-leak.test.ts'

 0 pass
 2 fail
 2 errors
```

- [x] **Step 4: Implementar `src/security/token-pattern.ts`**

`TOKEN_PATTERNS = [/[A-Za-z0-9_-]{24,28}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,38}/g, /mfa\.[A-Za-z0-9_-]{20,}/g]`. `findTokenLike` devuelve los matches únicos en orden de aparición.

- [x] **Step 5: Verificar**

Run: `bun test && bun run typecheck`
Expected: `5 pass, 0 fail` y typecheck sin errores.

```text
$ bun test && bun run typecheck
 5 pass
 0 fail
 5 expect() calls
Ran 5 tests across 2 files. [129.00ms]
$ tsc --noEmit   # sin salida, código 0
```

- [x] **Step 6: Commit y push**

```bash
git add -A && git commit -m "chore(e0): scaffold, AGENTS.md and token leak test" && git push origin main
```

---

### Task 2: `Secret` y logger con lista blanca

**Files:**
- Create: `src/secret.ts`, `src/config/paths.ts`, `src/log/logger.ts`
- Test: `tests/secret.test.ts`, `tests/log/logger.test.ts`

**Interfaces:**
- Consumes: `findTokenLike` (Task 1).
- Produces:
  - `class Secret { constructor(value: string); reveal(): string; toString(): "[redacted]"; toJSON(): "[redacted]"; [Symbol.for("nodejs.util.inspect.custom")](): "[redacted]" }`. El valor vive en un campo privado `#value`.
  - `configDir(): string`, `stateDir(): string`, `sessionPath(): string`, `settingsPath(): string`, `logPath(): string` en `src/config/paths.ts`, leyendo `XDG_CONFIG_HOME` / `XDG_STATE_HOME` en cada llamada (los tests los apuntan a carpetas temporales).
  - `type LogFields = Partial<Record<AllowedField, string | number | boolean | null>>`; `createLogger(opts?: { file?: string }): Logger` con `info|warn|error(event: string, fields?: LogFields): void` y `flush(): Promise<void>`. `log` = logger por defecto a `logPath()`.
  - `ALLOWED_FIELDS = ["method","route","status","code","op","t","seq","close_code","guild_id","channel_id","message_id","state","attempt","duration_ms","error_name","msg","count","mode"] as const`.

- [x] **Step 1: Tests que fallan**

```ts
test("Secret never reveals itself when stringified", () => {
  const s = new Secret(fakeToken());
  for (const out of [String(s), `${s}`, JSON.stringify({ s }), Bun.inspect(s), Bun.inspect({ nested: { s } })])
    expect(out).not.toContain(fakeToken());
  expect(s.reveal()).toBe(fakeToken());
});
test("logger drops fields that are not allowlisted", async () => {
  // log.info("x", { route: "/users/@me", authorization: "abc" } as any)
  expect(line).toContain('"route":"/users/@me"');
  expect(line).not.toContain("abc");
  expect(line).toContain('"authorization":"[dropped]"');
});
test("logger redacts token-like strings in allowed fields", async () => {
  // log.error("boom", { msg: `failed with ${fakeToken()}` })
  expect(findTokenLike(fileContents)).toEqual([]);
  expect(fileContents).toContain("[redacted]");
});
test("log file is created with mode 0600 and its dir with 0700", async () => {
  expect(statSync(logPath()).mode & 0o777).toBe(0o600);
  expect(statSync(stateDir()).mode & 0o777).toBe(0o700);
});
```

- [x] **Step 2: Correr** — Run: `bun test tests/secret.test.ts tests/log` · Expected: FAIL por módulos inexistentes.

```text
$ bun test tests/secret.test.ts tests/log
error: Cannot find module '../src/log/logger' from '.../tests/log/logger.test.ts'
error: Cannot find module '../src/secret' from '.../tests/secret.test.ts'

 0 pass
 2 fail
 2 errors
```

- [x] **Step 3: Implementar** `src/secret.ts`, `src/config/paths.ts` y `src/log/logger.ts`. Cada línea del log es JSON: `{"ts": ISO, "level", "event", ...fields}`. Los valores string pasan por un `redactTokens(s)` que reemplaza cada match de `TOKEN_PATTERNS` por `[redacted]`. Carpeta con `mkdir(..., { recursive: true, mode: 0o700 })`, archivo abierto con `openSync(path, "a", 0o600)`.

- [x] **Step 4: Verificar** — Run: `bun test && bun run typecheck` · Expected: todo en verde.

```text
$ bun test && bun run typecheck
 9 pass
 0 fail
 18 expect() calls
Ran 9 tests across 4 files. [132.00ms]
$ tsc --noEmit   # sin salida, código 0
```

- [x] **Step 5: Commit y push** — `git commit -m "feat(e0): Secret type and allowlist logger"` + `git push origin main`.

---

### Task 3: Layout vacío de tres columnas y salida con `q`

**Files:**
- Create: `src/main.tsx`, `src/ui/App.tsx`, `src/ui/keymap.ts`
- Test: `tests/ui/app.test.tsx`

**Interfaces:**
- Produces:
  - `App(props: { onQuit: () => void }): JSX.Element` en `src/ui/App.tsx`: tres `<box>` con títulos `Servidores`, `Canales`, `Mensajes` y una barra inferior `StatusBar` con el texto `desconectado`.
  - `createAppKeymap(renderer: CliRenderer, handlers: { quit(): void }): Keymap` en `src/ui/keymap.ts`, sobre `createOpenTuiKeymap` + `registerDefaultKeys` de `@opentui/keymap`. Comando `app.quit` con tecla `q` en una capa global. E2/E3/E4/E5 agregan comandos a esta misma función.
  - `assertTty(stream: { isTTY?: boolean }): string | null` en `src/main.tsx` (devuelve `discord-tui necesita una terminal` si no es TTY).
  - `src/main.tsx`: si `assertTty(process.stdout)` da mensaje, lo escribe en stderr y sale con 1; si no, crea el renderer con `useKittyKeyboard: { events: true }` (lo necesita el PTT de E4b) y monta `App`; `onQuit` destruye el renderer y hace `process.exit(0)`.

- [x] **Step 1: Test que falla**

```tsx
test("renders the three empty columns and the status bar", async () => {
  const { captureCharFrame, renderOnce } = await testRender(() => <App onQuit={() => {}} />, { width: 100, height: 30 });
  await renderOnce();
  const f = captureCharFrame();
  for (const s of ["Servidores", "Canales", "Mensajes", "desconectado"]) expect(f).toContain(s);
});
test("q calls onQuit", async () => {
  let quit = 0;
  const { mockInput, renderOnce } = await testRender(() => <App onQuit={() => quit++} />, { width: 100, height: 30 });
  mockInput.pressKey("q"); await renderOnce();
  expect(quit).toBe(1);
});
test("assertTty", () => {
  expect(assertTty({ isTTY: false })).toBe("discord-tui necesita una terminal");
  expect(assertTty({ isTTY: true })).toBeNull();
});
test("tiny terminal still renders", async () => {
  const { renderOnce } = await testRender(() => <App onQuit={() => {}} />, { width: 40, height: 10 });
  await expect(renderOnce()).resolves.toBeUndefined();
});
```

- [x] **Step 2: Correr** — Run: `bun test tests/ui` · Expected: FAIL.

```text
$ bun test tests/ui
error: Cannot find module '../../src/main' from '.../tests/ui/app.test.tsx'

 0 pass
 1 fail
 1 error
```

- [x] **Step 3: Implementar** `App`, `createAppKeymap` y `main.tsx` con las firmas de arriba. El keymap se crea dentro de `App` con el renderer del contexto de `@opentui/solid`.
- [x] **Step 4: Verificar** — Run: `bun test && bun run typecheck` · Expected: todo en verde.

```text
$ bun test && bun run typecheck
 13 pass
 0 fail
 26 expect() calls
Ran 13 tests across 5 files. [291.00ms]
$ tsc --noEmit   # sin salida, código 0
```

- [x] **Step 5: Commit y push** — `git commit -m "feat(e0): empty three-column layout, q quits"` + push.

- [x] **Step 6: 🧍 Paso de Gon — mirar el esqueleto en Ghostty**

Gon corre, en Ghostty sin tmux: `cd ~/projects/discord-tui && bun install && bun run dev`.
Tiene que ver: tres columnas con `Servidores`, `Canales` y `Mensajes`, y abajo `desconectado`. Al apretar `q` vuelve al prompt sin basura en la pantalla.
Le contesta al agente: "ok" o qué vio distinto.

- [x] **Step 7: 🧍 Paso de Gon — preparar lo de las etapas siguientes (spec 11)**

1. Crear un servidor de Discord propio de prueba con un canal de texto `#pruebas` y un canal de voz `Voz`.
2. Conseguir la segunda cuenta de prueba o el amigo para los checkpoints **[2ª]** (E2, E3, E4c). No hace falta ya; sí antes del cierre de E2.
3. Avisarle al agente "servidor listo". No le pasa ids ni nombres: el agente no los necesita.
