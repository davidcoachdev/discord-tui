import pkg from "../../package.json";

export const APP_NAME = "zcord";
export const APP_TAGLINE = "Discord en tu terminal";
export const APP_VERSION: string = (pkg as { version?: string }).version ?? "0.0.0";
