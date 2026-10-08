import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { Fragment, useMemo, useRef, useState } from "react";
import { PanResponder, Platform, Pressable, type PressableStateCallbackType, Text, View } from "react-native";
import { type ListedWorkspace, moveWorkspace, UNSORTED_ID, workspaceFolderOf } from "../shared/model";
import { debugLog, useAutoImport, useDirectory, useFolders } from "./data";
import { StatusIcon } from "./ui";

/** Rows listed under an open folder; the rest are one press away. */
const MAX_ROWS_PER_FOLDER = 8;
/** Mouse drags start after this many pixels; touch drags start after a long press. */
const MOUSE_DRAG_SLOP = 6;

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Folders of workspaces, like Paseo's own list but grouped. One folder is open
 * at a time so every folder stays on screen as a drop target. Drag a workspace
 * onto a folder to move it (long-press first on touch screens), or long-press
 * it and tap a folder.
 */
export function FoldersSidebarItem({ theme, currentScreen, openScreen }: PluginSidebarItemProps) {
  const toast = useToast();
  const folders = useFolders();
  const { workspaces, loading } = useDirectory();
  useAutoImport(folders, workspaces, !loading);
  const [expanded, setExpanded] = useState(true);
  const [openFolder, setOpenFolder] = useState<string | null>(null);
  const [moving, setMoving] = useState<ListedWorkspace | null>(null);
  const [drag, setDrag] = useState<{ ws: ListedWorkspace; y: number } | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
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

  const dragApi: DragApi = {
    start(ws, x, y) {
      dragging.current = ws;
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
      setMoving(null);
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

  const picking = moving ?? drag?.ws ?? null;
  const groups = [{ id: UNSORTED_ID, name: "Unsorted" }, ...ready.doc.folders];
  return (
    <View ref={container} collapsable={false}>
      {header}
      {moving && !drag ? (
        <SidebarRow
          id="moving"
          icon="X"
          label={`Tap a folder for “${moving.title}”, or tap here to cancel`}
          onPress={() => setMoving(null)}
        />
      ) : null}
      {groups.map((folder) => {
        const list = byFolder.get(folder.id) ?? [];
        const isUnsorted = folder.id === UNSORTED_ID;
        if (isUnsorted && list.length === 0 && !picking) return null;
        const open = shownFolder === folder.id;
        const shown = open ? list.slice(0, MAX_ROWS_PER_FOLDER) : [];
        const running = list.some((ws) => ws.agents.some((a) => a.running));
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
                icon={picking ? "FolderInput" : isUnsorted ? "Inbox" : open ? "FolderOpen" : "Folder"}
                label={folder.name}
                active={activeScreen === "folder" && currentScreen?.params.id === folder.id}
                onPress={() => {
                  if (moving) {
                    const ws = moving;
                    setMoving(null);
                    void moveTo(ws, folder.id, folder.name);
                  } else setOpenFolder(open ? "" : folder.id);
                }}
                trailing={
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    {running && !open ? <StatusIcon running attention={false} icon="Folder" theme={theme} size={12} /> : null}
                    <Text style={muted}>{list.length}</Text>
                    {picking
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
                lifted={picking?.id === ws.id}
                dragRef={dragRef}
                onOpen={() => openScreen({ screenId: "open", params: { workspaceId: ws.id, name: ws.title } })}
                onLongPress={() => {
                  debugLog("long-press", { platform: Platform.OS });
                  setMoving(ws);
                }}
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
    </View>
  );
}

interface DragApi {
  start(ws: ListedWorkspace, x: number, y: number): void;
  move(x: number, y: number): void;
  end(x: number | null, y: number | null): void;
}

/** A workspace row: status like Paseo's own list, its title, and how many conversations it holds. */
function WorkspaceItem(props: {
  ws: ListedWorkspace;
  theme: PluginTheme;
  active: boolean;
  lifted: boolean;
  dragRef: { current: DragApi };
  onOpen(): void;
  onLongPress(): void;
}) {
  const { ws, theme, dragRef } = props;
  const armed = useRef(false);
  const latest = useRef(ws);
  latest.current = ws;
  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponderCapture: (_e, g) =>
          armed.current || (Platform.OS === "web" && Math.abs(g.dx) + Math.abs(g.dy) > MOUSE_DRAG_SLOP),
        onPanResponderGrant: (_e, g) => {
          armed.current = true;
          dragRef.current.start(latest.current, g.moveX || g.x0, g.moveY || g.y0);
        },
        onPanResponderMove: (_e, g) => dragRef.current.move(g.moveX, g.moveY),
        onPanResponderRelease: (_e, g) => {
          armed.current = false;
          dragRef.current.end(g.moveX, g.moveY);
        },
        onPanResponderTerminate: () => {
          armed.current = false;
          dragRef.current.end(null, null);
        },
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
  const count = ws.agents.length;
  return (
    <View {...pan.panHandlers} collapsable={false}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={ws.title}
        accessibilityHint="Drag onto a folder, or long press and then tap a folder"
        onPress={props.onOpen}
        onLongPress={() => {
          armed.current = true;
          props.onLongPress();
        }}
        onPressOut={() => {
          if (!armed.current) return;
          setTimeout(() => {
            armed.current = false;
          }, 0);
        }}
        delayLongPress={350}
        style={style}
      >
        <StatusIcon
          running={ws.agents.some((a) => a.running)}
          attention={ws.agents.some((a) => a.attention)}
          icon={count > 1 ? "MessagesSquare" : "MessageSquare"}
          theme={theme}
          size={13}
        />
        <Text numberOfLines={1} style={{ flex: 1, color: theme.colors.foreground, fontSize: 13 }}>
          {ws.title}
        </Text>
        {count > 1 ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>{count}</Text> : null}
      </Pressable>
    </View>
  );
}
