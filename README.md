# discord-tui

Un cliente de Discord para la terminal, para usar todos los días, hecho con OpenTUI, TypeScript y Bun. Tiene texto y voz con DAVE E2EE.
Se loguea con la cuenta personal: eso va contra los ToS de Discord y la cuenta puede terminar baneada (riesgo aceptado).
Corre en Linux con PipeWire, en Ghostty o Kitty, y se maneja con el teclado estilo vim.
Diseño: docs/superpowers/specs/2026-11-06-discord-tui-design.md
Estado (2026-11-07): texto completo y voz implementados; falta la prueba con la cuenta real (`docs/PRUEBAS-GON.md`).

Cómo correrlo:

- `bun install` una vez.
- `bun run dev`: la app real (login por QR o token la primera vez). Se usa con el mouse como Discord (click en canales, en 🔊 para entrar a voz, en los mensajes para responder/editar/borrar/reaccionar) o con el teclado estilo vim.
- `bun run demo`: la UI con datos falsos, sin conectarse a Discord (para mirar y probar teclas).
- `bun run voice-spike <guild> <canal>` es opcional (diagnóstico de voz por consola); la app no lo necesita.
- `?` dentro de la app muestra todas las teclas. `bun test` y `bun run typecheck` para el código.
