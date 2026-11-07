import type { Store } from "../store/store";
import { saveSettings } from "./settings";

/**
 * Guarda settings con debounce cada vez que la rama `settings` cambia.
 * Devuelve una función para desengancharse (y vaciar lo pendiente).
 */
export function attachSettingsPersistence(
  store: Store,
  opts?: { path?: string; debounceMs?: number },
): () => void {
  const debounceMs = opts?.debounceMs ?? 500;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let last = store.getState().settings;

  const unsubscribe = store.subscribe(() => {
    const current = store.getState().settings;
    if (current === last) return;
    last = current;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void saveSettings(current, { path: opts?.path }).catch(() => {});
    }, debounceMs);
  });

  return () => {
    unsubscribe();
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
}
