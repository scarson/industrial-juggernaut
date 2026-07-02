// ABOUTME: Durable storage key layout for a GameRoom — header / log:NNNNNN / snapshot / pending.
// ABOUTME: Shared by the reducer (PersistOp keys) and the DO host (storage reads), so they cannot drift.
export const HEADER_KEY = "header";
export const SNAPSHOT_KEY = "snapshot";
export const PENDING_KEY = "pending";
export const ROOM_OPTIONS_KEY = "roomOptions";
export const INITIALIZED_KEY = "initialized";
/** Zero-padded so lexical key order == numeric log order under storage.list({prefix:"log:"}). */
export function logKey(index: number): string { return `log:${String(index).padStart(6, "0")}`; }
