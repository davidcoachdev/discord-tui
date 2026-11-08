/**
 * Spike "ver transmisiones" (2026-11-08): ¿davey descifra un frame de video H264 cifrado con DAVE?
 * Sesión local en `ready` con los vectores de davey (como pipeline-local.ts). Sin Discord.
 *   bun scripts/spike-watch/dave-video.ts
 */
import { Codec, DAVESession, DAVE_PROTOCOL_VERSION, MediaType, ProposalsOperationType } from "@snazzah/davey";
import { APPENDING_PROPOSALS, CHANNEL_ID, EXTERNAL_SENDER, MY_USER_ID } from "../../tests/fixtures/davey/vectors";

const dave = new DAVESession(DAVE_PROTOCOL_VERSION, MY_USER_ID, CHANNEL_ID);
dave.setExternalSender(EXTERNAL_SENDER);
dave.getSerializedKeyPackage();
const { commit } = dave.processProposals(ProposalsOperationType.APPEND, APPENDING_PROPOSALS);
if (commit) dave.processCommit(commit);
console.log("ready", dave.ready, dave.getUserIds());
const sc4 = Buffer.from([0, 0, 0, 1]);
const sc3 = Buffer.from([0, 0, 1]);
const frame = Buffer.concat([sc4, Buffer.from([0x67, 0x42, 0, 0x1f]), sc3, Buffer.from([0x68, 0xce, 0x3c, 0x80]), sc3, Buffer.from([0x65]), Buffer.alloc(5000, 7)]);
const enc = dave.encrypt(MediaType.VIDEO, Codec.H264, frame);
console.log("enc", frame.length, "->", enc.length, enc.subarray(0, 24).toString("hex"), "tail", enc.subarray(-4).toString("hex"));
try {
  const dec = dave.decrypt(MY_USER_ID, MediaType.VIDEO, enc);
  console.log("dec", dec.length, dec.equals(frame), dec.subarray(0, 24).toString("hex"));
} catch (e) {
  console.log("dec err", String(e));
}
