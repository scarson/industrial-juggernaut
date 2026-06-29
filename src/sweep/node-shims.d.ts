// ABOUTME: Minimal ambient declarations for the Node builtins the sweep entrypoint (main.ts) uses.
// ABOUTME: The engine is Node-free (no @types/node); this declares only the handful of APIs main.ts calls.

declare module "node:fs" {
  export function mkdirSync(path: string, opts: { recursive: boolean }): void;
  export function writeFileSync(path: string, data: string, encoding: string): void;
}

declare module "node:path" {
  export function dirname(p: string): string;
  export function resolve(...segments: string[]): string;
}

declare module "node:url" {
  export function fileURLToPath(url: string | URL): string;
}

declare module "node:process" {
  const process: {
    argv: string[];
  };
  export default process;
}

interface ImportMeta {
  url: string;
}
