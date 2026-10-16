import type { PluginClientContext } from "@getpaseo/plugin/client";
import { usePaseo, useRpc, useSettings } from "@getpaseo/plugin/client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  agentBucket,
  applyForcedToWorkspaces,
  debugLogRpc,
  type FoldersDocument,
  foldersSettings,
  groupWorkspaces,
  type ListedAgent,
  type ListedWorkspace,
  mergeSuggestions,
  readSuggestionsRpc,
  withoutAutoTitle,
} from "../shared/model";

const PARENT_AGENT_LABEL = "paseo.parent-agent-id";
const IMPORT_MS = 10 * 60_000;
/** A workspace made from a folder stops waiting for a title after a day. */
const AUTO_TITLE_MS = 24 * 60 * 60_000;
const PAGE_SIZE = 200;
const MAX_PAGES = 50;

let pluginClient: PluginClientContext | null = null;

export function setPluginClient(client: PluginClientContext | null): void {
  pluginClient = client;
}

/** Fire-and-forget interaction log for tuning; never includes titles or notes. */
export function debugLog(event: string, data: Record<string, string | number | boolean | null> = {}): void {
  void pluginClient?.rpc(debugLogRpc, { event, data }).catch(() => undefined);
}

export type PaseoApi = ReturnType<typeof usePaseo>;

export interface WorkspaceMeta {
  /** The workspace's own title; empty while it has none. */
  title: string;
  directory: string;
  branch: string;
  /** Root of the project the workspace belongs to. */
  projectRoot: string;
  projectId: string;
}

export interface Directory {
  /** Every top-level agent, archived ones included. Subagents are left out. */
  agents: ListedAgent[];
  workspaceTitles: Map<string, string>;
  workspaceMeta: Map<string, WorkspaceMeta>;
}

/** Lists agents and workspace titles. Used by hooks and by the header-button controller. */
export async function fetchDirectory(paseo: PaseoApi): Promise<Directory> {
  const workspaceMeta = await listWorkspaceMeta(paseo);
  const workspaceTitles = titlesOf(workspaceMeta);
  const agents: ListedAgent[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await paseo.agents.list({
      filter: { includeArchived: true },
      page: cursor ? { limit: PAGE_SIZE, cursor } : { limit: PAGE_SIZE },
    });
    for (const { agent, project } of result.entries) {
      if (agent.labels?.[PARENT_AGENT_LABEL]) continue;
      agents.push({
        id: agent.id,
        title: agent.title?.trim() || "Untitled",
        provider: agent.provider,
        workspaceId: agent.workspaceId ?? "",
        workspaceName: project.workspaceName ?? "",
        archived: Boolean(agent.archivedAt),
        bucket: agentBucket({
          status: agent.status,
          requiresAttention: agent.requiresAttention,
          attentionReason: agent.attentionReason,
          pendingPermissionCount: agent.pendingPermissions?.length ?? 0,
        }),
        sessionId: agent.persistence?.sessionId ?? "",
        activityAt: agent.lastUserMessageAt ?? agent.updatedAt,
      });
    }
    const next = result.pageInfo.nextCursor;
    if (!result.pageInfo.hasMore || !next) break;
    cursor = next;
  }
  return { agents, workspaceTitles, workspaceMeta };
}

function titlesOf(meta: Map<string, WorkspaceMeta>): Map<string, string> {
  const titles = new Map<string, string>();
  for (const [id, m] of meta) if (m.title) titles.set(id, m.title);
  return titles;
}

