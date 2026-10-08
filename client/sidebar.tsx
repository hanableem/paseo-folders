import type { PluginTheme } from "@getpaseo/plugin";
import { type PluginSidebarItemProps, usePaseo } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type GestureResponderEvent,
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
  type ListedWorkspace,
  markAutoTitle,
  mostCommon,
  moveWorkspace,
  parseRoute,
  UNSORTED_ID,
  workspaceFolderOf,
} from "../shared/model";
import { debugLog, useAutoImport, useAutoTitle, useDirectory, useFolders } from "./data";
import { type MenuPoint, RowMenu, tint } from "./menu";
import { BucketIndicator, mostUrgent, WorkspaceIcon } from "./status";
import { currentPathname } from "./web-dom";

/** Rows listed under an open folder before Show more. */
const MAX_ROWS_PER_FOLDER = 8;
/** Mouse drags start after this many pixels. */
const MOUSE_DRAG_SLOP = 6;
/** How often the desktop app's address is read to follow the open workspace. */
const ROUTE_POLL_MS = 400;
/** A workspace made from a folder is listed before its first conversation for this long. */
const FRESH_MS = 30 * 60_000;
const OWN_PLUGIN_ID = "paseo-folders";

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Folders of workspaces, like Paseo's own list but grouped. One folder is open
 * at a time so every folder stays on screen as a drop target. With a mouse, drag
 * a workspace onto a folder; right-click or long-press it for the menu, which
 * also moves it.
 */
