import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { Fragment, useMemo, useRef, useState } from "react";
import {
  type GestureResponderEvent,
  PanResponder,
  Platform,
  Pressable,
  type PressableStateCallbackType,
  Text,
  View,
} from "react-native";
import { type ListedWorkspace, moveWorkspace, UNSORTED_ID, workspaceBucket, workspaceFolderOf } from "../shared/model";
import { debugLog, useAutoImport, useDirectory, useFolders } from "./data";
import { RowMenu } from "./menu";
import { StatusRing, WorkspaceIcon } from "./status";

/** Rows listed under an open folder; the rest are one press away. */
const MAX_ROWS_PER_FOLDER = 8;
/** Mouse drags start after this many pixels. */
const MOUSE_DRAG_SLOP = 6;

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
  const folders = useFolders();
  const { workspaces, loading } = useDirectory();
  useAutoImport(folders, workspaces, !loading);
  const [expanded, setExpanded] = useState(true);
  const [openFolder, setOpenFolder] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ ws: ListedWorkspace; y: number } | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ ws: ListedWorkspace; top: number } | null>(null);
  const container = useRef<View | null>(null);
  const containerTop = useRef(0);
  const folderViews = useRef(new Map<string, View | null>());
  const folderRects = useRef(new Map<string, Rect>());
  const dragging = useRef<ListedWorkspace | null>(null);
  const ready = folders.status === "ready" ? folders : null;

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
  const openWorkspaceId = activeScreen === "open" ? currentScreen?.params.workspaceId : null;
  const muted = { color: theme.colors.foregroundMuted, fontSize: 12 };
  const unsortedCount = byFolder.get(UNSORTED_ID)?.length ?? 0;
  // With nothing chosen, show Unsorted open so new workspaces are easy to file.
  const shownFolder = openFolder ?? (unsortedCount > 0 ? UNSORTED_ID : null);

  const openWorkspace = (ws: ListedWorkspace) =>
    openScreen({ screenId: "open", params: { workspaceId: ws.id, name: ws.title } });

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

  const openMenu = (ws: ListedWorkspace, pageY: number) => {
    const place = (top: number) => setMenu({ ws, top: Math.max(0, pageY - top - 8) });
    if (container.current) container.current.measureInWindow((_x, y) => place(y));
    else place(0);
    debugLog("menu", { platform: Platform.OS });
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
    <View ref={container} collapsable={false}>
      {header}
      {groups.map((folder) => {
        const list = byFolder.get(folder.id) ?? [];
        const isUnsorted = folder.id === UNSORTED_ID;
        if (isUnsorted && list.length === 0 && !drag) return null;
        const open = shownFolder === folder.id;
        const shown = open ? list.slice(0, MAX_ROWS_PER_FOLDER) : [];
        const running = list.some((ws) => workspaceBucket(ws) === "running");
        return (
          <Fragment key={folder.id}>
            <View
              ref={(view) => {
                folderViews.current.set(folder.id, view);
              }}
              collapsable={false}
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
                active={activeScreen === "folder" && currentScreen?.params.id === folder.id}
                onPress={() => setOpenFolder(open ? "" : folder.id)}
                trailing={
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    {running && !open ? <StatusRing theme={theme} /> : null}
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
                active={openWorkspaceId === ws.id}
                lifted={drag?.ws.id === ws.id}
                dragRef={dragRef}
                onOpen={() => openWorkspace(ws)}
                onMenu={(pageY) => openMenu(ws, pageY)}
              />
            ))}
            {open && list.length > shown.length ? (
              <SidebarRow
                id={`more-${folder.id}`}
                icon="CornerDownRight"
                label={`All ${list.length} in ${folder.name}`}
                onPress={() => openScreen({ screenId: "folder", params: { id: folder.id, name: folder.name } })}
              />
            ) : null}
          </Fragment>
        );
      })}
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
          top={menu.top}
          theme={theme}
          folders={ready}
          onOpen={() => openWorkspace(menu.ws)}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </View>
  );
}

interface DragApi {
  start(ws: ListedWorkspace, x: number, y: number): void;
  move(x: number, y: number): void;
  end(x: number | null, y: number | null): void;
}

function pageYOf(event: unknown): number {
  const e = event as { nativeEvent?: { pageY?: number; clientY?: number }; pageY?: number; clientY?: number };
  return e.nativeEvent?.pageY ?? e.nativeEvent?.clientY ?? e.pageY ?? e.clientY ?? 0;
}

/** A workspace row with Paseo-style status, its title, and how many conversations it holds. */
function WorkspaceItem(props: {
  ws: ListedWorkspace;
  theme: PluginTheme;
  active: boolean;
  lifted: boolean;
  dragRef: { current: DragApi };
  onOpen(): void;
  onMenu(pageY: number): void;
}) {
  const { ws, theme, dragRef } = props;
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
  const style = (state: PressableStateCallbackType) => {
    // React Native Web also reports hover; native platforms omit it.
    const hovered = (state as PressableStateCallbackType & { hovered?: boolean }).hovered;
    return {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 8,
      marginHorizontal: 8,
      paddingLeft: 26,
      paddingRight: 10,
      paddingVertical: 5,
      borderRadius: 6,
      opacity: props.lifted ? 0.5 : 1,
      backgroundColor: props.active || state.pressed || hovered ? theme.colors.surface2 : "transparent",
    };
  };
  // React Native Web forwards onContextMenu to the DOM; native platforms ignore it.
  const contextMenu = {
    onContextMenu: (event: { preventDefault?: () => void }) => {
      event.preventDefault?.();
      props.onMenu(pageYOf(event));
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
        onLongPress={(event: GestureResponderEvent) => props.onMenu(pageYOf(event))}
        delayLongPress={450}
        style={style}
        {...contextMenu}
      >
        <WorkspaceIcon workspace={ws} theme={theme} />
        <Text numberOfLines={1} style={{ flex: 1, color: theme.colors.foreground, fontSize: 13 }}>
          {ws.title}
        </Text>
        {count > 1 ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>{count}</Text> : null}
      </Pressable>
    </View>
  );
}
