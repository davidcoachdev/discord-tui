import type { Store } from "../store/store";
import { useSelector } from "./store-bridge";

export interface Theme {
  bg: string;
  fg: string;
  dim: string;
  faint: string;
  accent: string;
  unread: string;
  mention: string;
  error: string;
  warn: string;
  ok: string;
  border: string;
  borderFocus: string;
  panel: string;
  selection: string;
  selectionFg: string;
  header: string;
  codeBg: string;
  codeFg: string;
  link: string;
  mentionBg: string;
  mentionFg: string;
  quote: string;
  online: string;
  idle: string;
  dnd: string;
  offline: string;
  speaking: string;
  modeNormal: string;
  modeInsert: string;
  modeFg: string;
  /** Paleta para colorear nombres de usuarios sin rol con color. */
  names: string[];
  /** Degradé del logo de zcord en el splash. */
  brand: string[];
}

export const THEMES: Record<"dark" | "light", Theme> = {
  dark: {
    bg: "#1e1e2e",
    fg: "#cdd6f4",
    dim: "#7f849c",
    faint: "#45475a",
    accent: "#89b4fa",
    unread: "#f5e0dc",
    mention: "#f9e2af",
    error: "#f38ba8",
    warn: "#fab387",
    ok: "#a6e3a1",
    border: "#45475a",
    borderFocus: "#89b4fa",
    panel: "#181825",
    selection: "#313244",
    selectionFg: "#f5e0dc",
    header: "#b4befe",
    codeBg: "#11111b",
    codeFg: "#fab387",
    link: "#74c7ec",
    mentionBg: "#3b3f6b",
    mentionFg: "#b4befe",
    quote: "#6c7086",
    online: "#a6e3a1",
    idle: "#f9e2af",
    dnd: "#f38ba8",
    offline: "#6c7086",
    speaking: "#a6e3a1",
    modeNormal: "#89b4fa",
    modeInsert: "#a6e3a1",
    modeFg: "#11111b",
    names: ["#f38ba8", "#fab387", "#f9e2af", "#a6e3a1", "#94e2d5", "#89dceb", "#89b4fa", "#cba6f7", "#f5c2e7", "#eba0ac"],
    brand: ["#74c7ec", "#89b4fa", "#b4befe", "#cba6f7", "#f5c2e7", "#cba6f7", "#b4befe", "#89b4fa"],
  },
  light: {
    bg: "#eff1f5",
    fg: "#4c4f69",
    dim: "#8c8fa1",
    faint: "#bcc0cc",
    accent: "#1e66f5",
    unread: "#8839ef",
    mention: "#df8e1d",
    error: "#d20f39",
    warn: "#fe640b",
    ok: "#40a02b",
    border: "#bcc0cc",
    borderFocus: "#1e66f5",
    panel: "#e6e9ef",
    selection: "#ccd0da",
    selectionFg: "#4c4f69",
    header: "#7287fd",
    codeBg: "#dce0e8",
    codeFg: "#d20f39",
    link: "#209fb5",
    mentionBg: "#c6d0f5",
    mentionFg: "#1e66f5",
    quote: "#8c8fa1",
    online: "#40a02b",
    idle: "#df8e1d",
    dnd: "#d20f39",
    offline: "#9ca0b0",
    speaking: "#40a02b",
    modeNormal: "#1e66f5",
    modeInsert: "#40a02b",
    modeFg: "#eff1f5",
    names: ["#d20f39", "#fe640b", "#df8e1d", "#40a02b", "#179299", "#04a5e5", "#1e66f5", "#8839ef", "#ea76cb", "#e64553"],
    brand: ["#209fb5", "#1e66f5", "#7287fd", "#8839ef", "#ea76cb", "#8839ef", "#7287fd", "#1e66f5"],
  },
};

export function useTheme(store: Store): () => Theme {
  const themeName = useSelector(store, (state) => state.settings.theme);
  return () => THEMES[themeName()];
}

/** Color de un rol de Discord (entero RGB) como hex; 0 = sin color. */
export function roleHex(color: number): string | null {
  if (!color) return null;
  return `#${color.toString(16).padStart(6, "0")}`;
}

export function presenceColor(theme: Theme, status: string | undefined): string {
  if (status === "online") return theme.online;
  if (status === "idle") return theme.idle;
  if (status === "dnd") return theme.dnd;
  return theme.offline;
}
