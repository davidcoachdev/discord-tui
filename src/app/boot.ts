import { SessionPermissionError, type Session } from "../auth/session";
import { NetworkError, UnauthorizedError } from "../rest/errors";

export type BootResult =
  | { kind: "logout-done" }
  | { kind: "login" }
  | { kind: "main"; session: Session; me: { id: string; username: string } }
  | { kind: "offline"; session: Session }
  | { kind: "fatal"; message: string };

export interface BootDeps {
  loadSession(): Promise<Session | null>;
  deleteSession(): Promise<boolean>;
  validate(session: Session): Promise<{ id: string; username: string }>;
}

const CHMOD_HINT = "chmod 600 ~/.config/discord-tui/session.json";

export async function boot(argv: string[], deps: BootDeps): Promise<BootResult> {
  if (argv.includes("logout")) {
    await deps.deleteSession();
    return { kind: "logout-done" };
  }

  let session: Session | null;
  try {
    session = await deps.loadSession();
  } catch (error) {
    if (error instanceof SessionPermissionError) {
      const mode = (error.mode & 0o777).toString(8).padStart(3, "0");
      return {
        kind: "fatal",
        message: `session.json tiene permisos ${mode}; tienen que ser 600. Corré: ${CHMOD_HINT}`,
      };
    }
    throw error;
  }

  if (session === null) return { kind: "login" };

  try {
    const me = await deps.validate(session);
    return { kind: "main", session, me };
  } catch (error) {
    if (error instanceof UnauthorizedError) return { kind: "login" };
    if (error instanceof NetworkError) return { kind: "offline", session };
    throw error;
  }
}
