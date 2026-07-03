// ABOUTME: Structure tests for the SVG shape primitives — asserts the right DOM element per
// ABOUTME: shape and that fill wires the identity's colorVar. Not a visual/geometry test.
import { describe, expect, test } from "vitest";
import { render } from "@testing-library/react";
import { PlayerShapeIcon } from "./shapes";
import { playerIdentity } from "./player-identity";

describe("PlayerShapeIcon", () => {
  test("circle (id 0) renders a <circle>", () => {
    const { container } = render(<PlayerShapeIcon identity={playerIdentity(0)} size={20} />);
    expect(container.querySelector("circle")).not.toBeNull();
    expect(container.querySelector("polygon")).toBeNull();
  });

  test("square (id 1) renders a 4-point <polygon>", () => {
    const { container } = render(<PlayerShapeIcon identity={playerIdentity(1)} size={20} />);
    const polygon = container.querySelector("polygon");
    expect(polygon).not.toBeNull();
    expect(pointCount(polygon!)).toBe(4);
  });

  test("triangle (id 2) renders a 3-point <polygon>", () => {
    const { container } = render(<PlayerShapeIcon identity={playerIdentity(2)} size={20} />);
    const polygon = container.querySelector("polygon");
    expect(polygon).not.toBeNull();
    expect(pointCount(polygon!)).toBe(3);
  });

  test("diamond (id 3) renders a 4-point <polygon>", () => {
    const { container } = render(<PlayerShapeIcon identity={playerIdentity(3)} size={20} />);
    const polygon = container.querySelector("polygon");
    expect(polygon).not.toBeNull();
    expect(pointCount(polygon!)).toBe(4);
  });

  test("pentagon (id 4) renders a 5-point <polygon>", () => {
    const { container } = render(<PlayerShapeIcon identity={playerIdentity(4)} size={20} />);
    const polygon = container.querySelector("polygon");
    expect(polygon).not.toBeNull();
    expect(pointCount(polygon!)).toBe(5);
  });

  test("six-point (id 5) renders a 12-point <polygon> (six-pointed star)", () => {
    const { container } = render(<PlayerShapeIcon identity={playerIdentity(5)} size={20} />);
    const polygon = container.querySelector("polygon");
    expect(polygon).not.toBeNull();
    expect(pointCount(polygon!)).toBe(12);
  });

  test("the shape element's fill wires the identity's colorVar", () => {
    const identity = playerIdentity(3);
    const { container } = render(<PlayerShapeIcon identity={identity} size={20} />);
    const shapeEl = container.querySelector("circle, polygon");
    expect(shapeEl).not.toBeNull();
    expect(shapeEl!.getAttribute("fill")).toContain(identity.colorVar);
  });

  test("each of the 6 identities renders exactly one <pattern> def", () => {
    for (const id of [0, 1, 2, 3, 4, 5]) {
      const { container } = render(<PlayerShapeIcon identity={playerIdentity(id)} size={20} />);
      expect(container.querySelectorAll("defs pattern")).toHaveLength(1);
    }
  });

  test("the 5 non-solid pattern tiles are non-empty and pairwise distinct", () => {
    // Compares each tile's inner markup (its child elements), not the pattern's id
    // attribute, so distinctness reflects actual visual structure rather than naming.
    const tiles = [1, 2, 3, 4, 5].map((id) => {
      const { container } = render(<PlayerShapeIcon identity={playerIdentity(id)} size={20} />);
      return container.querySelector("defs pattern")!.innerHTML;
    });
    for (const tile of tiles) {
      expect(tile).not.toBe("");
    }
    expect(new Set(tiles).size).toBe(5);
  });

  test("solid (id 0) renders an intentionally empty pattern tile", () => {
    // "solid" means no texture mark on top of the color fill — the empty tile is designed
    // behavior, pinned here so emptiness can't be mistaken for a broken pattern.
    const { container } = render(<PlayerShapeIcon identity={playerIdentity(0)} size={20} />);
    const pattern = container.querySelector("defs pattern");
    expect(pattern).not.toBeNull();
    expect(pattern!.childElementCount).toBe(0);
  });

  test("square and triangle (the CVD floor pair, ids 1 and 2) render visually distinct element shapes", () => {
    const { container: squareContainer } = render(
      <PlayerShapeIcon identity={playerIdentity(1)} size={20} />,
    );
    const { container: triangleContainer } = render(
      <PlayerShapeIcon identity={playerIdentity(2)} size={20} />,
    );
    const squarePoints = pointCount(squareContainer.querySelector("polygon")!);
    const trianglePoints = pointCount(triangleContainer.querySelector("polygon")!);
    expect(squarePoints).not.toBe(trianglePoints);
  });
});

function pointCount(polygon: Element): number {
  const pointsAttr = polygon.getAttribute("points") ?? "";
  return pointsAttr.trim().split(/\s+/).filter(Boolean).length;
}
