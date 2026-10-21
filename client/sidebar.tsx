import type { PluginTheme } from "@getpaseo/plugin";
import { type PluginSidebarItemProps, usePaseo } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type GestureResponderEvent,
  type GestureResponderHandlers,
  PanResponder,
  Platform,
  Pressable,
  type PressableStateCallbackType,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import {
  type DragSubject,
  type DropAction,
  dropAction,
  dropNodeId,
  dropNodePart,
  type DropTarget,
  type Folder,
  type FoldersDocument,
  folderName,
  folderOrder,
  inFolderOrder,
  isDropNodeId,
  type ListedAgent,
  type ListedWorkspace,
  markAutoTitle,
  mostCommon,
  moveFolderAmong,
  moveInList,
  moveWorkspace,
  parseDropNodeId,
  parseRoute,
  placementAt,
  RECENT_PART,
  placeWorkspace,
  recentWorkspaces,
  reorderTarget,
  rowEdge,
  sameDirectory,
  type StatusBucket,
  UNSORTED_ID,
  withoutAutoTitle,
  workspaceFolderOf,
} from "../shared/model";
import { useArchiveAbandoned, useAutoImport, useAutoTitle, useDirectory, useFolders } from "./data";
import { FolderMenu, type MenuPoint, RowMenu, tint } from "./menu";
import { useMover } from "./move";
import { BucketIndicator, mostUrgent, ProviderMark, WorkspaceIcon } from "./status";
import { MoveConfirm } from "./ui";
import { currentPathname, idAtPoint, rectOfId } from "./web-dom";

/** Rows listed under an open folder before Show more. */
const MAX_ROWS_PER_FOLDER = 8;
/** Mouse drags start after this many pixels. */
const MOUSE_DRAG_SLOP = 6;
/** How often the desktop app's address is read to follow the open workspace. */
const ROUTE_POLL_MS = 400;
/** A workspace made from a folder is listed before its first conversation for this long. */
const FRESH_MS = 30 * 60_000;
const OWN_PLUGIN_ID = "paseo-folders";
/** On the web a fixed layer follows the pointer past the sidebar's edge. */
const layer = (Platform.OS === "web" ? "fixed" : "absolute") as "absolute";

const sameTarget = (a: DropTarget | null, b: DropTarget | null) => a?.kind === b?.kind && a?.id === b?.id;

/** The row under a dragged workspace or conversation, and whether the pointer is at its top or bottom edge. */
type Hover = { target: DropTarget; edge: "above" | "below" | null };
const sameHover = (a: Hover | null, b: Hover | null) => sameTarget(a?.target ?? null, b?.target ?? null) && a?.edge === b?.edge;

/** What a sidebar row drags: a workspace or conversation to file or merge, or a folder to put in order. */
type Dragged = DragSubject | { kind: "folder"; folder: Folder };

/** Where a dragged folder would go: above this folder, or at the end. */
const AT_END = "";

/**
 * Folders of workspaces, like Paseo's own list but grouped. One folder is open
 * at a time so every folder stays on screen as a drop target. With a mouse:
 * drag a workspace onto a folder to file it there, onto the top or bottom edge of
 * another workspace to put it there (the folder then keeps that order, with new
 * workspaces on top), or onto the middle of another workspace to move its
 * conversations in as tabs. A workspace with several conversations
 * opens into one row per conversation; drag one onto another workspace to move
 * it there, or onto a folder to give it a workspace of its own in that folder.
 * Moves into another project ask first. Right-click or long-press a workspace
 * for the menu, which does the same. Folders are dragged into order with the
 * mouse, and right-clicked (or More on touch screens) to add, rename or delete.
 * Recent, above the folders, lists the workspaces pinned in Paseo and the ones used
 * last, so the few in hand are one press away; the menu pins and unpins. A drag
 * dropped anywhere on a workspace there merges into it: Recent keeps its own order.
 */
