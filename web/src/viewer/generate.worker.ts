// ABOUTME: The Web Worker that runs recordGame off the main thread — the ONLY module in the
// ABOUTME: client allowed to import recordGame, so agents ship in the worker chunk, never the entry.
import { recordGame } from "../../../src/session/record";
import type { GenerateRequest, GenerateReply } from "./generate-client";

self.onmessage = ({ data }: MessageEvent<GenerateRequest>) => {
  const { header, turnCap } = data;
  let reply: GenerateReply;
  try {
    reply = { ok: true, result: recordGame(header, { turnCap }) };
  } catch (err) {
    reply = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  postMessage(reply);
};
