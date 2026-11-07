import { normalizeSettings, type Settings } from "../../settings/settings";
import type { AppState } from "../types";

export function applySettingsLoaded(state: AppState, settings: Settings): AppState {
  return { ...state, settings };
}

export function applySettingsPatch(state: AppState, patch: Partial<Settings>): AppState {
  return { ...state, settings: normalizeSettings({ ...state.settings, ...patch }) };
}
