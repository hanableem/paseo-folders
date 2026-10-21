import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const paseoHome = () => process.env.PASEO_HOME || join(homedir(), ".paseo");

/** PASEO_WS_URL, else the listen address in Paseo's config, else Paseo's default. */
export function daemonUrl(): string {
  if (process.env.PASEO_WS_URL) return process.env.PASEO_WS_URL;
  try {
    const config = JSON.parse(readFileSync(join(paseoHome(), "config.json"), "utf8"));
    const listen = config?.daemon?.listen;
    if (typeof listen === "string" && /^[\w.-]+:\d+$/.test(listen)) return `ws://${listen}/ws`;
  } catch {
    // No readable config: Paseo itself then listens on its default address.
  }
  return "ws://127.0.0.1:6767/ws";
}
