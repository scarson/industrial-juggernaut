// ABOUTME: Smoke test for the public API barrel — every advertised value export is present and callable.
// ABOUTME: Guards the Worker/client import surface against accidental removal or rename.
import { test, expect } from "vitest";
import * as IJ from "../src/index";

test("barrel exports the public engine API", () => {
  for (const name of [
    "initGame","setupGame","applyAction","stepRound","applyEliminations","removeEncircledStrandedBases",
    "advanceRound","currentPlayer","legalActions","status","buildBudget","control",
    "generateBoard","loadBoard","representativeDefender","representativeFirstBase",
    "placeFirstBase","legalFirstBaseHexes","seed","nextUint32","nextFloat","encodeRng","decodeRng","defaultConfig",
  ]) {
    expect(typeof (IJ as any)[name]).toBe("function");
  }
});
