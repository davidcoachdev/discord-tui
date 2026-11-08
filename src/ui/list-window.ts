/** Qué tramo de una lista larga se muestra para que el elegido siempre quede a la vista. */
export function listWindow(index: number, total: number, size: number): { start: number; end: number } {
  if (total <= size) return { start: 0, end: total };
  const clamped = Math.max(0, Math.min(total - 1, index));
  const start = Math.max(0, Math.min(total - size, clamped - Math.floor(size / 2)));
  return { start, end: start + size };
}

/** Mueve la selección con las teclas de lista; null si la tecla no es de navegación. */
export function moveInList(
  key: { name: string; ctrl?: boolean; shift?: boolean },
  index: number,
  total: number,
  page: number,
): number | null {
  if (total === 0) return null;
  const last = total - 1;
  const clamp = (n: number): number => Math.max(0, Math.min(last, n));
  if (key.name === "down" || (key.ctrl && key.name === "n") || (key.name === "tab" && !key.shift)) return clamp(index + 1);
  if (key.name === "up" || (key.ctrl && key.name === "p") || (key.name === "tab" && key.shift)) return clamp(index - 1);
  if (key.name === "pagedown") return clamp(index + page);
  if (key.name === "pageup") return clamp(index - page);
  if (key.name === "home") return 0;
  if (key.name === "end") return last;
  return null;
}
