import type { PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { useMemo, useState } from "react";
import { Pressable, Text } from "react-native";
import { countByFolder, UNSORTED_ID } from "../shared/model";
import { useAutoImport, useFolders, useTopLevelAgents } from "./data";

/** A "Folders" row, then one row per folder with its conversation count. */
export function FoldersSidebarItem({ theme, currentScreen, openScreen }: PluginSidebarItemProps) {
  const folders = useFolders();
  useAutoImport(folders);
  const { agents } = useTopLevelAgents();
  const [expanded, setExpanded] = useState(true);
  const ready = folders.status === "ready" ? folders : null;
  const counts = useMemo(() => (ready ? countByFolder(ready.doc, agents) : {}), [ready, agents]);
  const openFolderId = currentScreen?.screenId === "folder" ? currentScreen.params.id : null;
  const muted = { color: theme.colors.foregroundMuted, fontSize: 12 };

  const header = (
    <SidebarRow
      id="folders"
      icon="Folders"
      label="Folders"
      active={currentScreen?.screenId === "overview"}
      onPress={() => openScreen({ screenId: "overview" })}
      trailing={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={expanded ? "Collapse folders" : "Expand folders"}
          onPress={() => setExpanded((v) => !v)}
          hitSlop={8}
        >
          <Icon name={expanded ? "ChevronDown" : "ChevronRight"} size={14} color={theme.colors.foregroundMuted} />
        </Pressable>
      }
    />
  );
  if (!ready || !expanded) return header;
  const unsorted = counts[UNSORTED_ID] ?? 0;
  return (
    <>
      {header}
      {ready.doc.folders.map((folder) => (
        <SidebarRow
          key={folder.id}
          id={`folder-${folder.id}`}
          icon={openFolderId === folder.id ? "FolderOpen" : "Folder"}
          label={folder.name}
          active={openFolderId === folder.id}
          trailing={<Text style={muted}>{counts[folder.id] ?? 0}</Text>}
          onPress={() => openScreen({ screenId: "folder", params: { id: folder.id, name: folder.name } })}
        />
      ))}
      {unsorted > 0 ? (
        <SidebarRow
          id="folder-unsorted"
          icon="Inbox"
          label="Unsorted"
          active={openFolderId === UNSORTED_ID}
          trailing={<Text style={muted}>{unsorted}</Text>}
          onPress={() => openScreen({ screenId: "folder", params: { id: UNSORTED_ID, name: "Unsorted" } })}
        />
      ) : null}
    </>
  );
}
