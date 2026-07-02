// ABOUTME: Smoke test for the session barrel — value exports present and callable.
// ABOUTME: Verifies the session barrel (src/session/index.ts) exposes all expected functions.
import { test, expect } from "vitest";
import * as S from "../../src/session/index";
test("session barrel exposes record/replay/codec/hash/validation", () => {
  for (const name of ["recordGame","replayLog","applyEntry","stateHash","encodeRecord","decodeRecord","encodeEntry","decodeEntry","validatePass","validateTargetAttackable","validateAttackDecl","validateBuildPieces","claimSeat","seatRoster"]) {
    expect(typeof (S as any)[name]).toBe("function");
  }
});