export function FoldersSidebarItem({ theme, currentScreen, openScreen }: PluginSidebarItemProps) {
  const toast = useToast();
  const paseo = usePaseo();
  const folders = useFolders();
  const { workspaces: listed, workspaceMeta, loading, refresh } = useDirectory();
  const { height: windowHeight } = useWindowDimensions();
  const closeMenu = useCallback(() => setMenu(null), []);
  const [expanded, setExpanded] = useState(true);
  const [recentOpen, setRecentOpen] = useState(true);
  const [openFolder, setOpenFolder] = useState<string | null>(null);
  const [showAll, setShowAll] = useState<ReadonlySet<string>>(new Set());
  /** Workspaces opened to list their conversations. */
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const [drag, setDrag] = useState<{
    subject: Dragged;
    at: MenuPoint;
    /** The sidebar's horizontal extent in window coordinates; Paseo clips anything past it. */
    bounds: { left: number; width: number } | null;
  } | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  /** Where a dragged folder would land among the folders shown. */
  const [reorder, setReorder] = useState<number | null>(null);
  /** A folder just dropped in a new place, shown there until the saved order arrives. */
  const [placed, setPlaced] = useState<{ id: string; index: number } | null>(null);
  /** The folders as a workspace just dropped between rows left them, shown until they are saved. */
  const [placedDoc, setPlacedDoc] = useState<FoldersDocument | null>(null);
  const [headerHovered, setHeaderHovered] = useState(false);
  const [menu, setMenu] = useState<
    | { kind: "workspace"; ws: ListedWorkspace; at: MenuPoint }
    /** A folder's menu; with no folder, the header's New folder. */
    | { kind: "folder"; folderId: string | null; at: MenuPoint }
    | null
  >(null);
  const [fresh, setFresh] = useState<ReadonlyMap<string, string>>(() => new Map(freshWorkspaces));
  const [creating, setCreating] = useState<string | null>(null);
  /** A workspace that conversations just moved into, to show once it is listed. */
  const [reveal, setReveal] = useState<string | null>(null);
  const container = useRef<View | null>(null);
  const dragging = useRef<Dragged | null>(null);
  /** The folders on screen, in order, for working out where a dragged one lands. */
  const shownFolders = useRef<string[]>([]);
  /** How far below the top of a dragged folder's row the pointer took hold of it. */
  const grabOffset = useRef(0);
  /** The folders and Recent as they were when the drag began, so rows hold still under the pointer. */
  const frozen = useRef<Map<string, ListedWorkspace[]> | null>(null);
  const frozenRecent = useRef<ListedWorkspace[] | null>(null);
  const ghost = useRef<((at: MenuPoint) => void) | null>(null);
  const ready = folders.status === "ready" ? folders : null;
  const orderKey = ready ? folderOrder(ready.doc).map((f) => f.id).join("\n") : "";
  useEffect(() => setPlaced(null), [orderKey]);
  const placeKey = ready ? JSON.stringify([ready.doc.workspaceOrder, ready.doc.workspaceAssignments]) : "";
  useEffect(() => setPlacedDoc(null), [placeKey]);
  /** The folders as shown: as saved, or as a drop just left them. */
  const doc = placedDoc ?? ready?.doc ?? null;

  // A workspace made from a folder has no conversation yet, so Paseo lists no agent
  // for it. Show it until its first conversation arrives or it is archived: on every
  // device while Paseo lists the workspace, and here from the moment it is made.
  const autoTitle = ready?.doc.autoTitle;
  const workspaces = useMemo(() => {
    const now = Date.now();
    const known = new Set(listed.map((ws) => ws.id));
    const waiting = new Map<string, string>();
    for (const [id, at] of fresh) if (now - Date.parse(at) < FRESH_MS) waiting.set(id, at);
    for (const [id, at] of Object.entries(autoTitle ?? {})) if (workspaceMeta.has(id)) waiting.set(id, at);
    const extra: ListedWorkspace[] = [];
    for (const [id, at] of waiting) {
      if (!known.has(id)) {
        extra.push({ id, title: workspaceMeta.get(id)?.title || "New workspace", agents: [], activityAt: at });
      }
    }
    return extra.length > 0 ? [...extra, ...listed] : listed;
  }, [listed, fresh, workspaceMeta, autoTitle]);
  useEffect(() => {
    const known = new Set(listed.map((ws) => ws.id));
    if ([...fresh.keys()].some((id) => known.has(id))) {
      for (const id of known) freshWorkspaces.delete(id);
      setFresh(new Map(freshWorkspaces));
    }
  }, [listed, fresh]);
  useAutoImport(folders, listed, !loading);
  useAutoTitle(folders, listed, workspaceMeta);
  const showing = useShownWorkspace(workspaces);
  useArchiveAbandoned(folders, !loading, showing.id);

  const byFolder = useMemo(() => {
    const map = new Map<string, ListedWorkspace[]>();
    if (!doc) return map;
    for (const ws of workspaces) {
      const id = workspaceFolderOf(doc, ws);
      const list = map.get(id) ?? [];
      list.push(ws);
      map.set(id, list);
    }
    for (const [id, list] of map) map.set(id, inFolderOrder(doc, id, list));
    return map;
  }, [doc, workspaces]);
  const lists = (drag && frozen.current) || byFolder;
  const recent = useMemo(
    () => recentWorkspaces(workspaces, (id) => workspaceMeta.get(id)?.pinnedAt ?? ""),
    [workspaces, workspaceMeta],
  );
  const recentShown = (drag && frozenRecent.current) || recent;

  const activeScreen = currentScreen?.screenId ?? null;
  const web = Platform.OS === "web";
  const unsortedCount = lists.get(UNSORTED_ID)?.length ?? 0;
  // With nothing chosen, show Unsorted open so new workspaces are easy to file.
  const shownFolder = openFolder ?? (unsortedCount > 0 ? UNSORTED_ID : null);

  const openWorkspace = (ws: Pick<ListedWorkspace, "id" | "title">) => {
    showing.expect(ws.id);
    openScreen({ screenId: "open", params: { workspaceId: ws.id, name: ws.title } });
  };
  const openConversation = (ws: ListedWorkspace, agent: ListedAgent) => {
    showing.expect(ws.id);
    openScreen({ screenId: "open", params: { agentId: agent.id, name: agent.title } });
  };
  const mover = useMover({
    folders,
    workspaces,
    meta: workspaceMeta,
    open: (id, title) => {
      openWorkspace({ id, title });
      setReveal(id);
    },
    refresh,
  });

  // After a move, open the folder of the workspace the conversations went to and list them.
  useEffect(() => {
    if (!reveal || !ready) return;
    const ws = workspaces.find((w) => w.id === reveal);
    if (!ws) return;
    setReveal(null);
    setOpenFolder(workspaceFolderOf(ready.doc, ws));
    setOpened((prev) => (prev.has(ws.id) ? prev : new Set(prev).add(ws.id)));
  }, [reveal, ready, workspaces]);

  const toggleOpened = (id: string) =>
    setOpened((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /** Makes an empty workspace in the folder's usual project, files it there and opens it. */
  async function createIn(folderId: string, folderName: string) {
    if (!ready || creating) return;
    const projectOf = (ws: ListedWorkspace) => workspaceMeta.get(ws.id)?.projectRoot ?? "";
    const root =
      mostCommon((byFolder.get(folderId) ?? []).map(projectOf)) ?? mostCommon(listed.map(projectOf));
    if (!root) {
      toast.error("No project to make the workspace in yet.");
      return;
    }
    const projectId = [...workspaceMeta.values()].find((m) => m.projectRoot === root)?.projectId || undefined;
    setCreating(folderId);
    try {
      const created = await paseo.workspaces.create({ source: { kind: "directory", path: root, projectId } });
      const at = new Date().toISOString();
      freshWorkspaces.set(created.id, at);
      setFresh(new Map(freshWorkspaces));
      setOpenFolder(folderId);
      const saved = await ready.update((d) => markAutoTitle(moveWorkspace(d, created.id, folderId), created.id, at));
      if (!saved) toast.error(`Made the workspace, but could not file it in ${folderName}.`);
      openWorkspace({ id: created.id, title: "New workspace" });
    } catch {
      toast.error("Could not make a workspace. Try Paseo's New workspace instead.");
    } finally {
      setCreating(null);
    }
  }

  async function moveTo(ws: ListedWorkspace, folderId: string, folderName: string) {
    if (!ready || workspaceFolderOf(ready.doc, ws) === folderId) return;
    const ok = await ready.update((d) => moveWorkspace(d, ws.id, folderId));
    if (!ok) toast.error("Could not move. Try again.");
    else toast.show(`Moved to ${folderName}`, { variant: "success" });
  }

  const nameOf = (folderId: string) => (ready ? folderName(ready.doc, folderId) : "");
  const titleOf = (workspaceId: string) => workspaces.find((w) => w.id === workspaceId)?.title ?? "";

  /** The row under the pointer, read from the page so it is right even if rows moved, and the edge the pointer is at. */
  const hoverAt = (x: number, y: number): Hover | null => {
    const nodeId = idAtPoint(x, y, isDropNodeId);
    const target = parseDropNodeId(nodeId);
    if (!target || !nodeId) return null;
    if (target.kind !== "workspace") return { target, edge: null };
    const rect = rectOfId(nodeId);
    const edge = rect ? rowEdge(rect, y) : null;
    // A listed workspace's conversations follow its row, so between it and the next
    // workspace is the bottom edge of its last conversation.
    const ws = [...lists.values()].flat().find((w) => w.id === target.id);
    const listing = Boolean(ws && ws.agents.length > 1 && opened.has(ws.id));
    const part = dropNodePart(nodeId);
    if (part === RECENT_PART) return { target, edge: null };
    if (part === null) return { target, edge: listing && edge === "below" ? null : edge };
    const last = ws?.agents[ws.agents.length - 1]?.id;
    return { target, edge: edge === "below" && part === last ? "below" : null };
  };

  /** What dropping `subject` at `at` does: put a workspace between rows, or what `dropAction` says for the row. */
  const actionFor = (subject: DragSubject, at: Hover | null): DropAction | null => {
    if (!doc || !at) return null;
    if (subject.kind === "workspace") {
      const placement = placementAt(doc, lists, subject.ws, at.target, at.edge);
      if (placement !== undefined) return placement;
    }
    return dropAction(doc, subject, at.target);
  };

  /** Puts a workspace among a folder's workspaces as the drop showed it, and shows it there until that is saved. */
  function place(ws: ListedWorkspace, folderId: string, before: string | null) {
    if (!ready || !doc) return;
    const shown = (lists.get(folderId) ?? []).map((w) => w.id);
    const change = (d: FoldersDocument) => placeWorkspace(d, ws.id, folderId, shown, before);
    setPlacedDoc(change(doc));
    void ready.update(change).then((ok) => {
      if (ok) return;
      setPlacedDoc(null);
      toast.error("Could not reorder. Try again.");
    });
  }

  const openMenu = (ws: ListedWorkspace, at: MenuPoint) => {
    setMenu({ kind: "workspace", ws, at });
  };

  /** Where folder `folderId`, held with the pointer at window height `y`, would land among the folders shown. */
  const reorderAt = (folderId: string, y: number): number | null => {
    const rows: { y: number; height: number }[] = [];
    for (const id of shownFolders.current) {
      const rect = rectOfId(dropNodeId({ kind: "folder", id }));
      if (!rect) return null;
      rows.push(rect);
    }
    const from = shownFolders.current.indexOf(folderId);
    if (from < 0) return null;
    return reorderTarget(rows, from, y - grabOffset.current - rows[from].y);
  };

  /** Saves a folder dropped at `index` among the folders shown. */
  function placeFolder(folderId: string, index: number) {
    const shown = shownFolders.current;
    if (!ready || shown.indexOf(folderId) === index) return;
    setPlaced({ id: folderId, index });
    void ready.update((d) => moveFolderAmong(d, shown, folderId, index)).then((ok) => {
      if (ok) return;
      setPlaced(null);
      toast.error("Could not reorder. Try again.");
    });
  }

  function perform(subject: DragSubject, action: DropAction) {
    if (action.kind === "place") {
      if (subject.kind === "workspace") place(subject.ws, action.folderId, action.before);
    } else if (action.kind === "file") {
      void moveTo(subject.ws, action.folderId, nameOf(action.folderId));
    } else if (action.kind === "split") {
      if (subject.kind !== "conversation") return;
      setOpenFolder(action.folderId);
      void mover.split(subject.ws, subject.agent, action.folderId);
    } else {
      const target = workspaces.find((w) => w.id === action.workspaceId);
      if (!target) return;
      void mover.merge(subject.ws, target, subject.kind === "conversation" ? [subject.agent.id] : undefined);
    }
  }

  const dragApi: DragApi = {
    start(subject, x, y) {
      dragging.current = subject;
      frozen.current = byFolder;
      frozenRecent.current = recent;
      setMenu(null);
      setHover(null);
      setReorder(null);
      if (subject.kind === "folder") {
        const rect = rectOfId(dropNodeId({ kind: "folder", id: subject.folder.id }));
        grabOffset.current = rect ? y - rect.y : 0;
      }
      setDrag({ subject, at: { x, y }, bounds: null });
      container.current?.measureInWindow((left, _top, width) => {
        setDrag((d) => (d && d.subject === subject ? { ...d, bounds: { left, width } } : d));
      });
    },
    move(x, y) {
      ghost.current?.({ x, y });
      const subject = dragging.current;
      if (subject?.kind === "folder") {
        const index = reorderAt(subject.folder.id, y);
        setReorder((r) => (r === index ? r : index));
        return;
      }
      const at = hoverAt(x, y);
      setHover((h) => (sameHover(h, at) ? h : at));
    },
    end(x, y) {
      const subject = dragging.current;
      dragging.current = null;
      frozen.current = null;
      frozenRecent.current = null;
      setDrag(null);
      setHover(null);
      setReorder(null);
      if (subject?.kind === "folder") {
        const index = y === null ? null : reorderAt(subject.folder.id, y);
        if (index !== null) placeFolder(subject.folder.id, index);
        return;
      }
      const at = x === null || y === null ? null : hoverAt(x, y);
      const action = subject ? actionFor(subject, at) : null;
      if (subject && action) perform(subject, action);
    },
  };
  const dragRef = useRef(dragApi);
  dragRef.current = dragApi;

  const chevron = (open: boolean, label: string, onPress: () => void) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={8}>
      <Icon name={open ? "ChevronDown" : "ChevronRight"} size={14} color={theme.colors.foregroundMuted} />
    </Pressable>
  );

  // Like the + on folders: New folder shows on hover, and always on touch screens.
  const addable = Boolean(ready) && expanded && (headerHovered || !web);
  const header = (
    <View {...({ onMouseEnter: () => setHeaderHovered(true), onMouseLeave: () => setHeaderHovered(false) } as object)}>
      <SidebarRow
        id="folders"
        icon="Folders"
        label="Folders"
        active={activeScreen === "overview"}
        onPress={() => openScreen({ screenId: "overview" })}
        trailing={
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            {ready && expanded ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="New folder"
                disabled={!addable}
                onPress={(event) => setMenu({ kind: "folder", folderId: null, at: pointOf(event) })}
                hitSlop={6}
                style={{ opacity: addable ? 1 : 0 }}
              >
                <Icon name="FolderPlus" size={14} color={theme.colors.foregroundMuted} />
              </Pressable>
            ) : null}
            {chevron(expanded, expanded ? "Collapse folders" : "Expand folders", () => setExpanded((v) => !v))}
          </View>
        }
      />
    </View>
  );
  if (!ready || !expanded) {
    return (
      <>
        {header}
        <MoveConfirm mover={mover} theme={theme} />
      </>
    );
  }

  // Unsorted shows in the place the user gave it even when empty, so it is always there
  // to drop on and no row appears or goes while something is dragged.
  const filing = drag && drag.subject.kind !== "folder" ? drag.subject : null;
  const order = folderOrder(ready.doc);
  const groups = placed ? moveInList(order, placed.id, placed.index) : order;
  shownFolders.current = groups.map((f) => f.id);

  // A dragged folder would land above this folder, or at the end.
  const held = drag?.subject.kind === "folder" ? drag.subject.folder.id : null;
  const heldAt = held ? shownFolders.current.indexOf(held) : -1;
  const lineAbove =
    reorder === null || heldAt < 0 || reorder === heldAt
      ? null
      : ((reorder < heldAt ? groups[reorder] : groups[reorder + 1])?.id ?? AT_END);

  // What the drop would do, shown on the target row, or as a line between rows, and beside the pointer.
  const action = filing ? actionFor(filing, hover) : null;
  const placing = action?.kind === "place" ? action : null;
  const dropOn = action && !placing ? (hover?.target ?? null) : null;
  let hint = "";
  if (filing && action) {
    if (action.kind === "file") hint = `Move to ${nameOf(action.folderId)}`;
    else if (action.kind === "place") {
      const first = (lists.get(action.folderId) ?? []).find((w) => w.id !== filing.ws.id)?.id;
      if (action.before === null) hint = `Move to the bottom of ${nameOf(action.folderId)}`;
      else if (action.before === first) hint = `Move to the top of ${nameOf(action.folderId)}`;
      else hint = `Move above “${titleOf(action.before)}”`;
    } else if (action.kind === "split") hint = `New workspace in ${nameOf(action.folderId)}`;
    else {
      const from = workspaceMeta.get(filing.ws.id)?.directory;
      const to = workspaceMeta.get(action.workspaceId)?.directory;
      const away = from && to && !sameDirectory(from, to) ? " (another project)" : "";
      const verb = filing.kind === "conversation" ? "Move into" : "Merge into";
      hint = `${verb} “${titleOf(action.workspaceId)}”${away}`;
    }
  } else if (lineAbove !== null) {
    hint = lineAbove === AT_END ? "Move to the bottom" : `Move above ${nameOf(lineAbove)}`;
  }

  const menuFolder =
    menu?.kind === "folder" && menu.folderId !== null ? order.find((f) => f.id === menu.folderId) : undefined;
  return (
    <View ref={container} collapsable={false}>
      {header}
      {/* Paseo's sidebar header does not scroll, so the folders scroll on their own when tall. */}
      <ScrollView style={{ maxHeight: Math.max(240, windowHeight * 0.6) }}>
      {recentShown.length > 0 ? (
        <RecentItem
          open={recentOpen}
          // Like a folder: collapsed, it shows its most urgent status.
          status={recentOpen ? "done" : mostUrgent(recentShown)}
          theme={theme}
          onToggle={() => setRecentOpen((v) => !v)}
        />
      ) : null}
      {recentOpen
        ? recentShown.map((ws) => (
            <WorkspaceItem
              key={`recent-${ws.id}`}
              ws={ws}
              theme={theme}
              active={showing.id === ws.id}
              lifted={drag?.subject.kind === "workspace" && drag.subject.ws.id === ws.id}
              dropTarget={dropOn?.kind === "workspace" && dropOn.id === ws.id}
              listing={false}
              recent
              pinned={Boolean(workspaceMeta.get(ws.id)?.pinnedAt)}
              dragRef={dragRef}
              onOpen={() => openWorkspace(ws)}
              onMenu={(at) => openMenu(ws, at)}
            />
          ))
        : null}
      {groups.map((folder) => {
        const list = lists.get(folder.id) ?? [];
        const open = shownFolder === folder.id;
        const all = showAll.has(folder.id);
        const shown = open ? (all ? list : list.slice(0, MAX_ROWS_PER_FOLDER)) : [];
        const line = placing?.folderId === folder.id ? placing.before : undefined;
        const toggleAll = () =>
          setShowAll((prev) => {
            const next = new Set(prev);
            if (next.has(folder.id)) next.delete(folder.id);
            else next.add(folder.id);
            return next;
          });
        return (
          <Fragment key={folder.id}>
            <FolderItem
              folder={folder}
              count={list.length}
              open={open}
              // Like Paseo's groups: a collapsed folder shows its most urgent status.
              status={open ? "done" : mostUrgent(list)}
              theme={theme}
              dragging={drag !== null}
              filing={filing !== null}
              lifted={held === folder.id}
              dropTarget={dropOn?.kind === "folder" && dropOn.id === folder.id}
              lineAbove={lineAbove === folder.id}
              creating={creating}
              dragRef={dragRef}
              onToggle={() => setOpenFolder(open ? "" : folder.id)}
              onCreate={folder.id === UNSORTED_ID ? undefined : () => void createIn(folder.id, folder.name)}
              onMenu={(at) => setMenu({ kind: "folder", folderId: folder.id, at })}
            />
            {shown.map((ws) => {
              const target = dropOn?.kind === "workspace" && dropOn.id === ws.id;
              const listing = ws.agents.length > 1 && opened.has(ws.id);
              return (
                <Fragment key={ws.id}>
                  {line === ws.id ? <InsertLine theme={theme} /> : null}
                  <WorkspaceItem
                    ws={ws}
                    theme={theme}
                    active={showing.id === ws.id}
                    lifted={drag?.subject.kind === "workspace" && drag.subject.ws.id === ws.id}
                    dropTarget={target}
                    listing={listing}
                    dragRef={dragRef}
                    onOpen={() => openWorkspace(ws)}
                    onToggle={() => toggleOpened(ws.id)}
                    onMenu={(at) => openMenu(ws, at)}
                  />
                  {listing
                    ? ws.agents.map((agent) => (
                        <ConversationItem
                          key={agent.id}
                          ws={ws}
                          agent={agent}
                          theme={theme}
                          lifted={drag?.subject.kind === "conversation" && drag.subject.agent.id === agent.id}
                          dropTarget={target}
                          dragRef={dragRef}
                          onOpen={() => openConversation(ws, agent)}
                        />
                      ))
                    : null}
                </Fragment>
              );
            })}
            {/* At the bottom, or above a row Show more hides. */}
            {line !== undefined && !shown.some((ws) => ws.id === line) ? <InsertLine theme={theme} end /> : null}
            {open && list.length > MAX_ROWS_PER_FOLDER ? (
              <SidebarRow
                id={`more-${folder.id}`}
                icon={all ? "ChevronUp" : "ChevronDown"}
                label={all ? "Show less" : "Show more"}
                onPress={toggleAll}
              />
            ) : null}
          </Fragment>
        );
      })}
      {lineAbove === AT_END ? <InsertLine theme={theme} end /> : null}
      </ScrollView>
      {drag ? (
        <DragGhost
          at={drag.at}
          bounds={drag.bounds}
          label={
            drag.subject.kind === "folder"
              ? drag.subject.folder.name
              : drag.subject.kind === "conversation"
                ? drag.subject.agent.title
                : drag.subject.ws.title
          }
          hint={hint}
          idle={
            drag.subject.kind === "folder"
              ? "Drag up or down to reorder"
              : drag.subject.kind === "workspace"
                ? "Drop between workspaces to reorder, or on a folder or a workspace"
                : "Drop on a folder or a workspace"
          }
          theme={theme}
          follow={ghost}
        />
      ) : null}
      {menu?.kind === "workspace" ? (
        <RowMenu
          key={menu.ws.id}
          ws={menu.ws}
          meta={workspaceMeta.get(menu.ws.id)}
          at={menu.at}
          theme={theme}
          folders={ready}
          workspaces={workspaces}
          mover={mover}
          onClose={closeMenu}
          onArchived={(id) => {
            if (freshWorkspaces.delete(id)) setFresh(new Map(freshWorkspaces));
            void ready.update((d) => withoutAutoTitle(d, [id]));
          }}
        />
      ) : null}
      {menu?.kind === "folder" && (menu.folderId === null || menuFolder) ? (
        <FolderMenu
          key={menu.folderId ?? "new"}
          folder={menuFolder ?? null}
          count={menuFolder ? (lists.get(menuFolder.id)?.length ?? 0) : 0}
          at={menu.at}
          theme={theme}
          folders={ready}
          onNewWorkspace={
            menuFolder && menuFolder.id !== UNSORTED_ID ? () => void createIn(menuFolder.id, menuFolder.name) : undefined
          }
          onClose={closeMenu}
        />
      ) : null}
      <MoveConfirm mover={mover} theme={theme} />
    </View>
  );
}

