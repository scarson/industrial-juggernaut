// ABOUTME: Minimal ambient declarations for the Node built-ins src/sweep/main.ts uses at runtime under tsx.
// ABOUTME: Avoids pulling @types/node (a dependency) or relaxing tsconfig; covers only the few APIs main.ts touches.

declare module "node:fs" {
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
  export function writeFileSync(path: string, data: string, encoding?: string): void;
}

declare module "node:path" {
  export function resolve(...segments: string[]): string;
  export function dirname(path: string): string;
}

declare const process: { cwd(): string };
