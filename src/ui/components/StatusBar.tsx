import { TextAttributes } from "@opentui/core";
import { Show, type JSX } from "solid-js";

import type { Store } from "../../store/store";
import { formatPrivacyCode } from "../../voice/privacy-code";
import { displayName } from "../format";
import { useSelector } from "../store-bridge";
import type { Theme } from "../theme";

export function connectionLabel(connection: string): string {
  if (connection === "ready") return "conectado";
  if (connection === "reconnecting") return "reconectando…";
  if (connection === "resuming") return "reanudando…";
  if (connection === "connecting" || connection === "identifying") return "conectando…";
  return "desconectado";
}

export function StatusBar(props: { store: Store; theme: Theme; mode: "NORMAL" | "INSERT"; hint?: string | null }): JSX.Element {
  const connection = useSelector(props.store, (state) => state.connection);
  const me = useSelector(props.store, (state) => state.me);
  const inputMode = useSelector(props.store, (state) => state.settings.inputMode);
  const connColor = (): string =>
    connection() === "ready" ? props.theme.ok : connection() === "disconnected" ? props.theme.error : props.theme.warn;

  return (
    <box height={1} width="100%" flexDirection="row" flexShrink={0}>
      <text
        fg={props.theme.modeFg}
        bg={props.mode === "INSERT" ? props.theme.modeInsert : props.theme.modeNormal}
        attributes={TextAttributes.BOLD}
      >
        {` ${props.mode} `}
      </text>
      <text fg={connColor()}>{` ● ${connectionLabel(connection())}`}</text>
      <text fg={props.theme.dim}>{` · logueado como ${me()?.username ?? "…"}`}</text>
      <text fg={props.theme.faint}>{` · mic ${inputMode() === "push_to_talk" ? "PTT" : "VAD"}`}</text>
      <box flexGrow={1} />
      <text fg={props.theme.dim} wrapMode="none">{`${props.hint ?? "? ayuda · Ctrl-k saltar · q salir"} `}</text>
    </box>
  );
}

export function VoiceBar(props: { store: Store; theme: Theme }): JSX.Element {
  const state = useSelector(props.store, (s) => s);
  const voice = () => state().voice;
  const channelName = (): string => {
    const id = voice().channelId;
    return id ? state().channels[id]?.name ?? "voz" : "";
  };
  const guildName = (): string => {
    const id = voice().guildId;
    return id ? state().guilds[id]?.name ?? "" : "";
  };
  const speakingNames = (): string => {
    const ids = Object.keys(voice().speaking);
    if (ids.length === 0) return "";
    const names = ids.slice(0, 3).map((id) => displayName(state(), id, voice().guildId));
    return `hablando: ${names.join(", ")}${ids.length > 3 ? ` +${ids.length - 3}` : ""}`;
  };
  const statusText = (): string => {
    const s = voice().status;
    if (s === "joining") return "conectando…";
    if (s === "reconnecting") return "reconectando…";
    return "";
  };
  const visible = (): boolean => voice().channelId !== null || voice().error !== null;

  return (
    <Show when={visible()}>
      <box height={1} width="100%" flexDirection="row" flexShrink={0} backgroundColor={props.theme.panel}>
        <Show
          when={voice().channelId !== null}
          fallback={<text fg={props.theme.error} wrapMode="none">{` ✗ voz: ${voice().error ?? ""}`}</text>}
        >
          <text fg={props.theme.speaking} attributes={TextAttributes.BOLD} wrapMode="none">{` 🔊 ${channelName()}`}</text>
          <text fg={props.theme.dim} wrapMode="none">{guildName() ? ` · ${guildName()}` : ""}</text>
          <Show when={statusText()}>
            <text fg={props.theme.warn}>{` · ${statusText()}`}</text>
          </Show>
          <Show when={voice().status === "connected"}>
            <text fg={props.theme.ok} wrapMode="none">
              {voice().privacyCode ? ` · 🔒 E2EE ${formatPrivacyCode(voice().privacyCode!)}` : " · 🔒 E2EE"}
            </text>
          </Show>
          <text fg={props.theme.accent}>{` · ${state().settings.inputMode === "push_to_talk" ? "PTT" : "VAD"}`}</text>
          <text fg={voice().selfSpeaking ? props.theme.speaking : props.theme.faint}>
            {voice().selfSpeaking ? " · ● vos" : " · ○ vos"}
          </text>
          <text fg={props.theme.warn}>{voice().selfMute && !voice().selfDeaf ? " [mute]" : ""}</text>
          <text fg={props.theme.error}>{voice().selfDeaf ? " [deaf]" : ""}</text>
          <text fg={props.theme.speaking} wrapMode="none">{speakingNames() ? ` · ${speakingNames()}` : ""}</text>
          <text fg={props.theme.warn} wrapMode="none">{voice().pttWarning ? ` · ${voice().pttWarning}` : ""}</text>
          <text fg={props.theme.warn} wrapMode="none">{voice().micError ? ` · sin mic: ${voice().micError}` : ""}</text>
          <box flexGrow={1} />
          <text fg={props.theme.dim} wrapMode="none">{"m mute · D deaf · M modo · v salir "}</text>
        </Show>
      </box>
    </Show>
  );
}
