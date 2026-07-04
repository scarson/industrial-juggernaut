// ABOUTME: Tests for the rail-content seam — a provider carries a ReactNode into the shell rail
// ABOUTME: without re-rendering its passed-through children, and the setter defaults to a no-op.
import { describe, expect, test, vi } from "vitest";
import { useEffect } from "react";
import { act, render, screen } from "@testing-library/react";
import { RailContentProvider, useRailContent, useSetRailContent } from "./rail-content";

/** A consumer that renders whatever content the rail context currently holds, or a fallback. */
function ContentReadout() {
  const content = useRailContent();
  return <div data-testid="readout">{content ?? <span>fallback</span>}</div>;
}

describe("rail-content", () => {
  test("useRailContent is null until a publisher sets content", () => {
    render(
      <RailContentProvider>
        <ContentReadout />
      </RailContentProvider>,
    );
    expect(screen.getByText("fallback")).toBeInTheDocument();
  });

  test("a publisher's set content reaches a sibling consumer", () => {
    function Publisher() {
      const setContent = useSetRailContent();
      useEffect(() => {
        setContent(<span>published</span>);
        return () => setContent(null);
      }, [setContent]);
      return null;
    }

    render(
      <RailContentProvider>
        <Publisher />
        <ContentReadout />
      </RailContentProvider>,
    );
    expect(screen.getByText("published")).toBeInTheDocument();
  });

  test("unmounting a publisher's effect clears the content back to null", () => {
    function Publisher() {
      const setContent = useSetRailContent();
      useEffect(() => {
        setContent(<span>published</span>);
        return () => setContent(null);
      }, [setContent]);
      return null;
    }

    const { rerender } = render(
      <RailContentProvider>
        <Publisher />
        <ContentReadout />
      </RailContentProvider>,
    );
    expect(screen.getByText("published")).toBeInTheDocument();

    rerender(
      <RailContentProvider>
        <ContentReadout />
      </RailContentProvider>,
    );
    expect(screen.getByText("fallback")).toBeInTheDocument();
  });

  test("the setter identity is stable across content changes", () => {
    const seen: Array<(node: React.ReactNode) => void> = [];
    function SetterProbe() {
      const setContent = useSetRailContent();
      seen.push(setContent);
      return (
        <button type="button" onClick={() => setContent(<span>tick</span>)}>
          publish
        </button>
      );
    }

    render(
      <RailContentProvider>
        <SetterProbe />
        <ContentReadout />
      </RailContentProvider>,
    );
    act(() => {
      screen.getByRole("button", { name: "publish" }).click();
    });
    // Every render observed the same setter reference — a stable identity a publisher can depend on.
    expect(new Set(seen).size).toBe(1);
  });

  test("useSetRailContent defaults to a no-op outside any provider", () => {
    // A publisher mounted without a provider must not throw — the setter is a safe no-op.
    function LonePublisher() {
      const setContent = useSetRailContent();
      useEffect(() => {
        setContent(<span>orphan</span>);
      }, [setContent]);
      return <p>lone</p>;
    }

    expect(() => render(<LonePublisher />)).not.toThrow();
    expect(screen.getByText("lone")).toBeInTheDocument();
  });

  test("setting content does not re-render the provider's passed-through children", () => {
    const childRenders = vi.fn();
    function InertChild() {
      childRenders();
      return <p>inert</p>;
    }
    function Publisher() {
      const setContent = useSetRailContent();
      return (
        <button type="button" onClick={() => setContent(<span>tick</span>)}>
          publish
        </button>
      );
    }

    // The stable-identity `children` element is the inert subtree; the publisher lives elsewhere.
    const children = <InertChild />;
    function Harness() {
      return (
        <RailContentProvider>
          {children}
          <Publisher />
          <ContentReadout />
        </RailContentProvider>
      );
    }

    render(<Harness />);
    expect(childRenders).toHaveBeenCalledTimes(1);
    act(() => {
      screen.getByRole("button", { name: "publish" }).click();
    });
    // The content changed, but the passed-through child element (stable identity) never re-rendered.
    expect(childRenders).toHaveBeenCalledTimes(1);
    expect(screen.getByText("tick")).toBeInTheDocument();
  });
});
