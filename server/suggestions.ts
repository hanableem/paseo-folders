import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import { readSuggestionsRpc, SuggestionsSchema } from "../shared/model";

const MAX_BYTES = 5 * 1024 * 1024;

/** `<PASEO_HOME>/paseo-folders/suggestions.json`, so nothing user-specific is hard-coded. */
export function defaultSuggestionsPath(): string {
  const paseoHome = process.env.PASEO_HOME || join(homedir(), ".paseo");
  return join(paseoHome, "paseo-folders", "suggestions.json");
}

function resolvePath(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return defaultSuggestionsPath();
  if (trimmed === "~") return homedir();
  if (trimmed.startsWith("~/")) return join(homedir(), trimmed.slice(2));
  return trimmed;
}

type Output = RpcOutput<typeof readSuggestionsRpc>;

export async function readSuggestions({ path }: RpcInput<typeof readSuggestionsRpc>): Promise<Output> {
  const resolved = resolvePath(path);
  if (!isAbsolute(resolved)) {
    return { status: "invalid", path: resolved, error: "Use an absolute path or one starting with ~/." };
  }
  try {
    const info = await stat(resolved);
    if (!info.isFile()) return { status: "invalid", path: resolved, error: "Not a file." };
    if (info.size > MAX_BYTES) return { status: "invalid", path: resolved, error: "File is larger than 5 MB." };
  } catch {
    return { status: "missing", path: resolved };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(resolved, "utf8"));
  } catch (error) {
    return { status: "invalid", path: resolved, error: `Not valid JSON: ${String(error)}` };
  }
  const parsed = SuggestionsSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: "invalid", path: resolved, error: parsed.error.issues[0]?.message ?? "Invalid format." };
  }
  return { status: "ok", path: resolved, suggestions: parsed.data };
}
