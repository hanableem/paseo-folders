import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

/** Agents in no folder are listed under this pseudo-folder. */
export const UNSORTED_ID = "unsorted";

export const FolderSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(60),
});
export type Folder = z.infer<typeof FolderSchema>;

export const FoldersDocumentSchema = z.object({
  /** Display order is array order. */
  folders: z.array(FolderSchema).default([]),
  /**
   * Workspace ID -> folder ID, or UNSORTED_ID when the user took it out of every
   * folder. Folders hold workspaces, as Paseo's own sidebar does.
   */
  workspaceAssignments: z.record(z.string(), z.string()).default({}),
  /** Workspaces the user placed by hand. */
  workspaceManual: z.record(z.string(), z.boolean()).default({}),
  /**
   * Agent ID -> folder ID, usually from a suggestions file. A workspace without
   * its own placement goes where most of its conversations point.
   */
  assignments: z.record(z.string(), z.string()).default({}),
  /** Agents the user placed by hand. Imported suggestions never move them. */
  manual: z.record(z.string(), z.boolean()).default({}),
  /** Agent ID -> one-line note, usually imported from a suggestions file. */
  notes: z.record(z.string(), z.string()).default({}),
  /** Optional override for the suggestions file. Empty means the default location. */
  suggestionsPath: z.string().default(""),
  /** ISO time of the last successful import, for display only. */
  lastImportAt: z.string().default(""),
  /**
   * Workspace ID -> ISO time, for workspaces made from a folder. They start
   * untitled and take their first conversation's title.
   */
  autoTitle: z.record(z.string(), z.string()).default({}),
});
export type FoldersDocument = z.infer<typeof FoldersDocumentSchema>;

export const foldersSettings = defineSettings({
  id: "folders",
  scope: "host",
  version: 1,
  schema: FoldersDocumentSchema,
});

/**
 * A suggestions file lets another tool (for example a script that classifies
 * conversations) propose folders. Folders are matched by name.
 */
export const SuggestionsSchema = z.object({
  version: z.literal(1),
  folders: z.array(z.string().min(1).max(60)).max(200).default([]),
  assignments: z.record(z.string(), z.string().min(1).max(60)).default({}),
  notes: z.record(z.string(), z.string().max(400)).default({}),
  /**
   * Agent IDs the user explicitly re-filed through the other tool. Their suggested
   * folder wins even over a placement made by hand in Paseo.
   */
  force: z.array(z.string()).default([]),
});
export type Suggestions = z.infer<typeof SuggestionsSchema>;

export const readSuggestionsRpc = defineRpc({
  name: "suggestions.read",
  input: z.object({ path: z.string() }),
  output: z.object({
    status: z.enum(["ok", "missing", "invalid"]),
    path: z.string(),
    error: z.string().optional(),
    suggestions: SuggestionsSchema.optional(),
  }),
});

export const readFoldersRpc = defineRpc({
  name: "folders.read",
  input: z.object({}),
  output: FoldersDocumentSchema,
});

/** Temporary interaction log while drag and drop is being tuned; prints to the plugin log only. */
export const debugLogRpc = defineRpc({
  name: "debug.log",
  input: z.object({ event: z.string().max(60), data: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}) }),
  output: z.object({ ok: z.boolean() }),
});

export interface ListedAgent {
  id: string;
  title: string;
  provider: string;
  workspaceId: string;
  workspaceName: string;
  archived: boolean;
  /** Status as Paseo's sidebar shows it. */
  bucket: StatusBucket;
  /** Provider session ID, for the resume command. Empty when unknown. */
  sessionId: string;
  /** ISO time used for sorting: last user message, else last update. */
  activityAt: string;
}

/** Paseo's sidebar status buckets, most urgent first. */
export type StatusBucket = "needs_input" | "failed" | "running" | "attention" | "done";
const BUCKET_PRIORITY: Record<StatusBucket, number> = { needs_input: 0, failed: 1, running: 2, attention: 3, done: 4 };