/**
 * The workspace Paseo shows, so the highlight matches its own list. On the web
 * and in the desktop app it is read from the address; native apps cannot read
 * it and highlight the workspace last opened from here. While this plugin's own
 * screens are showing (opening a workspace passes through one), the workspace
 * last opened from here stays highlighted.
 */
function useShownWorkspace(workspaces: readonly ListedWorkspace[]): { id: string | null; expect(id: string): void } {
  const [path, setPath] = useState(currentPathname);
  const [expected, setExpected] = useState<string | null>(lastOpened);
  useEffect(() => {
    if (currentPathname() === null) return;
    const timer = setInterval(() => setPath(currentPathname()), ROUTE_POLL_MS);
    return () => clearInterval(timer);
  }, []);
  const expect = useCallback((id: string) => {
    lastOpened = id;
    setExpected(id);
  }, []);
  const id = useMemo(() => {
    if (path === null) return expected;
    const route = parseRoute(path);
    if (!route) return null;
    if (route.kind === "plugin") return route.pluginId === OWN_PLUGIN_ID ? expected : null;
    if (route.kind === "workspace") return route.id;
    return workspaces.find((ws) => ws.agents.some((a) => a.id === route.id))?.id ?? null;
  }, [path, expected, workspaces]);
  return { id, expect };
}

