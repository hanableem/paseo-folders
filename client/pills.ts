import type { PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { type FoldersDocument, folderOf, readFoldersRpc, UNSORTED_ID } from "../shared/model";
import { FolderPicker } from "./picker";

const PARENT_AGENT_LABEL = "paseo.parent-agent-id";
const FOLDERS_POLL_MS = 10_000;
const AGENT_PAGE_LIMIT = 500;

interface AgentLike {
  id: string;
  workspaceId?: string | null;
  archivedAt?: string | null;
  labels?: Record<string, string> | null;
}

let refreshHook: (() => void) | null = null;

/** Called after a move so pill labels update without waiting for the next poll. */
export function refreshFolderPills(): void {
  refreshHook?.();
}

/**
 * Adds a folder pill beside every active top-level agent's composer. The pill
 * shows the agent's folder and opens a picker to move it.
 */
export function startFolderPills(client: PluginClientContext): () => void {
  let stopped = false;
  const lifetime = new AbortController();
  const agents = new Map<string, string>(); // agent ID -> workspace ID
  const pills = new Map<string, { reg: PluginButtonRegistration; label: string; workspaceId: string }>();
  let doc: FoldersDocument | null = null;

  const labelFor = (agentId: string): string => {
    if (!doc) return "Folder";
    const id = folderOf(doc, agentId);
    if (id === UNSORTED_ID) return "No folder";
    return doc.folders.find((f) => f.id === id)?.name ?? "No folder";
  };

  const sync = () => {
    if (stopped) return;
    for (const [agentId, workspaceId] of agents) {
      const label = labelFor(agentId);
      const existing = pills.get(agentId);
      if (existing && existing.workspaceId === workspaceId) {
        if (existing.label !== label) {
          existing.reg.update({ label });
          existing.label = label;
        }
        continue;
      }
      existing?.reg.remove();
      try {
        const reg = client.addComposerPill({
          id: "folder",
          workspaceId,
          agentId,
          button: {
            title: "Move to folder",
            icon: "Folder",
            label,
            behavior: { kind: "popover", Content: FolderPicker },
          },
        });
        pills.set(agentId, { reg, label, workspaceId });
      } catch (error) {
        console.warn("Folders: could not add a pill", agentId, error);
      }
    }
    for (const [agentId, pill] of pills) {
      if (!agents.has(agentId)) {
        pill.reg.remove();
        pills.delete(agentId);
      }
    }
  };

  const track = (agent: AgentLike) => {
    if (!agent.workspaceId || agent.archivedAt || agent.labels?.[PARENT_AGENT_LABEL]) agents.delete(agent.id);
    else agents.set(agent.id, agent.workspaceId);
  };

  const loadFolders = async () => {
    try {
      doc = await client.rpc(readFoldersRpc, {});
      sync();
    } catch (error) {
      if (!stopped) console.warn("Folders: could not read folders", error);
    }
  };

  refreshHook = () => void loadFolders();
  void loadFolders();
  const timer = setInterval(() => void loadFolders(), FOLDERS_POLL_MS);

  void client.paseo.agents
    .list({ subscribe: {}, page: { limit: AGENT_PAGE_LIMIT }, signal: lifetime.signal })
    .then(({ subscription }) => {
      subscription?.subscribe({
        snapshot: ({ entries }) => {
          agents.clear();
          for (const { agent } of entries) track(agent);
          sync();
        },
        update: (message) => {
          if (message.type !== "agent_update") return;
          const update = message.payload;
          if (update.kind === "remove") agents.delete(update.agentId);
          else track(update.agent);
          sync();
        },
      });
    })
    .catch((error) => {
      if (!stopped) console.warn("Folders: agent observation failed", error);
    });

  return () => {
    stopped = true;
    lifetime.abort();
    clearInterval(timer);
    refreshHook = null;
    for (const pill of pills.values()) pill.reg.remove();
    pills.clear();
  };
}
