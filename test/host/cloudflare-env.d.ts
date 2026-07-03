// ABOUTME: Committed Cloudflare.Env binding types (GAME_ROOM + ASSETS) for the host tsconfig.
// ABOUTME: The generated worker-configuration.d.ts is gitignored, so CI never has it — this
// ABOUTME: hand-authored declaration keeps `env` (cloudflare:test) and the Worker typed deterministically.

declare namespace Cloudflare {
  interface Env {
    ASSETS: Fetcher;
    GAME_ROOM: DurableObjectNamespace;
  }
}