interface DragApi {
  start(subject: Dragged, x: number, y: number): void;
  move(x: number, y: number): void;
  end(x: number | null, y: number | null): void;
}

/** Mouse-drag handlers for a row; `subject` says what the row drags. Touch screens use the menu instead. */
function useRowDrag(dragRef: { current: DragApi }, subject: () => Dragged): GestureResponderHandlers {
  const latest = useRef(subject);
  latest.current = subject;
  return useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponderCapture: (_e, g) =>
          Platform.OS === "web" && Math.abs(g.dx) + Math.abs(g.dy) > MOUSE_DRAG_SLOP,
        onPanResponderGrant: (_e, g) => dragRef.current.start(latest.current(), g.moveX || g.x0, g.moveY || g.y0),
        onPanResponderMove: (_e, g) => dragRef.current.move(g.moveX, g.moveY),
        onPanResponderRelease: (_e, g) => dragRef.current.end(g.moveX, g.moveY),
        onPanResponderTerminate: () => dragRef.current.end(null, null),
        onPanResponderTerminationRequest: () => false,
      }).panHandlers,
    [dragRef],
  );
}

type PointerLike = { clientX?: number; clientY?: number; pageX?: number; pageY?: number };

/** Window coordinates of a mouse or touch event. */
function pointOf(event: unknown): MenuPoint {
  const e = event as PointerLike & { nativeEvent?: PointerLike };
  const n = e.nativeEvent ?? {};
  return {
    x: n.clientX ?? e.clientX ?? n.pageX ?? e.pageX ?? 0,
    y: n.clientY ?? e.clientY ?? n.pageY ?? e.pageY ?? 0,
  };
}

