import {
  DAVESession,
  DAVE_PROTOCOL_VERSION,
  MediaType,
  ProposalsOperationType,
  SessionStatus,
} from "@snazzah/davey";

import {
  APPENDING_PROPOSALS,
  CHANNEL_ID,
  EXTERNAL_SENDER,
  MY_USER_ID,
  OTHER_USER_ID,
} from "../tests/fixtures/davey/vectors";

const SILENCE_FRAME = Buffer.from([0xf8, 0xff, 0xfe]);

function attemptA(): boolean {
  try {
    // A es la cuenta que manda la propuesta; B es la que se une.
    const a = new DAVESession(DAVE_PROTOCOL_VERSION, MY_USER_ID, CHANNEL_ID);
    const b = new DAVESession(DAVE_PROTOCOL_VERSION, OTHER_USER_ID, CHANNEL_ID);

    a.setExternalSender(EXTERNAL_SENDER);
    a.getSerializedKeyPackage();
    const { commit, welcome } = a.processProposals(ProposalsOperationType.APPEND, APPENDING_PROPOSALS, [
      MY_USER_ID,
      OTHER_USER_ID,
    ]);
    if (!commit || !welcome) return false;

    a.processCommit(commit);
    b.setExternalSender(EXTERNAL_SENDER);
    b.processWelcome(welcome);

    if (!a.ready || !b.ready) return false;
    if (a.voicePrivacyCode === "" || a.voicePrivacyCode !== b.voicePrivacyCode) return false;

    const encrypted = a.encryptOpus(SILENCE_FRAME);
    const decrypted = b.decrypt(MY_USER_ID, MediaType.AUDIO, encrypted);
    return Buffer.compare(decrypted, SILENCE_FRAME) === 0;
  } catch (error) {
    console.error("a falló:", error instanceof Error ? error.message : error);
    return false;
  }
}

function attemptB(): boolean {
  try {
    const a = new DAVESession(DAVE_PROTOCOL_VERSION, MY_USER_ID, CHANNEL_ID);
    a.setExternalSender(EXTERNAL_SENDER);
    a.getSerializedKeyPackage();
    const { commit } = a.processProposals(ProposalsOperationType.APPEND, APPENDING_PROPOSALS);
    if (!commit) return false;
    a.processCommit(commit);
    return a.status === SessionStatus.ACTIVE || a.status === SessionStatus.AWAITING_RESPONSE
      ? a.voicePrivacyCode !== ""
      : false;
  } catch (error) {
    console.error("b falló:", error instanceof Error ? error.message : error);
    return false;
  }
}

function attemptC(): boolean {
  try {
    const a = new DAVESession(DAVE_PROTOCOL_VERSION, MY_USER_ID, CHANNEL_ID);
    a.setExternalSender(EXTERNAL_SENDER);
    const first = a.getSerializedKeyPackage();
    const second = a.getSerializedKeyPackage();
    if (Buffer.compare(first, second) === 0) return false;
    a.setPassthroughMode(true);
    const before = a.encryptOpus(SILENCE_FRAME);
    if (!Buffer.isBuffer(before) || before.length === 0) return false;
    return DAVE_PROTOCOL_VERSION >= 1;
  } catch (error) {
    console.error("c falló:", error instanceof Error ? error.message : error);
    return false;
  }
}

for (const [name, attempt] of [
  ["a", attemptA],
  ["b", attemptB],
  ["c", attemptC],
] as const) {
  if (attempt()) {
    console.log(`DAVE local: ${name}`);
    process.exit(0);
  }
}

console.log("DAVE local: ninguna");
process.exit(1);
