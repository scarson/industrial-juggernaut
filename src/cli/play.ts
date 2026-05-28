// ABOUTME: Industrial Juggernaut CLI play harness — interactive REPL for humans + scriptable subcommands for agents.
// ABOUTME: Subcommands: new, show, legal, act, hint, play. State persists in a JSON file; opponents auto-resolve.

import { readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { generateBoard } from "../board/generate";
import { buildBudget } from "../engine/build";
import { defaultConfig, type RuleConfig } from "../engine/config";
import { control } from "../engine/control";
import { legalActions } from "../engine/legal";
import { stepRound } from "../engine/round";
import { status } from "../engine/status";
import { advanceRound, currentPlayer, setupGame } from "../engine/turn";
import { seed } from "../rng/pcg";
import { key } from "../geometry/cube";
import { heuristicAgent } from "../agent/heuristic-agent";
import { mctsAgent, defaultMctsParams } from "../agent/mcts-agent";
import { samplePolicy } from "../agent/heuristic";
import type { Agent } from "../agent/agent";
import type { Action, GameState, Hex, PlayerId } from "../engine/types";
import { deserializeState, serializeState } from "./serialize";

// ---------------------------------------------------------------------------
// State file I/O
// ---------------------------------------------------------------------------

function loadState(path: string): GameState {
  if (!existsSync(path)) {
    throw new Error(`State file not found: ${path}`);
  }
  return deserializeState(readFileSync(path, "utf8"));
}

function saveState(path: string, state: GameState): void {
  writeFileSync(path, serializeState(state) + "\n", "utf8");
}

// ---------------------------------------------------------------------------
// Variants — preset configs the CLI understands by name.
// ---------------------------------------------------------------------------

interface VariantPreset {
  description: string;
  config: RuleConfig;
}

function variantPresets(): Record<string, VariantPreset> {
  const dflt = defaultConfig();
  return {
    default: { description: "Engine default config.", config: dflt },
    c: {
      description: "Variant (c): noIronRequiresPerimeter=true, ironCount=14, victoryThreshold=10, radius=2, boardSize=96. The variant chosen as the load-bearing fix in the 2026-05-28 balance sweep.",
      config: {
        ...dflt,
        boardSize: 96,
        radius: 2,
        ironCount: 14,
        victoryThreshold: 10,
        noIronRequiresPerimeter: true,
      },
    },
    "c-alliances": {
      description: "Variant (c) with alliances enabled (delta=4) — for testing multiplayer alliance dynamics.",
      config: {
        ...dflt,
        boardSize: 96,
        radius: 2,
        ironCount: 14,
        victoryThreshold: 10,
        noIronRequiresPerimeter: true,
        alliancesEnabled: true,
        allianceVictoryDelta: 4,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Opponent agents — by name.
// ---------------------------------------------------------------------------

function buildOpponentAgent(name: string, mctsIter?: number): Agent {
  switch (name) {
    case "heuristic":
      return heuristicAgent();
    case "mcts":
      return mctsAgent({ ...defaultMctsParams(), iterations: mctsIter ?? 50 });
    default:
      throw new Error(`Unknown opponent agent: ${name} (expected: heuristic, mcts)`);
  }
}

// ---------------------------------------------------------------------------
// Action formatting — human-readable + canonical.
// ---------------------------------------------------------------------------

function hexStr(h: Hex): string {
  return `(${h.x},${h.y},${h.z})`;
}

function formatAction(a: Action): string {
  switch (a.kind) {
    case "pass":
      return "pass";
    case "build": {
      const pieces = a.pieces.map((p) => `${p.type} ${hexStr(p.hex)}`).join(", ");
      return `build ${pieces}`;
    }
    case "attack": {
      const decl = a.attacks[0]!;
      const attackers = decl.attackers.map(hexStr).join(",");
      return `attack target=${hexStr(decl.target)} attackers=[${attackers}] (commit=${decl.attackers.length})`;
    }
    case "ally":
      return `ally target=P${a.target}`;
    case "break-alliance":
      return `break-alliance target=P${a.target}`;
  }
}

// ---------------------------------------------------------------------------
// State pretty-print.
// ---------------------------------------------------------------------------

function pretty(state: GameState): string {
  const lines: string[] = [];
  const phase = state.phase;
  const acting = currentPlayer(state);

  lines.push(`=== Industrial Juggernaut — turn ${phase.turn}, round-index ${phase.indexInOrder} of ${phase.order.length} (acting: P${acting}) ===`);
  lines.push(`Config: boardSize=${state.config.boardSize}, radius=${state.config.radius}, ironCount=${state.config.ironCount}, victoryThreshold=${state.config.victoryThreshold}, noIronRequiresPerimeter=${state.config.noIronRequiresPerimeter}, alliancesEnabled=${state.config.alliancesEnabled}${state.config.alliancesEnabled ? `, allianceVictoryDelta=${state.config.allianceVictoryDelta}` : ""}`);
  lines.push(``);

  // Per-player stats.
  lines.push(`Players:`);
  for (const p of state.players) {
    const ctl = control(state, p.id);
    const myBases = state.bases.filter((b) => b.owner === p.id);
    const freshCount = myBases.filter((b) => b.state === "fresh").length;
    const matureCount = myBases.length - freshCount;
    const allies = p.alliance.filter((id) => id !== p.id);
    const aliveTag = p.eliminated ? "ELIMINATED" : "alive";
    lines.push(
      `  P${p.id}: ${aliveTag}, iron=${ctl.iron.length}, factories=${ctl.factories.length}, bases=${myBases.length} (${freshCount} fresh, ${matureCount} mature), basesInHand=${p.basesInHand}, alliance=[${allies.length === 0 ? "—" : allies.map((a) => `P${a}`).join(",")}], cooldown=${p.allianceCooldownTurns}`,
    );
  }
  lines.push(``);

  // Bases per player (one line each).
  lines.push(`Bases on board:`);
  for (const p of state.players) {
    const myBases = state.bases.filter((b) => b.owner === p.id);
    if (myBases.length === 0) continue;
    const list = myBases
      .map((b) => `${hexStr(b.hex)}${b.state === "fresh" ? "·F" : ""}`)
      .join(", ");
    lines.push(`  P${p.id}: ${list}`);
  }
  lines.push(``);

  // Factories.
  if (state.factories.length > 0) {
    lines.push(`Factories: ${state.factories.map((f) => hexStr(f.hex)).join(", ")}`);
    lines.push(``);
  }

  // Iron hexes — show all, with ownership tag.
  lines.push(`Iron hexes (${state.board.iron.length} total):`);
  const ironOwnership: { hex: Hex; owner: PlayerId | null }[] = state.board.iron.map((h) => {
    let owner: PlayerId | null = null;
    for (const p of state.players) {
      if (p.eliminated) continue;
      const ctl = control(state, p.id);
      if (ctl.iron.some((ih) => key(ih) === key(h))) {
        owner = p.id;
        break;
      }
    }
    return { hex: h, owner };
  });
  for (const ih of ironOwnership) {
    lines.push(`  ${hexStr(ih.hex)} ${ih.owner === null ? "neutral" : `→ P${ih.owner}`}`);
  }
  lines.push(``);

  // Status.
  const st = status(state);
  if (st.kind === "victory") {
    lines.push(`>>> Game over: ${st.reason} victory by [${st.players.map((p) => `P${p}`).join(", ")}] <<<`);
  } else {
    lines.push(`Status: ongoing.`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// JSON-mode state summary — agent-friendly compact view.
// ---------------------------------------------------------------------------

interface JsonStateView {
  turn: number;
  acting: PlayerId;
  gameOver: boolean;
  victory: { reason: "iron" | "last-standing"; winners: PlayerId[] } | null;
  config: {
    boardSize: number;
    radius: number;
    ironCount: number;
    victoryThreshold: number;
    noIronRequiresPerimeter: boolean;
    alliancesEnabled: boolean;
    allianceVictoryDelta: number;
  };
  players: {
    id: PlayerId;
    eliminated: boolean;
    iron: number;
    factories: number;
    bases: number;
    basesInHand: number;
    alliance: PlayerId[];
    allianceCooldownTurns: number;
  }[];
  bases: { owner: PlayerId; hex: Hex; state: "fresh" | "fatigued" }[];
  factories: { hex: Hex }[];
  iron: { hex: Hex; owner: PlayerId | null }[];
}

function toJsonView(state: GameState): JsonStateView {
  const st = status(state);
  const ironOwnership = state.board.iron.map((h) => {
    let owner: PlayerId | null = null;
    for (const p of state.players) {
      if (p.eliminated) continue;
      const ctl = control(state, p.id);
      if (ctl.iron.some((ih) => key(ih) === key(h))) {
        owner = p.id;
        break;
      }
    }
    return { hex: h, owner };
  });
  return {
    turn: state.phase.turn,
    acting: currentPlayer(state),
    gameOver: st.kind === "victory",
    victory: st.kind === "victory" ? { reason: st.reason, winners: [...st.players] } : null,
    config: {
      boardSize: state.config.boardSize,
      radius: state.config.radius,
      ironCount: state.config.ironCount,
      victoryThreshold: state.config.victoryThreshold,
      noIronRequiresPerimeter: state.config.noIronRequiresPerimeter,
      alliancesEnabled: state.config.alliancesEnabled,
      allianceVictoryDelta: state.config.allianceVictoryDelta,
    },
    players: state.players.map((p) => {
      const ctl = control(state, p.id);
      const myBases = state.bases.filter((b) => b.owner === p.id);
      return {
        id: p.id,
        eliminated: p.eliminated,
        iron: ctl.iron.length,
        factories: ctl.factories.length,
        bases: myBases.length,
        basesInHand: p.basesInHand,
        alliance: p.alliance.filter((id) => id !== p.id),
        allianceCooldownTurns: p.allianceCooldownTurns,
      };
    }),
    bases: state.bases.map((b) => ({ owner: b.owner, hex: b.hex, state: b.state })),
    factories: state.factories.map((f) => ({ hex: f.hex })),
    iron: ironOwnership,
  };
}

// ---------------------------------------------------------------------------
// Auto-play opponents until it's the human/agent's turn or the game ends.
// ---------------------------------------------------------------------------

interface SessionMeta {
  you: PlayerId;
  opponent: string;
  mctsIter?: number;
}

/**
 * Append a structured JSONL log entry. Each line is a single JSON object with at
 * minimum `{ts, event}` and event-specific fields. Cheap (no file lock, append-only),
 * safe for sequential agent use; not safe for concurrent writers (the CLI is one-shot
 * per invocation, so this is fine).
 */
/**
 * Parse the compact `--build` shortcut string into a multi-piece build Action.
 * Format: `type@x,y,z;type@x,y,z;...` where type ∈ {factory, base}. Whitespace
 * and surrounding spaces are tolerated. Every piece must have the same type
 * (engine constraint — a build round is one type only). Throws on syntax error
 * or mixed-type pieces; does NOT validate placement legality (the engine's
 * applyAction handles that and returns a clear error if a piece is illegal).
 */
function parseBuildShortcut(s: string): Action {
  const parts = s.split(";").map((p) => p.trim()).filter((p) => p.length > 0);
  if (parts.length === 0) {
    throw new Error(`--build: empty piece list (format: "type@x,y,z;type@x,y,z;...")`);
  }
  const pieces: Array<{ type: "factory" | "base"; hex: Hex }> = [];
  let firstType: "factory" | "base" | null = null;
  for (const part of parts) {
    const atIdx = part.indexOf("@");
    if (atIdx < 0) {
      throw new Error(`--build piece "${part}": missing '@' separator (format: "type@x,y,z")`);
    }
    const type = part.slice(0, atIdx).trim();
    if (type !== "factory" && type !== "base") {
      throw new Error(`--build piece "${part}": type must be "factory" or "base" (got "${type}")`);
    }
    if (firstType === null) firstType = type;
    if (type !== firstType) {
      throw new Error(`--build: all pieces must be the same type (mixed "${firstType}" and "${type}")`);
    }
    const coordsStr = part.slice(atIdx + 1).trim();
    const coords = coordsStr.split(",").map((c) => c.trim());
    if (coords.length !== 3) {
      throw new Error(`--build piece "${part}": hex must be "x,y,z" (got ${coords.length} components)`);
    }
    const [x, y, z] = coords.map(Number);
    if (![x, y, z].every((n) => Number.isInteger(n))) {
      throw new Error(`--build piece "${part}": hex coords must be integers`);
    }
    if (x! + y! + z! !== 0) {
      throw new Error(`--build piece "${part}": cube-coord invariant x+y+z=0 violated (got ${x! + y! + z!})`);
    }
    pieces.push({ type, hex: { x: x!, y: y!, z: z! } });
  }
  return { kind: "build", pieces };
}

function appendLog(logPath: string | undefined, entry: Record<string, unknown>): void {
  if (logPath === undefined || logPath === "") return;
  const enriched = { ts: new Date().toISOString(), ...entry };
  appendFileSync(logPath, JSON.stringify(enriched) + "\n", "utf8");
}

function readMeta(path: string): SessionMeta {
  const metaPath = path + ".meta.json";
  if (!existsSync(metaPath)) {
    throw new Error(`Session metadata file not found: ${metaPath}. Did you create the game with \`iju new\`?`);
  }
  return JSON.parse(readFileSync(metaPath, "utf8")) as SessionMeta;
}

function saveMeta(path: string, meta: SessionMeta): void {
  writeFileSync(path + ".meta.json", JSON.stringify(meta, null, 2) + "\n", "utf8");
}

/**
 * Run opponent turns one round at a time (one action per `acting` player) until the
 * acting player is `you` again, or the game ends, or the turn cap is reached.
 * Returns the advanced state plus a list of opponent actions taken (for transcript).
 */
function autoPlayOpponents(
  state: GameState,
  you: PlayerId,
  opponentAgent: Agent,
  turnCap: number,
): { state: GameState; opponentLog: { player: PlayerId; action: Action }[]; ended: boolean } {
  let cur = state;
  const log: { player: PlayerId; action: Action }[] = [];

  for (;;) {
    const stCheck = status(cur);
    if (stCheck.kind === "victory") return { state: cur, opponentLog: log, ended: true };
    if (cur.phase.turn > turnCap) return { state: cur, opponentLog: log, ended: true };

    const acting = currentPlayer(cur);
    if (acting === you && !cur.players[you]!.eliminated) {
      return { state: cur, opponentLog: log, ended: false };
    }
    if (cur.players[acting]!.eliminated) {
      // Skip eliminated player (advance round without acting).
      const before = cur.phase.turn;
      cur = advanceRound(cur);
      void before;
      continue;
    }

    const choice = opponentAgent(cur, acting);
    cur = choice.state;
    let stepped: GameState;
    try {
      stepped = stepRound(cur, choice.action).state;
    } catch (e) {
      throw new Error(
        `Illegal action from opponent agent (turn=${cur.phase.turn}, player=${acting}, action=${JSON.stringify(choice.action)}): ${String(e)}`,
      );
    }
    log.push({ player: acting, action: choice.action });
    cur = stepped;

    const st = status(cur);
    if (st.kind === "victory") return { state: cur, opponentLog: log, ended: true };
    cur = advanceRound(cur);
  }
}

// ---------------------------------------------------------------------------
// Subcommand: new
// ---------------------------------------------------------------------------

function cmdNew(argv: Argv): void {
  const seedN = BigInt(argv.req("--seed"));
  const nPlayers = Number(argv.req("--players"));
  const variantName = argv.opt("--variant", "c");
  const you = Number(argv.opt("--you", "0")) as PlayerId;
  const opponent = argv.opt("--opponent", "heuristic");
  const mctsIterStr = argv.opt("--mcts-iter", "");
  const mctsIter = mctsIterStr === "" ? undefined : Number(mctsIterStr);
  const out = argv.req("--out");
  const logPath = argv.opt("--log", "");

  const presets = variantPresets();
  const preset = presets[variantName];
  if (preset === undefined) {
    throw new Error(`Unknown variant: ${variantName}. Known: ${Object.keys(presets).join(", ")}`);
  }
  if (nPlayers < 2 || nPlayers > 6) {
    throw new Error(`--players must be 2..6, got ${nPlayers}`);
  }
  if (you < 0 || you >= nPlayers) {
    throw new Error(`--you must be 0..${nPlayers - 1}, got ${you}`);
  }

  const config = preset.config;
  let rng = seed(seedN);
  const g = generateBoard(rng, { size: config.boardSize, ironCount: config.ironCount });
  rng = g.rng;
  let state = setupGame(rng, g.board, nPlayers, config);

  const opponentAgent = buildOpponentAgent(opponent, mctsIter);
  // Auto-play any opponents that act BEFORE you.
  const auto = autoPlayOpponents(state, you, opponentAgent, /*turnCap=*/ 60);
  state = auto.state;

  const meta: SessionMeta = { you, opponent, ...(mctsIter !== undefined && { mctsIter }) };
  saveState(out, state);
  saveMeta(out, meta);

  appendLog(logPath === "" ? undefined : logPath, {
    event: "new",
    seed: seedN.toString(),
    nPlayers,
    variant: variantName,
    you,
    opponent,
    ...(mctsIter !== undefined && { mctsIter }),
    statePath: out,
    preTurnOpponentActions: auto.opponentLog.map((e) => ({ player: e.player, action: e.action, display: formatAction(e.action) })),
  });

  console.log(`Created new game (seed=${seedN}, players=${nPlayers}, variant=${variantName}, you=P${you}, opponent=${opponent}${mctsIter !== undefined ? `@${mctsIter}` : ""}).`);
  if (auto.opponentLog.length > 0) {
    console.log(`Opponents auto-played ${auto.opponentLog.length} pre-turn-1 actions:`);
    for (const e of auto.opponentLog) console.log(`  P${e.player}: ${formatAction(e.action)}`);
  }
  console.log(`State written to ${out}. Run \`iju show ${out}\` to see it.`);
}

// ---------------------------------------------------------------------------
// Subcommand: show
// ---------------------------------------------------------------------------

function cmdShow(argv: Argv): void {
  const path = argv.positional(0, "<state-file>");
  const state = loadState(path);
  if (argv.flag("--json")) {
    console.log(JSON.stringify(toJsonView(state), null, 2));
  } else {
    console.log(pretty(state));
  }
}

// ---------------------------------------------------------------------------
// Subcommand: legal
// ---------------------------------------------------------------------------

function cmdLegal(argv: Argv): void {
  const path = argv.positional(0, "<state-file>");
  const state = loadState(path);
  const acts = legalActions(state);
  const acting = currentPlayer(state);
  const budget = buildBudget(state, acting);
  const ctl = control(state, acting);
  if (argv.flag("--json")) {
    console.log(
      JSON.stringify(
        {
          turn: state.phase.turn,
          player: acting,
          buildBudget: budget,
          controlledIron: ctl.iron.length,
          controlledFactories: ctl.factories.length,
          singlePieceActions: acts.map((a, i) => ({ index: i, action: a, display: formatAction(a) })),
          multiPieceBuildNote:
            "legalActions ONLY emits single-piece builds (one base or one factory per legal placement). To compose a multi-piece build (up to `buildBudget` pieces), pass --action with {kind:'build',pieces:[{type,hex},...]} or use `act --build 'base@x,y,z;base@x,y,z;...'`. All pieces must be the same type. Each piece's legality is re-checked sequentially after the previous piece is hypothetically applied — same semantics the heuristic agent uses internally.",
        },
        null,
        2,
      ),
    );
  } else {
    console.log(`Legal actions for P${acting} (turn ${state.phase.turn}). buildBudget=${budget}, controlled iron=${ctl.iron.length}, factories=${ctl.factories.length}.`);
    acts.forEach((a, i) => {
      console.log(`  [${i}] ${formatAction(a)}`);
    });
    if (budget >= 2) {
      console.log(``);
      console.log(`NOTE: this list shows SINGLE-PIECE build options only. With buildBudget=${budget} you can compose up to ${budget} pieces in one round.`);
      console.log(`  Compose via:  iju act ${path} --build "base@x,y,z;base@x,y,z;..."  (or factory@...; same type for all pieces)`);
      console.log(`  Or pass the full JSON:  iju act ${path} --action '{"kind":"build","pieces":[{"type":"base","hex":{"x":..,"y":..,"z":..}},...]}'`);
      console.log(`  The heuristic typically composes multi-piece builds — see what it would compose with: iju hint ${path}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Subcommand: act
// ---------------------------------------------------------------------------

function cmdAct(argv: Argv): void {
  const path = argv.positional(0, "<state-file>");
  const out = argv.opt("--out", path);
  const indexStr = argv.opt("--index", "");
  const actionStr = argv.opt("--action", "");
  const buildStr = argv.opt("--build", "");
  const logPathRaw = argv.opt("--log", "");
  const logPath = logPathRaw === "" ? undefined : logPathRaw;
  const provided = [indexStr, actionStr, buildStr].filter((s) => s !== "").length;
  if (provided === 0) {
    throw new Error(`act requires one of: --index N, --action <json>, or --build "type@x,y,z;type@x,y,z;..."`);
  }
  if (provided > 1) {
    throw new Error(`act takes exactly one of --index / --action / --build (got ${provided})`);
  }

  let state = loadState(path);
  const meta = readMeta(path);
  const acts = legalActions(state);
  const turnBefore = state.phase.turn;
  const playerBefore = currentPlayer(state);

  let chosen: Action;
  if (indexStr !== "") {
    const idx = Number(indexStr);
    if (!Number.isInteger(idx) || idx < 0 || idx >= acts.length) {
      throw new Error(`--index ${indexStr} is out of range; legal action count is ${acts.length}`);
    }
    chosen = acts[idx]!;
  } else if (buildStr !== "") {
    chosen = parseBuildShortcut(buildStr);
  } else {
    chosen = JSON.parse(actionStr) as Action;
  }

  // Verify chosen is in the legal set (by structural equality on actionKey-style).
  // Apply chosen.
  let stepped: GameState;
  try {
    stepped = stepRound(state, chosen).state;
  } catch (e) {
    throw new Error(`Illegal action: ${formatAction(chosen)} — ${String(e)}`);
  }
  state = stepped;
  console.log(`You (P${meta.you}) played: ${formatAction(chosen)}`);

  // Check status BEFORE advancing round (status fires after applyAction).
  const stMid = status(state);
  if (stMid.kind === "victory") {
    saveState(out, state);
    appendLog(logPath, {
      event: "act",
      turnBefore,
      playerBefore,
      yourAction: chosen,
      yourActionDisplay: formatAction(chosen),
      opponentActions: [],
      victory: { reason: stMid.reason, winners: [...stMid.players] },
      youWon: stMid.players.includes(meta.you),
      turnAfter: state.phase.turn,
    });
    console.log(`>>> Game over: ${stMid.reason} victory by [${stMid.players.map((p) => `P${p}`).join(", ")}] <<<`);
    return;
  }

  state = advanceRound(state);

  // Auto-play opponents until it's your turn again or game ends.
  const opponentAgent = buildOpponentAgent(meta.opponent, meta.mctsIter);
  const auto = autoPlayOpponents(state, meta.you, opponentAgent, /*turnCap=*/ 60);
  state = auto.state;
  saveState(out, state);

  if (auto.opponentLog.length > 0) {
    console.log(`Opponents played ${auto.opponentLog.length} action(s):`);
    for (const e of auto.opponentLog) console.log(`  P${e.player}: ${formatAction(e.action)}`);
  }
  const stEnd = status(state);
  const ended = stEnd.kind === "victory" || state.phase.turn > 60;
  appendLog(logPath, {
    event: "act",
    turnBefore,
    playerBefore,
    yourAction: chosen,
    yourActionDisplay: formatAction(chosen),
    opponentActions: auto.opponentLog.map((e) => ({ player: e.player, action: e.action, display: formatAction(e.action) })),
    victory: stEnd.kind === "victory" ? { reason: stEnd.reason, winners: [...stEnd.players] } : null,
    youWon: stEnd.kind === "victory" ? stEnd.players.includes(meta.you) : false,
    turnAfter: state.phase.turn,
    hitTurnCap: state.phase.turn > 60,
    ended,
  });
  if (stEnd.kind === "victory") {
    console.log(`>>> Game over: ${stEnd.reason} victory by [${stEnd.players.map((p) => `P${p}`).join(", ")}] <<<`);
  } else if (state.phase.turn > 60) {
    console.log(`>>> Turn cap (60) reached without a victory. <<<`);
  } else {
    console.log(`Now your turn (P${meta.you}, turn ${state.phase.turn}). Run \`iju show ${out}\` then \`iju legal ${out}\`.`);
  }
}

// ---------------------------------------------------------------------------
// Subcommand: hint
// ---------------------------------------------------------------------------

function cmdHint(argv: Argv): void {
  const path = argv.positional(0, "<state-file>");
  const state = loadState(path);
  // Use samplePolicy at temp→0 to see the heuristic's argmax choice for the current player.
  const { action } = samplePolicy(state, currentPlayer(state), state.rngState, 1e-6);
  if (argv.flag("--json")) {
    console.log(JSON.stringify({ action, display: formatAction(action) }, null, 2));
  } else {
    console.log(`Heuristic's choice for P${currentPlayer(state)}: ${formatAction(action)}`);
  }
}

// ---------------------------------------------------------------------------
// Argv helper — minimal arg parser to keep the CLI dependency-free.
// ---------------------------------------------------------------------------

class Argv {
  private readonly args: string[];
  private readonly flags: Set<string>;
  constructor(args: string[]) {
    this.args = args;
    this.flags = new Set();
    for (const a of args) if (a.startsWith("--") && !a.includes("=") && !this.peekValue(a)) this.flags.add(a);
  }
  private peekValue(name: string): boolean {
    const i = this.args.indexOf(name);
    return i >= 0 && i + 1 < this.args.length && !this.args[i + 1]!.startsWith("--");
  }
  positional(idx: number, label: string): string {
    const positionals = this.args.filter((a) => !a.startsWith("--"));
    if (positionals[idx] === undefined) {
      throw new Error(`Missing positional argument ${idx}: ${label}`);
    }
    return positionals[idx]!;
  }
  req(name: string): string {
    const v = this.opt(name, undefined);
    if (v === undefined) throw new Error(`Missing required flag ${name}`);
    return v;
  }
  opt<T extends string | undefined>(name: string, def: T): string | T {
    const i = this.args.indexOf(name);
    if (i < 0) return def;
    if (i + 1 >= this.args.length || this.args[i + 1]!.startsWith("--")) {
      throw new Error(`Flag ${name} requires a value`);
    }
    return this.args[i + 1]!;
  }
  flag(name: string): boolean {
    return this.flags.has(name) || this.args.indexOf(name) >= 0;
  }
}

// ---------------------------------------------------------------------------
// Main dispatch.
// ---------------------------------------------------------------------------

const USAGE = `iju — Industrial Juggernaut play harness

Subcommands:
  new --seed N --players K [--variant V] [--you P] [--opponent O] [--mcts-iter N] [--log LOG] --out FILE
      Create a new game. --variant: default | c | c-alliances (default: c).
      --opponent: heuristic | mcts (default: heuristic). Writes FILE + FILE.meta.json.
      --log LOG appends a JSONL {ts, event:"new", ...} line to LOG.

  show FILE [--json]
      Pretty-print state, or output structured JSON.

  legal FILE [--json]
      List legal actions for the current player.

  act FILE (--index N | --action <json> | --build "type@x,y,z;...") [--out FILE2] [--log LOG]
      Apply an action by legal-list index, by raw JSON, or by the --build shortcut.
      --build "base@0,0,0;base@1,-1,0;base@2,-2,0" composes a multi-piece build
        action (all pieces same type, up to buildBudget pieces).
      The CLI auto-plays opponents after your move, until your next turn or game end.
      --log LOG appends a JSONL {ts, event:"act", ...} line per call.

  Multi-piece builds: legalActions only emits SINGLE-piece options, so
  "iju legal" lists each placement individually. When your buildBudget >= 2,
  YOU compose the multi-piece action via --build or --action JSON. The
  heuristic agent composes greedy multi-piece builds internally — use
  "iju hint FILE" to see what composition it would pick.

  hint FILE [--json]
      Show what the perimeter-aware heuristic would do for the current player.

Examples (agent workflow):
  iju new --seed 42 --players 2 --variant c --you 0 --opponent heuristic --out /tmp/game.json
  iju show /tmp/game.json --json
  iju legal /tmp/game.json --json
  iju act /tmp/game.json --index 3
  # repeat until game.gameOver === true
`;

function main(): void {
  const args = process.argv.slice(2);
  const sub = args[0];
  if (sub === undefined || sub === "--help" || sub === "-h") {
    console.log(USAGE);
    process.exit(sub === undefined ? 1 : 0);
  }
  const argv = new Argv(args.slice(1));
  try {
    switch (sub) {
      case "new": cmdNew(argv); break;
      case "show": cmdShow(argv); break;
      case "legal": cmdLegal(argv); break;
      case "act": cmdAct(argv); break;
      case "hint": cmdHint(argv); break;
      default:
        console.error(`Unknown subcommand: ${sub}\n`);
        console.error(USAGE);
        process.exit(1);
    }
  } catch (e) {
    console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}

void resolve; // keep import (path resolution helper used elsewhere if extended)
main();
