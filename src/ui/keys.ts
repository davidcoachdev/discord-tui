export interface KeyEntry {
  key: string;
  desc: string;
  group: "Navegación" | "Mensajes" | "Voz" | "App";
}

// Tabla de la spec 7.5 + las nuestras (R, gm, gs) — docs/superpowers/plans/2026-11-06-discord-tui-e5.md.
export const SPEC_KEYS: KeyEntry[] = [
  { key: "j", desc: "bajar", group: "Navegación" },
  { key: "k", desc: "subir", group: "Navegación" },
  { key: "h", desc: "panel anterior", group: "Navegación" },
  { key: "l", desc: "panel siguiente / abrir", group: "Navegación" },
  { key: "gg", desc: "ir al principio", group: "Navegación" },
  { key: "G", desc: "ir al final", group: "Navegación" },
  { key: "gu", desc: "siguiente canal no leído", group: "Navegación" },
  { key: "gm", desc: "mostrar u ocultar miembros", group: "Navegación" },
  { key: "gs", desc: "abrir settings", group: "App" },
  { key: "i", desc: "entrar al composer", group: "Mensajes" },
  { key: "Esc", desc: "salir del composer / cerrar", group: "Mensajes" },
  { key: "r", desc: "responder al último mensaje", group: "Mensajes" },
  { key: "e", desc: "editar mensaje seleccionado", group: "Mensajes" },
  { key: "dd", desc: "borrar mensaje seleccionado", group: "Mensajes" },
  { key: "R", desc: "reintentar el envío fallido", group: "Mensajes" },
  { key: "+", desc: "agregar reacción", group: "Mensajes" },
  { key: "Ctrl-k", desc: "quick switcher", group: "Navegación" },
  { key: "v", desc: "entrar a voz", group: "Voz" },
  { key: "m", desc: "mutear micrófono", group: "Voz" },
  { key: "D", desc: "ensordecer", group: "Voz" },
  { key: "Espacio", desc: "push-to-talk", group: "Voz" },
  { key: "M", desc: "mutear a otro participante", group: "Voz" },
  { key: "Ctrl-v", desc: "pegar imagen del portapapeles", group: "Mensajes" },
  { key: "a", desc: "marcar como leído", group: "Mensajes" },
  { key: "?", desc: "mostrar esta ayuda", group: "App" },
  { key: "q", desc: "salir", group: "App" },
];

export function keysByGroup(): Map<KeyEntry["group"], KeyEntry[]> {
  const groups = new Map<KeyEntry["group"], KeyEntry[]>();
  for (const entry of SPEC_KEYS) {
    const list = groups.get(entry.group) ?? [];
    list.push(entry);
    groups.set(entry.group, list);
  }
  return groups;
}
