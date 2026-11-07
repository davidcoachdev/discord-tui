# Prompt para `/goal`: discord-tui usable con el mouse, como Discord

Pegar en Claude Code abierto en `~/projects/discord-tui`, después de `/goal`:

```
Objetivo: que discord-tui se use como Discord pero en la terminal, todo clickeable con el mouse además del teclado, y que lo único que tenga que hacer Gon sea `bun run dev`: nada de ids, scripts aparte ni pasos manuales para entrar a voz.

Contexto (leé primero, en este orden):
1. AGENTS.md: reglas del repo, mandan sobre todo. Sobre todo: nunca leas el token ni ~/.config/discord-tui/session.json, nunca corras nada contra la cuenta real (ni `bun run dev`, ni `voice-spike`, ni `leak-check`), y después de cada tarea `bun test`, `bun run typecheck`, commit y `git push origin main`.
2. README.md, docs/PRUEBAS-GON.md y docs/protocol-notes.md (estado actual, gotchas de voz y del teclado Kitty).
3. src/ui/App.tsx (todo el teclado y el estado de la UI), src/ui/components/*, src/ui/screens/SettingsScreen.tsx, src/actions/index.ts y src/actions/voice.ts (lo que la UI puede hacer).
4. scripts/demo-state.ts (estado falso para la demo y los tests) y scripts/render-frame.tsx (imprime un frame de la UI: `KEYS="j,k,^k,ENTER" bun scripts/render-frame.tsx`).

Estado de hoy: 398 tests verdes. Texto y voz implementados y manejables con teclado. La demo (`bun run demo`) le encanta a Gon. Hoy el mouse solo sirve para elegir servidor o canal y para la rueda en las listas. La voz real todavía no se probó contra Discord: eso es un paso de Gon, no tuyo.

Qué tiene que andar con el mouse (click izquierdo salvo que diga otra cosa):
- Servidores: click elige el servidor; hover resalta la fila.
- Canales: click en un canal de texto o DM lo abre y pasa el foco a mensajes. Click en un canal de voz 🔊 entra (como en Discord); click en el canal donde ya estás no hace nada, y se sale con el botón de la barra de voz. Click en un participante de voz lo selecciona y abre un control de volumen chico (−/+ clickeables, 0–200 %, se guarda en settings). Click en una categoría la colapsa o expande.
- Mensajes: click selecciona el mensaje. El mensaje seleccionado, o el que tiene el mouse encima, muestra una barra de acciones clickeable a la derecha o abajo: ↩ responder, ✎ editar (solo propios), 🗑 borrar (solo propios, con confirmación y/n también clickeable), 😀 reaccionar. Click en una reacción existente la pone o la saca (toggleReaction). Click en un adjunto o link lo abre con `xdg-open` (spawnClean de src/proc/spawn.ts, nunca con shell, solo https). Rueda: scroll; llegar arriba de todo carga historial (actions.loadOlder).
- Composer: click lo pone en modo escritura. Los ítems del popup de menciones y del selector de emojis se eligen con click. Botones clickeables 📎 (pide path, como `a`) y 📋 (pegar del portapapeles, como Ctrl-v). Click en "x" de un adjunto lo quita.
- Barra de voz (abajo): botones clickeables 🎙 mute, 🎧 deafen, VAD/PTT y ✕ salir, que muestran el estado actual (tachado o en color cuando están activos).
- Barra de estado: "? ayuda", "⚙ settings" y "Ctrl-k saltar" clickeables.
- Overlays: en el quick switcher cada resultado se abre con click; la ayuda y el switcher se cierran con click afuera; en settings cada fila se activa con click (como Enter) y h/l tienen botones ◀ ▶.
- Miembros: click en un miembro inserta su @mención en el composer, con el autocompletado de src/ui/mentions.ts para que salga como <@id>.
- El teclado sigue andando igual que hoy. Ningún click manda nada a Discord que no sea una acción explícita (spec 2, anti-objetivos).

Reglas de implementación:
- La UI no habla con la red: todo pasa por `props.actions` (spec 5). Si falta una acción, agregala en src/actions/.
- Sin dependencias nuevas. Colores solo en src/ui/theme.ts (hay un test que falla si ponés un hex en otro lado).
- OpenTUI 0.8.2: `onMouseDown`, `onMouseOver` y `onMouseOut` en box o text, y `event.stopPropagation()` para que un botón dentro de una fila no dispare también la fila. Los spans dentro de un <text> no reciben eventos: los botones van como <text> o <box> propios.
- No rompas el rendimiento: los selectores con `jsonEqual`/`shallowEqual` de src/ui/store-bridge.ts se quedan como están (un mensaje nuevo o una ráfaga de presencias no tiene que re-renderizar las listas).
- docs/PRUEBAS-GON.md: sacá el voice-spike con ids. La prueba de voz pasa a ser "abrí `bun run dev` y hacé click en un canal 🔊". El script puede quedar, pero opcional. Agregá al checklist los puntos de mouse.
- scripts/demo-state.ts / `bun run demo`: todo lo anterior tiene que poder probarse en la demo sin red (la voz simulada ya existe).

Cómo verificar (vos, sin cuenta):
- Un test con `testRender` + `mockMouse.click(x, y)` por cada punto de la lista de arriba. Buscá la coordenada en `captureCharFrame()`, como hace tests/ui/app.test.tsx "click on a channel opens it". El Esc en tests va como `mockInput.pressKeys(["\u001b[27u"])`.
- `bun scripts/render-frame.tsx` en 160x45 y 100x30 para mirar que nada se corte ni se superponga (barra de acciones, botones de voz, popups).
- `bun run demo` en una PTY (`timeout 4 script -qec "bun run demo" /dev/null`) para ver que arranca sin errores.
- Al final: `bun test` y `bun run typecheck` verdes, commits chicos por tema, cada uno pusheado.

Terminado cuando: cada punto de la lista tiene su test verde, la demo se maneja entera con el mouse, PRUEBAS-GON.md ya no pide ids, y le dejás a Gon un resumen corto: qué se puede clickear, qué probar con `bun run demo` y qué con `bun run dev`. Si algo no se puede hacer con OpenTUI 0.8.2 (por ejemplo, hover en alguna terminal), no lo inventes: anotalo en docs/protocol-notes.md y seguí con lo demás.
```
