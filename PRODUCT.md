# Product

<!-- impeccable:product-schema 1 -->

## Platform

web (la landing). El producto en sí es una app de terminal (TUI) para Linux.

## Stack

La landing es HTML/CSS estático, sin build. Se sirve desde cerostation (`/srv/www/zcord`, Caddy, túnel de Cloudflare) en
https://zcord.gonzalorocca.com y se publica con `scripts/deploy-site.sh`. Fuente en `site/`.

## Users

Devs que viven en la terminal (vim, tmux, Linux, Wayland, tiling WMs) y usan Discord todos los días. Lo abren a
desgano: es una app Electron pesada que los saca de su flujo. Llegan a la landing desde un post o un link
compartido y deciden en segundos si vale la pena instalarlo.

## Product Purpose

zcord es un cliente de Discord completo que corre dentro de la terminal: chat, voz, pantalla compartida y
transmisiones, con el mouse como Discord o con teclas estilo vim. La landing existe para que ese dev lo pruebe:
éxito = clona el repo y corre `bin/zcord` (o `bin/zcord demo` para mirar sin loguearse).

## Positioning

No es un cliente de solo texto ni un bot. Tiene voz real con el cifrado de punta a punta de Discord (DAVE),
Go Live (compartir pantalla y mirar la de otros) e imágenes y GIFs dibujados en la terminal con el protocolo
gráfico de Kitty. Todo es clickeable y, a la vez, se maneja entero con el teclado.

## Operating Context

- Linux con PipeWire y Wayland; terminal Ghostty o Kitty; Bun.
- Se loguea con la cuenta personal (QR o token). `bin/zcord demo` muestra la UI con datos falsos, sin conectarse.
- Opcionales: `wl-clipboard` (pegar), `wf-recorder`/`ffmpeg` (pantalla compartida).

## Capabilities and Constraints

- Chat: servidores, canales, DMs, grupos, hilos, foros, markdown, código, respuestas, edición, borrado,
  reacciones, menciones, emojis propios, stickers, encuestas, embeds, "mensajes nuevos".
- Voz: E2EE DAVE con código de privacidad, VAD o push-to-talk, mute, ensordecer, volumen por persona, salida de
  audio elegible, sonidos de eventos. Chat de los canales de voz sin entrar a la llamada.
- Pantalla: Go Live del propio monitor; ver transmisiones de otros dentro de la terminal (en ajuste).
- Adjuntos: pegar captura o archivos copiados (`Ctrl-v`), adjuntar por ruta.
- Teclas reales: `i` escribir, `j/k`, `Ctrl-k` saltar, `r` responder, `e` editar, `dd` borrar, `+` reaccionar,
  `v` voz, `m` mute, espacio PTT, `S` transmitir, `w` ver transmisión, `?` ayuda.
- Solo Linux. No hay binarios ni paquetes: se corre desde el repo.
- Abierto: el repo (github.com/gonzalonicolasr/discord-tui) hoy es privado; Gon eligió que la landing lleve a
  probarlo, así que se hace público después de revisar el historial.

## Brand Commitments

- Nombre: **zcord**, en minúscula. Tagline: "Discord en tu terminal". Versión actual 0.2.0.
- Voz: español rioplatense (vos), directa, anti-corporativa, sin humo. Autor: Gon (Gonzalo Rocca), San Luis,
  Argentina; gonzalorocca.com, @gnrocca, linkedin.com/in/gonnicolas.
- No es de Discord Inc. y no usa su logo ni su marca visual.
- Aviso obligatorio y honesto: entra con la cuenta personal, va contra los Términos de Discord y la cuenta puede
  ser suspendida.

## Evidence on Hand

- `docs/img/zcord.gif` (demo animada), `docs/img/{chat,voz,saltar,splash}.png`, `docs/img/og.png`: todas salen
  de `bin/zcord demo` (datos falsos), generadas por `scripts/readme-gif.tsx` y `scripts/screenshots.tsx`.
- Logo ASCII "block" de la splash (`src/ui/components/Splash.tsx`).
- No hay usuarios, testimonios, estrellas ni métricas: no inventarlos.

## Product Principles

1. La terminal es el lugar: nada obliga a salir de ella, ni para la voz.
2. Mouse y teclado valen lo mismo; nunca hay que tipear un id.
3. Honestidad sobre el riesgo de la cuenta y sobre lo que todavía está en ajuste.
4. Probarlo tiene que costar un comando.
