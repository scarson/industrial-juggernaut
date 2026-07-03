// ABOUTME: Main-thread entry point for all-agent generation — posts to a Web Worker and resolves
// ABOUTME: with its RecordResult. MUST NOT import recordGame; that stays inside generate.worker.ts.
import type { SessionHeader } from "../engine-client/barrel";
import type { RecordResult } from "../../../src/session/record";

export type GenerateRequest = { header: SessionHeader; turnCap: number };
export type GenerateReply = { ok: true; result: RecordResult } | { ok: false; error: string };

/** The subset of the Worker surface generateGame needs — real Workers satisfy this structurally. */
export interface GenerateWorker {
  postMessage(msg: GenerateRequest): void;
  onmessage: ((ev: MessageEvent<GenerateReply>) => void) | null;
  onerror: ((ev: ErrorEvent) => void) | null;
  onmessageerror: ((ev: MessageEvent) => void) | null;
  terminate(): void;
}

function defaultWorkerFactory(): GenerateWorker {
  return new Worker(new URL("./generate.worker.ts", import.meta.url), { type: "module" });
}

/**
 * Generates an all-agent game off the main thread. `workerFactory` is an injected seam
 * (defaults to a real module Worker) so callers — and tests, since jsdom has no Worker —
 * can supply a fake. The worker fails to load → `onerror` fires, not `onmessage`; a reply
 * that can't be structured-cloned → `onmessageerror`. Both reject rather than hang.
 */
export function generateGame(req: GenerateRequest, workerFactory: () => GenerateWorker = defaultWorkerFactory): Promise<RecordResult> {
  return new Promise((resolve, reject) => {
    const worker = workerFactory();
    worker.onmessage = ({ data }) => {
      worker.terminate();
      if (data.ok) resolve(data.result);
      else reject(new Error(data.error));
    };
    worker.onerror = () => {
      worker.terminate();
      reject(new Error("generation worker failed to load or run"));
    };
    worker.onmessageerror = () => {
      worker.terminate();
      reject(new Error("generation worker sent an undeliverable message"));
    };
    worker.postMessage(req);
  });
}