/** Workspace ID -> title, directory and branch. Archived workspaces may be missing. */
async function listWorkspaceMeta(paseo: PaseoApi): Promise<Map<string, WorkspaceMeta>> {
  const meta = new Map<string, WorkspaceMeta>();
  try {
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const result = await paseo.workspaces.list({
        page: cursor ? { limit: PAGE_SIZE, cursor } : { limit: PAGE_SIZE },
      });
      for (const ws of result.entries) {
        meta.set(ws.id, {
          title: ws.title?.trim() ?? "",
          directory: ws.workspaceDirectory ?? ws.projectRootPath ?? "",
          branch: ws.gitRuntime?.currentBranch ?? "",
          projectRoot: ws.projectRootPath ?? ws.workspaceDirectory ?? "",
          projectId: ws.projectId ?? "",
        });
      }
      const next = result.pageInfo?.nextCursor;
      if (!result.pageInfo?.hasMore || !next) break;
      cursor = next;
    }
  } catch {
    // Titles and paths are extras; workspaces still list with their conversation titles.
  }
  return meta;
}

export interface DirectoryState {
  agents: ListedAgent[];
  workspaceMeta: Map<string, WorkspaceMeta>;
  /** Active workspaces with their active conversations, newest first. */
  workspaces: ListedWorkspace[];
  loading: boolean;
  error: string | null;
  reload(): Promise<void>;
}

type AgentPayload = {
  id: string;
  title: string | null;
  provider: string;
  workspaceId?: string;
  archivedAt?: string | null;
  status: string;
  requiresAttention?: boolean;
  attentionReason?: string | null;
  pendingPermissions?: readonly unknown[];
  persistence?: { sessionId?: string } | null;
  lastUserMessageAt: string | null;
  updatedAt: string;
  labels?: Record<string, string>;
};

function toListed(agent: AgentPayload, workspaceName: string): ListedAgent {
  return {
    id: agent.id,
    title: agent.title?.trim() || "Untitled",
    provider: agent.provider,
    workspaceId: agent.workspaceId ?? "",
    workspaceName,
    archived: Boolean(agent.archivedAt),
    bucket: agentBucket({
      status: agent.status,
      requiresAttention: agent.requiresAttention,
      attentionReason: agent.attentionReason,
      pendingPermissionCount: agent.pendingPermissions?.length ?? 0,
    }),
    sessionId: agent.persistence?.sessionId ?? "",
    activityAt: agent.lastUserMessageAt ?? agent.updatedAt,
  };
}

/**
 * Live directory: agents arrive through Paseo's agent subscription, so running
 * spinners and attention dots follow the daemon without polling. Workspace
 * titles refresh every minute.
 */
