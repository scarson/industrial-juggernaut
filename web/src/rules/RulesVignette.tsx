// ABOUTME: RulesVignette — the lazy-loaded board illustration for one rules-page scene: a real
// ABOUTME: Board render of a curated engine state, framed as a small parchment plate.
import { Board } from "../board/Board";
import { ruleScene, type RuleSceneKey } from "./scenes";

export interface RulesVignetteProps {
  readonly scene: RuleSceneKey;
}

/**
 * A non-interactive Board render of `ruleScene(scene)` — the same authentic-renderer technique as
 * the landing hero (illustration by the real engine, never clip-art). No click/hover wiring: a
 * rules illustration is a picture of a rule, not a play surface.
 */
export default function RulesVignette({ scene }: RulesVignetteProps) {
  const { state, highlights, emphasis } = ruleScene(scene);
  return (
    <div style={PLATE_STYLE}>
      <Board
        state={state}
        {...(highlights !== undefined ? { highlights } : {})}
        {...(emphasis !== undefined ? { selection: { pieces: emphasis } } : {})}
      />
    </div>
  );
}

const PLATE_STYLE: React.CSSProperties = {
  width: "100%",
  aspectRatio: "3 / 2",
};
