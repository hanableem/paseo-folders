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
  /** The user's name for Unsorted. Empty means "Unsorted". */
  unsortedName: z.string().max(60).default(""),
  /** How many folders come before Unsorted in the display order. */
  unsortedAt: z.number().int().min(0).default(0),
  /**
   * Old name -> folder ID, for folders the user renamed, so a suggestions file that
   * still uses the old name files into the renamed folder.
   */
  formerFolderNames: z.record(z.string(), z.string()).default({}),
  /** Names of folders the user deleted. Imports do not make them again. */
  deletedFolderNames: z.array(z.string()).default([]),
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

/**
 * Moves one conversation into another workspace, or into a new workspace in its
 * own directory. Refusals come back as `ok: false` with a reason for the user.
 */
export const moveConversationRpc = defineRpc({
  name: "conversation.move",
  input: z.object({
    agentId: z.string().min(1),
    /** Null makes a new workspace in the conversation's own directory. */
    targetWorkspaceId: z.string().min(1).nullable(),
    /** Title for a new workspace. */
    title: z.string().max(200).optional(),
  }),
  output: z.union([
    z.object({
      ok: z.literal(true),
      /** The conversation's agent ID after the move; a new one when it changed directories. */
      agentId: z.string(),
      workspaceId: z.string(),
      /** The workspace it left was empty afterwards and is archived. */
      sourceArchived: z.boolean(),
      /** Settings that could not be carried over, for the user; empty when all went well. */
      note: z.string(),
    }),
    z.object({ ok: z.literal(false), reason: z.string() }),
  ]),
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

/** What decides a workspace's folder: its own placement, its title and its conversations. */
export interface FolderSubject {
  id: string;
  title: string;
  agents: readonly { id: string }[];
}

/**
 * The folder a workspace shows in: the user's own placement if any; else, for a
 * workspace holding several conversations and named like a folder, that folder;
 * else the folder most of its conversations point to (ties go to the newest).
 */
export function workspaceFolderOf(doc: FoldersDocument, ws: FolderSubject): string {
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

/** Carries a conversation's folder, hand placement and note over to the agent ID it got when it moved. */
export function renameAgent(doc: FoldersDocument, from: string, to: string): FoldersDocument {
  if (from === to) return doc;
  const carry = <T>(record: Record<string, T>): Record<string, T> => {
    if (!(from in record)) return record;
    const next = { ...record, [to]: record[from] };
    delete next[from];
    return next;
  };
  return { ...doc, assignments: carry(doc.assignments), manual: carry(doc.manual), notes: carry(doc.notes) };
}

/**
 * Keeps a workspace in the folder it showed in before conversations moved in or
 * out of it, placing it there when its new conversations would point elsewhere.
 */
export function keepFolder(doc: FoldersDocument, ws: FolderSubject, folderId: string): FoldersDocument {
  return workspaceFolderOf(doc, ws) === folderId ? doc : moveWorkspace(doc, ws.id, folderId);
}

/**
 * Workspaces a workspace can merge into, matching the query: those in its own
 * folder first, then the rest, newest first within each.
 */
export function mergeTargets(
  doc: FoldersDocument,
  workspaces: readonly ListedWorkspace[],
  source: ListedWorkspace,
  query: string,
): ListedWorkspace[] {
  const folder = workspaceFolderOf(doc, source);
  const matches = workspaces.filter((ws) => ws.id !== source.id && matchesWorkspace(ws, doc.notes, query));
  const near = matches.filter((ws) => workspaceFolderOf(doc, ws) === folder);
  const far = matches.filter((ws) => workspaceFolderOf(doc, ws) !== folder);
  return [...near.sort(byRecentActivity), ...far.sort(byRecentActivity)];
}

/** What is dragged in the sidebar: a whole workspace, or one of its conversations. */
export type DragSubject =
  | { kind: "workspace"; ws: ListedWorkspace }
  | { kind: "conversation"; ws: ListedWorkspace; agent: ListedAgent };

/** A row a drag can land on. A conversation row counts as its workspace. */
export interface DropTarget {
  kind: "folder" | "workspace";
  id: string;
}

/**
 * What a drop does: file a workspace in a folder, move conversations into another
 * workspace (all of a dragged workspace's, or the one dragged conversation), or
 * give a dragged conversation a workspace of its own in a folder.
 */
export type DropAction =
  | { kind: "file"; folderId: string }
  | { kind: "merge"; workspaceId: string }
  | { kind: "split"; folderId: string };

/** What dropping `subject` on `target` does, or null when it would change nothing. */
export function dropAction(doc: FoldersDocument, subject: DragSubject, target: DropTarget | null): DropAction | null {
  if (!target) return null;
  if (target.kind === "folder") {
    if (subject.kind === "conversation") return { kind: "split", folderId: target.id };
    return workspaceFolderOf(doc, subject.ws) === target.id ? null : { kind: "file", folderId: target.id };
  }
  if (target.id === subject.ws.id || subject.ws.agents.length === 0) return null;
  return { kind: "merge", workspaceId: target.id };
}

const DROP_ID_PREFIX = "paseo-folders-drop:";

/**
 * The element ID that marks a sidebar row as a drop target, so a drop is matched
 * to whatever row is under the pointer when it lands. `part` tells apart several
 * rows of one target.
 */
export function dropNodeId(target: DropTarget, part = ""): string {
  const tail = part ? `:${encodeURIComponent(part)}` : "";
  return `${DROP_ID_PREFIX}${target.kind}:${encodeURIComponent(target.id)}${tail}`;
}

/** The drop target an element ID from `dropNodeId` marks; null for any other ID. */
export function parseDropNodeId(id: string | null | undefined): DropTarget | null {
  if (!id?.startsWith(DROP_ID_PREFIX)) return null;
  const [kind, raw] = id.slice(DROP_ID_PREFIX.length).split(":");
  if ((kind !== "folder" && kind !== "workspace") || !raw) return null;
  try {
    return { kind, id: decodeURIComponent(raw) };
  } catch {
    return null;
  }
}

export function isDropNodeId(id: string): boolean {
  return id.startsWith(DROP_ID_PREFIX);
}

/** Directories match when they differ only by trailing slashes; the server compares real paths. */
export function sameDirectory(a: string, b: string): boolean {
  const plain = (p: string) => p.replace(/\/+$/, "") || "/";
  return plain(a) === plain(b);
}

/** Where a workspace works: its directory, and its project's name when Paseo knows it. */
export interface Place {
  directory: string;
  projectName: string;
}

/** Names for two places that tell them apart: project names when those differ, else the directories. */
export function placeNames(from: Place, to: Place): [string, string] {
  const short = (p: string) => p.replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, "~");
  const a = from.projectName.trim();
  const b = to.projectName.trim();
  if (a && b && a !== b) return [a, b];
  return [short(from.directory), short(to.directory)];
}

/** A folder's name. Unsorted's is the one the user gave it, or "Unsorted". */
export function folderName(doc: FoldersDocument, folderId: string): string {
  if (folderId === UNSORTED_ID) return doc.unsortedName.trim() || "Unsorted";
  return doc.folders.find((f) => f.id === folderId)?.name ?? "";
}

/** The folders in display order, with Unsorted (id UNSORTED_ID) in its place. */
export function folderOrder(doc: FoldersDocument): Folder[] {
  const at = Math.min(doc.unsortedAt, doc.folders.length);
  return [...doc.folders.slice(0, at), { id: UNSORTED_ID, name: folderName(doc, UNSORTED_ID) }, ...doc.folders.slice(at)];
}

/** Whether another folder, or Unsorted, already uses `name`. */
function nameTaken(doc: FoldersDocument, name: string, exceptId?: string): boolean {
  return folderOrder(doc).some((f) => f.name === name && f.id !== exceptId);
}

/** A name the user gives a folder no longer stands for a renamed or a deleted one. */
function claimName(doc: FoldersDocument, name: string): FoldersDocument {
  if (!(name in doc.formerFolderNames) && !doc.deletedFolderNames.includes(name)) return doc;
  const formerFolderNames = { ...doc.formerFolderNames };
  delete formerFolderNames[name];
  return { ...doc, formerFolderNames, deletedFolderNames: doc.deletedFolderNames.filter((n) => n !== name) };
}

/** Adds a folder at the end of the list, or right after folder `after`, which may be Unsorted. */
export function addFolder(doc: FoldersDocument, name: string, after?: string): FoldersDocument {
  const trimmed = name.trim();
  if (!trimmed || nameTaken(doc, trimmed)) return doc;
  const folder = { id: newFolderId(doc.folders), name: trimmed };
  const added = { ...claimName(doc, trimmed), folders: [...doc.folders, folder] };
  const index = after === undefined ? -1 : folderOrder(doc).findIndex((f) => f.id === after);
  return index < 0 ? added : moveFolder(added, folder.id, index + 1);
}

/**
 * Renames a folder, or Unsorted; refuses a name another one uses. A folder's old
 * name keeps leading imports to it.
 */
export function renameFolder(doc: FoldersDocument, folderId: string, name: string): FoldersDocument {
  const trimmed = name.trim();
  if (!trimmed || nameTaken(doc, trimmed, folderId)) return doc;
  // Naming it "Unsorted" again goes back to the default.
  if (folderId === UNSORTED_ID) return { ...doc, unsortedName: trimmed === "Unsorted" ? "" : trimmed };
  const old = doc.folders.find((f) => f.id === folderId)?.name;
  if (old === undefined || old === trimmed) return doc;
  const renamed = claimName(doc, trimmed);
  return {
    ...renamed,
    folders: doc.folders.map((f) => (f.id === folderId ? { ...f, name: trimmed } : f)),
    formerFolderNames: { ...renamed.formerFolderNames, [old]: folderId },
  };
}

/**
 * Deleting a folder sends its workspaces and agents back to Unsorted, where imports
 * may place them in other folders. Imports do not make the folder again, under its
 * name or a former one, until the user makes a folder with that name. Unsorted
 * itself cannot be deleted.
 */
export function deleteFolder(doc: FoldersDocument, folderId: string): FoldersDocument {
  const index = doc.folders.findIndex((f) => f.id === folderId);
  if (index < 0) return doc;
  const deleted = new Set(doc.deletedFolderNames).add(doc.folders[index].name);
  const formerFolderNames: Record<string, string> = {};
  for (const [name, id] of Object.entries(doc.formerFolderNames)) {
    if (id === folderId) deleted.add(name);
    else formerFolderNames[name] = id;
  }
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
    // Unsorted keeps its place among the folders that are left.
    unsortedAt: index < doc.unsortedAt ? doc.unsortedAt - 1 : doc.unsortedAt,
    assignments,
    manual,
    workspaceAssignments,
    workspaceManual,
    formerFolderNames,
    deletedFolderNames: [...deleted],
  };
}

/** `list` with item `id` moved to position `index`, clamped to the ends; `list` itself when it stays put. */
export function moveInList<T extends { id: string }>(list: T[], id: string, index: number): T[] {
  const from = list.findIndex((item) => item.id === id);
  const to = Math.max(0, Math.min(list.length - 1, Math.round(index)));
  if (from < 0 || to === from) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** Moves a folder, or Unsorted, to position `index` in folderOrder; `doc` itself when it stays put. */
export function moveFolder(doc: FoldersDocument, folderId: string, index: number): FoldersDocument {
  const order = folderOrder(doc);
  const next = moveInList(order, folderId, index);
  if (next === order) return doc;
  const unsortedAt = next.findIndex((f) => f.id === UNSORTED_ID);
  return { ...doc, folders: next.filter((f) => f.id !== UNSORTED_ID), unsortedAt };
}

/**
 * Moves a folder to position `target` among `shown`, the folders on screen in display
 * order, which can run ahead of the saved order while a reorder is being saved, or
 * leave folders out. It goes just above the shown folder that follows it, or just
 * below the one before it at the end, so a folder not shown stays beside one of its
 * neighbours.
 */
export function moveFolderAmong(
  doc: FoldersDocument,
  shown: readonly string[],
  folderId: string,
  target: number,
): FoldersDocument {
  const next = moveInList(shown.map((id) => ({ id })), folderId, target).map((f) => f.id);
  const at = next.indexOf(folderId);
  if (at < 0) return doc;
  const rest = folderOrder(doc)
    .map((f) => f.id)
    .filter((id) => id !== folderId);
  const below = next[at + 1];
  const neighbour = below ?? next[at - 1];
  const place = neighbour === undefined ? -1 : rest.indexOf(neighbour);
  if (place < 0) return doc;
  return moveFolder(doc, folderId, below === undefined ? place + 1 : place);
}

/**
 * Where a row dragged by `dy` from position `from` would land among rows laid out
 * at `rows` (tops and heights, in list order). It passes a neighbour once it covers
 * half of it: a row above stays above while its middle is above the dragged row's
 * top, and a row below moves above once its middle is above the dragged row's bottom.
 */
export function reorderTarget(rows: readonly { y: number; height: number }[], from: number, dy: number): number {
  const dragged = rows[from];
  if (!dragged) return from;
  const top = dragged.y + dy;
  const bottom = top + dragged.height;
  return rows.filter((row, i) => {
    const middle = row.y + row.height / 2;
    return i < from ? middle < top : i > from && middle < bottom;
  }).length;
}

export interface MergeResult {
  doc: FoldersDocument;
  createdFolders: number;
  placed: number;
  keptManual: number;
  /** Agents suggested for a folder the user deleted, left where they were. */
  forDeletedFolders: number;
}

/**
 * Applies a suggestions file. Hand-placed agents stay where the user put them. A
 * renamed folder still answers to its old name; a folder the user deleted is not
 * made again, and agents suggested for it stay where they are.
 */
export function mergeSuggestions(doc: FoldersDocument, s: Suggestions, now: string): MergeResult {
  const folders = [...doc.folders];
  let createdFolders = 0;
  const idByName = new Map<string, string>();
  for (const [name, id] of Object.entries(doc.formerFolderNames)) {
    if (folders.some((f) => f.id === id)) idByName.set(name, id);
  }
  // A folder's current name wins over another folder's former one.
  for (const f of folders) idByName.set(f.name, f.id);
  const deleted = new Set(doc.deletedFolderNames);
  const ensure = (name: string): string | null => {
    const found = idByName.get(name);
    if (found) return found;
    if (deleted.has(name)) return null;
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
  let forDeletedFolders = 0;
  for (const [agentId, name] of Object.entries(s.assignments)) {
    if (doc.manual[agentId] && !forced.has(agentId)) {
      keptManual += 1;
      continue;
    }
    const id = ensure(name);
    if (id === null) {
      forDeletedFolders += 1;
      continue;
    }
    if (assignments[agentId] !== id) {
      assignments[agentId] = id;
      placed += 1;
      if (forced.has(agentId)) manual[agentId] = true;
    }
  }
  const notesChanged = Object.entries(s.notes).some(([agentId, note]) => doc.notes[agentId] !== note);
  if (createdFolders === 0 && placed === 0 && !notesChanged) {
    return { doc, createdFolders, placed, keptManual, forDeletedFolders };
  }
  return {
    doc: { ...doc, folders, assignments, manual, notes: { ...doc.notes, ...s.notes }, lastImportAt: now },
    createdFolders,
    placed,
    keptManual,
    forDeletedFolders,
  };
}

