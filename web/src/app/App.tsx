// ABOUTME: Root application component for the Industrial Juggernaut SPA.
// ABOUTME: Temporary token/type specimen for the P0.3 browser smoke — replaced wholesale in P0.7.
import { chrome, parchment, brass, ink, players, type PaletteColor } from "../design/tokens";

// Self-contained swatch data for the smoke specimen. All of App.tsx is thrown
// away in P0.7, so this inline shape is intentional (no shared component yet).
const SWATCH_GROUPS: { label: string; note: string; colors: [string, PaletteColor][] }[] = [
  {
    label: "Chrome — the Table",
    note: "dark walnut/iron; carries the app body",
    colors: Object.entries(chrome),
  },
  {
    label: "Parchment — the board only",
    note: "map material; never app-chrome tint",
    colors: Object.entries(parchment),
  },
  {
    label: "Brass — scarce accent",
    note: "≤10% of any screen",
    colors: Object.entries(brass),
  },
  { label: "Ink", note: "warm-black cartographic text", colors: Object.entries(ink) },
  {
    label: "Players — CVD-safe set of 6 (never color alone)",
    note: "committed: oxide/cobalt/violet · extension: gold/steel/forest",
    colors: Object.entries(players),
  },
];

function Swatch({ name, value }: { name: string; value: PaletteColor }) {
  return (
    <figure style={{ margin: 0, width: 132 }}>
      <div
        style={{
          height: 64,
          borderRadius: 4,
          background: value.oklch,
          border: "1px solid var(--hairline)",
        }}
      />
      <figcaption style={{ marginTop: 6 }}>
        <div style={{ fontSize: 13 }}>{name}</div>
        <div className="mono" style={{ fontSize: 10, opacity: 0.7 }}>
          {value.hex}
        </div>
      </figcaption>
    </figure>
  );
}

export function App() {
  return (
    <main className="table-surface" style={{ minHeight: "100vh", padding: 32 }}>
      <h1 className="cartouche" style={{ margin: "0 0 4px", fontSize: 40 }}>
        Industrial Juggernaut
      </h1>
      <p style={{ margin: "0 0 32px", opacity: 0.7 }}>
        P0.3 token &amp; type specimen — display serif above (Cartouche), body sans here, mono for
        data.
      </p>

      {SWATCH_GROUPS.map((group) => (
        <section key={group.label} style={{ marginBottom: 28 }}>
          <h2 style={{ fontSize: 15, margin: "0 0 2px" }}>{group.label}</h2>
          <p style={{ fontSize: 12, opacity: 0.6, margin: "0 0 12px" }}>{group.note}</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
            {group.colors.map(([name, value]) => (
              <Swatch key={name} name={name} value={value} />
            ))}
          </div>
        </section>
      ))}

      <section className="board-surface" style={{ padding: 20, borderRadius: 6, marginBottom: 20 }}>
        <p className="cartouche" style={{ fontSize: 22, margin: "0 0 8px" }}>
          The board is the hero — ink on parchment.
        </p>
        <p style={{ margin: 0 }}>
          Body sans on the board reads as cartographic legend text. Numbers live in the mono face:{" "}
          <span className="mono">36 / 36 · seed 0x9f3a · 75 / 83 / 89</span>.
        </p>
      </section>

      <section className="table-panel" style={{ padding: 20, borderRadius: 6 }}>
        <p style={{ margin: "0 0 8px" }}>
          A panel sits on the table — one step up in walnut, hairline border, no floating shadow.
        </p>
        <p style={{ margin: 0 }}>
          <span className="brass-accent">Brass accent</span> is scarce; the{" "}
          <span className="mono">mono telemetry</span> tells the truth about the numbers.
        </p>
      </section>
    </main>
  );
}