/** Same rules as Paseo's sidebar: permissions first, then errors, work in progress, unread results. */
export function agentBucket(agent: {
  status: string;
  requiresAttention?: boolean | null;
  attentionReason?: string | null;
  pendingPermissionCount?: number;
}): StatusBucket {
  if ((agent.pendingPermissionCount ?? 0) > 0 || agent.attentionReason === "permission") return "needs_input";
  if (agent.status === "error" || agent.attentionReason === "error") return "failed";
  if (agent.status === "running" || agent.status === "initializing") return "running";
  if (agent.requiresAttention) return "attention";
  return "done";
}

/** A workspace shows its most urgent conversation's status. */
export function workspaceBucket(ws: { agents: readonly { bucket: StatusBucket }[] }): StatusBucket {
  let best: StatusBucket = "done";
  for (const a of ws.agents) if (BUCKET_PRIORITY[a.bucket] < BUCKET_PRIORITY[best]) best = a.bucket;
  return best;
}

const RESUME_COMMANDS: Record<string, string> = {
  claude: "claude --resume {sessionId}",
  codex: "codex resume {sessionId}",
  opencode: "opencode --session {sessionId}",
  pi: "pi --session {sessionId}",
  omp: "omp --session {sessionId}",
  hermes: "hermes --resume {sessionId}",
};

/** The command Paseo's own tab menu copies, or null when the provider or session is unknown. */
export function resumeCommand(provider: string, sessionId: string): string | null {
  const template = RESUME_COMMANDS[provider.split("/")[0]];
  return template && sessionId ? template.replace("{sessionId}", sessionId) : null;
}

/** An active workspace and its active top-level conversations, newest first. */
export interface ListedWorkspace {
  id: string;
  title: string;
  agents: ListedAgent[];
  activityAt: string;
}

export function byRecentActivity<T extends { activityAt: string }>(a: T, b: T): number {
  return b.activityAt.localeCompare(a.activityAt);
}

export function groupWorkspaces(
  agents: readonly ListedAgent[],
  workspaceTitles: ReadonlyMap<string, string>,
): ListedWorkspace[] {
  const byId = new Map<string, ListedAgent[]>();
  for (const agent of agents) {
    if (agent.archived || !agent.workspaceId) continue;
    const list = byId.get(agent.workspaceId) ?? [];
    list.push(agent);
    byId.set(agent.workspaceId, list);
  }
  const out: ListedWorkspace[] = [];
  for (const [id, list] of byId) {
    list.sort(byRecentActivity);
    const title = workspaceTitles.get(id)?.trim() || list[0].title || list[0].workspaceName || "Untitled";
    out.push({ id, title, agents: list, activityAt: list[0].activityAt });
  }
  return out.sort(byRecentActivity);
}

/**
 * The folder a workspace shows in: the user's own placement if any; else, for a
 * workspace holding several conversations and named like a folder, that folder;
 * else the folder most of its conversations point to (ties go to the newest).
 */
