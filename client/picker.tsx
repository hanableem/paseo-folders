import type { PluginButtonContentProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { addFolder, folderOf, moveAgent, UNSORTED_ID } from "../shared/model";
import { useFolders } from "./data";
import { refreshFolderPills } from "./pills";
import { useStyles } from "./ui";

/** Opened from the folder pill beside an agent's composer. */
export function FolderPicker(props: PluginButtonContentProps) {
  const { theme, layout } = props;
  const styles = useStyles(theme, layout.compact);
  const folders = useFolders();
  const [newName, setNewName] = useState("");
  const [error, setError] = useState("");
  if (props.context !== "agent") return null;
  const agentId = props.agentId;
  if (folders.status !== "ready") return <Text style={styles.muted}>{folders.message}</Text>;
  const { doc } = folders;
  const current = folderOf(doc, agentId);

  async function moveTo(folderId: string) {
    if (folders.status !== "ready") return;
    const ok = await folders.update((d) => moveAgent(d, agentId, folderId));
    if (!ok) {
      setError("Could not save. Try again.");
      return;
    }
    refreshFolderPills();
    props.close();
  }

  async function createAndMove() {
    if (folders.status !== "ready") return;
    const name = newName.trim();
    if (!name) return;
    const ok = await folders.update((d) => {
      const withFolder = d.folders.some((f) => f.name === name) ? d : addFolder(d, name);
      const target = withFolder.folders.find((f) => f.name === name);
      return target ? moveAgent(withFolder, agentId, target.id) : withFolder;
    });
    if (!ok) {
      setError("Could not save. Try again.");
      return;
    }
    refreshFolderPills();
    props.close();
  }

  const choices = [...doc.folders, { id: UNSORTED_ID, name: "No folder" }];
  return (
    <View style={{ gap: 6, minWidth: 220 }}>
      {choices.map((f) => {
        const selected = f.id === current;
        return (
          <Pressable
            key={f.id}
            accessibilityRole="button"
            accessibilityLabel={`Move to ${f.name}`}
            accessibilityState={{ selected }}
            onPress={() => void moveTo(f.id)}
            style={[styles.row, selected ? { borderColor: theme.colors.accent } : null]}
          >
            <Icon
              name={selected ? "Check" : f.id === UNSORTED_ID ? "Inbox" : "Folder"}
              size={16}
              color={selected ? theme.colors.accent : theme.colors.foreground}
            />
            <Text style={styles.text} numberOfLines={1}>
              {f.name}
            </Text>
          </Pressable>
        );
      })}
      <View style={styles.toolbar}>
        <TextInput
          value={newName}
          onChangeText={setNewName}
          placeholder="New folder"
          placeholderTextColor={theme.colors.foregroundMuted}
          style={[styles.input, { flex: 1, minWidth: 140 }]}
          onSubmitEditing={() => void createAndMove()}
          accessibilityLabel="New folder name"
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Create folder and move here"
          disabled={!newName.trim()}
          onPress={() => void createAndMove()}
          style={[styles.button, !newName.trim() ? { opacity: 0.5 } : null]}
        >
          <Icon name="FolderPlus" size={16} color={theme.colors.foreground} />
        </Pressable>
      </View>
      {error ? <Text style={styles.danger}>{error}</Text> : null}
    </View>
  );
}
