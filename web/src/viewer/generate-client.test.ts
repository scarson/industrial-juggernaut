// ABOUTME: Pins generateGame's Promise contract against an injected fake worker (jsdom has no
// ABOUTME: real Worker) — success envelope resolves, error envelope/onerror/onmessageerror reject.
import { describe, expect, test } from "vitest";
import { generateGame, type GenerateWorker } from "./generate-client";
import type { GenerateRequest, GenerateReply } from "./generate-client";
import type { SessionHeader } from "../engine-client/barrel";
import type { RecordResult } from "../../../src/session/record";

// A minimal fake worker: captures the posted message, exposes onmessage/onerror/onmessageerror
// hooks the test drives directly, and a postMessage the test asserts on. No real Worker involved.
function makeFakeWorker(): GenerateWorker & { posted: GenerateRequest[] } {
  const fake: GenerateWorker & { posted: GenerateRequest[] } = {
    posted: [],
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    postMessage(msg: GenerateRequest) {
      fake.posted.push(msg);
    },
    terminate() {},
  };
  return fake;
}

const header: SessionHeader = {
  formatVersion: 1,
  replayVersion: "test",
  seed: 1n,
  config: {} as SessionHeader["config"],
  boardSource: { kind: "generate", size: 96, ironCount: 6 },
  seats: [{ kind: "human" }],
};

describe("generateGame", () => {
  test("posts {header, turnCap} to the worker", async () => {
    let fake!: ReturnType<typeof makeFakeWorker>;
    const factory = () => (fake = makeFakeWorker());
    void generateGame({ header, turnCap: 20 }, factory);

    expect(fake.posted).toEqual([{ header, turnCap: 20 }]);
  });

  test("a success reply resolves the promise with the result payload", async () => {
    const factory = () => makeFakeWorker();
    let fake!: ReturnType<typeof makeFakeWorker>;
    const wrappedFactory = () => (fake = factory());

    const promise = generateGame({ header, turnCap: 20 }, wrappedFactory);
    const fakeResult = { header, log: [], boundaryHashes: [], events: [], finalState: {}, hitTurnCap: false } as unknown as RecordResult;
    const reply: GenerateReply = { ok: true, result: fakeResult };
    fake.onmessage!({ data: reply } as MessageEvent<GenerateReply>);

    await expect(promise).resolves.toBe(fakeResult);
  });

  test("an error reply rejects with the message", async () => {
    let fake!: ReturnType<typeof makeFakeWorker>;
    const factory = () => (fake = makeFakeWorker());

    const promise = generateGame({ header, turnCap: 20 }, factory);
    const reply: GenerateReply = { ok: false, error: "recordGame blew up" };
    fake.onmessage!({ data: reply } as MessageEvent<GenerateReply>);

    await expect(promise).rejects.toThrow("recordGame blew up");
  });

  test("the worker's onerror event rejects with a friendly message", async () => {
    let fake!: ReturnType<typeof makeFakeWorker>;
    const factory = () => (fake = makeFakeWorker());

    const promise = generateGame({ header, turnCap: 20 }, factory);
    fake.onerror!(new ErrorEvent("error", { message: "failed to load worker script" }));

    await expect(promise).rejects.toThrow(/worker/i);
  });

  test("the worker's onmessageerror event rejects with a friendly message", async () => {
    let fake!: ReturnType<typeof makeFakeWorker>;
    const factory = () => (fake = makeFakeWorker());

    const promise = generateGame({ header, turnCap: 20 }, factory);
    fake.onmessageerror!({} as MessageEvent);

    await expect(promise).rejects.toThrow(/worker/i);
  });
});
