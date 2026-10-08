import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { Fragment, useMemo, useRef, useState } from "react";
import {
  PanResponder,
  Platform,
  Pressable,
  type PressableStateCallbackType,
  Text,
  View,
} from "react-native";
import { byRecentActivity, folderOf, type ListedAgent, moveAgent, UNSORTED_ID } from "../shared/model";
import { debugLog, useAutoImport, useFolders, useTopLevelAgents } from "./data";
import { refreshFolderPills } from "./pills";

const MAX_ROWS_PER_FOLDER = 25;
/** Mouse drags start after this many pixels; touch drags start after a long press. */
const MOUSE_DRAG_SLOP = 6;

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface DragState {
  agent: ListedAgent;
  x: number;
  y: number;
}

/**
 * A "Folders" row, then Unsorted and one row per folder. Expanding a folder
 * lists its active conversations. Drag a conversation onto a folder to move it
 * (long-press first on touch screens), or long-press it and tap a folder.
 */
export function FoldersSidebarItem({ theme, currentScreen, openScreen }: PluginSidebarItemProps) {
  const toast = useToast();
  const folders = useFolders();
  useAutoImport(folders);
  const { agents } = useTopLevelAgents();
  const [expanded, setExpanded] = useState(true);
  const [toggled, setToggled] = useState<ReadonlySet<string>>(new Set());
  const [moving, setMoving] = useState<ListedAgent | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const container = useRef<View | null>(null);
  const containerTop = useRef(0);
  const folderViews = useRef(new Map<string, View | null>());
  const folderRects = useRef(new Map<string, Rect>());
  const dragAgent = useRef<ListedAgent | null>(null);
  const ready = folders.status === "ready" ? folders : null;

  const byFolder = useMemo(() => {
    const map = new Map<string, ListedAgent[]>();
    if (!ready) return map;
    for (const agent of agents) {
      if (agent.archived) continue;
      const id = folderOf(ready.doc, agent.id);
      const list = map.get(id) ?? [];
      list.push(agent);
      map.set(id, list);
    }
    for (const list of map.values()) list.sort(byRecentActivity);
    return map;
  }, [ready, agents]);

  const activeScreen = currentScreen?.screenId ?? null;
  const openAgentId = activeScreen === "open" ? currentScreen?.params.agentId : null;
  const muted = { color: theme.colors.foregroundMuted, fontSize: 12 };

  // Unsorted starts open so new conversations are easy to file; folders start closed.
  const isOpen = (id: string) => (id === UNSORTED_ID) !== toggled.has(id);
  const toggle = (id: string) =>
    setToggled((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function moveTo(agent: ListedAgent, folderId: string, folderName: string) {
    if (!ready) return;
    if (folderOf(ready.doc, agent.id) === folderId) return;
    const ok = await ready.update((d) => moveAgent(d, agent.id, folderId));
    debugLog("drop", { ok, unsorted: folderId === UNSORTED_ID });
    if (!ok) {
      toast.error("Could not move. Try again.");
      return;
    }
    toast.show(`Moved to ${folderName}`, { variant: "success" });
    refreshFolderPills();
  }

  const hitTest = (x: number, y: number): string | null => {
    for (const [id, r] of folderRects.current) {
      if (x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height) return id;
    }
    return null;
  };

  const measureTargets = () => {
    folderRects.current.clear();
    for (const [id, view] of folderViews.current) {
      view?.measureInWindow((x, y, width, height) => {
        folderRects.current.set(id, { x, y, width, height });
      });
    }
    container.current?.measureInWindow((_x, y) => {
      containerTop.current = y;
    });
  };

  const dragApi = {
    start(agent: ListedAgent, x: number, y: number) {
      dragAgent.current = agent;
      measureTargets();
      setDrag({ agent, x, y });
      debugLog("drag-start", { platform: Platform.OS, targets: folderViews.current.size, x, y });
    },
    move(x: number, y: number) {
      setDrag((d) => (d ? { ...d, x, y } : d));
      setHoverId(hitTest(x, y));
    },
    end(x: number | null, y: number | null) {
      const agent = dragAgent.current;
      dragAgent.current = null;
      const target = x === null || y === null ? null : hitTest(x, y);
      debugLog("drag-end", { hit: target !== null, x, y, rects: folderRects.current.size });
      setDrag(null);
      setHoverId(null);
      setMoving(null);
      if (!agent || !target || !ready) return;
      const name = target === UNSORTED_ID ? "Unsorted" : ready.doc.folders.find((f) => f.id === target)?.name ?? "";
      void moveTo(agent, target, name);
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

  const picking = moving ?? drag?.agent ?? null;
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
        if (folder.id === UNSORTED_ID && list.length === 0 && !picking) return null;
        const open = isOpen(folder.id);
        const shown = open ? list.slice(0, MAX_ROWS_PER_FOLDER) : [];
        const isUnsorted = folder.id === UNSORTED_ID;
        const hovered = hoverId === folder.id;
        return (
          <Fragment key={folder.id}>
            <View
              ref={(view) => {
                folderViews.current.set(folder.id, view);
              }}
              collapsable={false}
              style={
                hovered
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
                    const agent = moving;
                    setMoving(null);
                    void moveTo(agent, folder.id, folder.name);
                  } else toggle(folder.id);
                }}
                trailing={
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Text style={muted}>{list.length}</Text>
                    {picking
                      ? null
                      : chevron(open, open ? `Collapse ${folder.name}` : `Expand ${folder.name}`, () => toggle(folder.id))}
                  </View>
                }
              />
            </View>
            {shown.map((agent) => (
              <ConversationRow
                key={agent.id}
                agent={agent}
                theme={theme}
                active={openAgentId === agent.id}
                lifted={picking?.id === agent.id}
                dragRef={dragRef}
                onOpen={() => openScreen({ screenId: "open", params: { agentId: agent.id, name: agent.title } })}
                onLongPress={() => {
                  debugLog("long-press", { platform: Platform.OS });
                  setMoving(agent);
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
            {drag.agent.title}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

interface DragApi {
  start(agent: ListedAgent, x: number, y: number): void;
  move(x: number, y: number): void;
  end(x: number | null, y: number | null): void;
}

function ConversationRow(props: {
  agent: ListedAgent;
  theme: PluginTheme;
  active: boolean;
  lifted: boolean;
  dragRef: { current: DragApi };
  onOpen(): void;
  onLongPress(): void;
}) {
  const { agent, theme, dragRef } = props;
  const armed = useRef(false);
  const latestAgent = useRef(agent);
  latestAgent.current = agent;

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponderCapture: (_e, g) =>
          armed.current || (Platform.OS === "web" && Math.abs(g.dx) + Math.abs(g.dy) > MOUSE_DRAG_SLOP),
        onPanResponderGrant: (_e, g) => {
          armed.current = true;
          dragRef.current.start(latestAgent.current, g.moveX || g.x0, g.moveY || g.y0);
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
  return (
    <View {...pan.panHandlers} collapsable={false}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={agent.title}
        accessibilityHint="Drag onto a folder, or long press and then tap a folder"
        onPress={props.onOpen}
        onLongPress={() => {
          armed.current = true;
          props.onLongPress();
        }}
        onPressOut={() => {
          // A long press without a drag leaves tap-to-move mode on; it does not arm a later press.
          if (!armed.current) return;
          setTimeout(() => {
            armed.current = false;
          }, 0);
        }}
        delayLongPress={350}
        style={style}
      >
        <Icon name="MessageSquare" size={13} color={theme.colors.foregroundMuted} />
        <Text numberOfLines={1} style={{ flex: 1, color: theme.colors.foreground, fontSize: 13 }}>
          {agent.title}
        </Text>
      </Pressable>
    </View>
  );
}
