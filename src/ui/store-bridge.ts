import { createSignal, onCleanup, type Accessor } from "solid-js";

import type { Store } from "../store/store";
import type { AppState } from "../store/types";

export function useSelector<T>(
  store: Store,
  selector: (state: AppState) => T,
  equals: (a: T, b: T) => boolean = Object.is,
): Accessor<T> {
  let current = selector(store.getState());
  const [value, setValue] = createSignal<T>(current, { equals: false });
  const unsubscribe = store.subscribe(() => {
    const next = selector(store.getState());
    if (equals(current, next)) return;
    current = next;
    setValue(() => next);
  });
  onCleanup(unsubscribe);
  return value;
}

/** Igualdad por campos de primer nivel (para selectores que arman un objeto con referencias del store). */
export function shallowEqual<T extends Record<string, unknown>>(a: T, b: T): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => Object.is(a[key], b[key]));
}

/** Igualdad estructural para datos derivados chicos (filas de listas). */
export function jsonEqual<T>(a: T, b: T): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
