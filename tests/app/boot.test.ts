import { expect, test } from "bun:test";

import { boot, type BootDeps } from "../../src/app/boot";
import { SessionPermissionError, type Session } from "../../src/auth/session";
import { NetworkError, UnauthorizedError } from "../../src/rest/errors";
import { Secret } from "../../src/secret";
import { fakeToken } from "../helpers/fake-token";

const session: Session = { token: new Secret(fakeToken()), userId: "1", buildNumber: 400000 };

function deps(overrides: Partial<BootDeps> = {}): BootDeps {
  return {
    loadSession: async () => session,
    deleteSession: async () => true,
    validate: async () => ({ id: "1", username: "gon" }),
    ...overrides,
  };
}

test("boot with a valid session goes to main", async () => {
  const result = await boot([], deps());
  expect(result.kind).toBe("main");
  if (result.kind === "main") {
    expect(result.me).toEqual({ id: "1", username: "gon" });
    expect(result.session).toBe(session);
  }
});

test("boot without a session goes to login", async () => {
  const result = await boot([], deps({ loadSession: async () => null }));
  expect(result.kind).toBe("login");
});

test("boot with session mode 644 is fatal with the chmod hint", async () => {
  const result = await boot(
    [],
    deps({
      loadSession: async () => {
        throw new SessionPermissionError(0o644);
      },
    }),
  );
  expect(result).toMatchObject({ kind: "fatal" });
  if (result.kind === "fatal") {
    expect(result.message).toContain("permisos 644");
    expect(result.message).toContain("chmod 600 ~/.config/discord-tui/session.json");
  }
});

test("boot with 401 deletes nothing and goes to login", async () => {
  let deleted = false;
  const result = await boot(
    [],
    deps({
      deleteSession: async () => {
        deleted = true;
        return true;
      },
      validate: async () => {
        throw new UnauthorizedError("/users/@me");
      },
    }),
  );
  expect(result.kind).toBe("login");
  expect(deleted).toBe(false);
});

test("boot with network error keeps the session and returns offline", async () => {
  const result = await boot(
    [],
    deps({
      validate: async () => {
        throw new NetworkError("GET", "/users/@me");
      },
    }),
  );
  expect(result).toMatchObject({ kind: "offline" });
});

test("argv ['logout'] deletes the session", async () => {
  let deleted = false;
  const result = await boot(
    ["logout"],
    deps({
      deleteSession: async () => {
        deleted = true;
        return true;
      },
    }),
  );
  expect(result.kind).toBe("logout-done");
  expect(deleted).toBe(true);
});
