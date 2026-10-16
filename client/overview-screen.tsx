import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import { formatTime, importSuggestions, useDirectory, useFolders } from "./data";
import { type MenuPoint, RowMenu, tint } from "./menu";
import { useMover } from "./move";
import {
  Button,
  IconButton,
  MoveConfirm,
  MoveModal,
  SearchBox,
  Section,
  showsActionsAlways,
  type Styles,
  useStyles,
  WorkspaceRow,
} from "./ui";

/** Manage folders, search every workspace, and import suggestions. */
export function OverviewScreen({ theme, layout, navigation }: PluginScreenProps) {
  const styles = useStyles(theme, layout.compact);
  const toast = useToast();
  const folders = useFolders();
  const { workspaces, workspaceMeta, loading, error, refresh } = useDirectory();
  const [menu, setMenu] = useState<{ ws: ListedWorkspace; at: MenuPoint } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const readSuggestions = useRpc(readSuggestionsRpc);
  const mover = useMover({
    folders,
    workspaces,
    meta: workspaceMeta,
    open: (workspaceId) => navigation?.openWorkspace({ workspaceId }),
    refresh,
  });
  const [query, setQuery] = useState("");
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

  /** Adds a folder; says so and returns false when the name is taken. */
  function add(name: string): boolean {
    const trimmed = name.trim();
    if (!trimmed) return false;
    if (doc.folders.some((f) => f.name === trimmed)) {
      toast.show(`There is already a folder named “${trimmed}”.`, { variant: "warning" });
      return false;
    }
    void save((d) => addFolder(d, trimmed));
    return true;
  }

  /** Renames a folder; says so and returns false when another folder has the name. */
  function rename(folderId: string, name: string): boolean {
    const trimmed = name.trim();
    if (!trimmed) return false;
    if (doc.folders.some((f) => f.name === trimmed && f.id !== folderId)) {
      toast.show(`There is already a folder named “${trimmed}”.`, { variant: "warning" });
      return false;
    }
    void save((d) => renameFolder(d, folderId, trimmed));
    return true;
  }

  const alwaysActions = showsActionsAlways(layout.compact);
  const imported = doc.lastImportAt ? `Last import ${formatTime(doc.lastImportAt)}` : "Not imported yet";
  return (
    <View style={styles.screen}>
      <ScrollView>
        <View style={styles.page}>
          <SearchBox value={query} onChange={setQuery} styles={styles} theme={theme} />
          {error ? <Text style={[styles.danger, { marginTop: 8 }]}>{error}</Text> : null}
          {query.trim() ? (
            <Section
              label={loading ? "Searching…" : results.length === 1 ? "1 result" : `${results.length} results`}
              styles={styles}
            >
              {results.length === 0 ? (
                <View style={styles.item}>
                  <Text style={styles.muted}>No workspace matches.</Text>
                </View>
              ) : (
                results.map((ws, index) => {
                  const id = workspaceFolderOf(doc, ws);
                  return (
                    <WorkspaceRow
                      key={ws.id}
                      workspace={ws}
                      notes={doc.notes}
                      folderName={id === UNSORTED_ID ? "Unsorted" : doc.folders.find((f) => f.id === id)?.name}
                      styles={styles}
                      theme={theme}
                      divider={index > 0}
                      onOpen={navigation ? () => navigation.openWorkspace({ workspaceId: ws.id }) : undefined}
                      onMove={() => setMoving(ws)}
                      onMenu={(at) => setMenu({ ws, at })}
                    />
                  );
                })
              )}
            </Section>
          ) : null}

          <Section label="Folders" styles={styles}>
            {doc.folders.map((folder, index) => (
              <FolderRow
                key={folder.id}
                folder={folder}
                count={counts[folder.id] ?? 0}
                first={index === 0}
                last={index === doc.folders.length - 1}
                divider={index > 0}
                alwaysActions={alwaysActions}
                styles={styles}
                theme={theme}
                onRename={(name) => rename(folder.id, name)}
                onDelete={() => void save((d) => deleteFolder(d, folder.id))}
                onMove={(delta) => void save((d) => moveFolder(d, folder.id, delta))}
              />
            ))}
            <View style={[styles.item, doc.folders.length > 0 ? styles.divider : null]}>
              <Icon name="Inbox" size={16} color={theme.colors.foregroundMuted} />
              <Text style={[styles.text, { flex: 1, color: theme.colors.foregroundMuted }]}>Unsorted</Text>
              <Text style={styles.count}>{counts[UNSORTED_ID] ?? 0}</Text>
            </View>
            <AddFolderRow styles={styles} theme={theme} onAdd={add} />
          </Section>

          <Section label="Suggestions file" styles={styles}>
            <View style={[styles.item, { paddingVertical: 12 }]}>
              <Text style={[styles.muted, { flex: 1, fontSize: 13, lineHeight: 19 }]}>
                Another tool can write folder suggestions as JSON. Conversations you moved by hand are never moved by
                an import. Leave the path empty to use the default location.
              </Text>
            </View>
            <SuggestionsPath
              initial={doc.suggestionsPath}
              styles={styles}
              theme={theme}
              onSave={(path) => void save((d) => ({ ...d, suggestionsPath: path.trim() }))}
            />
            <View style={[styles.item, styles.divider]}>
              <Text style={[styles.muted, { flex: 1, fontSize: 13 }]} numberOfLines={2}>
                {importStatus || imported}
              </Text>
              <Button label="Import now" onPress={() => void runImport()} styles={styles} />
            </View>
          </Section>
        </View>
      </ScrollView>
      {menu ? (
        <RowMenu
          ws={menu.ws}
          meta={workspaceMeta.get(menu.ws.id)}
          at={menu.at}
          bounds={null}
          theme={theme}
          folders={ready}
          workspaces={workspaces}
          mover={mover}
          onClose={closeMenu}
        />
      ) : null}
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
      <MoveConfirm mover={mover} theme={theme} />
    </View>
  );
}

