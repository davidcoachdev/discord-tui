import { TextAttributes } from "@opentui/core";
import { createSignal, For, type JSX } from "solid-js";

import { buildPollView, type PollAnswerView } from "../../store/reducers/polls";
import type { ApiPoll } from "../../store/types";
import { cellWidth, fit } from "../format";
import type { Theme } from "../theme";
import type { Click } from "./Button";

const BAR = 12;
const MAX_LABEL = 28;

/** "termina en 3 h" / "terminada" a partir de `expiry` (ISO). */
export function pollTimeLeft(expiry: string | null, ended: boolean, now: number): string {
  if (ended) return "terminada";
  const at = expiry ? Date.parse(expiry) : NaN;
  if (!Number.isFinite(at)) return "sin vencimiento";
  const minutes = Math.max(1, Math.ceil((at - now) / 60_000));
  if (minutes < 60) return `termina en ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `termina en ${hours} h`;
  return `termina en ${Math.round(hours / 24)} d`;
}

export function pollBar(percent: number, width = BAR): string {
  const full = Math.round((Math.max(0, Math.min(100, percent)) * width) / 100);
  return "█".repeat(full) + "░".repeat(width - full);
}

function AnswerRow(props: {
  answer: PollAnswerView;
  labelWidth: number;
  canVote: boolean;
  theme: Theme;
  onVote?(answerId: number): void;
}): JSX.Element {
  const [hover, setHover] = createSignal(false);
  const bg = (): string | undefined =>
    props.canVote && hover() ? props.theme.selection : props.answer.meVoted ? props.theme.mentionBg : undefined;
  const label = (): string => `${props.answer.emoji ? `${props.answer.emoji} ` : ""}${props.answer.text}`;
  return (
    <text
      wrapMode="none"
      bg={bg()}
      onMouseDown={(e: Click) => {
        e.stopPropagation();
        if (props.canVote) props.onVote?.(props.answer.id);
      }}
      onMouseOver={() => setHover(true)}
      onMouseOut={() => setHover(false)}
    >
      <span style={{ fg: props.theme.ok }}>{props.answer.meVoted ? "✓ " : "  "}</span>
      <span style={{ fg: props.answer.meVoted ? props.theme.mentionFg : props.theme.fg }}>{fit(label(), props.labelWidth)}</span>
      {/* Cantidad y % antes de la barra: en un panel angosto se corta la barra, no los números. */}
      <span style={{ fg: props.theme.fg }}>{` ${String(props.answer.count).padStart(3)}`}</span>
      <span style={{ fg: props.theme.dim }}>{` ${String(props.answer.percent).padStart(3)}% `}</span>
      <span style={{ fg: props.answer.meVoted ? props.theme.accent : props.theme.dim }}>{pollBar(props.answer.percent)}</span>
    </text>
  );
}

/** Encuesta debajo del contenido: pregunta, una fila por respuesta (click vota) y el total. */
export function PollBox(props: { poll: ApiPoll; theme: Theme; now?: number; onVote?(answerId: number): void }): JSX.Element {
  const view = () => buildPollView(props.poll, props.now ?? Date.now());
  const labelWidth = (): number =>
    Math.min(
      MAX_LABEL,
      Math.max(4, ...view().answers.map((a) => cellWidth(`${a.emoji ? `${a.emoji} ` : ""}${a.text}`))),
    );
  const footer = (): string => {
    const v = view();
    const votes = `${v.total} ${v.total === 1 ? "voto" : "votos"}`;
    const kind = v.multiselect && !v.ended ? " · varias respuestas" : "";
    return `${votes} · ${pollTimeLeft(v.expiry, v.ended, props.now ?? Date.now())}${kind}`;
  };
  return (
    <box
      flexDirection="column"
      border
      borderStyle="rounded"
      borderColor={props.theme.border}
      paddingLeft={1}
      paddingRight={1}
      alignSelf="flex-start"
      maxWidth="100%"
    >
      <text fg={props.theme.fg} attributes={TextAttributes.BOLD} wrapMode="word">
        {`📊 ${view().question}`}
      </text>
      <For each={view().answers}>
        {(answer) => (
          <AnswerRow
            answer={answer}
            labelWidth={labelWidth()}
            canVote={!view().ended}
            theme={props.theme}
            onVote={props.onVote}
          />
        )}
      </For>
      <text fg={props.theme.dim} wrapMode="none">{footer()}</text>
    </box>
  );
}
