import { For, type JSX } from "solid-js";

import type { Store } from "../../store/store";
import { useSelector } from "../store-bridge";
import type { Theme } from "../theme";

export function Notices(props: { store: Store; theme?: Theme }): JSX.Element {
  const notices = useSelector(props.store, (state) => Object.values(state.notices));
  const color = (level: string): string | undefined =>
    level === "error" ? props.theme?.error : level === "warn" ? props.theme?.warn : props.theme?.accent;

  return (
    <box flexDirection="column" width="100%" flexShrink={0}>
      <For each={notices()}>
        {(notice) => (
          <text fg={color(notice.level)} wrapMode="word">
            {`${notice.level === "error" ? "✗" : notice.level === "warn" ? "!" : "ℹ"} ${notice.text}${notice.count > 1 ? ` (×${notice.count})` : ""}`}
          </text>
        )}
      </For>
    </box>
  );
}
