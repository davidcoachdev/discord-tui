# discord-tui E5 (pulido): plan de implementación

> **Para el agente ejecutor (DeepSeek V4 Pro en dsh):** tarea por tarea, en orden. TDD: test que falla → mínimo código → verde. Antes de tildar un `- [ ]` corrés la verificación y pegás la salida. Al cerrar cada tarea: commit **y** `git push origin main`. Los **🧍 Paso de Gon** los hace Gon; frenás y esperás. Nunca leés el token ni `session.json`.

**Goal:** dejar discord-tui listo para usarlo un día entero de laburo: settings persistentes (audio, modo de entrada, sensibilidad, volumen por usuario, tema), pantalla de settings con medidor y "probar mic", ayuda `?` con el keymap completo, mouse básico, errores visibles y presencia idle por inactividad.

**Architecture:** `settings/` guarda un JSON aparte de la sesión (sin secretos) y se carga al store; `voice/` y `ui/` lo leen de ahí. La ayuda se genera del catálogo de comandos del keymap, así no se desincroniza. Los errores pasan por un slice `notices` del store que la UI muestra como avisos.

**Tech Stack:** lo de E0–E4c; `pw-dump` del sistema para listar dispositivos.

**Spec:** `docs/superpowers/specs/2026-11-06-discord-tui-design.md` (7.5, 7.6, 7.8, 9/E5, 10.3).

## Global Constraints

- Las de E0–E4c.
- Settings en `~/.config/discord-tui/settings.json` (`settingsPath()`), modo 0600 como la sesión; nunca contiene el token ni nada de `session.json`.
- Dispositivo de audio: se pasa como `--target <node.name>` a `pw-record`/`pw-cat` (spec 7.3 y 9/E5).
- Presencia: online al conectar; idle opcional por inactividad, imitando al cliente oficial (spec 7.8). Op 3 con la forma que use el cliente web (si E1.5 no la capturó, la de discord.food, anotada en `docs/protocol-notes.md`).
- Llamadas de DM: **fuera de este plan**. La spec las deja "si da el tiempo"; van en un plan aparte después de la v1 **[nuestra]**.
- Toda tecla de la tabla de la spec 7.5 tiene un comando con descripción en español.

## Review Focus

- `settings.json` editado a mano con un valor inválido (`"inputMode": "loud"`, volumen 900): ese campo vuelve al default y el resto se respeta; la app arranca igual (Task 1).
- El dispositivo guardado ya no existe (desenchufó los auriculares USB): se usa el default del sistema y se avisa `no encontré <dispositivo>, uso el predeterminado` (Task 2).
- Volumen por usuario al 200 % con alguien que ya grita: satura, no da la vuelta (Task 2).
- `?` abierto encima de un modal (quick switcher, confirmación de borrado): `Esc` cierra solo la ayuda (Task 4).
- Un error que se repite cada segundo (REST caído): un solo aviso con contador, no una pila infinita (Task 5).

---

### Task 1: Settings persistentes

**Files:**
- Create: `src/settings/settings.ts`, `src/store/reducers/settings.ts`
- Modify: `src/store/types.ts`, `src/app/runtime.ts`
- Test: `tests/settings/settings.test.ts`

**Interfaces:**
- Produces:
  - `Settings = { version: 1; inputMode: "voice_activity" | "push_to_talk"; vadSensitivity: "auto" | number; inputDevice: string | null; outputDevice: string | null; userVolumes: Record<string, number>; theme: "dark" | "light"; idleAfterMinutes: number | null }`. `DEFAULT_SETTINGS`: `voice_activity`, `auto`, `null`, `null`, `{}`, `dark`, `10`.
  - `loadSettings(): Promise<Settings>` (archivo faltante o JSON roto → defaults; campo inválido → default de ese campo; `vadSensitivity` numérico acotado a [-60, -20]; volúmenes enteros en [0, 200]); `saveSettings(s: Settings): Promise<void>` (atómico, 0600).
  - Acción de store `{ type: "settings/set"; patch: Partial<Settings> }` que guarda con debounce de 500 ms. El `inputMode` de E4b pasa a leerse y escribirse acá.

- [ ] **Step 1: Tests**

```ts
test("missing file gives defaults", async () => { expect(await loadSettings()).toEqual(DEFAULT_SETTINGS); });
test("invalid fields fall back one by one", async () => {
  // { inputMode: "loud", theme: "light", userVolumes: { "1": 900, "2": 50 } }
  expect(s).toMatchObject({ inputMode: "voice_activity", theme: "light", userVolumes: { "2": 50 } });
});
test("saved with mode 0600 and never contains a token-like string", async () => {});
test("settings/set persists after the debounce", async () => {});
```

