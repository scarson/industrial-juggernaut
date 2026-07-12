// ABOUTME: Tests for the landing screen — title plate, working entry points (navigate to
// ABOUTME: game/viewer/rules), the map vignette's honest loading plate, and brass discipline.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HomeScreen, VignetteBoundary } from "./HomeScreen";

beforeEach(() => {
  window.history.pushState({}, "", "/");
});

afterEach(() => {
  window.history.pushState({}, "", "/");
});

describe("HomeScreen", () => {
  test("renders the title plate as the page heading in the Cartouche display serif", () => {
    render(<HomeScreen />);
    const title = screen.getByRole("heading", { level: 1, name: /industrial juggernaut/i });
    expect(title).toHaveClass("cartouche");
  });

  test("Begin a game navigates to /game", async () => {
    const user = userEvent.setup();
    render(<HomeScreen />);
    await user.click(screen.getByRole("button", { name: /begin a game/i }));
    expect(window.location.pathname).toBe("/game");
  });

  test("Watch the agents play navigates to /viewer", async () => {
    const user = userEvent.setup();
    render(<HomeScreen />);
    await user.click(screen.getByRole("button", { name: /watch the agents play/i }));
    expect(window.location.pathname).toBe("/viewer");
  });

  test("Read the rules navigates to /rules", async () => {
    const user = userEvent.setup();
    render(<HomeScreen />);
    await user.click(screen.getByRole("button", { name: /read the rules/i }));
    expect(window.location.pathname).toBe("/rules");
  });

  test("only the primary action spends the brass budget; the others are quiet chrome", () => {
    render(<HomeScreen />);
    expect(screen.getByRole("button", { name: /begin a game/i })).toHaveClass(
      "chrome-button",
      "brass-accent-bg",
    );
    for (const name of [/watch the agents play/i, /read the rules/i]) {
      const button = screen.getByRole("button", { name });
      expect(button).toHaveClass("chrome-button");
      expect(button).not.toHaveClass("brass-accent-bg");
      expect(button).not.toHaveClass("brass-accent");
    }
  });

  test("the map plate is present immediately (honest placeholder before the lazy vignette lands)", () => {
    render(<HomeScreen />);
    // The plate region exists at first paint — the lazy chunk fills it in; content is never
    // gated on the async load (a headless render still shows the parchment plate).
    expect(screen.getByTestId("landing-plate")).toBeInTheDocument();
  });

  test("the real board vignette arrives from the lazy chunk", async () => {
    render(<HomeScreen />);
    expect(
      await screen.findByRole("img", { name: "Game board" }, { timeout: 10_000 }),
    ).toBeInTheDocument();
  });

  test("a vignette failure never takes the landing down — the plate stays, the actions work", async () => {
    // React logs the caught error; capture it so the output stays pristine and the catch is proven.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    function ExplodingMap(): never {
      throw new Error("vignette failed");
    }

    const user = userEvent.setup();
    render(
      <div className="landing">
        <VignetteBoundary>
          <ExplodingMap />
        </VignetteBoundary>
        <button type="button" onClick={() => window.history.pushState({}, "", "/game")}>
          Begin a game
        </button>
      </div>,
    );

    // The boundary swallowed the failure (an empty parchment plate, no crash)...
    expect(consoleError).toHaveBeenCalled();
    // ...and the rest of the landing still works.
    await user.click(screen.getByRole("button", { name: /begin a game/i }));
    expect(window.location.pathname).toBe("/game");
    consoleError.mockRestore();
  });
});
