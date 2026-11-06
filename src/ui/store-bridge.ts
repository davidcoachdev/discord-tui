import { createSignal, onCleanup, type Accessor } from "solid-js";

import type { Store } from "../store/store";
import type { AppState } from "../store/types";

export function useSelector<T>(store: Store, selector: (state: AppState) => T): Accessor<T> {
  const [value, setValue] = createSignal<T>(selector(store.getState()));
  const unsubscribe = store.subscribe(() => {
    setValue(() => selector(store.getState()));
  });
  onCleanup(unsubscribe);
  return value;
}
