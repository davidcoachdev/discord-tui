import type { JSX } from "solid-js";

const MIN_DB = -60;
const MAX_DB = 0;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function meterRow(levelDb: number, thresholdDb: number, open: boolean, width: number): string {
  const columns = Math.max(4, width);
  const level = clamp01((levelDb - MIN_DB) / (MAX_DB - MIN_DB));
  const threshold = clamp01((thresholdDb - MIN_DB) / (MAX_DB - MIN_DB));
  const filled = Math.round(level * columns);
  const markerIndex = Math.min(columns - 1, Math.floor(threshold * columns));

  let bar = "";
  for (let i = 0; i < columns; i += 1) {
    if (i === markerIndex) bar += "|";
    else if (i < filled) bar += "█";
    else bar += "─";
  }

  return `${bar} ${open ? "● hablando" : "  callado"}`;
}

export function LevelMeter(props: {
  levelDb: number;
  thresholdDb: number;
  open: boolean;
  width: number;
}): JSX.Element {
  return (
    <box height={1} width="100%">
      <text>{meterRow(props.levelDb, props.thresholdDb, props.open, props.width)}</text>
    </box>
  );
}
