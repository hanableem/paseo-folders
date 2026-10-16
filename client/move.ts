import { useRpc } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import { useCallback, useRef, useState } from "react";
import {
  type FoldersDocument,
  keepFolder,
  type ListedAgent,
  type ListedWorkspace,
  moveConversationRpc,
  renameAgent,
  UNSORTED_ID,
  workspaceFolderOf,
} from "../shared/model";
import { debugLog, type FoldersState } from "./data";

export interface Mover {
  busy: boolean;
  /** Moves every conversation in `source` into `target`, oldest first, then opens `target`. */
  merge(source: ListedWorkspace, target: ListedWorkspace): Promise<void>;
  /** Moves one conversation out of `source` into a new workspace next to it, then opens that. */
  split(source: ListedWorkspace, agent: ListedAgent): Promise<void>;
}

const quoted = (title: string) => `“${title}”`;
const plural = (n: number) => (n === 1 ? "1 conversation" : `${n} conversations`);

/**
 * Merges and splits workspaces through the server's move RPC, one conversation per
 * call, and keeps the workspaces involved in the folders they showed in. A
 * conversation that changes directories gets a new agent ID; its folder and note
 * follow it.
 */
export function useMover(folders: FoldersState, open: (workspaceId: string, title: string) => void): Mover {
  const move = useRpc(moveConversationRpc);
  const toast = useToast();
  const latest = useRef(folders);
  latest.current = folders;
  const running = useRef(false);
  const [busy, setBusy] = useState(false);

  const call = useCallback(
    async (input: { agentId: string; targetWorkspaceId: string | null; title?: string }) => {
      try {
        return await move(input);
      } catch (error) {
        return { ok: false as const, reason: `Paseo did not answer (${error instanceof Error ? error.message : String(error)}).` };
      }
    },
    [move],
  );

  /** Saves folder changes on the latest document; says so when that fails. */
  const save = useCallback(
    async (change: (doc: FoldersDocument) => FoldersDocument) => {
      const current = latest.current;
      if (current.status !== "ready" || !(await current.update(change))) {
        toast.error("Moved, but could not update the folders. Check where the workspaces went.");
      }
    },
    [toast],
  );

  const guard = useCallback(
    async (work: () => Promise<void>) => {
      if (running.current) {
        toast.show("Another move is still going.", { variant: "warning" });
        return;
      }
      running.current = true;
      setBusy(true);
      try {
        await work();
      } finally {
        running.current = false;
        setBusy(false);
      }
    },
    [toast],
  );

  const merge = useCallback(
    (source: ListedWorkspace, target: ListedWorkspace) =>
      guard(async () => {
        const doc = latest.current.status === "ready" ? latest.current.doc : null;
        if (!doc) return;
        const targetFolder = workspaceFolderOf(doc, target);
        const pending = [...source.agents].reverse();
        toast.show(`Moving ${plural(pending.length)} into ${quoted(target.title)}…`, { variant: "info" });
        const moved: Array<{ from: string; to: string }> = [];
        const notes: string[] = [];
        let failure = "";
        for (const agent of pending) {
          const out = await call({ agentId: agent.id, targetWorkspaceId: target.id });
          if (!out.ok) {
            failure = out.reason;
            break;
          }
          moved.push({ from: agent.id, to: out.agentId });
          if (out.note) notes.push(`${quoted(agent.title)}: ${out.note}`);
        }
        debugLog("merge", { moved: moved.length, of: pending.length, failed: Boolean(failure) });
        if (moved.length > 0) {
          await save((d) => {
            let next = d;
            for (const { from, to } of moved) next = renameAgent(next, from, to);
            const agents = [...target.agents, ...moved.map(({ to }) => ({ id: to }))];
            return keepFolder(next, { id: target.id, title: target.title, agents }, targetFolder);
          });
        }
        if (failure) {
          toast.error(moved.length > 0 ? `Moved ${moved.length} of ${pending.length}. ${failure}` : failure);
        } else {
          toast.show(`Merged into ${quoted(target.title)}`, { variant: "success" });
        }
        if (notes.length > 0) toast.show(notes.join(" "), { variant: "warning" });
        if (moved.length > 0) open(target.id, target.title);
      }),
    [guard, call, save, toast, open],
  );

  const split = useCallback(
    (source: ListedWorkspace, agent: ListedAgent) =>
      guard(async () => {
        const doc = latest.current.status === "ready" ? latest.current.doc : null;
        if (!doc) return;
        const folder = workspaceFolderOf(doc, source);
        const out = await call({ agentId: agent.id, targetWorkspaceId: null, title: agent.title });
        debugLog("split", { ok: out.ok });
        if (!out.ok) {
          toast.error(out.reason);
          return;
        }
        await save((d) => {
          const rest = source.agents.filter((a) => a.id !== agent.id);
          let next = keepFolder(d, { id: source.id, title: source.title, agents: rest }, folder);
          if (folder !== UNSORTED_ID) {
            next = keepFolder(next, { id: out.workspaceId, title: agent.title, agents: [{ id: out.agentId }] }, folder);
          }
          return next;
        });
        toast.show(`${quoted(agent.title)} has its own workspace now`, { variant: "success" });
        if (out.note) toast.show(out.note, { variant: "warning" });
        open(out.workspaceId, agent.title);
      }),
    [guard, call, save, toast, open],
  );

  return { busy, merge, split };
}
