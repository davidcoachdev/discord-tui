import type { KittyKeyboardOptions } from "@opentui/core";

/**
 * Kitty keyboard protocol (Ghostty y Kitty). `allKeysAsEscapes` hace falta para el push-to-talk:
 * sin ese modo las teclas que producen texto (como Espacio) se mandan como texto plano y la
 * terminal no avisa cuándo se sueltan (docs del protocolo de Kitty, "Report all keys as escape codes").
 */
export const KITTY_KEYBOARD: KittyKeyboardOptions = { events: true, allKeysAsEscapes: true };
