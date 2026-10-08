import type { PluginClientContext, PluginOpenScreenInput } from "@getpaseo/plugin/client";
import { usePaseo, useRpc, useSettings } from "@getpaseo/plugin/client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type FoldersDocument,
  foldersSettings,
  type ListedAgent,
  mergeSuggestions,
  readSuggestionsRpc,
} from "../shared/model";

const PARENT_AGENT_LABEL = "paseo.parent-agent-id";
const REFRESH_MS = 30_000;
const IMPORT_MS = 10 * 60_000;
const PAGE_SIZE = 200;
const MAX_PAGES = 50;

let pluginClient: PluginClientContext | null = null;

export function setPluginClient(client: PluginClientContext | null): void {
  pluginClient = client;
}

/** Screens receive no `openScreen`, so they go through the registered client. */
export function openPluginScreen(input: PluginOpenScreenInput): void {
  pluginClient?.openScreen(input);
}

export interface AgentsState {
  agents: ListedAgent[];
  loading: boolean;
  error: string | null;
  reload(): Promise<void>;
}

/** Every top-level agent on the host, archived ones included. Subagents are left out. */
export function useTopLevelAgents(): AgentsState {
  const paseo = usePaseo();
  const paseoRef = useRef(paseo);
  paseoRef.current = paseo;
  const [agents, setAgents] = useState<ListedAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  const reload = useCallback(async () => {
    try {
      const out: ListedAgent[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const result = await paseoRef.current.agents.list({
          filter: { includeArchived: true },
          page: cursor ? { limit: PAGE_SIZE, cursor } : { limit: PAGE_SIZE },
        });
        for (const { agent, project } of result.entries) {
          if (agent.labels?.[PARENT_AGENT_LABEL]) continue;
          out.push({
            id: agent.id,
            title: agent.title?.trim() || project.workspaceName?.trim() || "Untitled",
            provider: agent.provider,
            workspaceId: agent.workspaceId ?? "",
            workspaceName: project.workspaceName ?? "",
            archived: Boolean(agent.archivedAt),
            activityAt: agent.lastUserMessageAt ?? agent.updatedAt,
          });
        }
        const next = result.pageInfo.nextCursor;
        if (!result.pageInfo.hasMore || !next) break;
        cursor = next;
      }
      if (!alive.current) return;
      setAgents(out);
      setError(null);
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (alive.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void reload();
    const timer = setInterval(() => void reload(), REFRESH_MS);
    return () => {
      alive.current = false;
      clearInterval(timer);
    };
  }, [reload]);

  return { agents, loading, error, reload };
}

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

/** Reads the suggestions file and merges it. Hand-placed conversations are never moved. */
export async function importSuggestions(
  read: ReadSuggestions,
  folders: Extract<FoldersState, { status: "ready" }>,
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
    changed = merged.doc !== doc;
    if (changed) {
      summary = `${merged.placed} placed, ${merged.createdFolders} new folders, ${merged.keptManual} kept where you put them`;
    }
    return merged.doc;
  });
  if (!saved) return { ok: false, changed: false, message: "Import could not be saved. Try again." };
  return { ok: true, changed, message: `Imported: ${summary}` };
}

/** Imports once when folders first load, then every ten minutes while the app is open. */
export function useAutoImport(folders: FoldersState): void {
  const read = useRpc(readSuggestionsRpc);
  const readRef = useRef(read);
  readRef.current = read;
  const latest = useRef(folders);
  latest.current = folders;
  const ready = folders.status === "ready";
  useEffect(() => {
    if (!ready) return;
    let running = false;
    const run = async () => {
      const current = latest.current;
      if (running || current.status !== "ready") return;
      running = true;
      try {
        await importSuggestions(readRef.current, current);
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