/** The workspace last opened from this list; survives the screen switch that opening causes. */
let lastOpened: string | null = null;
/** Workspaces made from a folder in this session, with when; kept across remounts. */
const freshWorkspaces = new Map<string, string>();

/** Selected, pressed and hovered rows darken like Paseo's own list; a drop target takes the accent. */
function rowBackground(theme: PluginTheme, row: { dropTarget: boolean; active?: boolean; pressed: boolean; hovered: boolean }) {
  if (row.dropTarget) return tint(theme.colors.accent, 0.16);
  if (row.active) return tint(theme.colors.foreground, 0.09);
  if (row.pressed) return tint(theme.colors.foreground, 0.12);
  return row.hovered ? tint(theme.colors.foreground, 0.05) : "transparent";
}

/** Outlines a folder row a drag would drop into, over the row so nothing moves. */
function DropHighlight({ theme }: { theme: PluginTheme }) {
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: 8,
        right: 8,
        top: 0,
        bottom: 0,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.accent,
        backgroundColor: tint(theme.colors.accent, 0.16),
      }}
    />
  );
}

const GHOST_WIDTH = 240;

/** What is being dragged, and what dropping it here would do, just below the pointer. */
function DragGhost(props: {
  at: MenuPoint;
  bounds: { left: number; width: number } | null;
  label: string;
  hint: string;
  /** Said while no drop would do anything. */
  idle: string;
  theme: PluginTheme;
  /** Set to a function that moves the ghost, so following the pointer re-renders only this. */
  follow: { current: ((at: MenuPoint) => void) | null };
}) {
  const { theme, follow } = props;
  const [at, setAt] = useState(props.at);
  useEffect(() => {
    follow.current = setAt;
    return () => {
      follow.current = null;
    };
  }, [follow]);
  // Beside the pointer, but inside the sidebar, which clips anything past its edge.
  const minX = (props.bounds?.left ?? 0) + 8;
  const maxX = props.bounds ? props.bounds.left + props.bounds.width - 8 : at.x + 14 + GHOST_WIDTH;
  const width = Math.min(GHOST_WIDTH, Math.max(120, maxX - minX));
  const left = Math.max(minX, Math.min(at.x + 14, maxX - width));
  return (
    <View
      pointerEvents="none"
      style={{
        position: layer,
        left,
        top: at.y + 12,
        width,
        paddingHorizontal: 10,
        paddingVertical: 6,
        gap: 2,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: props.hint ? theme.colors.accent : theme.colors.border,
        backgroundColor: theme.colors.surface1,
        shadowColor: "rgba(0, 0, 0, 0.20)",
        shadowOffset: { width: 0, height: 4 },
        shadowRadius: 8,
        zIndex: 1001,
      }}
    >
      <Text numberOfLines={1} style={{ color: theme.colors.foreground, fontSize: 13 }}>
        {props.label}
      </Text>
      <Text numberOfLines={2} style={{ color: props.hint ? theme.colors.accent : theme.colors.foregroundMuted, fontSize: 12 }}>
        {props.hint || props.idle}
      </Text>
    </View>
  );
}