export function workspaceFolderOf(doc: FoldersDocument, ws: Pick<ListedWorkspace, "id" | "title" | "agents">): string {
  const explicit = doc.workspaceAssignments[ws.id];
  if (explicit === UNSORTED_ID || (explicit && doc.folders.some((f) => f.id === explicit))) return explicit;
  const named = doc.folders.find((f) => f.name === ws.title.trim());
  if (named && ws.agents.length > 1) return named.id;
  const votes = new Map<string, number>();
  for (const agent of ws.agents) {
    const id = folderOf(doc, agent.id);
    if (id !== UNSORTED_ID) votes.set(id, (votes.get(id) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestVotes = 0;
  for (const agent of ws.agents) {
    const id = folderOf(doc, agent.id);
    const n = votes.get(id) ?? 0;
    if (id !== UNSORTED_ID && n > bestVotes) {
      best = id;
      bestVotes = n;
    }
  }
  return best ?? named?.id ?? UNSORTED_ID;
}

/** Marks a workspace made from a folder, so it takes its first conversation's title. */
export function markAutoTitle(doc: FoldersDocument, workspaceId: string, at: string): FoldersDocument {
  return { ...doc, autoTitle: { ...doc.autoTitle, [workspaceId]: at } };
}

export function withoutAutoTitle(doc: FoldersDocument, workspaceIds: readonly string[]): FoldersDocument {
  if (!workspaceIds.some((id) => id in doc.autoTitle)) return doc;
  const autoTitle = { ...doc.autoTitle };
  for (const id of workspaceIds) delete autoTitle[id];
  return { ...doc, autoTitle };
}

/** The most frequent non-empty value; ties go to the one seen first. */
export function mostCommon(values: readonly string[]): string | null {
  const counts = new Map<string, number>();
  let best: string | null = null;
  for (const v of values) {
    if (!v) continue;
    const n = (counts.get(v) ?? 0) + 1;
    counts.set(v, n);
    if (best === null || n > (counts.get(best) ?? 0)) best = v;
  }
  return best;
}

export type PaseoRoute = { kind: "workspace" | "agent"; id: string } | { kind: "plugin"; pluginId: string };

/**
 * What a Paseo address shows: /h/<host>/workspace/<id>, /h/<host>/agent/<id> or a
 * plugin screen at /h/<host>/plugin/<plugin>/...; null for anything else.
 */
export function parseRoute(path: string): PaseoRoute | null {
  const m = /^\/h\/[^/]+\/(workspace|agent|plugin)\/([^/?#]+)/.exec(path);
  if (!m) return null;
  let id = m[2];
  try {
    id = decodeURIComponent(id);
  } catch {
    // A malformed escape keeps the raw segment.
  }
  return m[1] === "plugin" ? { kind: "plugin", pluginId: id } : { kind: m[1] as "workspace" | "agent", id };
}

export function moveWorkspace(doc: FoldersDocument, workspaceId: string, folderId: string): FoldersDocument {
  return {
    ...doc,
    workspaceAssignments: { ...doc.workspaceAssignments, [workspaceId]: folderId },
    workspaceManual: { ...doc.workspaceManual, [workspaceId]: true },
  };
}

export function countWorkspacesByFolder(
  doc: FoldersDocument,
  workspaces: readonly ListedWorkspace[],
): Record<string, number> {
  const counts: Record<string, number> = { [UNSORTED_ID]: 0 };
  for (const f of doc.folders) counts[f.id] = 0;
  for (const ws of workspaces) {
    const id = workspaceFolderOf(doc, ws);
    counts[id] = (counts[id] ?? 0) + 1;
  }
  return counts;
}

/**
 * A suggestion forced for an agent re-files its workspace too when that
 * workspace holds only this conversation.
 */
export function applyForcedToWorkspaces(
  doc: FoldersDocument,
  forcedAgentIds: readonly string[],
  workspaces: readonly ListedWorkspace[],
): FoldersDocument {
  let next = doc;
  for (const agentId of forcedAgentIds) {
    const ws = workspaces.find((w) => w.agents.length === 1 && w.agents[0].id === agentId);
    if (!ws) continue;
    const target = folderOf(next, agentId);
    if (next.workspaceAssignments[ws.id] !== target) next = moveWorkspace(next, ws.id, target);
  }
  return next;
}

/** Case-insensitive match on the workspace title, its conversation titles and their notes. */
export function matchesWorkspace(ws: ListedWorkspace, notes: Record<string, string>, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (ws.title.toLowerCase().includes(q)) return true;
  return ws.agents.some((a) => a.title.toLowerCase().includes(q) || (notes[a.id] ?? "").toLowerCase().includes(q));
}

export function newFolderId(existing: readonly Folder[]): string {
  const taken = new Set(existing.map((f) => f.id));
  for (;;) {
    const id = `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    if (!taken.has(id) && id !== UNSORTED_ID) return id;
  }
}

/** Folder ID for an agent, or UNSORTED_ID when unassigned or its folder was deleted. */
export function folderOf(doc: FoldersDocument, agentId: string): string {
  const id = doc.assignments[agentId];
  return id && doc.folders.some((f) => f.id === id) ? id : UNSORTED_ID;
}

export function moveAgent(doc: FoldersDocument, agentId: string, folderId: string): FoldersDocument {
  const assignments = { ...doc.assignments };
  if (folderId === UNSORTED_ID) delete assignments[agentId];
  else assignments[agentId] = folderId;
  return { ...doc, assignments, manual: { ...doc.manual, [agentId]: true } };
}

export function addFolder(doc: FoldersDocument, name: string): FoldersDocument {
  const trimmed = name.trim();
  if (!trimmed || doc.folders.some((f) => f.name === trimmed)) return doc;
  return { ...doc, folders: [...doc.folders, { id: newFolderId(doc.folders), name: trimmed }] };
}

export function renameFolder(doc: FoldersDocument, folderId: string, name: string): FoldersDocument {
  const trimmed = name.trim();
  if (!trimmed || doc.folders.some((f) => f.name === trimmed && f.id !== folderId)) return doc;
  return { ...doc, folders: doc.folders.map((f) => (f.id === folderId ? { ...f, name: trimmed } : f)) };
}

/** Deleting a folder sends its workspaces and agents back to Unsorted and lets imports place them again. */
export function deleteFolder(doc: FoldersDocument, folderId: string): FoldersDocument {
  const assignments: Record<string, string> = {};
  const manual = { ...doc.manual };
  for (const [agentId, id] of Object.entries(doc.assignments)) {
    if (id === folderId) delete manual[agentId];
    else assignments[agentId] = id;
  }
  const workspaceAssignments: Record<string, string> = {};
  const workspaceManual = { ...doc.workspaceManual };
  for (const [workspaceId, id] of Object.entries(doc.workspaceAssignments)) {
    if (id === folderId) delete workspaceManual[workspaceId];
    else workspaceAssignments[workspaceId] = id;
  }
  return {
    ...doc,
    folders: doc.folders.filter((f) => f.id !== folderId),
    assignments,
    manual,
    workspaceAssignments,
    workspaceManual,
  };
}

export function moveFolder(doc: FoldersDocument, folderId: string, delta: -1 | 1): FoldersDocument {
  const i = doc.folders.findIndex((f) => f.id === folderId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= doc.folders.length) return doc;
  const folders = [...doc.folders];
  [folders[i], folders[j]] = [folders[j], folders[i]];
  return { ...doc, folders };
}

export interface MergeResult {
  doc: FoldersDocument;
  createdFolders: number;
  placed: number;
  keptManual: number;
}

/** Applies a suggestions file. Hand-placed agents stay where the user put them. */
export function mergeSuggestions(doc: FoldersDocument, s: Suggestions, now: string): MergeResult {
  const folders = [...doc.folders];
  let createdFolders = 0;
  const idByName = new Map(folders.map((f) => [f.name, f.id]));
  const ensure = (name: string): string => {
    const found = idByName.get(name);
    if (found) return found;
    const id = newFolderId(folders);
    folders.push({ id, name });
    idByName.set(name, id);
    createdFolders += 1;
    return id;
  };
  for (const name of s.folders) ensure(name);
  const assignments = { ...doc.assignments };
  const manual = { ...doc.manual };
  const forced = new Set(s.force);
  let placed = 0;
  let keptManual = 0;
  for (const [agentId, name] of Object.entries(s.assignments)) {
    if (doc.manual[agentId] && !forced.has(agentId)) {
      keptManual += 1;
      continue;
    }
    const id = ensure(name);
    if (assignments[agentId] !== id) {
      assignments[agentId] = id;
      placed += 1;
      if (forced.has(agentId)) manual[agentId] = true;
    }
  }
  const notesChanged = Object.entries(s.notes).some(([agentId, note]) => doc.notes[agentId] !== note);
  if (createdFolders === 0 && placed === 0 && !notesChanged) {
    return { doc, createdFolders, placed, keptManual };
  }
  return {
    doc: { ...doc, folders, assignments, manual, notes: { ...doc.notes, ...s.notes }, lastImportAt: now },
    createdFolders,
    placed,
    keptManual,
  };
}