- [ ] **Step 2–4:** FAIL → implementar → `bun test tests/settings` PASS.
- [ ] **Step 5:** commit `feat(e5): persistent settings` + push.

---

### Task 2: Dispositivos de audio y volumen por usuario

**Files:**
- Create: `src/voice/devices.ts`, `src/voice/gain.ts`
- Modify: `src/voice/mixer.ts` (ganancia por usuario antes de sumar), `src/actions/voice.ts` (usa `inputDevice`/`outputDevice`), `src/ui/components/ChannelList.tsx` y `src/ui/keymap.ts` (sobre un participante de voz seleccionado: `+`/`-` cambian su volumen de a 10 %; en esa capa no abren reacciones)
- Test: `tests/voice/devices.test.ts`, `tests/voice/gain.test.ts`

**Interfaces:**
- Consumes: `spawnClean`, `Settings`.
- Produces:
  - `listAudioDevices(deps?: { spawn?: typeof spawnClean }): Promise<{ inputs: AudioDevice[]; outputs: AudioDevice[] }>` con `AudioDevice = { name: string; description: string }`, parseando `pw-dump` (objetos `PipeWire:Interface:Node` con `info.props["media.class"]` `Audio/Source` → inputs, `Audio/Sink` → outputs; `node.name` y `node.description`).
  - `resolveTarget(saved: string | null, devices: AudioDevice[]): { target: string | null; warning: string | null }` (`warning` = `no encontré <saved>, uso el predeterminado`).
  - `applyGain(pcm: Uint8Array, percent: number): Uint8Array` (s16le, satura; 100 devuelve el mismo buffer).
  - Participante en `ChannelList`: `· <usuario> 150%` cuando no es 100.

- [ ] **Step 1: Tests**

```ts
test("pw-dump parsing splits sources and sinks", () => { /* fixture tests/fixtures/pw-dump.json armada a mano */ });
test("missing saved device warns and falls back to null", () => {});
test("applyGain", () => {
  expect(sampleAt(applyGain(pcmOf(20000), 200), 0)).toBe(32767);
  expect(sampleAt(applyGain(pcmOf(20000), 50), 0)).toBe(10000);
  expect(sampleAt(applyGain(pcmOf(-20000), 200), 0)).toBe(-32768);
});
test("mixer applies per-user gain from settings", () => {});
```

- [ ] **Step 2–4:** FAIL → implementar → PASS.
- [ ] **Step 5:** commit `feat(e5): audio device selection and per-user volume` + push.

---

### Task 3: Pantalla de settings con medidor y "probar mic"

**Files:**
- Create: `src/ui/screens/SettingsScreen.tsx`
- Modify: `src/ui/keymap.ts` (`settings.open` en `g s` **[nuestra]**: la spec no le da tecla), `src/ui/App.tsx`
- Test: `tests/ui/settings-screen.test.tsx`

**Interfaces:**
- Consumes: `listAudioDevices`, `LevelMeter` y `createEcho` (E4a), `createVad`, `settings/set`.
- Produces: `SettingsScreen(props: { store: Store; actions: Actions; deps: { listAudioDevices; startCapture; startPlayback } })` con secciones `Audio` (entrada, salida, modo de entrada `Actividad de voz | Push-to-Talk`, sensibilidad `auto` o dBFS con el `LevelMeter` en vivo y la línea del umbral, `probar mic` que prende y apaga el eco) y `Apariencia` (tema). `j`/`k` se mueven, `Enter` cambia, `h`/`l` ajustan la sensibilidad de a 3 dB, `Esc` cierra. Si la voz está conectada, `probar mic` está deshabilitado con `salí de voz para probar el mic` **[nuestra]**: dos capturas del mismo mic a la vez confunden.

- [ ] **Step 1: Tests**

```tsx
test("lists devices from the fake pw-dump and saves the choice", async () => {});
test("sensitivity h/l moves 3 dB and persists", async () => {});
test("probar mic starts and stops the echo", async () => {});
test("probar mic is disabled while in voice", async () => {});
```

- [ ] **Step 2–4:** FAIL → implementar → PASS.
- [ ] **Step 5:** commit `feat(e5): settings screen with live mic meter` + push.

---

### Task 4: Ayuda `?`, keymap completo, temas y mouse

**Files:**
- Create: `src/ui/components/HelpOverlay.tsx`, `src/ui/theme.ts`
- Modify: `src/ui/keymap.ts` (metadatos `desc` y `group` en cada comando con `registerMetadataFields`), componentes que tengan colores fijos, `GuildList`/`ChannelList`/`MessageView` (click selecciona, rueda hace scroll)
- Test: `tests/ui/keymap-complete.test.ts`, `tests/ui/help.test.tsx`, `tests/ui/theme.test.ts`

