import { createDeflate, constants } from "node:zlib";

export type FakeGwStep =
  | { type: "dispatch"; t: string; d: unknown }
  | { type: "close"; code: number };

export interface FakeGatewayOptions {
  onIdentify?(d: any): void;
  script?: FakeGwStep[];
  heartbeatInterval?: number;
  noHeartbeatAck?: boolean;
  closeOnOpen?: number;
}

export interface FakeGateway {
  url: string;
  sent: any[];
  received: any[];
  dispatch(t: string, d: unknown): void;
  sendRaw(payload: unknown): void;
  close(code: number): void;
  stop(): void;
}

interface FakeConn {
  deflate: ReturnType<typeof createDeflate>;
  pending: Buffer[];
  seq: number;
}

export function startFakeGateway(opts: FakeGatewayOptions = {}): FakeGateway {
  const sent: any[] = [];
  const received: any[] = [];
  let active: Bun.ServerWebSocket<FakeConn> | null = null;

  function sendJson(ws: Bun.ServerWebSocket<FakeConn>, payload: unknown): void {
    sent.push(payload);
    ws.data.deflate.write(JSON.stringify(payload));
    ws.data.deflate.flush(constants.Z_SYNC_FLUSH, () => {
      const chunk = Buffer.concat(ws.data.pending);
      ws.data.pending.length = 0;
      try {
        ws.send(chunk);
      } catch {
        // el cliente ya cerró
      }
    });
  }

  function dispatch(t: string, d: unknown): void {
    if (active === null) return;
    active.data.seq += 1;
    sendJson(active, { op: 0, t, s: active.data.seq, d });
  }

  const server = Bun.serve<FakeConn>({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req, srv) {
      const deflate = createDeflate();
      const pending: Buffer[] = [];
      deflate.on("data", (chunk: Buffer) => pending.push(chunk));
      const upgraded = srv.upgrade(req, { data: { deflate, pending, seq: 0 } });
      if (!upgraded) return new Response("expected websocket", { status: 400 });
    },
    websocket: {
      open(ws) {
        active = ws;
        if (opts.closeOnOpen !== undefined) {
          ws.close(opts.closeOnOpen);
          return;
        }
        sendJson(ws, {
          op: 10,
          d: { heartbeat_interval: opts.heartbeatInterval ?? 45_000, _trace: ["fake"] },
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
        if (message.op === 1) {
          if (!opts.noHeartbeatAck) sendJson(ws, { op: 11, d: null });
          return;
        }
        if (message.op === 2) {
          opts.onIdentify?.(message.d);
          for (const step of opts.script ?? []) {
            if (step.type === "dispatch") dispatch(step.t, step.d);
            else if (step.type === "close") ws.close(step.code);
          }
        }
      },
      close(ws) {
        if (active === ws) active = null;
        ws.data.deflate.destroy();
      },
    },
  });

  return {
    url: `ws://127.0.0.1:${server.port}/`,
    sent,
    received,
    dispatch,
    sendRaw: (payload: unknown) => {
      if (active !== null) sendJson(active, payload);
    },
    close: (code: number) => active?.close(code),
    stop: () => server.stop(true),
  };
}
