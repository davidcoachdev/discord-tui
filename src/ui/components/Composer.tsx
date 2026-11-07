import type { JSX } from "solid-js";

export function Composer(props: {
  text: string;
  insert: boolean;
  replyTo: string | null;
  editing: string | null;
}): JSX.Element {
  const over = props.text.length > 2000;
  const suffix = over ? ` · ${props.text.length}/2000 · el mensaje es muy largo` : ` ${props.text.length}/2000`;

  return (
    <box height={1} width="100%" paddingLeft={1}>
      <text>{`${props.insert ? "❯ " : "· "}${props.text}${props.insert ? "█" : ""}${suffix}`}</text>
    </box>
  );
}