/**
 * Where a dragged row would land: a line between two rows, drawn over them so nothing
 * moves. At the end of a list it sits inside the last row, where the list does not clip it.
 */
function InsertLine({ theme, end = false }: { theme: PluginTheme; end?: boolean }) {
  return (
    <View pointerEvents="none" style={{ height: 0, zIndex: 1 }}>
      <View
        style={{
          position: "absolute",
          left: 12,
          right: 12,
          top: end ? -2 : -1,
          height: 2,
          borderRadius: 1,
          backgroundColor: theme.colors.accent,
        }}
      />
    </View>
  );
}

/** The Recent header: press it to show or hide the workspaces under it. */
function RecentItem(props: { open: boolean; status: StatusBucket; theme: PluginTheme; onToggle(): void }) {
  const { theme } = props;
  return (
    <SidebarRow
      id="recent"
      icon="Clock"
      label="Recent"
      active={false}
      onPress={props.onToggle}
      trailing={
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <BucketIndicator bucket={props.status} theme={theme} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={props.open ? "Collapse Recent" : "Expand Recent"}
            onPress={props.onToggle}
            hitSlop={8}
          >
            <Icon name={props.open ? "ChevronDown" : "ChevronRight"} size={14} color={theme.colors.foregroundMuted} />
          </Pressable>
        </View>
      }
    />
  );
}

