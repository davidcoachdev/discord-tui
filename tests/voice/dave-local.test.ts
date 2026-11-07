import { describe, expect, test } from "bun:test";
import {
  DAVESession,
  DAVE_PROTOCOL_VERSION,
  ProposalsOperationType,
} from "@snazzah/davey";

import {
  APPENDING_PROPOSALS,
  CHANNEL_ID,
  EXTERNAL_SENDER,
  MY_USER_ID,
} from "../fixtures/davey/vectors";

// DAVE local salió por el camino (b) en el spike: una sesión que llega a `ready`
// con su propio commit, sin un segundo participante (docs/protocol-notes.md).
describe("DAVE local (camino b)", () => {
  test("new DAVESession() throws on invalid protocol version", () => {
    expect(() => new DAVESession(0, MY_USER_ID, CHANNEL_ID)).toThrow();
  });

  test("DAVE_PROTOCOL_VERSION is at least 1", () => {
    expect(DAVE_PROTOCOL_VERSION).toBeGreaterThanOrEqual(1);
  });

  test("a single session reaches ready with a non-empty voicePrivacyCode", () => {
    const session = new DAVESession(DAVE_PROTOCOL_VERSION, MY_USER_ID, CHANNEL_ID);
    session.setExternalSender(EXTERNAL_SENDER);
    session.getSerializedKeyPackage();
    const { commit } = session.processProposals(ProposalsOperationType.APPEND, APPENDING_PROPOSALS);
    expect(commit).toBeDefined();
    session.processCommit(commit!);
    expect(session.voicePrivacyCode).not.toBe("");
  });
});