export function useDirectory(): DirectoryState {
  const paseo = usePaseo();
  const paseoRef = useRef(paseo);
  paseoRef.current = paseo;
  const [agentMap, setAgentMap] = useState<ReadonlyMap<string, ListedAgent>>(new Map());
  const [workspaceMeta, setWorkspaceMeta] = useState<Map<string, WorkspaceMeta>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    let stopped = false;
    const lifetime = new AbortController();
    const map = new Map<string, ListedAgent>();
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      flushTimer = null;
      if (!stopped) setAgentMap(new Map(map));
    };
    const scheduleFlush = () => {
      if (flushTimer === null) flushTimer = setTimeout(flush, 250);
    };
    const put = (agent: AgentPayload, workspaceName?: string) => {
      if (agent.labels?.[PARENT_AGENT_LABEL]) {
        map.delete(agent.id);
        return;
      }
      map.set(agent.id, toListed(agent, workspaceName ?? map.get(agent.id)?.workspaceName ?? ""));
    };
    let unsubscribe: (() => void) | null = null;
    paseoRef.current.agents
      .list({ subscribe: {}, filter: { includeArchived: true }, page: { limit: PAGE_SIZE }, signal: lifetime.signal })
      .then((result) => {
        if (stopped) return;
        debugLog("dir-list", { entries: result.entries.length, more: result.pageInfo.hasMore, sub: Boolean(result.subscription) });
        // Seed from the first answer; the subscription only carries later changes and re-snapshots.
        map.clear();
        for (const { agent, project } of result.entries) put(agent, project.workspaceName ?? "");
        flush();
        setLoading(false);
        setError(null);
        unsubscribe = result.subscription.subscribe({
          snapshot: ({ entries }) => {
            debugLog("dir-snapshot", { entries: entries.length });
            map.clear();
            for (const { agent, project } of entries) put(agent, project.workspaceName ?? "");
            flush();
          },
          update: (message) => {
            if (message.type !== "agent_update") return;
            const update = message.payload;
            if (update.kind === "remove") map.delete(update.agentId);
            else put(update.agent);
            scheduleFlush();
          },
          error: (e) => {
            if (!stopped) setError(e instanceof Error ? e.message : String(e));
          },
        });
      })
      .catch((e) => {
        if (stopped) return;
        debugLog("dir-error", { message: String(e instanceof Error ? e.message : e).slice(0, 200) });
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });

    // The live list covers one page (Paseo allows at most 200). A full pass each
    // minute picks up anything beyond it, drops conversations the daemon no longer
    // has (deleted ones have lingered in the live list) and refreshes workspace titles.
    const reconcile = async () => {
      try {
        const known = new Set(map.keys());
        const full = await fetchDirectory(paseoRef.current);
        if (stopped) return;
        setWorkspaceMeta(full.workspaceMeta);
        const listed = new Set(full.agents.map((agent) => agent.id));
        let dropped = 0;
        for (const id of known) {
          if (!listed.has(id) && map.delete(id)) dropped += 1;
        }
        if (dropped > 0) debugLog("dir-drop", { dropped });
        for (const agent of full.agents) if (!map.has(agent.id)) map.set(agent.id, agent);
        flush();
        setLoading(false);
      } catch (e) {
        if (!stopped) debugLog("dir-reconcile-error", { message: String(e instanceof Error ? e.message : e).slice(0, 200) });
      }
    };
    void reconcile();
    const titleTimer = setInterval(() => void reconcile(), 60_000);
    return () => {
      stopped = true;
      lifetime.abort();
      unsubscribe?.();
      if (flushTimer !== null) clearTimeout(flushTimer);
      clearInterval(titleTimer);
    };
  }, [generation]);

  const agents = useMemo(() => [...agentMap.values()], [agentMap]);
  const workspaces = useMemo(() => groupWorkspaces(agents, titlesOf(workspaceMeta)), [agents, workspaceMeta]);
  const reload = useCallback(async () => setGeneration((g) => g + 1), []);
  return { agents, workspaceMeta, workspaces, loading, error, reload };
}

export type ReadyFolders = Extract<FoldersState, { status: "ready" }>;

export type FoldersState =
  | { status: "loading" | "error" | "invalid"; message: string }
  | {
      status: "ready";
      doc: FoldersDocument;
      saving: boolean;
      /** Applies `change` to the latest saved document. Returns false if the save failed. */
      update(change: (doc: FoldersDocument) => FoldersDocument): Promise<boolean>;
    };

export function useFolders(): FoldersState {
  const settings = useSettings(foldersSettings);
  if (settings.status === "loading") return { status: "loading", message: "Loading folders…" };
  if (settings.status === "error") return { status: "error", message: String(settings.error) };
  if (settings.status === "invalid") {
    return { status: "invalid", message: "Saved folder data is invalid. Reset it in Settings → Plugins." };
  }
  const doc = settings.values as FoldersDocument;
  return {
    status: "ready",
    doc,
    saving: settings.saving,
    async update(change) {
      const next = change(doc);
      if (next === doc) return true;
      return settings.save(next, settings.revision);
    },
  };
}

export function formatDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

type ReadSuggestions = ReturnType<typeof useRpc<typeof readSuggestionsRpc.input, typeof readSuggestionsRpc.output>>;

export interface ImportOutcome {
  ok: boolean;
  changed: boolean;
  message: string;
}

