// ABOUTME: Minimal ambient declarations for the Node builtins the sweep entrypoint (main.ts) uses.
// ABOUTME: The engine is Node-free (no @types/node); this declares only the handful of APIs main.ts calls.

declare module "node:fs" {
  export function mkdirSync(path: string, opts: { recursive: boolean }): void;
  export function writeFileSync(path: string, data: string, encoding: string): void;
  export function appendFileSync(path: string, data: string, encoding: string): void;
  export function readFileSync(path: string, encoding: string): string;
  export function existsSync(path: string): boolean;
  export function rmSync(path: string, opts: { recursive: boolean; force: boolean }): void;
}

declare module "node:child_process" {
  interface SpawnedProcess {
    on(event: "exit", cb: (code: number | null, signal: string | null) => void): void;
    on(event: "error", cb: (err: Error) => void): void;
    kill(signal?: string): void;
    readonly pid?: number;
  }
  export function spawn(
    command: string,
    args: string[],
    opts: { stdio: "inherit" | "ignore"; cwd?: string },
  ): SpawnedProcess;
}

declare module "node:os" {
  export function cpus(): unknown[];
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
    exit(code?: number): never;
  };
  export default process;
}

interface ImportMeta {
  url: string;
}
