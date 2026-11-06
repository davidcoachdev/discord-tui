# Planes de implementación de discord-tui

Diseño: `docs/superpowers/specs/2026-11-06-discord-tui-design.md` (aprobado por Gon tal cual, 2026-11-06).
Ejecutor: DeepSeek V4 Pro en DeepSeek Harness (dsh). Reglas del agente: `AGENTS.md` en la raíz (lo crea E0, Task 1).

## Cómo se ejecutan

- Un plan por etapa, en el orden de la tabla. No se arranca una etapa sin que la anterior tenga su checkpoint de Gon cerrado.
- Dentro de cada plan: tarea por tarea, TDD (test que falla → mínimo código → verde), se corre la verificación y se pega la salida antes de tildar, y **commit + `git push origin main` al final de cada tarea**.
- **🧍 Paso de Gon** = lo hace Gon a mano. El agente frena, le pasa el paso y espera el resultado. Nunca se saltea.
- El agente **nunca** lee el token ni `~/.config/discord-tui/session.json`, nunca ve payloads autenticados crudos y nunca corre los scripts que se conectan con la cuenta (`capture-gateway`, `voice-spike`, `leak-check`). Trabaja con `fixtures/`, que Gon redacta en E1.5.
- Versiones fijadas (exactas, `bun add --exact`): Bun 1.4.3 (engines `>=1.3.14`), `@opentui/core`/`solid`/`keymap`/`qrcode` 0.8.2, `solid-js` 1.9.18, `typescript` 5.9.3 (solo typecheck), `@types/bun` 1.4.4, `discord-api-types` 0.38.57, `@discordjs/voice` 0.19.2, `@snazzah/davey` 0.1.12 (forzado con `overrides`; 0.2.0 solo en la rama B), `@discordjs/opus` 0.11.0, `opusscript` 0.1.1. Consultadas con `npm view` el 2026-11-06.

## Orden y dependencias

| # | Plan | Tareas | Depende de | Entrega |
|---|---|---|---|---|
| 1 | [E0 esqueleto](2026-11-06-discord-tui-e0.md) | 3 | — | layout vacío, `q` sale, `Secret`, logger, test anti-filtración, `AGENTS.md` |
| 2 | [E1 login](2026-11-06-discord-tui-e1.md) | 8 | E0 | QR o token pegado, `session.json` 0600, `logout`, `leak-check` |
| 3 | [E1.5 capturas](2026-11-06-discord-tui-e1.5.md) | 6 | E1 (sesión real para el script de captura) | `fixtures/` redactadas y `docs/protocol-notes.md` |
| 4 | [E2 leer](2026-11-06-discord-tui-e2.md) | 13 | E1.5 (identify, READY, op 37) | gateway, store, UI de lectura, markdown, imágenes, miembros |
| 5 | [E3 escribir](2026-11-06-discord-tui-e3.md) | 9 | E2 | outbox, composer, menciones, editar/borrar, reacciones, typing, ack, subidas, notificaciones |
| 6 | [E4a voz local](2026-11-06-discord-tui-e4a.md) | 8 | E3 (`spawnClean`) | PipeWire, Opus, VAD, eco, RTP en loopback, DAVE local |
| 7 | [E4b voz real](2026-11-06-discord-tui-e4b.md) | 6 (+4 de la rama B si hace falta) | E4a, E2 (gateway), E1.5 (op 4) | entrar a voz con DAVE, VAD/PTT, mute, deafen |
| 8 | [E4c voz con otro](2026-11-06-discord-tui-e4c.md) | 5 | E4b | recepción, mezcla, quién habla, código de privacidad, 10 min estable |
| 9 | [E5 pulido](2026-11-06-discord-tui-e5.md) | 6 | E4c | settings, dispositivos, volumen por usuario, ayuda, temas, mouse, errores, idle |

E4a solo necesita de E3 el helper `spawnClean`; si hiciera falta adelantarla, se puede correr después de E0 moviendo ese helper (E3 Task 7) antes. Por defecto, en orden.

## Quién verifica qué

**Agente** (tests y fixtures, sin cuenta real): todas las tareas con TDD. Además, el agente corre en su máquina cosas que no tocan la cuenta: el spike del build number (E1 Task 1, request público sin token), `spike-image` y `mic-test` con `timeout` para ver que no explotan, y los spikes de dependencias y DAVE local (E4a Task 1).

**Gon solo** (cuenta real o sus sentidos):

| Etapa | Paso |
|---|---|
| E0 | ver el layout en Ghostty; crear el servidor de prueba (`#pruebas` y `Voz`) |
| E1 | build number desde DevTools si el spike falla; checkpoint de login (QR, reinicio, `stat`, `leak-check`, `logout`) |
| E1.5 | capturas del navegador (Task 3), script de captura (Task 4), redactar y subir `fixtures/` (Task 5) |
| E2 | mirar imágenes en Ghostty (Task 1); checkpoint de lectura (Task 13, puntos 1–7 y 9) |
| E3 | checkpoint de escritura (Task 9, puntos 1–9 y 11) |
| E4a | escuchar el eco y probar el VAD (Task 8) |
| E4b | spike de voz real (Task 1, Step 6); checkpoint de voz solo (Task 6) |
| E5 | un día entero de uso (Task 6) |

**Gon + segunda cuenta o amigo [2ª]:**

| Etapa | Paso |
|---|---|
| E1.5 | `TYPING_START` y `PRESENCE_UPDATE` de otro (Task 4; si no hay [2ª] todavía, se repite antes de cerrar E2) |
| E2 | ver el typing y la presencia de otro (Task 13, punto 8) |
| E3 | una mención de otra cuenta dispara `notify-send` (Task 9, punto 10); "está escribiendo" visto desde otra cuenta (punto 6) |
| E4c | dónde muestra el cliente oficial el código de privacidad (Task 1); llamada de 10 minutos en las dos direcciones (Task 5) |

El teléfono de Gon con la misma cuenta **no** sirve como segundo participante de voz (spec 8.2).

## Decisiones nuestras que no estaban en la spec

- **E1.5 en dos fuentes:** el navegador muestra legibles solo los frames salientes y el REST; los eventos entrantes llegan comprimidos. Por eso los entrantes los graba `scripts/capture-gateway.ts`, que corre Gon con su sesión y que nunca imprime payloads, y todo pasa por `redact.ts` en una sola corrida para que los ids falsos sean coherentes.
- **Flujo de subida de archivos:** la spec no dice si es multipart directo o `/attachments` + URL de subida. Se captura en E1.5 (Task 3, punto 7) y E3 implementa lo que se vea.
- **Permisos de canal:** READY de usuario trae canales que no podés ver; E2 calcula `VIEW_CHANNEL` con roles y overwrites para no listarlos.
- **DAVE local:** davey no exporta el rol de "external sender" que hace el servidor en MLS; sus tests usan vectores fijos. E4a Task 1 prueba dos sesiones con esos vectores y, si no se puede, cae a una sesión o a pruebas de API; el handshake real se verifica en E4b/E4c.
- **Teclas sin asignar en la spec:** `R` reintenta un envío fallido, `gm` muestra u oculta miembros (`Ctrl-m` es Enter en terminales sin el protocolo de Kitty), `gs` abre settings.
- **TypeScript 5.9.3** para el typecheck, no la 7.x que salió esta semana.
- **davey 0.1.12** (la que resuelve `@discordjs/voice` 0.19.2) con `overrides`, para tener una sola copia; 0.2.0 solo si hay rama B.
- **Llamadas de DM:** fuera de E5; van a un plan post-v1 (`docs/backlog.md`, que se arma al cierre de E5).
