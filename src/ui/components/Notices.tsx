import { For, type JSX } from "solid-js";

import type { Store } from "../../store/store";
import { useSelector } from "../store-bridge";

export function Notices(props: { store: Store }): JSX.Element {
  const notices = useSelector(props.store, (state) => Object.values(state.notices));

  return (
    <box flexDirection="column">
      <For each={notices()}>
        {(notice) => (
          <text>{`${notice.text}${notice.count > 1 ? ` (×${notice.count})` : ""}`}</text>
        )}
      </For>
    </box>
  );
}
