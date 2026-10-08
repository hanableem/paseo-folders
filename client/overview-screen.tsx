import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import { useEffect, useMemo, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import {
  addFolder,
  countWorkspacesByFolder,
  deleteFolder,
  type Folder,
  type FoldersDocument,
  type ListedWorkspace,
  matchesWorkspace,
  moveFolder,
  moveWorkspace,
  readSuggestionsRpc,
  renameFolder,
  UNSORTED_ID,
  workspaceFolderOf,
} from "../shared/model";
import { importSuggestions, openPluginScreen, useDirectory, useFolders } from "./data";
import { Button, MoveModal, SearchBox, type Styles, useStyles, WorkspaceRow } from "./ui";

/** Manage folders, search every workspace, and import suggestions. */
export function OverviewScreen({ theme, layout, navigation }: PluginScreenProps) {
  const styles = useStyles(theme, layout.compact);
  const toast = useToast();
  const folders = useFolders();
  const { workspaces, loading, error } = useDirectory();
  const readSuggestions = useRpc(readSuggestionsRpc);
  const [query, setQuery] = useState("");
  const [newName, setNewName] = useState("");
  const [moving, setMoving] = useState<ListedWorkspace | null>(null);
  const [importStatus, setImportStatus] = useState("");

  const ready = folders.status === "ready" ? folders : null;
  const counts = useMemo(() => (ready ? countWorkspacesByFolder(ready.doc, workspaces) : {}), [ready, workspaces]);
  const results = useMemo(() => {
    if (!ready || !query.trim()) return [];
    return workspaces.filter((ws) => matchesWorkspace(ws, ready.doc.notes, query));
  }, [ready, workspaces, query]);

  async function runImport() {
    if (!ready) return;
    const outcome = await importSuggestions(readSuggestions, ready, workspaces);
    setImportStatus(outcome.message);
    toast.show(outcome.message, { variant: outcome.ok ? "success" : "error" });
  }

  if (!ready) {
    return (
      <View style={[styles.screen, styles.body]}>
        <Text style={styles.muted}>{folders.status === "ready" ? "" : folders.message}</Text>
      </View>
    );
  }
  const { doc } = ready;

  async function save(change: (d: FoldersDocument) => FoldersDocument) {
    const ok = await ready!.update(change);
    if (!ok) toast.error("Could not save. Try again.");
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.body}>
        <SearchBox value={query} onChange={setQuery} styles={styles} theme={theme} />
        {error ? <Text style={styles.danger}>{error}</Text> : null}
        {query.trim() ? (
          <>
            <Text style={styles.sectionTitle}>{loading ? "Loading…" : `${results.length} results`}</Text>
            {results.map((ws) => {
              const id = workspaceFolderOf(doc, ws);
              return (
                <WorkspaceRow
                  key={ws.id}
                  workspace={ws}
                  notes={doc.notes}
                  folderName={id === UNSORTED_ID ? "Unsorted" : doc.folders.find((f) => f.id === id)?.name}
                  styles={styles}
                  theme={theme}
                  onOpen={navigation ? () => navigation.openWorkspace({ workspaceId: ws.id }) : undefined}
                  onMove={() => setMoving(ws)}
                />
              );
            })}
          </>
        ) : null}

        <Text style={styles.sectionTitle}>FOLDERS</Text>
        {doc.folders.map((folder, index) => (
          <FolderRow
            key={folder.id}
            folder={folder}
            count={counts[folder.id] ?? 0}
            first={index === 0}
            last={index === doc.folders.length - 1}
            styles={styles}
            theme={theme}
            onOpen={() => openPluginScreen({ screenId: "folder", params: { id: folder.id, name: folder.name } })}
            onRename={(name) => void save((d) => renameFolder(d, folder.id, name))}
            onDelete={() => void save((d) => deleteFolder(d, folder.id))}
            onMove={(delta) => void save((d) => moveFolder(d, folder.id, delta))}
          />
        ))}
        <View style={styles.row}>
          <Text style={[styles.text, { flex: 1 }]}>Unsorted</Text>
          <Text style={styles.muted}>{counts[UNSORTED_ID] ?? 0}</Text>
          <Button
            label="Open"
            onPress={() => openPluginScreen({ screenId: "folder", params: { id: UNSORTED_ID, name: "Unsorted" } })}
            styles={styles}
          />
        </View>
        <View style={styles.toolbar}>
          <TextInput
            value={newName}
            onChangeText={setNewName}
            placeholder="New folder name"
            placeholderTextColor={theme.colors.foregroundMuted}
            style={[styles.input, { flex: 1, minWidth: 160 }]}
            accessibilityLabel="New folder name"
          />
          <Button
            label="Add folder"
            primary
            disabled={!newName.trim()}
            onPress={() => {
              const name = newName;
              setNewName("");
              void save((d) => addFolder(d, name));
            }}
            styles={styles}
          />
        </View>

        <Text style={styles.sectionTitle}>SUGGESTIONS FILE</Text>
        <Text style={styles.muted}>
          Another tool can write folder suggestions as JSON. Conversations you moved by hand are never moved by an
          import. Leave the path empty to use the default location.
        </Text>
        <SuggestionsPath
          initial={doc.suggestionsPath}
          styles={styles}
          theme={theme}
          onSave={(path) => void save((d) => ({ ...d, suggestionsPath: path.trim() }))}
        />
        <View style={styles.toolbar}>
          <Button label="Import now" onPress={() => void runImport()} styles={styles} />
          <Text style={[styles.muted, { flex: 1 }]}>
            {importStatus || (doc.lastImportAt ? `Last import ${doc.lastImportAt.slice(0, 16).replace("T", " ")}` : "")}
          </Text>
        </View>
      </ScrollView>
      <MoveModal
        open={moving !== null}
        onOpenChange={(open) => (open ? null : setMoving(null))}
        folders={doc.folders}
        currentId={moving ? workspaceFolderOf(doc, moving) : UNSORTED_ID}
        onPick={(id) => {
          const ws = moving;
          setMoving(null);
          if (ws) void save((d) => moveWorkspace(d, ws.id, id));
        }}
        styles={styles}
        theme={theme}
      />
    </View>
  );
}