/** Reads the suggestions file and merges it. Hand-placed conversations and workspaces are never moved. */
export async function importSuggestions(
  read: ReadSuggestions,
  folders: ReadyFolders,
  workspaces: readonly ListedWorkspace[],
): Promise<ImportOutcome> {
  const res = await read({ path: folders.doc.suggestionsPath });
  if (res.status === "missing") return { ok: false, changed: false, message: `No suggestions file at ${res.path}` };
  if (res.status === "invalid" || !res.suggestions) {
    return { ok: false, changed: false, message: `Could not read ${res.path}: ${res.error ?? "invalid file"}` };
  }
  const suggestions = res.suggestions;
  let summary = "nothing new";
  let changed = false;
  const saved = await folders.update((doc) => {
    const merged = mergeSuggestions(doc, suggestions, new Date().toISOString());
    const next = applyForcedToWorkspaces(merged.doc, suggestions.force, workspaces);
    changed = next !== doc;
    if (changed) {
      summary = `${merged.placed} placed, ${merged.createdFolders} new folders, ${merged.keptManual} kept where you put them`;
    }
    return next;
  });
  if (!saved) return { ok: false, changed: false, message: "Import could not be saved. Try again." };
  return { ok: true, changed, message: `Imported: ${summary}` };
}

/** Imports once workspaces have loaded, then every ten minutes while the app is open. */
export function useAutoImport(folders: FoldersState, workspaces: readonly ListedWorkspace[], loaded: boolean): void {
  const read = useRpc(readSuggestionsRpc);
  const readRef = useRef(read);
  readRef.current = read;
  const latest = useRef({ folders, workspaces });
  latest.current = { folders, workspaces };
  const ready = folders.status === "ready" && loaded;
  useEffect(() => {
    if (!ready) return;
    let running = false;
    const run = async () => {
      const current = latest.current;
      if (running || current.folders.status !== "ready") return;
      running = true;
      try {
        await importSuggestions(readRef.current, current.folders, current.workspaces);
      } catch {
        // A missing daemon or RPC failure only delays the next attempt.
      } finally {
        running = false;
      }
    };
    void run();
    const timer = setInterval(() => void run(), IMPORT_MS);
    return () => clearInterval(timer);
  }, [ready]);
}

/**
 * Paseo names a workspace after the prompt it was created with. A workspace made
 * from a folder starts empty, so once its first conversation has answered, it
 * takes that conversation's title. Workspaces that already have a title, or
 * that the user renamed, are left alone.
 */
export function useAutoTitle(
  folders: FoldersState,
  workspaces: readonly ListedWorkspace[],
  meta: ReadonlyMap<string, WorkspaceMeta>,
): void {
  const paseo = usePaseo();
  const busy = useRef(false);
  useEffect(() => {
    if (folders.status !== "ready" || busy.current) return;
    const waiting = Object.entries(folders.doc.autoTitle);
    if (waiting.length === 0) return;
    const now = Date.now();
    const settled: string[] = [];
    const titles: Array<[string, string]> = [];
    for (const [id, since] of waiting) {
      const own = meta.get(id)?.title;
      if (own || !(now - Date.parse(since) < AUTO_TITLE_MS)) {
        settled.push(id);
        continue;
      }
      const agents = workspaces.find((ws) => ws.id === id)?.agents ?? [];
      const first = agents[agents.length - 1];
      // Wait for fresh metadata and for the first answer, which settles the conversation's title.
      if (!meta.has(id) || !first || first.bucket === "running" || first.title === "Untitled") continue;
      titles.push([id, first.title]);
      settled.push(id);
    }
    if (settled.length === 0) return;
    busy.current = true;
    void (async () => {
      for (const [id, title] of titles) {
        try {
          await paseo.workspaces.ref(id).setTitle(title);
        } catch {
          // Left untitled; it can still be renamed from the menu.
        }
      }
      await folders.update((doc) => withoutAutoTitle(doc, settled));
    })().finally(() => {
      busy.current = false;
    });
  }, [folders, workspaces, meta, paseo]);
}
