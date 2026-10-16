import { usePaseo, useRpc } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type FoldersDocument,
  keepFolder,
  type ListedAgent,
  type ListedWorkspace,
  moveConversationRpc,
  moveWorkspace,
  placeNames,
  renameAgent,
  sameDirectory,
  UNSORTED_ID,
  workspaceFolderOf,
} from "../shared/model";
import { debugLog, type FoldersState, listWorkspaceMeta, type WorkspaceMeta } from "./data";

/** A question to answer before a move goes ahead; `MoveConfirm` shows it. */
export interface MoveQuestion {
  title: string;
  message: string;
  /** Label of the button that goes ahead. */
  action: string;
}

export interface Mover {
  busy: boolean;
  /** The question on screen, if any. */
  question: MoveQuestion | null;
  answer(ok: boolean): void;
  /**
   * Moves conversations from `source` into `target`, oldest first, then opens
   * `target`: those in `agentIds`, or all of them. Asks first when they would
   * change project. Resolves to whether anything moved.
   */
  merge(source: ListedWorkspace, target: ListedWorkspace, agentIds?: readonly string[]): Promise<boolean>;
  /**
   * Moves one conversation out of `source` into a new workspace next to it, then
   * opens that. The new workspace goes in `folderId`, or by default in the
   * folder `source` shows in.
   */
  split(source: ListedWorkspace, agent: ListedAgent, folderId?: string): Promise<boolean>;
}

const quoted = (title: string) => `“${title}”`;
const plural = (n: number) => (n === 1 ? "1 conversation" : `${n} conversations`);
const names = (agents: readonly ListedAgent[]) => agents.map((a) => quoted(a.title)).join(", ");

/** Why these conversations cannot move now, or null. The server checks again. */
function blocker(agents: readonly ListedAgent[]): string | null {
  const running = agents.filter((a) => a.bucket === "running");
  if (running.length === 1) return `${names(running)} is still running. Try again when it has finished.`;
  if (running.length > 1) return `${names(running)} are still running. Try again when they have finished.`;
  const asking = agents.filter((a) => a.bucket === "needs_input");
  if (asking.length === 1) return `${names(asking)} is waiting for a permission answer.`;
  if (asking.length > 1) return `${names(asking)} are waiting for permission answers.`;
  return null;
}

/**
 * Merges and splits workspaces through the server's move RPC, one conversation per
 * call, and keeps the workspaces involved in the folders they showed in. A
 * conversation that changes directories gets a new agent ID; its folder and note
 * follow it.
 */