function FolderRow(props: {
  folder: Folder;
  count: number;
  first: boolean;
  last: boolean;
  styles: Styles;
  theme: PluginScreenProps["theme"];
  onOpen(): void;
  onRename(name: string): void;
  onDelete(): void;
  onMove(delta: -1 | 1): void;
}) {
  const { styles, theme } = props;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(props.folder.name);
  const [confirming, setConfirming] = useState(false);

  if (editing) {
    return (
      <View style={styles.row}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          autoFocus
          style={[styles.input, { flex: 1 }]}
          placeholderTextColor={theme.colors.foregroundMuted}
          accessibilityLabel="Folder name"
        />
        <Button
          label="Save"
          primary
          disabled={!draft.trim()}
          onPress={() => {
            props.onRename(draft);
            setEditing(false);
          }}
          styles={styles}
        />
        <Button label="Cancel" onPress={() => setEditing(false)} styles={styles} />
      </View>
    );
  }
  return (
    <View style={styles.row}>
      <Text style={[styles.text, { flex: 1 }]} numberOfLines={1}>
        {props.folder.name}
      </Text>
      <Text style={styles.muted}>{props.count}</Text>
      <Button label="Open" onPress={props.onOpen} styles={styles} />
      <Button label="↑" disabled={props.first} onPress={() => props.onMove(-1)} styles={styles} />
      <Button label="↓" disabled={props.last} onPress={() => props.onMove(1)} styles={styles} />
      <Button
        label="Rename"
        onPress={() => {
          setDraft(props.folder.name);
          setEditing(true);
        }}
        styles={styles}
      />
      {confirming ? (
        <>
          <Button label="Delete folder" primary onPress={props.onDelete} styles={styles} />
          <Button label="Keep" onPress={() => setConfirming(false)} styles={styles} />
        </>
      ) : (
        <Button label="Delete" onPress={() => setConfirming(true)} styles={styles} />
      )}
    </View>
  );
}

function SuggestionsPath(props: { initial: string; styles: Styles; theme: PluginScreenProps["theme"]; onSave(path: string): void }) {
  const [draft, setDraft] = useState(props.initial);
  useEffect(() => setDraft(props.initial), [props.initial]);
  return (
    <View style={props.styles.toolbar}>
      <TextInput
        value={draft}
        onChangeText={setDraft}
        placeholder="Default: <Paseo home>/paseo-folders/suggestions.json"
        placeholderTextColor={props.theme.colors.foregroundMuted}
        autoCapitalize="none"
        autoCorrect={false}
        style={[props.styles.input, { flex: 1, minWidth: 220 }]}
        accessibilityLabel="Suggestions file path"
      />
      <Button label="Save path" disabled={draft === props.initial} onPress={() => props.onSave(draft)} styles={props.styles} />
    </View>
  );
}
