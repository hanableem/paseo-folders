import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import type { PaseoApi } from "@getpaseo/client";
import { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { moveConversationRpc } from "../shared/model";

// Paseo's plugin API cannot import a provider session into a workspace or delete an
// agent, so moves go through Paseo's internal daemon client, as scripts/move-agent.mjs
// does. Within one directory Paseo reuses the archived agent record, so the
// conversation keeps its agent ID. Across directories only Claude Code sessions can
// move: Claude Code resumes a session by ID from any directory and keeps writing to
// the transcript where it started; the agent gets a new Paseo ID.

type Input = RpcInput<typeof moveConversationRpc>;
type Output = RpcOutput<typeof moveConversationRpc>;
type Agent = NonNullable<Awaited<ReturnType<DaemonClient["fetchAgent"]>>>["agent"];

const paseoHome = () => process.env.PASEO_HOME || join(homedir(), ".paseo");

/** PASEO_WS_URL, else the listen address in Paseo's config, else Paseo's default. */
function daemonUrl(): string {
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

function samePath(a: string, b: string): boolean {
  const real = (p: string) => {
    try {
      return realpathSync(p);
    } catch {
      return resolve(p);
    }
  };
  return real(a) === real(b);
}

class Refusal extends Error {}

let queue: Promise<unknown> = Promise.resolve();

/** One move at a time, so two requests never interleave their archive, delete and import steps. */
export function moveConversation(input: Input, paseo: PaseoApi): Promise<Output> {
  const run = queue.then(() => moveNow(input, paseo));
  queue = run.catch(() => undefined);
  return run;
}

async function moveNow(input: Input, paseo: PaseoApi): Promise<Output> {
  const client = new DaemonClient({ url: daemonUrl(), clientId: "paseo-folders-move", clientType: "cli" });
  try {
    await client.connect();
    return await move(client, paseo, input);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!(error instanceof Refusal)) console.error(`[folders] move ${input.agentId} failed: ${message}`);
    return { ok: false, reason: message };
  } finally {
    await client.close().catch(() => undefined);
  }
}

async function move(client: DaemonClient, paseo: PaseoApi, input: Input): Promise<Output> {
  const agent = (await client.fetchAgent(input.agentId))?.agent;
  if (!agent || agent.archivedAt) throw new Refusal("This conversation is no longer open in Paseo.");
  const { id, cwd, provider, title } = agent;
  const sessionId = agent.persistence?.sessionId;
  const sourceWorkspaceId = agent.workspaceId;
  if (!cwd || !provider || !sessionId || !sourceWorkspaceId) {
    throw new Refusal(`“${title || "This conversation"}” has no saved session, so it cannot move.`);
  }
  if (agent.status === "running" || agent.status === "initializing") {
    throw new Refusal(`“${title || "This conversation"}” is still running. Try again when it has finished.`);
  }
  if ((agent.pendingPermissions?.length ?? 0) > 0) {
    throw new Refusal(`“${title || "This conversation"}” is waiting for a permission answer.`);
  }

  const workspaces = (await client.fetchWorkspaces({})).entries;
  const source = workspaces.find((ws) => ws.id === sourceWorkspaceId);
  let workspaceId = input.targetWorkspaceId;
  let directory = cwd;
  if (workspaceId) {
    if (workspaceId === sourceWorkspaceId) throw new Refusal("It is already in that workspace.");
    const target = workspaces.find((ws) => ws.id === workspaceId);
    if (!target) throw new Refusal("That workspace is no longer open.");
    directory = target.workspaceDirectory || target.projectRootPath;
  }
  const sameDirectory = samePath(directory, cwd);
  if (!sameDirectory && provider !== "claude") {
    throw new Refusal(`Only Claude conversations can move to another project. This one stays in ${cwd}.`);
  }

  let created = false;
  if (!workspaceId) {
    const ws = await paseo.workspaces.create({
      source: { kind: "directory", path: cwd, projectId: source?.projectId || undefined },
    });
    workspaceId = ws.id;
    created = true;
    await ws.setTitle(input.title?.trim() || title || "Conversation").catch((error) => {
      console.error(`[folders] could not title workspace ${ws.id}: ${String(error)}`);
    });
  }

  let movedId: string;
  let note = "";
  try {
    if (sameDirectory) {
      movedId = await moveWithinDirectory(client, agent, sessionId, workspaceId, sourceWorkspaceId);
    } else {
      ({ movedId, note } = await moveAcrossDirectories(client, agent, sessionId, workspaceId, directory, source));
    }
  } catch (error) {
    if (created) await paseo.workspaces.archive(workspaceId).catch(() => undefined);
    throw error;
  }

  const left = (await client.fetchAgents({})).entries.some(({ agent: other }) => other.workspaceId === sourceWorkspaceId);
  if (!left) await client.archiveWorkspace(sourceWorkspaceId);
  if (note) console.error(`[folders] moved ${id} as ${movedId}: ${note}`);
  return { ok: true, agentId: movedId, workspaceId, sourceArchived: !left, note };
}

/** Archives the agent and imports its session into the target; Paseo reuses the record and its ID. */
async function moveWithinDirectory(
  client: DaemonClient,
  agent: Agent,
  sessionId: string,
  workspaceId: string,
  sourceWorkspaceId: string,
): Promise<string> {
  const { provider, cwd } = agent;
  await client.archiveAgent(agent.id);
  try {
    return (await client.importAgent({ provider, sessionId, workspaceId, cwd })).id;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    try {
      await client.importAgent({ provider, sessionId, workspaceId: sourceWorkspaceId, cwd });
    } catch {
      throw new Error(`Paseo could not move it (${reason}), nor put it back. It is archived; unarchive it from History.`);
    }
    throw new Error(`Paseo could not move it (${reason}). It stays where it was.`);
  }
}

/**
 * Deletes the agent's Paseo record and imports its Claude session into the target
 * directory. A copy of the record is saved first, and the session is imported back
 * into the old workspace if the move fails.
 */
async function moveAcrossDirectories(
  client: DaemonClient,
  agent: Agent,
  sessionId: string,
  workspaceId: string,
  directory: string,
  source: unknown,
): Promise<{ movedId: string; note: string }> {
  const { provider, cwd } = agent;
  const sourceWorkspaceId = agent.workspaceId as string;
  const movesDir = join(paseoHome(), "paseo-folders", "moves");
  mkdirSync(movesDir, { recursive: true });
  const saved = join(movesDir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${agent.id}.json`);
  writeFileSync(saved, `${JSON.stringify({ to: { workspaceId, directory }, agent, fromWorkspace: source }, null, 2)}\n`);

  const labels = agent.labels && Object.keys(agent.labels).length > 0 ? agent.labels : undefined;
  await client.deleteAgent(agent.id);
  let movedId: string;
  try {
    movedId = (await client.importAgent({ provider, sessionId, workspaceId, cwd: directory, labels })).id;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    try {
      const back = await client.importAgent({ provider, sessionId, workspaceId: sourceWorkspaceId, cwd, labels });
      await restoreSettings(client, back.id, agent);
    } catch {
      throw new Error(`Paseo could not move it (${reason}), nor put it back. Its record is saved in ${saved}.`);
    }
    throw new Error(`Paseo could not move it (${reason}). It is back where it was.`);
  }
  const failed = await restoreSettings(client, movedId, agent);
  return { movedId, note: failed.length > 0 ? `Its ${failed.join(", ")} could not be carried over.` : "" };
}

/** Carries the title, mode, model and thinking option over to the imported agent. Returns what failed. */
async function restoreSettings(client: DaemonClient, newId: string, agent: Agent): Promise<string[]> {
  const failed: string[] = [];
  const attempt = async (what: string, work: () => Promise<unknown>) => {
    try {
      await work();
    } catch {
      failed.push(what);
    }
  };
  if (agent.title) await attempt("title", () => client.updateAgent(newId, { name: agent.title as string }));
  if (agent.currentModeId) await attempt("mode", () => client.setAgentMode(newId, agent.currentModeId as string));
  if (agent.model) await attempt("model", () => client.setAgentModel(newId, agent.model as string));
  if (agent.thinkingOptionId) {
    await attempt("thinking option", () => client.setAgentThinkingOption(newId, agent.thinkingOptionId as string));
  }
  return failed;
}
