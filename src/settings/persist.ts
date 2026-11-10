import type { Settings } from "./settings";
import type { Store } from "../store/store";
import { saveSettings } from "./settings";

/**
 * Guarda settings con debounce cada vez que la rama `settings` cambia.
 * Devuelve una función para desengancharse que, si hay un guardado pendiente
 * (por el debounce o en vuelo), lo espera antes de resolverse: así `stop()`
 * no pierde el último cambio aunque salga antes de que venza el debounce.
 */
export function attachSettingsPersistence(
  store: Store,
  opts?: { path?: string; debounceMs?: number },
): () => Promise<void> {
  const debounceMs = opts?.debounceMs ?? 500;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: Promise<void> | null = null;
  let last = store.getState().settings;

  const persist = (settings: Settings): Promise<void> =>
    saveSettings(settings, { path: opts?.path }).catch(() => {});

  const unsubscribe = store.subscribe(() => {
    const current = store.getState().settings;
    if (current === last) return;
    last = current;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const save = persist(current);
      pending = save;
      void save.then(() => {
        if (pending === save) pending = null;
      });
    }, debounceMs);
  });

  return () => {
    unsubscribe();
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
      return persist(last);
    }
    return pending ?? Promise.resolve();
  };
}
