import type { PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { Fragment, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { byRecentActivity, folderOf, type ListedAgent, UNSORTED_ID } from "../shared/model";
import { useAutoImport, useFolders, useTopLevelAgents } from "./data";

const MAX_ROWS_PER_FOLDER = 25;

/**
 * A "Folders" row, then one row per folder. Expanding a folder lists its active
 * conversations; pressing one opens it.
 */
export function FoldersSidebarItem({ theme, currentScreen, openScreen }: PluginSidebarItemProps) {
  const folders = useFolders();
  useAutoImport(folders);
  const { agents } = useTopLevelAgents();
  const [expanded, setExpanded] = useState(true);
  const [openFolders, setOpenFolders] = useState<ReadonlySet<string>>(new Set());
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
  const openFolderScreenId = activeScreen === "folder" ? currentScreen?.params.id : null;
  const openAgentId = activeScreen === "open" ? currentScreen?.params.agentId : null;
  const muted = { color: theme.colors.foregroundMuted, fontSize: 12 };

  const toggleFolder = (id: string) =>
    setOpenFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

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

  const groups = [...ready.doc.folders, { id: UNSORTED_ID, name: "Unsorted" }];
  return (
    <>
      {header}
      {groups.map((folder) => {
        const list = byFolder.get(folder.id) ?? [];
        if (folder.id === UNSORTED_ID && list.length === 0) return null;
        const isOpen = openFolders.has(folder.id);
        const shown = isOpen ? list.slice(0, MAX_ROWS_PER_FOLDER) : [];
        return (
          <Fragment key={folder.id}>
            <SidebarRow
              id={`folder-${folder.id}`}
              icon={folder.id === UNSORTED_ID ? "Inbox" : isOpen ? "FolderOpen" : "Folder"}
              label={folder.name}
              active={openFolderScreenId === folder.id}
              onPress={() => toggleFolder(folder.id)}
              trailing={
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text style={muted}>{list.length}</Text>
                  {chevron(isOpen, isOpen ? `Collapse ${folder.name}` : `Expand ${folder.name}`, () =>
                    toggleFolder(folder.id),
                  )}
                </View>
              }
            />
            {shown.map((agent) => (
              <SidebarRow
                key={agent.id}
                id={`agent-${agent.id}`}
                icon="CornerDownRight"
                label={agent.title}
                active={openAgentId === agent.id}
                onPress={() => openScreen({ screenId: "open", params: { agentId: agent.id, name: agent.title } })}
              />
            ))}
            {isOpen && list.length > shown.length ? (
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
