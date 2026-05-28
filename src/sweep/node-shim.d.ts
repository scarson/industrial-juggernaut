// ABOUTME: Minimal ambient declarations for the Node built-ins the sweep scripts (main, calibrate, pool, worker) use under tsx.
// ABOUTME: Avoids pulling @types/node (a dependency) or relaxing tsconfig; covers only the few APIs these files touch.

declare module "node:fs" {
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
  export function writeFileSync(path: string, data: string, encoding?: string): void;
  export function appendFileSync(path: string, data: string, encoding?: string): void;
  export function existsSync(path: string): boolean;
  export function readFileSync(path: string, encoding: string): string;
}

declare module "node:path" {
  export function resolve(...segments: string[]): string;
  export function dirname(path: string): string;
}

declare module "node:url" {
  export function fileURLToPath(url: string | URL): string;
}

declare module "node:os" {
  export function cpus(): Array<{ model: string; speed: number }>;
}

declare module "node:readline" {
  export interface Interface {
    on(event: "line", cb: (line: string) => void): Interface;
  }
  export function createInterface(opts: { input: unknown }): Interface;
}

declare module "node:child_process" {
  export interface ChildProcessIO {
    write(chunk: string): void;
    end(): void;
  }
  export interface ChildProcess {
    stdin: ChildProcessIO | null;
    stdout: unknown;
    on(event: "exit", cb: (code: number | null) => void): void;
    on(event: string, cb: (...args: unknown[]) => void): void;
  }
  export function spawn(
    command: string,
    args: string[],
    options?: { stdio?: (string | number | null)[] },
  ): ChildProcess;
  export function execSync(command: string, options?: { stdio?: string | (string | number | null)[]; encoding?: string; cwd?: string }): string;
}

declare const process: {
  cwd(): string;
  execPath: string;
  argv: string[];
  stdin: unknown;
  stdout: { write(chunk: string): void };
  exit(code?: number): never;
};
