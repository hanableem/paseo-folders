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
  /** Agent ID -> folder ID. */
  assignments: z.record(z.string(), z.string()).default({}),
  /** Agents the user placed by hand. Imported suggestions never move them. */
  manual: z.record(z.string(), z.boolean()).default({}),
  /** Agent ID -> one-line note, usually imported from a suggestions file. */
  notes: z.record(z.string(), z.string()).default({}),
  /** Optional override for the suggestions file. Empty means the default location. */
  suggestionsPath: z.string().default(""),
  /** ISO time of the last successful import, for display only. */
  lastImportAt: z.string().default(""),
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

export interface ListedAgent {
  id: string;
  title: string;
  provider: string;
  workspaceId: string;
  workspaceName: string;
  archived: boolean;
  /** ISO time used for sorting: last user message, else last update. */
  activityAt: string;
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

export function countByFolder(doc: FoldersDocument, agents: readonly ListedAgent[]): Record<string, number> {
  const counts: Record<string, number> = { [UNSORTED_ID]: 0 };
  for (const f of doc.folders) counts[f.id] = 0;
  for (const a of agents) {
    const id = folderOf(doc, a.id);
    counts[id] = (counts[id] ?? 0) + 1;
  }
  return counts;
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

/** Deleting a folder sends its agents back to Unsorted and lets imports place them again. */
export function deleteFolder(doc: FoldersDocument, folderId: string): FoldersDocument {
  const assignments: Record<string, string> = {};
  const manual = { ...doc.manual };
  for (const [agentId, id] of Object.entries(doc.assignments)) {
    if (id === folderId) delete manual[agentId];
    else assignments[agentId] = id;
  }
  return { ...doc, folders: doc.folders.filter((f) => f.id !== folderId), assignments, manual };
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

/** Case-insensitive match on title, workspace name and note. */
export function matchesQuery(agent: ListedAgent, note: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [agent.title, agent.workspaceName, note].some((t) => t.toLowerCase().includes(q));
}

export function byRecentActivity(a: ListedAgent, b: ListedAgent): number {
  return b.activityAt.localeCompare(a.activityAt);
}
