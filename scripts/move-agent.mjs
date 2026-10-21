#!/usr/bin/env node
// Moves one agent into another directory, so it shows under that directory's project.
//
//   node scripts/move-agent.mjs <agent-id> <target-directory> [--dry-run]
//
// Paseo cannot change an agent's directory. This script creates a local workspace in the
// target directory, archives and deletes the agent's Paseo record and imports its provider
// session into the new workspace. The provider session is not touched: Claude Code resumes a
// session by id from any directory and keeps writing to the transcript where the session
// started, so the history stays. The agent gets a new Paseo id; its title, labels, mode, model
// and thinking option are carried over, and so are its folder, hand placement and note in
// Folders. When nothing else is left in the old workspace, it is archived and the new one takes
// its title and pin.
//
// Before deleting anything, the script saves the agent as Paseo returned it under
// <Paseo home>/paseo-folders/moves/. If the import fails, it imports the session back into the
// old directory and workspace.
//
// Experimental: relies on Paseo's internal daemon client, like split-agent.mjs. Claude agents
// only for now. Uses the `paseo` CLI from PATH (or PASEO_CLI) and the daemon at PASEO_WS_URL
// (default ws://127.0.0.1:6767/ws).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { DaemonClient } from "@getpaseo/client/internal/daemon-client";

const cli = process.env.PASEO_CLI || "paseo";
const url = process.env.PASEO_WS_URL || "ws://127.0.0.1:6767/ws";
const paseoHome = process.env.PASEO_HOME || join(homedir(), ".paseo");
const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const [agentId, target] = argv.filter((arg) => arg !== "--dry-run");
if (!agentId || !target) {
  console.error("usage: node scripts/move-agent.mjs <agent-id> <target-directory> [--dry-run]");
  process.exit(2);
}
const targetDir = resolve(target.replace(/^~(?=$|\/)/, homedir()));
if (!existsSync(targetDir) || !statSync(targetDir).isDirectory()) {
  console.error(`not a directory: ${targetDir}`);
  process.exit(2);
}
const run = (args) => execFileSync(cli, args, { encoding: "utf8" });
const warn = (what) => (error) => console.error(`warning: could not ${what}: ${error?.message ?? error}`);

// Carries the old agent's settings over to the imported one.
async function restoreSettings(client, newId, agent) {
  if (agent.title) await client.updateAgent(newId, { name: agent.title }).catch(warn("restore the title"));
  if (agent.currentModeId) await client.setAgentMode(newId, agent.currentModeId).catch(warn("restore the mode"));
  if (agent.model) await client.setAgentModel(newId, agent.model).catch(warn("restore the model"));
  if (agent.thinkingOptionId) {
    await client.setAgentThinkingOption(newId, agent.thinkingOptionId).catch(warn("restore the thinking option"));
  }
}

// Carries the conversation's folder, hand placement and note in Folders over to the new agent id,
// as the plugin does after its own moves. Tries again when an app saved the folders in between.
async function carryFolders(client, from, to) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const read = await client.invokePluginRpc("paseo-folders", "settings.folders.read", {});
    if (read?.status !== "ready") throw new Error("the saved folders are invalid");
    const keys = ["assignments", "manual", "notes"].filter((key) => read.values[key] && from in read.values[key]);
    if (keys.length === 0) return;
    const values = { ...read.values };
    for (const key of keys) {
      values[key] = { ...values[key], [to]: values[key][from] };
      delete values[key][from];
    }
    const written = await client.invokePluginRpc("paseo-folders", "settings.folders.write", { revision: read.revision, values });
    if (written?.status === "saved") return;
    if (written?.status !== "conflict") throw new Error(written?.error ?? "the folders were not saved");
  }
  throw new Error("the folders kept changing while saving");
}

