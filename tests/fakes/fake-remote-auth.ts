import { fingerprintOf } from "../../src/auth/ra-crypto";

export interface FakeRaScript {
  /** En la primera conexión manda un fingerprint que no coincide con la clave del cliente. */
  fingerprint?: "correct" | "wrong";
  /** Cierra con este código justo después del pending_remote_init de la primera conexión. */
  closeAfterQr?: number;
  /** No responde los heartbeats. */
  noHeartbeatAck?: boolean;
  /** En la primera conexión manda `cancel` en vez de `pending_login`. */
  cancel?: boolean;
  /** Se queda en el QR y no manda ticket (para probar el heartbeat). */
  stallAfterQr?: boolean;
  /** Cierra con 1000 después de `pending_login` (default: sí). */
  closeAfterLogin?: boolean;
  heartbeatInterval?: number;
  username?: string;
  userId?: string;
  ticket?: string;
}

export interface FakeRemoteAuth {
  url: string;
  received: any[];
  originHeader: string | null;
  connections: number;
  stop(): void;
}

interface FakeConn {
  index: number;
  publicKey: CryptoKey | null;
  spki: Uint8Array | null;
  nonce: Uint8Array | null;
}

function closeSafe(ws: { close(code?: number): void }, code: number): void {
  try {
    ws.close(code);
  } catch {
    // ya estaba cerrado
  }
}

function sendSafe(ws: { send(data: string): unknown }, payload: unknown): boolean {
  try {
    ws.send(JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

export function startFakeRemoteAuth(script: FakeRaScript = {}): FakeRemoteAuth {
  let originHeader: string | null = null;
  let connections = 0;
  const received: any[] = [];

  async function onInit(ws: Bun.ServerWebSocket<FakeConn>, message: any): Promise<void> {
    const der = Buffer.from(String(message.encoded_public_key), "base64");
    const publicKey = await crypto.subtle.importKey(
      "spki",
      der,
      { name: "RSA-OAEP", hash: "SHA-256" },
      false,
      ["encrypt"],
    );
    ws.data.publicKey = publicKey;
    ws.data.spki = new Uint8Array(der);

    const nonce = crypto.getRandomValues(new Uint8Array(32));
    ws.data.nonce = nonce;
    const encrypted = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, publicKey, nonce);
    sendSafe(ws, { op: "nonce_proof", encrypted_nonce: Buffer.from(encrypted).toString("base64") });
  }

  function onNonceProof(ws: Bun.ServerWebSocket<FakeConn>, message: any): void {
    const expected = ws.data.nonce;
    const sent = Buffer.from(String(message.nonce), "base64url");
    if (expected === null || sent.length !== expected.length || !sent.every((byte, index) => byte === expected[index])) {
      closeSafe(ws, 4001);
      return;
    }
    const spki = ws.data.spki;
    if (spki === null || ws.data.publicKey === null) return;

    const fingerprint = fingerprintOf(spki);
    const wrong = script.fingerprint === "wrong" && ws.data.index === 1;
    sendSafe(ws, { op: "pending_remote_init", fingerprint: wrong ? "deadbeef-not-my-key" : fingerprint });

    if (wrong || script.stallAfterQr) return;
    if (script.closeAfterQr !== undefined && ws.data.index === 1) {
      setTimeout(() => closeSafe(ws, script.closeAfterQr!), 10);
      return;
    }
    setTimeout(() => void sendTicket(ws), 10);
  }

  async function sendTicket(ws: Bun.ServerWebSocket<FakeConn>): Promise<void> {
    const publicKey = ws.data.publicKey;
    if (publicKey === null) return;
    const payload = `${script.userId ?? "123"}:0:avatarhash:${script.username ?? "gonfake"}`;
    const encrypted = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, publicKey, new TextEncoder().encode(payload));
    if (!sendSafe(ws, { op: "pending_ticket", encrypted_user_payload: Buffer.from(encrypted).toString("base64") })) return;

    setTimeout(() => {
      if (script.cancel && ws.data.index === 1) {
        sendSafe(ws, { op: "cancel" });
        closeSafe(ws, 1000);
        return;
      }
      if (!sendSafe(ws, { op: "pending_login", ticket: script.ticket ?? "ticket-1" })) return;
      if (script.closeAfterLogin !== false) setTimeout(() => closeSafe(ws, 1000), 100);
    }, 10);
  }

  const server = Bun.serve<FakeConn>({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req, srv) {
      originHeader = req.headers.get("origin");
      const upgraded = srv.upgrade(req, { data: { index: 0, publicKey: null, spki: null, nonce: null } });
      if (!upgraded) return new Response("expected websocket", { status: 400 });
    },
    websocket: {
      open(ws) {
        connections += 1;
        ws.data.index = connections;
        sendSafe(ws, {
          op: "hello",
          heartbeat_interval: script.heartbeatInterval ?? 10_000,
          timeout_ms: 60_000,
        });
      },
      message(ws, raw) {
        let message: any;
        try {
          message = JSON.parse(String(raw));
        } catch {
          return;
        }
        received.push(message);
        if (message.op === "init") void onInit(ws, message);
        else if (message.op === "nonce_proof") onNonceProof(ws, message);
        else if (message.op === "heartbeat" && !script.noHeartbeatAck) sendSafe(ws, { op: "heartbeat_ack" });
      },
    },
  });

  return {
    url: `ws://127.0.0.1:${server.port}/`,
    received,
    get originHeader() {
      return originHeader;
    },
    get connections() {
      return connections;
    },
    stop: () => server.stop(true),
  };
}