**Interfaces:**
- Produces:
  - `SPEC_KEYS`: la tabla de la spec 7.5 como datos (`j`, `k`, `h`, `l`, `gg`, `G`, `i`, `Esc`, `r`, `e`, `dd`, `+`, `Ctrl-k`, `gu`, `v`, `m`, `D`, `Espacio`, `M`, `Ctrl-v`, `a`, `?`, `q`), más las nuestras (`R`, `gm`, `gs`).
  - `HelpOverlay`: agrupada por `group` (`Navegación`, `Mensajes`, `Voz`, `App`), generada con `commandBindings` de `@opentui/keymap/extras`; `?` abre, `Esc` o `?` cierra.
  - `Theme = { bg; fg; dim; accent; unread; mention; error; warn; ok }`; `THEMES: Record<"dark" | "light", Theme>`; `useTheme(store)`. Ningún componente usa colores literales fuera de `theme.ts`.

- [ ] **Step 1: Tests**

```ts
test("every key of the spec table is bound to a command with a spanish description", () => {
  for (const k of SPEC_KEYS) expect(bindingFor(keymap, k)?.desc).toBeTruthy();
});
test("no component uses a literal color outside theme.ts", () => { /* grep de /#[0-9a-f]{3,6}\b|"(red|green|blue|yellow)"/ en src/ui salvo theme.ts */ });
```
```tsx
test("? shows the grouped help and Esc closes only the help", async () => {});
test("click on a channel opens it; wheel scrolls messages", async () => {});
test("switching theme repaints with the light palette", async () => {});
```

- [ ] **Step 2–4:** FAIL → implementar → PASS.
- [ ] **Step 5:** commit `feat(e5): help overlay, full keymap, themes and mouse` + push.

---

### Task 5: Errores visibles y presencia idle

**Files:**
- Create: `src/store/reducers/notices.ts`, `src/ui/components/Notices.tsx`, `src/actions/presence.ts`
- Modify: `src/app/runtime.ts` (errores de identify, REST y voz → `notices`), `src/ui/App.tsx`
- Test: `tests/store/notices.test.ts`, `tests/actions/presence.test.ts`

**Interfaces:**
- Produces:
  - `Notice = { id: string; level: "info" | "warn" | "error"; text: string; count: number; at: number }`; acciones `{ type: "notice/push"; key: string; level; text }` (misma `key` suma `count` en vez de duplicar) y `{ type: "notice/dismiss"; id }`. Se ven abajo a la derecha 6 s (los `error` quedan hasta `Esc`), como `<texto> (×<count>)`.
  - Mensajes fijos: identify rechazado `Discord rechazó la conexión (<código>): puede que haya cambiado el protocolo. Revisá el log.` (spec 10.3); REST que no es de la outbox `no se pudo <acción>: <status>`.
  - `createIdlePresence(deps: { gateway: Gateway; settings: () => Settings; now: () => number; setTimer? }): { activity(): void; stop(): void }`: tras `idleAfterMinutes` sin teclas manda op 3 idle; con la próxima tecla, op 3 online. `idleAfterMinutes: null` lo apaga. Nunca manda op 3 si no cambió el estado.

- [ ] **Step 1: Tests**

```ts
test("same key accumulates count instead of stacking", () => {});
test("errors stay until dismissed, info expires after 6 s", () => {});
test("idle after 10 min without keys, online on next key, one op 3 each", () => {});
test("op 3 has the documented shape", () => { expect(shapeOf(sent.d)).toEqual(shapeOf(documentedOp3)); });
test("idleAfterMinutes null never sends op 3", () => {});
```

- [ ] **Step 2–4:** FAIL → implementar → PASS.
- [ ] **Step 5:** commit `feat(e5): visible errors and idle presence` + push.

---

### Task 6: 🧍 Paso de Gon — un día entero de laburo (checkpoint E5 y de la v1)

- [ ] Gon usa discord-tui como único cliente de Discord un día de laburo (texto y, si surge, voz), sin abrir la app oficial en la PC.
- [ ] En el camino prueba: `?` muestra todas las teclas; `gs` → elegir auriculares como salida y el mic como entrada, mover la sensibilidad mirando el medidor, `probar mic`; tema claro y oscuro; volumen de un participante con `+`/`-` en una llamada.
- [ ] Anota cada cosa que lo obligó a abrir la app oficial o que le molestó, y se la pasa al agente al final del día junto con `bun run leak-check` → `OK`.
- [ ] Con esa lista el agente arma, sin implementarla, la lista de pendientes post-v1 en `docs/backlog.md` (incluye llamadas de DM y las mejoras que la spec deja para después: keyring, PTT global con Hyprland, VAD con modelo), commit + push.
