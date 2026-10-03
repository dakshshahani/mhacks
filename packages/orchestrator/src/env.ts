// Minimal env access without @types/node (local declaration, no global clash).
declare const process: { env: Record<string, string | undefined> } | undefined;

export function env(name: string): string {
  if (typeof process === "undefined") return "";
  return process.env[name] ?? "";
}
