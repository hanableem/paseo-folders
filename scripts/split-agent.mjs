#!/usr/bin/env node
// Moves one agent out of a shared workspace into a new workspace of its own.
//
//   node scripts/split-agent.mjs <agent-id> "<new workspace title>" [--dry-run]
//
// Paseo has no "move tab to workspace" yet. This script creates a local workspace
// in the agent's directory, archives the agent, and imports its provider session
// into the new workspace. Paseo then reuses the same agent record, so the
// conversation, its ID and its history stay intact. If the import fails the agent
// stays archived; unarchive it from Paseo's History.
//
// Experimental: relies on Paseo's internal daemon client. Uses the `paseo` CLI from
// PATH (or PASEO_CLI) and the daemon at PASEO_WS_URL (default ws://127.0.0.1:6767/ws).
import { execFileSync } from "node:child_process";
import { DaemonClient } from "@getpaseo/client/internal/daemon-client";

const cli = process.env.PASEO_CLI || "paseo";
const url = process.env.PASEO_WS_URL || "ws://127.0.0.1:6767/ws";
const [agentId, title, flag] = process.argv.slice(2);
const dryRun = flag === "--dry-run";
if (!agentId || !title) {
  console.error('usage: node scripts/split-agent.mjs <agent-id> "<new workspace title>"');
  process.exit(2);
}
const run = (args) => execFileSync(cli, args, { encoding: "utf8" });

const client = new DaemonClient({ url, clientId: "paseo-folders-split", clientType: "cli" });
await client.connect();
try {
  const fetched = await client.fetchAgent(agentId);
  const agent = fetched?.agent;
  if (!agent) throw new Error(`agent ${agentId} not found`);
  const { id, cwd, provider } = agent;
  const sessionId = agent.persistence?.sessionId;
  if (!cwd || !provider || !sessionId) throw new Error(`missing cwd, provider or session for ${agentId}`);
  if (agent.status === "running") throw new Error("agent is running; try again when it is idle");
  if (dryRun) {
    console.log(JSON.stringify({ dryRun: true, agentId: id, provider, cwd, from: agent.workspaceId }));
    process.exit(0);
  }

  const created = JSON.parse(run(["workspace", "create", "--isolation", "local", "--path", cwd, "--title", title, "--json"]));
  const workspaceId = created.workspaceId ?? created.id ?? created.workspace?.id ?? created.workspace?.workspaceId;
  if (!workspaceId) throw new Error("could not read the new workspace id");

  run(["archive", id]);
  try {
    const imported = await client.importAgent({ provider, sessionId, workspaceId, cwd });
    if (imported.workspaceId !== workspaceId) throw new Error("the agent landed in another workspace");
    console.log(JSON.stringify({ agentId: imported.id, workspaceId, title }));
  } catch (error) {
    run(["workspace", "archive", workspaceId]);
    console.error(`Import failed (${error?.message ?? error}). The agent stays archived; unarchive it from History.`);
    process.exitCode = 1;
  }
} finally {
  await client.close().catch(() => {});
}
