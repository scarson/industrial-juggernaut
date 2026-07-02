// ABOUTME: Thin helpers over a GameRoom's ctx.storage — the header bundle, atomic persistEvent, snapshot/tail load.
// ABOUTME: Stores RAW structured-clone objects (bigints persist natively; NO codec on the storage path — DO-CODEC-1).

import {
  HEADER_KEY,
  SNAPSHOT_KEY,
  PENDING_KEY,
  ROOM_OPTIONS_KEY,
  INITIALIZED_KEY,
  FROZEN_KEY,
  logKey,
  PENDING_TOMBSTONE,
} from "../session";
import type { PersistOp, Pending, Snapshot, SessionHeader } from "../session";
import type { LogEntry } from "../session";
import type { RoomOptions } from "../wire/protocol";

/** The room-init bundle: everything a wake needs before replaying the log. Written in ONE atomic put. */
export type HeaderBundle = {
  header: SessionHeader;
  roomOptions: RoomOptions;
  authorizedDigests: (string | null)[];
};

/** HEADER_KEY carries the header + per-seat authorized digests together (roomOptions rides its own key). */
type StoredHeader = { header: SessionHeader; authorizedDigests: (string | null)[] };

/**
 * The room-init write: header + per-seat authorizedDigest + roomOptions + the initialized flag, in ONE atomic
 * multi-key put (all-or-nothing). The bigint header seed stores natively via structured clone — no codec here.
 */
export async function writeHeader(
  storage: DurableObjectStorage,
  bundle: HeaderBundle & { initialized: true },
): Promise<void> {
  const storedHeader: StoredHeader = { header: bundle.header, authorizedDigests: bundle.authorizedDigests };
  await storage.put({
    [HEADER_KEY]: storedHeader,
    [ROOM_OPTIONS_KEY]: bundle.roomOptions,
    [INITIALIZED_KEY]: true,
  });
}

/** True once {@link writeHeader} has run; false on a never-initialized room. */
export async function readInitialized(storage: DurableObjectStorage): Promise<boolean> {
  return (await storage.get<boolean>(INITIALIZED_KEY)) === true;
}

/** The header bundle, or null if the room was never initialized. */
export async function readHeaderBundle(storage: DurableObjectStorage): Promise<HeaderBundle | null> {
  const stored = await storage.get<StoredHeader>(HEADER_KEY);
  if (stored === undefined) return null;
  const roomOptions = await storage.get<RoomOptions>(ROOM_OPTIONS_KEY);
  if (roomOptions === undefined) return null;
  return { header: stored.header, roomOptions, authorizedDigests: stored.authorizedDigests };
}

/** The live pending decision, or null when absent or cleared (a PENDING_TOMBSTONE reads back as null). */
export async function readPending(storage: DurableObjectStorage): Promise<Pending | null> {
  const value = await storage.get<Pending | typeof PENDING_TOMBSTONE>(PENDING_KEY);
  if (value === undefined) return null;
  if ((value as { cleared?: boolean }).cleared === true) return null;
  return value as Pending;
}

/** True once the room has been frozen (recovery divergence / defense-in-depth). */
export async function readFrozen(storage: DurableObjectStorage): Promise<boolean> {
  return (await storage.get<boolean>(FROZEN_KEY)) === true;
}

/** Freeze the room: every subsequent mutating command errors FROZEN. Idempotent. */
export async function writeFrozen(storage: DurableObjectStorage): Promise<void> {
  await storage.put(FROZEN_KEY, true);
}

/**
 * Persist one event as ONE atomic multi-key put (≤128 keys guaranteed all-or-nothing by Cloudflare; our events
 * write ≤4). The pending CLEAR rides as [PENDING_KEY]: PENDING_TOMBSTONE inside op.put — never a separate delete —
 * so the resolving log entry and the pending clear are atomic-by-construction (both land or neither does).
 */
export async function persistEvent(storage: DurableObjectStorage, op: PersistOp): Promise<void> {
  await storage.put(op.put);
}

/**
 * Read the head of the log — entries `[0 .. throughIndex]` inclusive, index-ordered. Used by the
 * replayVersion-mismatch freeze check to re-replay the snapshot-boundary log under the current engine.
 * Zero-padded keys make lexical list order == numeric order; `end` is exclusive so it stops after `throughIndex`.
 */
export async function readLogHead(storage: DurableObjectStorage, throughIndex: number): Promise<LogEntry[]> {
  const rows = await storage.list<LogEntry>({ prefix: "log:", start: logKey(0), end: logKey(throughIndex + 1) });
  return [...rows.values()];
}

/** A tail log entry paired with its true log index (parsed from the storage key). */
export type TailEntry = { index: number; entry: LogEntry };

/**
 * Load the snapshot (if any) and the post-snapshot log tail. With a snapshot, the tail is every entry after
 * snapshot.logIndex; with no snapshot, the tail is the FULL log from index 0. Zero-padded keys make lexical
 * list order == numeric order, and each entry's index is parsed back from its key. Entries are RAW (bigints intact).
 */
export async function loadSnapshotAndTail(
  storage: DurableObjectStorage,
): Promise<{ snapshot: Snapshot | null; tail: TailEntry[] }> {
  const snapshot = (await storage.get<Snapshot>(SNAPSHOT_KEY)) ?? null;
  const start = snapshot === null ? logKey(0) : logKey(snapshot.logIndex + 1);
  const rows = await storage.list<LogEntry>({ prefix: "log:", start });
  const tail: TailEntry[] = [];
  for (const [key, entry] of rows) {
    tail.push({ index: Number(key.slice("log:".length)), entry });
  }
  return { snapshot, tail };
}
