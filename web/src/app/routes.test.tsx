// ABOUTME: Structure tests for the in-house router — renders the screen matching
// ABOUTME: window.location.pathname, and re-renders on popstate/navigate.
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { Router, navigate } from "./routes";

function setPath(path: string) {
  window.history.pushState({}, "", path);
}

beforeEach(() => {
  setPath("/");
});

afterEach(() => {
  setPath("/");
});

describe("Router", () => {
  test("renders the landing screen at /", () => {
    setPath("/");
    render(<Router />);
    expect(
      screen.getByRole("heading", { level: 1, name: /industrial juggernaut/i }),
    ).toBeInTheDocument();
  });

  test("renders the game screen at /game", () => {
    setPath("/game");
    render(<Router />);
    expect(screen.getByRole("heading", { name: /game/i })).toBeInTheDocument();
  });

  test("renders the viewer screen at /viewer", () => {
    setPath("/viewer");
    render(<Router />);
    expect(screen.getByRole("heading", { name: /viewer/i })).toBeInTheDocument();
  });

  test("renders the rules screen at /rules", () => {
    setPath("/rules");
    render(<Router />);
    expect(screen.getByRole("heading", { name: /rules/i })).toBeInTheDocument();
  });

  test("renders a not-found screen for an unknown path", () => {
    setPath("/nope");
    render(<Router />);
    expect(screen.getByRole("heading", { name: /not found/i })).toBeInTheDocument();
  });

  test("navigate() updates the path and re-renders without a full page load", () => {
    setPath("/");
    render(<Router />);
    expect(
      screen.getByRole("heading", { level: 1, name: /industrial juggernaut/i }),
    ).toBeInTheDocument();

    act(() => {
      navigate("/rules");
    });

    expect(screen.getByRole("heading", { name: /rules/i })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/rules");
  });

  test("a popstate event (browser back/forward) re-renders the matching screen", () => {
    setPath("/game");
    render(<Router />);
    expect(screen.getByRole("heading", { name: /game/i })).toBeInTheDocument();

    act(() => {
      window.history.pushState({}, "", "/viewer");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    expect(screen.getByRole("heading", { name: /viewer/i })).toBeInTheDocument();
  });
});
