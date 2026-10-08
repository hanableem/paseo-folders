import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { byRecentActivity, folderOf, type ListedAgent, matchesQuery, moveAgent, UNSORTED_ID } from "../shared/model";
import { useFolders, useTopLevelAgents } from "./data";
import { AgentRow, Button, MoveModal, SearchBox, useStyles } from "./ui";

/** One folder's conversations. `params.id` is a folder ID or "unsorted". */
export function FolderScreen({ theme, layout, params, navigation }: PluginScreenProps) {
  const styles = useStyles(theme, layout.compact);
  const toast = useToast();
  const folders = useFolders();
  const { agents, loading, error, reload } = useTopLevelAgents();
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(true);
  const [moving, setMoving] = useState<ListedAgent | null>(null);
  const folderId = params.id || UNSORTED_ID;

  const rows = useMemo(() => {
    if (folders.status !== "ready") return [];
    const { doc } = folders;
    return agents
      .filter((a) => folderOf(doc, a.id) === folderId)
      .filter((a) => showArchived || !a.archived)
      .filter((a) => matchesQuery(a, doc.notes[a.id] ?? "", query))
      .sort(byRecentActivity);
  }, [folders, agents, folderId, showArchived, query]);

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
    const agent = moving;
    setMoving(null);
    const ok = await folders.update((d) => moveAgent(d, agent.id, target));
    if (!ok) toast.error("Could not save. Try again.");
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.body}>
        {!known ? <Text style={styles.danger}>This folder no longer exists.</Text> : null}
        <SearchBox value={query} onChange={setQuery} styles={styles} theme={theme} />
        <View style={styles.toolbar}>
          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: showArchived }}
            onPress={() => setShowArchived((v) => !v)}
            style={styles.button}
          >
            <Text style={styles.buttonText}>{showArchived ? "Showing archived" : "Hiding archived"}</Text>
          </Pressable>
          <Button label="Refresh" onPress={() => void reload()} styles={styles} />
          <Text style={styles.muted}>{loading ? "Loading…" : `${rows.length} conversations`}</Text>
        </View>
        {error ? <Text style={styles.danger}>{error}</Text> : null}
        {rows.map((agent) => (
          <AgentRow
            key={agent.id}
            agent={agent}
            note={doc.notes[agent.id] ?? ""}
            styles={styles}
            theme={theme}
            onOpen={navigation ? () => navigation.openAgent({ agentId: agent.id }) : undefined}
            onMove={() => setMoving(agent)}
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
