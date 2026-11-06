export interface FakeHttp {
  url: string;
  requests: Request[];
  stop(): void;
}

export function startFakeHttp(handler: (req: Request) => Response | Promise<Response>): FakeHttp {
  const requests: Request[] = [];
  const server = Bun.serve({
    port: 0,
    fetch: (req) => {
      requests.push(req.clone() as unknown as Request);
      return handler(req);
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    requests,
    stop: () => server.stop(true),
  };
}