/**
 * A folder row: press it to list its workspaces, drag it with the mouse to put it
 * in order, right-click it or press More for its menu. Like Paseo's project rows,
 * + makes a workspace in it; both buttons show on hover, and on touch screens on
 * the open folder.
 */
function FolderItem(props: {
  folder: Folder;
  count: number;
  open: boolean;
  status: StatusBucket;
  theme: PluginTheme;
  /** Something is being dragged, so the buttons stay hidden. */
  dragging: boolean;
  /** A workspace or conversation is being dragged, and the folder takes it. */
  filing: boolean;
  /** This folder is being dragged. */
  lifted: boolean;
  dropTarget: boolean;
  /** A dragged folder would land just above this one. */
  lineAbove: boolean;
  /** The folder a workspace is being made in, if any. */
  creating: string | null;
  dragRef: { current: DragApi };
  onToggle(): void;
  /** Makes a workspace in the folder; left out for Unsorted. */
  onCreate?(): void;
  onMenu(at: MenuPoint): void;
}) {
  const { folder, theme } = props;
  const [hovered, setHovered] = useState(false);
  const panHandlers = useRowDrag(props.dragRef, () => ({ kind: "folder", folder }));
  const buttons = !props.dragging && (hovered || (Platform.OS !== "web" && props.open));
  const muted = theme.colors.foregroundMuted;
  // React Native Web passes these to the page; native platforms ignore them.
  const pointer = {
    onMouseEnter: () => setHovered(true),
    onMouseLeave: () => setHovered(false),
    onContextMenu: (event: { preventDefault?: () => void }) => {
      event.preventDefault?.();
      props.onMenu(pointOf(event));
    },
  } as object;
  let icon = props.open ? "FolderOpen" : "Folder";
  if (folder.id === UNSORTED_ID) icon = "Inbox";
  if (props.filing) icon = "FolderInput";
  return (
    <View
      nativeID={dropNodeId({ kind: "folder", id: folder.id })}
      collapsable={false}
      style={props.lifted ? { opacity: 0.5 } : null}
      {...panHandlers}
      {...pointer}
    >
      {props.lineAbove ? <InsertLine theme={theme} /> : null}
      <SidebarRow
        id={`folder-${folder.id}`}
        icon={icon}
        label={folder.name}
        active={false}
        onPress={props.onToggle}
        trailing={
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            {props.onCreate ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`New workspace in ${folder.name}`}
                disabled={!buttons || props.creating !== null}
                onPress={props.onCreate}
                hitSlop={6}
                style={{ opacity: buttons || props.creating === folder.id ? 1 : 0 }}
              >
                <Icon name="Plus" size={14} color={muted} />
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`More for ${folder.name}`}
              disabled={!buttons}
              onPress={(event) => props.onMenu(pointOf(event))}
              hitSlop={6}
              style={{ opacity: buttons ? 1 : 0 }}
            >
              <Icon name="EllipsisVertical" size={14} color={muted} />
            </Pressable>
            <BucketIndicator bucket={props.status} theme={theme} />
            <Text style={{ color: muted, fontSize: 12 }}>{props.count}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={props.open ? `Collapse ${folder.name}` : `Expand ${folder.name}`}
              onPress={props.onToggle}
              hitSlop={8}
            >
              <Icon name={props.open ? "ChevronDown" : "ChevronRight"} size={14} color={muted} />
            </Pressable>
          </View>
        }
      />
      {props.dropTarget ? <DropHighlight theme={theme} /> : null}
    </View>
  );
}

