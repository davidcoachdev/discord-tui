# Pruebas de Gon con la cuenta real

Todo lo que el agente pudo probar sin tu cuenta ya está cubierto por `bun test` (387+ tests, incluido un
servidor de voz falso local). Lo que queda acá necesita tu cuenta, tus ojos o tus oídos. Hacelo en Ghostty, sin
tmux. Si algo falla, pasale al agente qué viste y las últimas líneas de `~/.local/state/discord-tui/discord-tui.log`
(el log ya sale redactado; corré `bun run leak-check` antes de pasarlo).

Antes de empezar: `cd ~/projects/discord-tui && git pull && bun install`.

## 0. Mirar la UI sin conectarte (2 min)

- [ ] `bun run demo` → se ven servidores, canales con categorías, mensajes con colores, miembros a la derecha.
- [ ] `?` abre la ayuda; `Esc` la cierra. `Ctrl-k`, escribí `mem`, Enter → abre `#memes`.
- [ ] `h` hasta la lista de canales, bajá con `j` hasta `🔊 Sala 1`, `v` → abajo aparece la barra de voz verde (es simulada). `m`, `D`, `M` cambian los indicadores. `v` sale. `q` sale de la demo.

## 1. Login y lectura (E1 + E2)

- [ ] `bun run dev` → entra solo (ya tenés sesión). El borde azul marca el panel activo.
- [ ] `j`/`k` en servidores, `l` para pasar a canales, `l` otra vez abre el canal. `Ctrl-k` + parte de un nombre + Enter abre otro canal o DM.
- [ ] En un canal con historia: `k` sube por los mensajes; al llegar arriba carga mensajes viejos sin saltos. `gg` va al principio, `G` o `Esc` vuelve abajo.
- [ ] Mandate un mensaje desde el teléfono: aparece en menos de 1 s.
- [ ] Menciones `<@…>` ahora se ven como `@nombre` resaltado (antes salían los números, como en tu captura).
- [ ] Un mensaje con imagen se ve inline (protocolo Kitty). Si ves bloques de colores o nada, decile al agente (o apagalo en `gs` → imágenes).
- [ ] `gu` salta al próximo canal no leído; `gm` muestra/oculta miembros con su punto de presencia (necesita la terminal de 110+ columnas).
- [ ] Wifi: `nmcli radio wifi off; sleep 30; nmcli radio wifi on` → la barra dice `reconectando…` y vuelve a `conectado`; no faltan mensajes.

## 2. Escribir (E3) — en tu servidor de prueba, `#pruebas`

- [ ] `i`, "hola desde discord-tui", Enter → llega al teléfono.
- [ ] `k` para elegir un mensaje, `r`, escribí, Enter → en el teléfono se ve como respuesta.
- [ ] `i`, `@` + parte de un nombre → aparece el cartel de menciones; `Tab` elige; Enter → en el teléfono es una mención real (azul).
- [ ] Sobre un mensaje tuyo: `e`, cambiá el texto, Enter → "(editado)". `dd`, `y` → se borra.
- [ ] `+`, escribí `fire`, Enter → reacción 🔥; repetilo → se va.
- [ ] Captura al portapapeles (Print de Omarchy), en el canal `Ctrl-v` → aparece `📎 captura-….png`; Enter → llega. `a`, un path a un archivo chico, Enter, Enter → llega.
- [ ] Wifi cortado, mandá "sin red" → queda `✗ no se envió · R reintenta`. Volvé el wifi, `R` → llega una sola vez.
- [ ] Abrí un canal con no leídos, esperá 2 s → en el teléfono deja de figurar no leído.
- [ ] [2ª] Mientras escribís, la otra cuenta ve "está escribiendo…"; una mención desde la otra cuenta (estando vos en otro canal) dispara la notificación de escritorio.

## 3. Voz solo (E4b) — lo más importante

Con auriculares y el teléfono mirando el canal de voz **sin entrar** (el teléfono no puede estar en voz con la misma cuenta).

- [ ] Spike primero: `bun run voice-spike <id del servidor> <id del canal de voz>` (ids con "Copiar ID" en modo desarrollador). Tiene que decir `voz: connected` en menos de 15 s, quedarse 60 s y terminar con `SPIKE OK`. En el teléfono te ves en el canal con el mic tachado. **Pasale al agente toda la salida** (no tiene datos sensibles). Si dice `4017` o no llega a `connected`, frená y avisale: hay plan B.
- [ ] En la app: elegí el canal 🔊 en la lista y `v` (o Enter) → abajo: `🔊 canal · servidor · 🔒 E2EE <código> · VAD · ○ vos`. En el teléfono aparecés en el canal.
- [ ] Hablá → `● vos` se prende (y tu nombre en verde debajo del canal); en el teléfono el anillo verde. Callado, se apaga.
- [ ] `M` → `PTT`. Mantené `Espacio` y hablá → prende; soltá → se apaga al toque. Si aparece un aviso amarillo de "interruptor", contáselo al agente.
- [ ] `m` → mic tachado en el teléfono. `D` → auriculares tachados; `D` otra vez → vuelve el mute que tenías.
- [ ] Con el canal seleccionado en la lista, `j` baja por los participantes; `+`/`-` cambia el volumen de esa persona (se ve `80%` al lado del nombre, se guarda).
- [ ] `v` → salís; en el teléfono ya no estás. Entrá de nuevo y salí con `q` → también te libera del canal.
- [ ] `bun run leak-check` → `OK`.

## 4. Voz con otra persona (E4c) [2ª]

- [ ] Antes, desde el cliente oficial con la otra persona: ¿muestra algún código de verificación de la llamada (tocando el candado 🔒)? ¿Cuántos dígitos y cómo agrupados? Contale al agente.
- [ ] Los dos se escuchan apenas entran. Cuando la otra persona habla, su `●` se prende debajo del canal y en la barra (`hablando: …`).
- [ ] 10 minutos de charla (o música de un lado): sin cortes ni voz robótica sostenida.
- [ ] `D` → dejás de escuchar y la otra persona te ve ensordecido; `D` otra vez → vuelve.
- [ ] Si el cliente oficial muestra código: coincide con el `🔒` de la barra.
- [ ] Salí con `v`; pasale al agente las líneas `voice.stats` del log.

## 5. Settings y día de uso (E5)

- [ ] `gs` → elegir micrófono y salida, mover la sensibilidad mirando el medidor, "probar mic" (eco), tema claro/oscuro, imágenes sí/no.
- [ ] Un día de laburo usando solo discord-tui; anotá todo lo que te hizo abrir la app oficial o te molestó y pasáselo al agente.