export function FoldersSidebarItem({ theme, currentScreen, openScreen }: PluginSidebarItemProps) {
  const toast = useToast();
  const paseo = usePaseo();
  const folders = useFolders();
  const { workspaces: listed, workspaceMeta, loading } = useDirectory();
  const { height: windowHeight } = useWindowDimensions();
  const closeMenu = useCallback(() => setMenu(null), []);
  const [expanded, setExpanded] = useState(true);
  const [openFolder, setOpenFolder] = useState<string | null>(null);
  const [showAll, setShowAll] = useState<ReadonlySet<string>>(new Set());
  const [drag, setDrag] = useState<{ ws: ListedWorkspace; y: number } | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [pointerFolder, setPointerFolder] = useState<string | null>(null);
  const [menu, setMenu] = useState<{
    ws: ListedWorkspace;
    at: MenuPoint;
    bounds: { left: number; width: number } | null;
  } | null>(null);
  const [fresh, setFresh] = useState<ReadonlyMap<string, string>>(() => new Map(freshWorkspaces));
  const [creating, setCreating] = useState<string | null>(null);
  const container = useRef<View | null>(null);
  const containerTop = useRef(0);
  const folderViews = useRef(new Map<string, View | null>());
  const folderRects = useRef(new Map<string, Rect>());
  const dragging = useRef<ListedWorkspace | null>(null);
  const ready = folders.status === "ready" ? folders : null;

  // A workspace made from a folder has no conversation yet, so Paseo lists no agent
  // for it. Show it until its first conversation arrives.
  const workspaces = useMemo(() => {
    const now = Date.now();
    const known = new Set(listed.map((ws) => ws.id));
    const extra: ListedWorkspace[] = [];
    for (const [id, at] of fresh) {
      if (!known.has(id) && now - Date.parse(at) < FRESH_MS) {
        extra.push({ id, title: workspaceMeta.get(id)?.title || "New workspace", agents: [], activityAt: at });
      }
    }
    return extra.length > 0 ? [...extra, ...listed] : listed;
  }, [listed, fresh, workspaceMeta]);
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

  const byFolder = useMemo(() => {
    const map = new Map<string, ListedWorkspace[]>();
    if (!ready) return map;
    for (const ws of workspaces) {
      const id = workspaceFolderOf(ready.doc, ws);
      const list = map.get(id) ?? [];
      list.push(ws);
      map.set(id, list);
    }
    return map;
  }, [ready, workspaces]);

  const activeScreen = currentScreen?.screenId ?? null;
  const muted = { color: theme.colors.foregroundMuted, fontSize: 12 };
  const unsortedCount = byFolder.get(UNSORTED_ID)?.length ?? 0;
  // With nothing chosen, show Unsorted open so new workspaces are easy to file.
  const shownFolder = openFolder ?? (unsortedCount > 0 ? UNSORTED_ID : null);

  const openWorkspace = (ws: ListedWorkspace) => {
    showing.expect(ws.id);
    openScreen({ screenId: "open", params: { workspaceId: ws.id, name: ws.title } });
  };

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
      openWorkspace({ id: created.id, title: "New workspace", agents: [], activityAt: at });
    } catch {
      toast.error("Could not make a workspace. Try Paseo's New workspace instead.");
    } finally {
      setCreating(null);
    }
  }

  async function moveTo(ws: ListedWorkspace, folderId: string, folderName: string) {
    if (!ready || workspaceFolderOf(ready.doc, ws) === folderId) return;
    const ok = await ready.update((d) => moveWorkspace(d, ws.id, folderId));
    debugLog("drop", { ok, unsorted: folderId === UNSORTED_ID });
    if (!ok) toast.error("Could not move. Try again.");
    else toast.show(`Moved to ${folderName}`, { variant: "success" });
  }

  const nameOf = (folderId: string) =>
    folderId === UNSORTED_ID ? "Unsorted" : ready?.doc.folders.find((f) => f.id === folderId)?.name ?? "";

  const hitTest = (x: number, y: number): string | null => {
    for (const [id, r] of folderRects.current) {
      if (x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height) return id;
    }
    return null;
  };

  const openMenu = (ws: ListedWorkspace, at: MenuPoint) => {
    setMenu({ ws, at, bounds: null });
    container.current?.measureInWindow((x, _y, width) => {
      setMenu((m) => (m && m.ws.id === ws.id ? { ...m, bounds: { left: x, width } } : m));
    });
    debugLog("menu", { platform: Platform.OS, x: Math.round(at.x), y: Math.round(at.y) });
  };

  const dragApi: DragApi = {
    start(ws, x, y) {
      dragging.current = ws;
      setMenu(null);
      folderRects.current.clear();
      for (const [id, view] of folderViews.current) {
        view?.measureInWindow((rx, ry, width, height) => folderRects.current.set(id, { x: rx, y: ry, width, height }));
      }
      container.current?.measureInWindow((_x, cy) => {
        containerTop.current = cy;
      });
      setDrag({ ws, y });
      debugLog("drag-start", { platform: Platform.OS, targets: folderViews.current.size, x, y });
    },
    move(x, y) {
      setDrag((d) => (d ? { ...d, y } : d));
      setHoverId(hitTest(x, y));
    },
    end(x, y) {
      const ws = dragging.current;
      dragging.current = null;
      const target = x === null || y === null ? null : hitTest(x, y);
      debugLog("drag-end", { hit: target !== null, x, y });
      setDrag(null);
      setHoverId(null);
      if (ws && target) void moveTo(ws, target, nameOf(target));
    },
  };
  const dragRef = useRef(dragApi);
  dragRef.current = dragApi;

  const chevron = (open: boolean, label: string, onPress: () => void) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={8}>
      <Icon name={open ? "ChevronDown" : "ChevronRight"} size={14} color={theme.colors.foregroundMuted} />
    </Pressable>
  );

  const header = (
    <SidebarRow
      id="folders"
      icon="Folders"
      label="Folders"
      active={activeScreen === "overview"}
      onPress={() => openScreen({ screenId: "overview" })}
      trailing={chevron(expanded, expanded ? "Collapse folders" : "Expand folders", () => setExpanded((v) => !v))}
    />
  );
  if (!ready || !expanded) return header;

  const groups = [{ id: UNSORTED_ID, name: "Unsorted" }, ...ready.doc.folders];
  return (
    <View ref={container} collapsable={false} style={menu ? { zIndex: 1000 } : null}>
      {header}
      {/* Paseo's sidebar header does not scroll, so the folders scroll on their own when tall. */}
      <ScrollView style={{ maxHeight: Math.max(240, windowHeight * 0.6) }} scrollEnabled={!drag}>
      {groups.map((folder) => {
        const list = byFolder.get(folder.id) ?? [];
        const isUnsorted = folder.id === UNSORTED_ID;
        if (isUnsorted && list.length === 0 && !drag) return null;
        const open = shownFolder === folder.id;
        const all = showAll.has(folder.id);
        const shown = open ? (all ? list : list.slice(0, MAX_ROWS_PER_FOLDER)) : [];
        const toggleAll = () =>
          setShowAll((prev) => {
            const next = new Set(prev);
            if (next.has(folder.id)) next.delete(folder.id);
            else next.add(folder.id);
            return next;
          });
        // Like Paseo's groups: a collapsed folder shows its most urgent status.
        const status = open ? "done" : mostUrgent(list);
        // Like Paseo's project rows: + on hover makes a new workspace here. Touch screens show it on the open folder.
        const canCreate = !isUnsorted && !drag && (pointerFolder === folder.id || (Platform.OS !== "web" && open));
        const hoverHandlers = {
          onMouseEnter: () => setPointerFolder(folder.id),
          onMouseLeave: () => setPointerFolder((id) => (id === folder.id ? null : id)),
        } as object;
        return (
          <Fragment key={folder.id}>
            <View
              ref={(view) => {
                folderViews.current.set(folder.id, view);
              }}
              collapsable={false}
              {...hoverHandlers}
              style={
                hoverId === folder.id
                  ? { backgroundColor: theme.colors.surface2, borderRadius: 6, borderWidth: 1, borderColor: theme.colors.accent }
                  : null
              }
            >
              <SidebarRow
                id={`folder-${folder.id}`}
                icon={drag ? "FolderInput" : isUnsorted ? "Inbox" : open ? "FolderOpen" : "Folder"}
                label={folder.name}
                active={false}
                onPress={() => setOpenFolder(open ? "" : folder.id)}
                trailing={
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    {isUnsorted ? null : (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`New workspace in ${folder.name}`}
                        disabled={!canCreate || creating !== null}
                        onPress={() => void createIn(folder.id, folder.name)}
                        hitSlop={6}
                        style={{ opacity: canCreate || creating === folder.id ? 1 : 0 }}
                      >
                        <Icon name="Plus" size={14} color={theme.colors.foregroundMuted} />
                      </Pressable>
                    )}
                    <BucketIndicator bucket={status} theme={theme} />
                    <Text style={muted}>{list.length}</Text>
                    {drag
                      ? null
                      : chevron(open, open ? `Collapse ${folder.name}` : `Expand ${folder.name}`, () =>
                          setOpenFolder(open ? "" : folder.id),
                        )}
                  </View>
                }
              />
            </View>
            {shown.map((ws) => (
              <WorkspaceItem
                key={ws.id}
                ws={ws}
                theme={theme}
                active={showing.id === ws.id}
                lifted={drag?.ws.id === ws.id}
                dragRef={dragRef}
                onOpen={() => openWorkspace(ws)}
                onMenu={(at) => openMenu(ws, at)}
              />
            ))}
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
      </ScrollView>
      {drag ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: 12,
            right: 12,
            top: drag.y - containerTop.current - 14,
            paddingHorizontal: 10,
            paddingVertical: 6,
            borderRadius: 6,
            backgroundColor: theme.colors.surface2,
            borderWidth: 1,
            borderColor: theme.colors.accent,
            opacity: 0.95,
          }}
        >
          <Text numberOfLines={1} style={{ color: theme.colors.foreground, fontSize: 13 }}>
            {drag.ws.title}
          </Text>
        </View>
      ) : null}
      {menu ? (
        <RowMenu
          ws={menu.ws}
          meta={workspaceMeta.get(menu.ws.id)}
          at={menu.at}
          bounds={menu.bounds}
          theme={theme}
          folders={ready}
          onClose={closeMenu}
          onArchived={(id) => {
            if (freshWorkspaces.delete(id)) setFresh(new Map(freshWorkspaces));
          }}
        />
      ) : null}
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
  start(ws: ListedWorkspace, x: number, y: number): void;
  move(x: number, y: number): void;
  end(x: number | null, y: number | null): void;
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

/** A workspace row with Paseo-style status, its title, and how many conversations it holds. */
function WorkspaceItem(props: {
  ws: ListedWorkspace;
  theme: PluginTheme;
  active: boolean;
  lifted: boolean;
  dragRef: { current: DragApi };
  onOpen(): void;
  onMenu(at: MenuPoint): void;
}) {
  const { ws, theme, dragRef } = props;
  const [hovered, setHovered] = useState(false);
  const latest = useRef(ws);
  latest.current = ws;
  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        // Mouse only: on touch screens a long press opens the menu, which can move it.
        onMoveShouldSetPanResponderCapture: (_e, g) =>
          Platform.OS === "web" && Math.abs(g.dx) + Math.abs(g.dy) > MOUSE_DRAG_SLOP,
        onPanResponderGrant: (_e, g) => dragRef.current.start(latest.current, g.moveX || g.x0, g.moveY || g.y0),
        onPanResponderMove: (_e, g) => dragRef.current.move(g.moveX, g.moveY),
        onPanResponderRelease: (_e, g) => dragRef.current.end(g.moveX, g.moveY),
        onPanResponderTerminate: () => dragRef.current.end(null, null),
        onPanResponderTerminationRequest: () => false,
      }),
    [dragRef],
  );
  // Selected, pressed and hovered rows darken like Paseo's own list.
  const style = (state: PressableStateCallbackType) => ({
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    marginHorizontal: 8,
    paddingLeft: 26,
    paddingRight: 6,
    paddingVertical: 6,
    borderRadius: 8,
    opacity: props.lifted ? 0.5 : 1,
    backgroundColor: props.active
      ? tint(theme.colors.foreground, 0.09)
      : state.pressed
        ? tint(theme.colors.foreground, 0.12)
        : hovered
          ? tint(theme.colors.foreground, 0.05)
          : "transparent",
  });
  // React Native Web forwards onContextMenu to the DOM; native platforms ignore it.
  const contextMenu = {
    onContextMenu: (event: { preventDefault?: () => void }) => {
      event.preventDefault?.();
      props.onMenu(pointOf(event));
    },
  } as object;
  const count = ws.agents.length;
  return (
    <View {...pan.panHandlers} collapsable={false}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={ws.title}
        accessibilityHint="Right-click or long press for more, or drag onto a folder"
        onPress={props.onOpen}
        onLongPress={(event: GestureResponderEvent) => props.onMenu(pointOf(event))}
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
        {count > 1 ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>{count}</Text> : null}
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