/**
 * A workspace row with Paseo-style status, its title, and how many conversations it holds.
 * Under Recent it leaves out the count and shows a pin when pinned; dropped on, the whole row
 * merges, since Recent keeps its own order.
 */
function WorkspaceItem(props: {
  ws: ListedWorkspace;
  theme: PluginTheme;
  active: boolean;
  lifted: boolean;
  /** A drag is over this workspace and would move conversations into it. */
  dropTarget: boolean;
  /** Its conversations are listed below it. */
  listing: boolean;
  /** Listed under Recent. */
  recent?: boolean;
  pinned?: boolean;
  dragRef: { current: DragApi };
  onOpen(): void;
  /** Lists or hides its conversations; left out under Recent. */
  onToggle?(): void;
  onMenu(at: MenuPoint): void;
}) {
  const { ws, theme } = props;
  const [hovered, setHovered] = useState(false);
  const panHandlers = useRowDrag(props.dragRef, () => ({ kind: "workspace", ws }));
  const style = (state: PressableStateCallbackType) => ({
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    marginHorizontal: 8,
    // One pixel less padding than Paseo's rows makes room for the drop outline without moving anything.
    paddingLeft: 25,
    paddingRight: 5,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: props.dropTarget ? theme.colors.accent : "transparent",
    opacity: props.lifted ? 0.5 : 1,
    backgroundColor: rowBackground(theme, { ...props, pressed: state.pressed, hovered }),
  });
  // React Native Web forwards onContextMenu to the DOM; native platforms ignore it.
  const contextMenu = {
    onContextMenu: (event: { preventDefault?: () => void }) => {
      event.preventDefault?.();
      props.onMenu(pointOf(event));
    },
  } as object;
  const web = Platform.OS === "web";
  const count = ws.agents.length;
  const muted = theme.colors.foregroundMuted;
  return (
    <View
      nativeID={dropNodeId({ kind: "workspace", id: ws.id }, props.recent ? RECENT_PART : "")}
      {...panHandlers}
      collapsable={false}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={ws.title}
        accessibilityHint={
          web
            ? "Right-click for more. Drag between workspaces to reorder, onto a folder to file it, or onto another workspace to move its conversations there"
            : "Long press for more"
        }
        onPress={props.onOpen}
        // With a mouse, holding the button starts a drag; the menu is on right-click.
        onLongPress={web ? undefined : (event: GestureResponderEvent) => props.onMenu(pointOf(event))}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        delayLongPress={450}
        style={style}
        {...contextMenu}
      >
        <WorkspaceIcon workspace={ws} theme={theme} />
        <Text numberOfLines={1} style={{ flex: 1, color: theme.colors.foreground, fontSize: 13 }}>
          {ws.title}
        </Text>
        {props.pinned ? <Icon name="Pin" size={12} color={muted} /> : null}
        {count > 1 && props.onToggle ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={props.listing ? `Hide the conversations in ${ws.title}` : `Show the ${count} conversations in ${ws.title}`}
            onPress={props.onToggle}
            hitSlop={6}
            style={{ flexDirection: "row", alignItems: "center", gap: 1 }}
          >
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>{count}</Text>
            <Icon name={props.listing ? "ChevronDown" : "ChevronRight"} size={12} color={theme.colors.foregroundMuted} />
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`More for ${ws.title}`}
          onPress={(event) => props.onMenu(pointOf(event))}
          hitSlop={6}
          style={{ width: 18, alignItems: "center", opacity: hovered || props.active ? 1 : 0 }}
        >
          <Icon name="EllipsisVertical" size={14} color={theme.colors.foregroundMuted} />
        </Pressable>
      </Pressable>
    </View>
  );
}

/** One conversation of a listed workspace, indented under it; drag it out to move it. */
function ConversationItem(props: {
  ws: ListedWorkspace;
  agent: ListedAgent;
  theme: PluginTheme;
  lifted: boolean;
  /** A drag is over this conversation's workspace. */
  dropTarget: boolean;
  dragRef: { current: DragApi };
  onOpen(): void;
}) {
  const { ws, agent, theme } = props;
  const [hovered, setHovered] = useState(false);
  const panHandlers = useRowDrag(props.dragRef, () => ({ kind: "conversation", ws, agent }));
  const style = (state: PressableStateCallbackType) => ({
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    marginHorizontal: 8,
    paddingLeft: 41,
    paddingRight: 5,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "transparent",
    opacity: props.lifted ? 0.5 : 1,
    backgroundColor: rowBackground(theme, { dropTarget: props.dropTarget, pressed: state.pressed, hovered }),
  });
  return (
    <View nativeID={dropNodeId({ kind: "workspace", id: ws.id }, agent.id)} {...panHandlers} collapsable={false}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={agent.title}
        accessibilityHint="Drag onto another workspace to move it there, or onto a folder to give it a workspace of its own"
        onPress={props.onOpen}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        style={style}
      >
        <ProviderMark provider={agent.provider} theme={theme} size={12} />
        <Text numberOfLines={1} style={{ flex: 1, color: theme.colors.foregroundMuted, fontSize: 12 }}>
          {agent.title}
        </Text>
        <BucketIndicator bucket={agent.bucket} theme={theme} />
      </Pressable>
    </View>
  );
}
