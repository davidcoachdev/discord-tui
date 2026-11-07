import type { Store } from "../store/store";
import { useSelector } from "./store-bridge";

export interface Theme {
  bg: string;
  fg: string;
  dim: string;
  accent: string;
  unread: string;
  mention: string;
  error: string;
  warn: string;
  ok: string;
}

export const THEMES: Record<"dark" | "light", Theme> = {
  dark: {
    bg: "#1e1e2e",
    fg: "#cdd6f4",
    dim: "#6c7086",
    accent: "#89b4fa",
    unread: "#f5e0dc",
    mention: "#f9e2af",
    error: "#f38ba8",
    warn: "#fab387",
    ok: "#a6e3a1",
  },
  light: {
    bg: "#eff1f5",
    fg: "#4c4f69",
    dim: "#9ca0b0",
    accent: "#1e66f5",
    unread: "#8839ef",
    mention: "#df8e1d",
    error: "#d20f39",
    warn: "#fe640b",
    ok: "#40a02b",
  },
};

export function useTheme(store: Store): () => Theme {
  const themeName = useSelector(store, (state) => state.settings.theme);
  return () => THEMES[themeName()];
}
