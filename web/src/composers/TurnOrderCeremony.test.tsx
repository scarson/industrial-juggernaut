// ABOUTME: Structure tests for TurnOrderCeremony — renders the drawn order shape-tagged per
// ABOUTME: player, the 2P iron weighting, and the reduced-motion vs animated branch via the DOM.
import { afterEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TurnOrderCeremony } from "./TurnOrderCeremony";
import type { TurnRollover } from "../game/store";

/** Installs a matchMedia stub reporting the given reduced-motion preference — the house pattern
 *  from design/motion.test.ts's stubReducedMotion / app/App.test.tsx's stubMatchMediaForWidth. */
function stubReducedMotion(prefersReduced: boolean): void {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("prefers-reduced-motion: reduce") ? prefersReduced : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const ORDER_2P: TurnRollover = { order: [1, 0], ironWeights: [3, 5] };
const ORDER_3P: TurnRollover = { order: [2, 0, 1], ironWeights: null };

describe("TurnOrderCeremony — rollover null", () => {
  test("renders nothing when no rollover has occurred", () => {
    stubReducedMotion(false);
    const { container } = render(<TurnOrderCeremony rollover={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("TurnOrderCeremony — drawn order display", () => {
  test("renders the rollover's order, one shape-tagged entry per player", () => {
    stubReducedMotion(false);
    render(<TurnOrderCeremony rollover={ORDER_2P} />);

    const list = screen.getByRole("list", { name: /turn order/i });
    expect(list).toBeInTheDocument();
    expect(screen.getByTestId("turn-order-seat-1")).toBeInTheDocument();
    expect(screen.getByTestId("turn-order-seat-0")).toBeInTheDocument();
    // Order 1-goes-first, 0 second — assert draw order via DOM position, not just presence.
    const entries = screen.getAllByRole("listitem");
    expect(entries[0]).toHaveAttribute("data-testid", "turn-order-seat-1");
    expect(entries[1]).toHaveAttribute("data-testid", "turn-order-seat-0");
  });
});

describe("TurnOrderCeremony — iron weighting (DER #12)", () => {
  test("a 2P rollover with ironWeights renders the weighting, mono, per player", () => {
    stubReducedMotion(false);
    render(<TurnOrderCeremony rollover={ORDER_2P} />);

    // ironWeights is indexed by PlayerId (see game/store.ts's TurnRollover doc comment /
    // agent-drive.ts's ironWeights[pid] = control(game, pid).iron.length) — ORDER_2P's
    // ironWeights: [3, 5] means player 0's weight is 3, player 1's is 5.
    expect(screen.getByTestId("iron-weight-0")).toHaveTextContent("3");
    expect(screen.getByTestId("iron-weight-1")).toHaveTextContent("5");
    expect(screen.getByText(/iron-proportional/i)).toBeInTheDocument();
  });

  test("a 3+P rollover (ironWeights null) renders no iron weighting", () => {
    stubReducedMotion(false);
    render(<TurnOrderCeremony rollover={ORDER_3P} />);

    expect(screen.queryByTestId(/iron-weight-/)).not.toBeInTheDocument();
    expect(screen.queryByText(/iron-proportional/i)).not.toBeInTheDocument();
  });
});

describe("TurnOrderCeremony — reduced motion", () => {
  test("reduced motion: no animation class, a static order summary is shown instantly", () => {
    stubReducedMotion(true);
    render(<TurnOrderCeremony rollover={ORDER_2P} />);

    const list = screen.getByRole("list", { name: /turn order/i });
    expect(list).not.toHaveClass("turn-order-animated");
    expect(screen.getByTestId("turn-order-static-summary")).toHaveTextContent("1, 0");
  });

  test("non-reduced motion: the animated reveal class is present, no static summary", () => {
    stubReducedMotion(false);
    render(<TurnOrderCeremony rollover={ORDER_2P} />);

    const list = screen.getByRole("list", { name: /turn order/i });
    expect(list).toHaveClass("turn-order-animated");
    expect(screen.queryByTestId("turn-order-static-summary")).not.toBeInTheDocument();
  });
});