/**
 * A folder in the list: its name and workspace count; on hover (always on touch
 * screens) buttons to reorder, rename and delete it. Renaming and deleting happen
 * in the row.
 */
function FolderRow(props: {
  folder: Folder;
  count: number;
  first: boolean;
  last: boolean;
  divider: boolean;
  alwaysActions: boolean;
  styles: Styles;
  theme: PluginScreenProps["theme"];
  /** Returns false when the name was refused. */
  onRename(name: string): boolean;
  onDelete(): void;
  onMove(delta: -1 | 1): void;
}) {
  const { folder, styles, theme } = props;
  const c = theme.colors;
  const [mode, setMode] = useState<"view" | "rename" | "delete">("view");
  const [draft, setDraft] = useState(folder.name);
  const [hovered, setHovered] = useState(false);
  const row = [styles.item, props.divider ? styles.divider : null];

  if (mode === "rename") {
    const submit = () => {
      if (props.onRename(draft)) setMode("view");
    };
    return (
      <View style={row}>
        <Icon name="Folder" size={16} color={c.foregroundMuted} />
        <TextInput
          value={draft}
          onChangeText={setDraft}
          autoFocus
          selectTextOnFocus
          onSubmitEditing={submit}
          onKeyPress={(event) => {
            if (event.nativeEvent.key === "Escape") setMode("view");
          }}
          style={[styles.field, { flex: 1 }]}
          placeholderTextColor={c.foregroundMuted}
          accessibilityLabel="Folder name"
        />
        <Button label="Save" primary disabled={!draft.trim()} onPress={submit} styles={styles} />
        <Button label="Cancel" onPress={() => setMode("view")} styles={styles} />
      </View>
    );
  }

  if (mode === "delete") {
    const what =
      props.count === 0
        ? `Delete “${folder.name}”?`
        : `Delete “${folder.name}”? Its ${props.count === 1 ? "workspace goes" : `${props.count} workspaces go`} back to Unsorted.`;
    return (
      <View style={row}>
        <Icon name="Trash2" size={16} color={c.statusDanger} />
        <Text style={[styles.text, { flex: 1 }]} numberOfLines={2}>
          {what}
        </Text>
        <Button label="Delete" danger onPress={props.onDelete} styles={styles} />
        <Button label="Cancel" onPress={() => setMode("view")} styles={styles} />
      </View>
    );
  }

  const showActions = props.alwaysActions || hovered;
  const hover = {
    onMouseEnter: () => setHovered(true),
    onMouseLeave: () => setHovered(false),
  } as object;
  return (
    <View style={[row, hovered ? { backgroundColor: tint(c.foreground, 0.03) } : null]} {...hover}>
      <Icon name="Folder" size={16} color={c.foregroundMuted} />
      <Text style={[styles.text, { flex: 1 }]} numberOfLines={1}>
        {folder.name}
      </Text>
      {showActions ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
          <IconButton icon="ArrowUp" label={`Move ${folder.name} up`} disabled={props.first} onPress={() => props.onMove(-1)} theme={theme} />
          <IconButton icon="ArrowDown" label={`Move ${folder.name} down`} disabled={props.last} onPress={() => props.onMove(1)} theme={theme} />
          <IconButton
            icon="Pencil"
            label={`Rename ${folder.name}`}
            onPress={() => {
              setDraft(folder.name);
              setMode("rename");
            }}
            theme={theme}
          />
          <IconButton icon="Trash2" label={`Delete ${folder.name}`} onPress={() => setMode("delete")} theme={theme} />
        </View>
      ) : null}
      <Text style={styles.count}>{props.count}</Text>
    </View>
  );
}

/** The card's last row: type a name and press Enter or Add. */
function AddFolderRow(props: { styles: Styles; theme: PluginScreenProps["theme"]; onAdd(name: string): boolean }) {
  const { styles, theme } = props;
  const [name, setName] = useState("");
  const submit = () => {
    if (props.onAdd(name)) setName("");
  };
  return (
    <View style={[styles.item, styles.divider]}>
      <Icon name="FolderPlus" size={16} color={theme.colors.foregroundMuted} />
      <TextInput
        value={name}
        onChangeText={setName}
        onSubmitEditing={submit}
        placeholder="New folder"
        placeholderTextColor={theme.colors.foregroundMuted}
        style={[styles.field, { flex: 1 }]}
        accessibilityLabel="New folder name"
      />
      <Button label="Add" primary disabled={!name.trim()} onPress={submit} styles={styles} />
    </View>
  );
}

function SuggestionsPath(props: { initial: string; styles: Styles; theme: PluginScreenProps["theme"]; onSave(path: string): void }) {
  const [draft, setDraft] = useState(props.initial);
  useEffect(() => setDraft(props.initial), [props.initial]);
  const changed = draft !== props.initial;
  return (
    <View style={[props.styles.item, props.styles.divider]}>
      <TextInput
        value={draft}
        onChangeText={setDraft}
        onSubmitEditing={() => changed && props.onSave(draft)}
        placeholder="Default: <Paseo home>/paseo-folders/suggestions.json"
        placeholderTextColor={props.theme.colors.foregroundMuted}
        autoCapitalize="none"
        autoCorrect={false}
        style={[props.styles.field, { flex: 1 }]}
        accessibilityLabel="Suggestions file path"
      />
      <Button label="Save" primary={changed} disabled={!changed} onPress={() => props.onSave(draft)} styles={props.styles} />
    </View>
  );
}
