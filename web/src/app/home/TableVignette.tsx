// ABOUTME: The landing hero's map — the real Board renderer over the curated landing scene.
// ABOUTME: Loaded via React.lazy so its engine value-imports stay out of the eager entry chunk.
import { useMemo } from "react";
import { Board } from "../../board/Board";
import { landingScene } from "./scene";

/** The aged map, rendered by the same Board that renders live play — authentic, not clip-art. */
export function TableVignette() {
  const state = useMemo(() => landingScene(), []);
  return <Board state={state} />;
}

export default TableVignette;
