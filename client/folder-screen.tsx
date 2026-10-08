import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import { useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { type ListedWorkspace, matchesWorkspace, moveWorkspace, UNSORTED_ID, workspaceFolderOf } from "../shared/model";
import { useDirectory, useFolders } from "./data";
import { Button, MoveModal, SearchBox, useStyles, WorkspaceRow } from "./ui";

/** One folder's workspaces. `params.id` is a folder ID or "unsorted". */
export function FolderScreen({ theme, layout, params, navigation }: PluginScreenProps) {
  const styles = useStyles(theme, layout.compact);
  const toast = useToast();
  const folders = useFolders();
  const { workspaces, loading, error, reload } = useDirectory();
  const [query, setQuery] = useState("");
  const [moving, setMoving] = useState<ListedWorkspace | null>(null);
  const folderId = params.id || UNSORTED_ID;

  const rows = useMemo(() => {
    if (folders.status !== "ready") return [];
    const { doc } = folders;
    return workspaces
      .filter((ws) => workspaceFolderOf(doc, ws) === folderId)
      .filter((ws) => matchesWorkspace(ws, doc.notes, query));
  }, [folders, workspaces, folderId, query]);

  if (folders.status !== "ready") {
    return (
      <View style={[styles.screen, styles.body]}>
        <Text style={styles.muted}>{folders.message}</Text>
      </View>
    );
  }
  const { doc } = folders;
  const known = folderId === UNSORTED_ID || doc.folders.some((f) => f.id === folderId);

  async function pick(target: string) {
    if (!moving || folders.status !== "ready") return;
    const ws = moving;
    setMoving(null);
    const ok = await folders.update((d) => moveWorkspace(d, ws.id, target));
    if (!ok) toast.error("Could not save. Try again.");
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.body}>
        {!known ? <Text style={styles.danger}>This folder no longer exists.</Text> : null}
        <SearchBox value={query} onChange={setQuery} styles={styles} theme={theme} />
        <View style={styles.toolbar}>
          <Button label="Refresh" onPress={() => void reload()} styles={styles} />
          <Text style={styles.muted}>{loading ? "Loading…" : `${rows.length} workspaces`}</Text>
        </View>
        {error ? <Text style={styles.danger}>{error}</Text> : null}
        {rows.map((ws) => (
          <WorkspaceRow
            key={ws.id}
            workspace={ws}
            notes={doc.notes}
            styles={styles}
            theme={theme}
            onOpen={navigation ? () => navigation.openWorkspace({ workspaceId: ws.id }) : undefined}
            onMove={() => setMoving(ws)}
          />
        ))}
        {!loading && rows.length === 0 ? <Text style={styles.muted}>Nothing here.</Text> : null}
      </ScrollView>
      <MoveModal
        open={moving !== null}
        onOpenChange={(open) => (open ? null : setMoving(null))}
        folders={doc.folders}
        currentId={folderId}
        onPick={(id) => void pick(id)}
        styles={styles}
        theme={theme}
      />
    </View>
  );
}