async function main(client) {
  const agent = (await client.fetchAgent(agentId))?.agent;
  if (!agent) throw new Error(`agent ${agentId} not found`);
  const { id, cwd, provider, workspaceId: fromWorkspaceId } = agent;
  const sessionId = agent.persistence?.sessionId;
  if (!cwd || !provider || !sessionId) throw new Error(`missing cwd, provider or session for ${id}`);
  if (provider !== "claude") throw new Error(`only Claude agents can be moved so far; this one is ${provider}`);
  if (agent.archivedAt) throw new Error("agent is archived; unarchive it first");
  if (agent.status === "running") throw new Error("agent is running; try again when it is idle");
  if (resolve(cwd) === targetDir) throw new Error(`agent is already in ${targetDir}`);

  const fromWorkspace = (await client.fetchWorkspaces({})).entries.find((ws) => ws.id === fromWorkspaceId) ?? null;
  const others = (await client.fetchAgents({})).entries.filter(
    ({ agent: other }) => other.workspaceId === fromWorkspaceId && other.id !== id && !other.archivedAt,
  );
  const alone = others.length === 0;
  const title = (alone && fromWorkspace?.title) || agent.title || "Moved conversation";
  const plan = { agentId: id, provider, sessionId, from: cwd, to: targetDir, fromWorkspaceId, alone, title };
  if (dryRun) {
    console.log(JSON.stringify({ dryRun: true, ...plan }));
    return;
  }

  const movesDir = join(paseoHome, "paseo-folders", "moves");
  mkdirSync(movesDir, { recursive: true });
  const saved = join(movesDir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${id}.json`);
  writeFileSync(saved, `${JSON.stringify({ plan, agent, fromWorkspace }, null, 2)}\n`);

  const created = JSON.parse(run(["workspace", "create", "--isolation", "local", "--path", targetDir, "--title", title, "--json"]));
  const workspaceId = created.workspaceId ?? created.id ?? created.workspace?.id ?? created.workspace?.workspaceId;
  if (!workspaceId) throw new Error("could not read the new workspace id");

  const labels = agent.labels && Object.keys(agent.labels).length > 0 ? agent.labels : undefined;
  // Paseo tells only the connection that deletes an agent (getpaseo/paseo#4870), so a Paseo window
  // showing the conversation would keep its tab. Every window hears about an archive.
  await client.archiveAgent(id);
  try {
    await client.deleteAgent(id);
  } catch (error) {
    // Importing the session where it was brings the archived record back.
    await client.importAgent({ provider, sessionId, workspaceId: fromWorkspaceId, cwd, labels }).catch(() => {});
    run(["workspace", "archive", workspaceId]);
    throw error;
  }
  let moved;
  try {
    moved = await client.importAgent({ provider, sessionId, workspaceId, cwd: targetDir, labels });
  } catch (error) {
    console.error(`Import failed (${error?.message ?? error}). Putting the session back where it was.`);
    try {
      const back = await client.importAgent({ provider, sessionId, workspaceId: fromWorkspaceId, cwd, labels });
      await restoreSettings(client, back.id, agent);
      console.error(`Back in the old workspace as agent ${back.id}.`);
    } catch (backError) {
      console.error(
        `Could not put it back either (${backError?.message ?? backError}). Import session ${sessionId} from Paseo; the old agent is saved in ${saved}.`,
      );
    }
    run(["workspace", "archive", workspaceId]);
    throw error;
  }

  if (moved.workspaceId !== workspaceId) console.error(`warning: the agent landed in workspace ${moved.workspaceId}`);
  await restoreSettings(client, moved.id, agent);
  await carryFolders(client, id, moved.id).catch(warn("carry its folder over in Folders"));
  if (alone) {
    if (fromWorkspace?.pinnedAt) await client.setWorkspacePinned(workspaceId, true).catch(warn("pin the new workspace"));
    await client.archiveWorkspace(fromWorkspaceId).catch(warn("archive the old workspace"));
  }
  console.log(JSON.stringify({ agentId: moved.id, workspaceId, from: cwd, to: targetDir, saved }));
}

const client = new DaemonClient({ url, clientId: "paseo-folders-move", clientType: "cli" });
await client.connect();
try {
  await main(client);
} catch (error) {
  console.error(error?.message ?? error);
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}
