import { expect, test } from "bun:test";

import { createSendActions } from "../../src/actions/send";
import type { RestClient } from "../../src/rest/client";
import { selectOutbox } from "../../src/store/selectors";
import { createStore, emptyState } from "../../src/store/store";
import type { PendingAttachment } from "../../src/store/types";
import { uploadAttachments } from "../../src/uploads/upload";

const CH = "100000000000000002";
const BUCKET = "https://discord-attachments-uploads-prd.storage.googleapis.com/upload/abc";

type RestCall = { method: string; path: string; body: unknown };

function fakeRest(handler: (call: RestCall) => unknown): { rest: RestClient; calls: RestCall[] } {
  const calls: RestCall[] = [];
  const rest: RestClient = {
    closed: false,
    async request<T>(method: string, path: string, body?: unknown): Promise<T> {
      const call = { method, path, body };
      calls.push(call);
      return handler(call) as T;
    },
  };
  return { rest, calls };
}

type FetchCall = { url: string; init: RequestInit | undefined };

function fakeFetch(status = 200): { fetchFn: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fn = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(input), init });
    return new Response(null, { status });
  };
  return { fetchFn: fn as typeof fetch, calls };
}

const FILES: PendingAttachment[] = [
  { filename: "captura.png", mime: "image/png", bytes: new Uint8Array([1, 2, 3]) },
  { filename: "doc.pdf", mime: "application/pdf", bytes: new Uint8Array([4, 5]) },
];

function uploadSlots(call: RestCall): unknown {
  if (call.path === `/channels/${CH}/attachments`) {
    return {
      attachments: [
        { id: 0, upload_url: `${BUCKET}?n=0`, upload_filename: "up/0/captura.png" },
        { id: 1, upload_url: `${BUCKET}?n=1`, upload_filename: "up/1/doc.pdf" },
      ],
    };
  }
  return { id: "100000000000000900", channel_id: CH, author: { id: "1" }, content: "x" };
}

function headerNames(init: RequestInit | undefined): string[] {
  return [...new Headers(init?.headers).keys()];
}

test("requests upload slots and returns attachments for postMessage", async () => {
  const { rest, calls } = fakeRest(uploadSlots);
  const { fetchFn } = fakeFetch();
  const result = await uploadAttachments(rest, fetchFn, CH, FILES);
  expect(calls).toEqual([
    {
      method: "POST",
      path: `/channels/${CH}/attachments`,
      body: {
        files: [
          { filename: "captura.png", file_size: 3, id: "0" },
          { filename: "doc.pdf", file_size: 2, id: "1" },
        ],
      },
    },
  ]);
  expect(result).toEqual([
    { id: "0", filename: "captura.png", uploaded_filename: "up/0/captura.png" },
    { id: "1", filename: "doc.pdf", uploaded_filename: "up/1/doc.pdf" },
  ]);
});

test("upload PUT to the bucket has no Authorization nor X-Super-Properties", async () => {
  const { rest } = fakeRest(uploadSlots);
  const { fetchFn, calls } = fakeFetch();
  await uploadAttachments(rest, fetchFn, CH, FILES);
  expect(calls).toHaveLength(2);
  expect(calls[0]!.url).toBe(`${BUCKET}?n=0`);
  expect(calls[0]!.init?.method).toBe("PUT");
  expect(calls[0]!.init?.body).toEqual(FILES[0]!.bytes);
  expect(new Headers(calls[0]!.init?.headers).get("content-type")).toBe("image/png");
  for (const call of calls) {
    const names = headerNames(call.init);
    expect(names).not.toContain("authorization");
    expect(names).not.toContain("x-super-properties");
    expect(names).toEqual(["content-type"]);
  }
});

test("rejects unexpected upload URLs without sending the bytes", async () => {
  for (const url of [
    "http://discord-attachments-uploads-prd.storage.googleapis.com/x",
    "https://evil.example.com/x",
    "https://googleapis.com.evil.example/x",
  ]) {
    const { rest } = fakeRest(() => ({ attachments: [{ id: 0, upload_url: url, upload_filename: "f" }] }));
    const { fetchFn, calls } = fakeFetch();
    await expect(uploadAttachments(rest, fetchFn, CH, [FILES[0]!])).rejects.toThrow(new Error("url de subida inesperada"));
    expect(calls).toHaveLength(0);
  }
});

test("non-2xx PUT throws with the status", async () => {
  const { rest } = fakeRest(uploadSlots);
  const { fetchFn } = fakeFetch(403);
  await expect(uploadAttachments(rest, fetchFn, CH, FILES)).rejects.toThrow(new Error("la subida falló: 403"));
});

test("message is posted with the attachments returned by the upload step", async () => {
  const { rest, calls } = fakeRest(uploadSlots);
  const { fetchFn } = fakeFetch();
  const store = createStore(emptyState());
  const actions = createSendActions({
    store,
    rest,
    upload: (channelId, files) => uploadAttachments(rest, fetchFn, channelId, files),
  });
  await actions.send(CH, "mirá", { attachments: FILES });

  const post = calls.find((c) => c.path === `/channels/${CH}/messages`);
  expect(post).toBeDefined();
  expect((post!.body as { attachments: unknown }).attachments).toEqual([
    { id: "0", filename: "captura.png", uploaded_filename: "up/0/captura.png" },
    { id: "1", filename: "doc.pdf", uploaded_filename: "up/1/doc.pdf" },
  ]);
  expect(calls.map((c) => c.path)).toEqual([`/channels/${CH}/attachments`, `/channels/${CH}/messages`]);
  expect(selectOutbox(store.getState(), CH)).toHaveLength(0);
});

test("upload failure leaves the item failed and does not post the message", async () => {
  const { rest, calls } = fakeRest(uploadSlots);
  const { fetchFn } = fakeFetch(500);
  const store = createStore(emptyState());
  const actions = createSendActions({
    store,
    rest,
    upload: (channelId, files) => uploadAttachments(rest, fetchFn, channelId, files),
  });
  await actions.send(CH, "mirá", { attachments: FILES });

  const items = selectOutbox(store.getState(), CH);
  expect(items).toHaveLength(1);
  expect(items[0]!.state).toBe("failed");
  expect(items[0]!.error).toBe("la subida falló: 500");
  expect(calls.some((c) => c.path === `/channels/${CH}/messages`)).toBe(false);
});
