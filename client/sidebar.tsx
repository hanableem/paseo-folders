import type { PluginSidebarItemProps } from "@getpaseo/plugin/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { Fragment, useMemo, useState } from "react";
import { Pressable, type PressableStateCallbackType, Text, View } from "react-native";
import { byRecentActivity, folderOf, type ListedAgent, moveAgent, UNSORTED_ID } from "../shared/model";
import { useAutoImport, useFolders, useTopLevelAgents } from "./data";
import { refreshFolderPills } from "./pills";

const MAX_ROWS_PER_FOLDER = 25;

/**
 * A "Folders" row, then Unsorted and one row per folder. Expanding a folder
 * lists its active conversations. Long-press a conversation to pick it up,
 * then tap the folder it should go to.
 */
export function FoldersSidebarItem({ theme, currentScreen, openScreen }: PluginSidebarItemProps) {
  const toast = useToast();
  const folders = useFolders();
  useAutoImport(folders);
  const { agents } = useTopLevelAgents();
  const [expanded, setExpanded] = useState(true);
  const [toggled, setToggled] = useState<ReadonlySet<string>>(new Set());
  const [moving, setMoving] = useState<ListedAgent | null>(null);
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

  async function drop(folderId: string) {
    const agent = moving;
    setMoving(null);
    if (!agent || !ready) return;
    if (folderOf(ready.doc, agent.id) === folderId) return;
    const ok = await ready.update((d) => moveAgent(d, agent.id, folderId));
    if (!ok) toast.error("Could not move. Try again.");
    else refreshFolderPills();
  }

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
    <>
      {header}
      {moving ? (
        <SidebarRow
          id="moving"
          icon="X"
          label={`Tap a folder for “${moving.title}”, or tap here to cancel`}
          onPress={() => setMoving(null)}
        />
      ) : null}
      {groups.map((folder) => {
        const list = byFolder.get(folder.id) ?? [];
        if (folder.id === UNSORTED_ID && list.length === 0 && !moving) return null;
        const open = !moving && isOpen(folder.id);
        const shown = open ? list.slice(0, MAX_ROWS_PER_FOLDER) : [];
        const isUnsorted = folder.id === UNSORTED_ID;
        return (
          <Fragment key={folder.id}>
            <SidebarRow
              id={`folder-${folder.id}`}
              icon={moving ? "FolderInput" : isUnsorted ? "Inbox" : open ? "FolderOpen" : "Folder"}
              label={folder.name}
              active={activeScreen === "folder" && currentScreen?.params.id === folder.id}
              onPress={() => (moving ? void drop(folder.id) : toggle(folder.id))}
              trailing={
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text style={muted}>{list.length}</Text>
                  {moving
                    ? null
                    : chevron(open, open ? `Collapse ${folder.name}` : `Expand ${folder.name}`, () => toggle(folder.id))}
                </View>
              }
            />
            {shown.map((agent) => (
              <ConversationRow
                key={agent.id}
                agent={agent}
                theme={theme}
                active={openAgentId === agent.id}
                onOpen={() => openScreen({ screenId: "open", params: { agentId: agent.id, name: agent.title } })}
                onPickUp={() => setMoving(agent)}
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
    </>
  );
}

function ConversationRow(props: {
  agent: ListedAgent;
  theme: PluginTheme;
  active: boolean;
  onOpen(): void;
  onPickUp(): void;
}) {
  const { agent, theme } = props;
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
      backgroundColor: props.active || state.pressed || hovered ? theme.colors.surface2 : "transparent",
    };
  };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={agent.title}
      accessibilityHint="Long press to move it to another folder"
      onPress={props.onOpen}
      onLongPress={props.onPickUp}
      delayLongPress={400}
      style={style}
    >
      <Icon name="MessageSquare" size={13} color={theme.colors.foregroundMuted} />
      <Text numberOfLines={1} style={{ flex: 1, color: theme.colors.foreground, fontSize: 13 }}>
        {agent.title}
      </Text>
    </Pressable>
  );
}