export function useMover(options: {
  folders: FoldersState;
  /** The listed workspaces; a move works on their latest state. */
  workspaces: readonly ListedWorkspace[];
  meta: ReadonlyMap<string, WorkspaceMeta>;
  /** Shows a workspace that conversations moved into. */
  open(workspaceId: string, title: string): void;
  /** Re-reads the list after a move, so conversations that changed ID do not linger under the old one. */
  refresh(): void;
}): Mover {
  const move = useRpc(moveConversationRpc);
  const paseo = usePaseo();
  const toast = useToast();
  const latest = useRef(options);
  latest.current = options;
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const [question, setQuestion] = useState<MoveQuestion | null>(null);
  const reply = useRef<((ok: boolean) => void) | null>(null);

  const ask = useCallback(
    (q: MoveQuestion) =>
      new Promise<boolean>((resolve) => {
        reply.current?.(false);
        reply.current = resolve;
        setQuestion(q);
      }),
    [],
  );
  const answer = useCallback((ok: boolean) => {
    const resolve = reply.current;
    reply.current = null;
    setQuestion(null);
    resolve?.(ok);
  }, []);
  // A question still open when the list goes away counts as Cancel.
  useEffect(() => () => reply.current?.(false), []);

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
      const current = latest.current.folders;
      if (current.status !== "ready" || !(await current.update(change))) {
        toast.error("Moved, but could not update the folders. Check where the workspaces went.");
      }
    },
    [toast],
  );

  const guard = useCallback(
    async (work: (doc: FoldersDocument) => Promise<boolean>) => {
      const folders = latest.current.folders;
      if (folders.status !== "ready") return false;
      if (running.current) {
        toast.show("Another move is still going.", { variant: "warning" });
        return false;
      }
      running.current = true;
      setBusy(true);
      try {
        return await work(folders.doc);
      } finally {
        running.current = false;
        setBusy(false);
      }
    },
    [toast],
  );

  /** The latest listing of a workspace; a drag may have started from an older one. */
  const fresh = (ws: ListedWorkspace) => latest.current.workspaces.find((w) => w.id === ws.id) ?? ws;

  /** Directory and project of each workspace, asking Paseo when one is new to the list (as right after a split). */
  const placesOf = useCallback(
    async (ids: readonly string[]) => {
      let known = latest.current.meta;
      if (ids.some((id) => !known.get(id)?.directory)) known = await listWorkspaceMeta(paseo);
      return ids.map((id) => known.get(id));
    },
    [paseo],
  );

  const merge = useCallback(
    (sourceIn: ListedWorkspace, targetIn: ListedWorkspace, agentIds?: readonly string[]) =>
      guard(async (doc) => {
        const source = fresh(sourceIn);
        const target = fresh(targetIn);
        const chosen = agentIds ? source.agents.filter((a) => agentIds.includes(a.id)) : source.agents;
        if (chosen.length === 0) {
          toast.show(`Nothing left to move in ${quoted(source.title)}.`, { variant: "warning" });
          return false;
        }
        const blocked = blocker(chosen);
        if (blocked) {
          toast.error(blocked);
          return false;
        }
        const [from, to] = await placesOf([source.id, target.id]);
        if (!from?.directory || !to?.directory) {
          toast.error("Could not tell which projects these workspaces are in. Try again.");
          return false;
        }
        if (!sameDirectory(from.directory, to.directory)) {
          const [fromName, toName] = placeNames(from, to);
          const stuck = chosen.filter((a) => a.provider.split("/")[0] !== "claude");
          if (stuck.length > 0) {
            const stay = stuck.length === 1 ? "stays" : "stay";
            toast.error(`Only Claude conversations can move to another project. ${names(stuck)} ${stay} in ${fromName}.`);
            return false;
          }
          const what = agentIds
            ? `Move ${names(chosen)} into ${quoted(target.title)}?`
            : `Merge ${quoted(source.title)} into ${quoted(target.title)}?`;
          const ok = await ask({
            title: "Move to another project?",
            message:
              `${what} ${quoted(source.title)} works in ${fromName}, ${quoted(target.title)} in ${toName}. ` +
              `${chosen.length === 1 ? "It carries" : "They carry"} on in ${toName}: commands and file changes happen there from now on.`,
            action: "Move",
          });
          debugLog("merge-asked", { ok });
          if (!ok) return false;
        }

        // A workspace without a title of its own is listed under its newest conversation's.
        // Keep the name it had when the conversations were dropped on it.
        if (!to.title && target.agents.length > 0) {
          await paseo.workspaces
            .ref(target.id)
            .setTitle(target.title)
            .catch(() => undefined);
        }

        const latestDoc = latest.current.folders.status === "ready" ? latest.current.folders.doc : doc;
        const targetFolder = workspaceFolderOf(latestDoc, target);
        const sourceFolder = workspaceFolderOf(latestDoc, source);
        const pending = [...chosen].reverse();
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
        debugLog("merge", { moved: moved.length, of: pending.length, failed: Boolean(failure), some: Boolean(agentIds) });
        if (moved.length > 0) latest.current.refresh();
        if (moved.length > 0) {
          const gone = new Set(moved.map(({ from }) => from));
          const rest = source.agents.filter((a) => !gone.has(a.id));
          await save((d) => {
            let next = d;
            for (const { from, to } of moved) next = renameAgent(next, from, to);
            const agents = [...target.agents, ...moved.map(({ to }) => ({ id: to }))];
            next = keepFolder(next, { id: target.id, title: target.title, agents }, targetFolder);
            if (rest.length > 0) next = keepFolder(next, { id: source.id, title: source.title, agents: rest }, sourceFolder);
            return next;
          });
        }
        if (failure) {
          toast.error(moved.length > 0 ? `Moved ${moved.length} of ${pending.length}. ${failure}` : failure);
        } else {
          toast.show(`${agentIds ? "Moved into" : "Merged into"} ${quoted(target.title)}`, { variant: "success" });
        }
        if (notes.length > 0) toast.show(notes.join(" "), { variant: "warning" });
        if (moved.length > 0) latest.current.open(target.id, target.title);
        return moved.length > 0;
      }),
    [guard, toast, placesOf, ask, paseo, call, save],
  );

  const split = useCallback(
    (sourceIn: ListedWorkspace, agentIn: ListedAgent, folderId?: string) =>
      guard(async (doc) => {
        const source = fresh(sourceIn);
        const agent = source.agents.find((a) => a.id === agentIn.id);
        if (!agent) {
          toast.show(`${quoted(agentIn.title)} is no longer in ${quoted(source.title)}.`, { variant: "warning" });
          return false;
        }
        const blocked = blocker([agent]);
        if (blocked) {
          toast.error(blocked);
          return false;
        }
        const folder = workspaceFolderOf(doc, source);
        const out = await call({ agentId: agent.id, targetWorkspaceId: null, title: agent.title });
        debugLog("split", { ok: out.ok, filed: folderId !== undefined });
        if (!out.ok) {
          toast.error(out.reason);
          return false;
        }
        latest.current.refresh();
        await save((d) => {
          let next = renameAgent(d, agent.id, out.agentId);
          const rest = source.agents.filter((a) => a.id !== agent.id);
          if (rest.length > 0) next = keepFolder(next, { id: source.id, title: source.title, agents: rest }, folder);
          if (folderId !== undefined) return moveWorkspace(next, out.workspaceId, folderId);
          const made = { id: out.workspaceId, title: agent.title, agents: [{ id: out.agentId }] };
          return folder === UNSORTED_ID ? next : keepFolder(next, made, folder);
        });
        const where =
          folderId === undefined
            ? ""
            : ` in ${folderId === UNSORTED_ID ? "Unsorted" : doc.folders.find((f) => f.id === folderId)?.name ?? "its folder"}`;
        toast.show(`${quoted(agent.title)} has its own workspace now${where}`, { variant: "success" });
        if (out.note) toast.show(out.note, { variant: "warning" });
        latest.current.open(out.workspaceId, agent.title);
        return true;
      }),
    [guard, toast, call, save],
  );

  return { busy, question, answer, merge, split };
}
