import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type GestureResponderHandlers,
  PanResponder,
  Platform,
  Pressable,
  type PressableStateCallbackType,
  ScrollView,
  Text,
  TextInput,
  View,
  type ViewStyle,
} from "react-native";
import {
  addFolder,
  countWorkspacesByFolder,
  deleteFolder,
  type Folder,
  folderName,
  folderOrder,
  type FoldersDocument,
  type ListedWorkspace,
  matchesWorkspace,
  moveFolder,
  moveWorkspace,
  moveInList,
  readSuggestionsRpc,
  renameFolder,
  reorderTarget,
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
  const [dragging, setDragging] = useState(false);

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

  async function save(change: (d: FoldersDocument) => FoldersDocument): Promise<boolean> {
    const ok = await ready!.update(change);
    if (!ok) toast.error("Could not save. Try again.");
    return ok;
  }

  /** Adds a folder; says so and returns false when the name is taken. */
  function add(name: string): boolean {
    const trimmed = name.trim();
    if (!trimmed) return false;
    if (folderOrder(doc).some((f) => f.name === trimmed)) {
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
    if (folderOrder(doc).some((f) => f.name === trimmed && f.id !== folderId)) {
      toast.show(`There is already a folder named “${trimmed}”.`, { variant: "warning" });
      return false;
    }
    void save((d) => renameFolder(d, folderId, trimmed));
    return true;
  }

  /** Deletes a folder at once and says where its workspaces went. */
  async function remove(folderId: string) {
    const name = folderName(doc, folderId);
    const count = counts[folderId] ?? 0;
    if (!(await save((d) => deleteFolder(d, folderId)))) return;
    const went = count === 1 ? "Its workspace went" : `Its ${count} workspaces went`;
    toast.show(count === 0 ? `Deleted “${name}”` : `Deleted “${name}”. ${went} to ${folderName(doc, UNSORTED_ID)}.`, {
      variant: "success",
    });
  }

  const alwaysActions = showsActionsAlways(layout.compact);
  const imported = doc.lastImportAt ? `Last import ${formatTime(doc.lastImportAt)}` : "Not imported yet";
  return (
    <View style={styles.screen}>
      {/* A touch that lifts a folder must not also scroll the page. */}
      <ScrollView scrollEnabled={Platform.OS === "web" || !dragging}>
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
                      folderName={folderName(doc, id)}
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
            <FolderList
              folders={folderOrder(doc)}
              counts={counts}
              alwaysActions={alwaysActions}
              styles={styles}
              theme={theme}
              onDragging={setDragging}
              onRename={rename}
              onDelete={(folderId) => void remove(folderId)}
              onMove={(folderId, index) => save((d) => moveFolder(d, folderId, index))}
            />
            <AddFolderRow styles={styles} theme={theme} onAdd={add} />
          </Section>

          <Section label="Suggestions file" styles={styles}>
            <View style={[styles.item, { paddingVertical: 12 }]}>
              <Text style={[styles.muted, { flex: 1, fontSize: 13, lineHeight: 19 }]}>
                Another tool can write folder suggestions as JSON. Conversations you moved by hand are never moved by
                an import, and folders you deleted are not made again. Leave the path empty to use the default location.
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
        folders={folderOrder(doc)}
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

/** How long a press must hold still before its row lifts; touch waits longer, so a swipe still scrolls. */
const HOLD_MS = Platform.OS === "web" ? 180 : 350;
/** How far a mouse moves before a press becomes a drag. */
const MOVE_SLOP = 6;

/** Styles only the web understands, which React Native's types do not list. */
function webStyle(style: Record<string, string>): ViewStyle | null {
  return Platform.OS === "web" ? (style as ViewStyle) : null;
}

type DragHandlers = { grab(): void; move(dy: number): void; drop(): void; cancel(): void };

/**
 * Press-and-hold dragging for a row. The row lifts after a short hold; with a mouse
 * it also lifts as soon as it moves. On touch screens a move before the hold is a
 * scroll, so the row stays put.
 */
function useHoldToDrag(handlers: DragHandlers): GestureResponderHandlers {
  const latest = useRef(handlers);
  latest.current = handlers;
  return useMemo(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let grabbed = false;
    const stopTimer = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };
    const grab = () => {
      stopTimer();
      if (grabbed) return;
      grabbed = true;
      latest.current.grab();
    };
    const finish = (dropped: boolean) => {
      stopTimer();
      if (!grabbed) return;
      grabbed = false;
      if (dropped) latest.current.drop();
      else latest.current.cancel();
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        timer = setTimeout(grab, HOLD_MS);
      },
      onPanResponderMove: (_e, g) => {
        if (!grabbed) {
          if (Math.abs(g.dx) + Math.abs(g.dy) <= MOVE_SLOP) return;
          if (Platform.OS !== "web") return finish(false);
          grab();
        }
        latest.current.move(g.dy);
      },
      onPanResponderRelease: () => finish(true),
      onPanResponderTerminate: () => finish(false),
      onPanResponderTerminationRequest: () => !grabbed,
    }).panHandlers;
  }, []);
}

/**
 * The folders in order. Press and hold one, or press it and move with a mouse, to
 * drag it up or down; a line shows where it goes when you let go.
 */
function FolderList(props: {
  /** In display order, Unsorted included. */
  folders: Folder[];
  counts: Record<string, number>;
  alwaysActions: boolean;
  styles: Styles;
  theme: PluginScreenProps["theme"];
  onDragging(dragging: boolean): void;
  /** Returns false when the name was refused. */
  onRename(folderId: string, name: string): boolean;
  onDelete(folderId: string): void;
  /** Resolves to false when the new order could not be saved. */
  onMove(folderId: string, index: number): Promise<boolean>;
}) {
  const layouts = useRef(new Map<string, { y: number; height: number }>());
  const dragRef = useRef<{ id: string; dy: number } | null>(null);
  const [drag, setDrag] = useState<{ id: string; dy: number } | null>(null);
  // The order just dropped, shown until the saved order arrives, so the row does not jump back.
  const [pending, setPending] = useState<{ id: string; index: number } | null>(null);
  useEffect(() => setPending(null), [props.folders]);

  const folders = pending ? moveInList(props.folders, pending.id, pending.index) : props.folders;
  const rows = folders.map((f) => layouts.current.get(f.id) ?? { y: 0, height: 0 });

  /** The dragged row's offset, kept within the list, and the place it would take. */
  function placement(state: { id: string; dy: number }) {
    const from = folders.findIndex((f) => f.id === state.id);
    if (from < 0) return null;
    const first = rows[0];
    const last = rows[rows.length - 1];
    const dy = Math.max(first.y - rows[from].y, Math.min(last.y + last.height - rows[from].y - rows[from].height, state.dy));
    return { from, dy, target: reorderTarget(rows, from, dy) };
  }

  function update(next: { id: string; dy: number } | null) {
    dragRef.current = next;
    setDrag(next);
  }

  function drop() {
    const place = dragRef.current ? placement(dragRef.current) : null;
    const id = dragRef.current?.id;
    update(null);
    props.onDragging(false);
    if (!place || !id || place.target === place.from) return;
    setPending({ id, index: place.target });
    void props.onMove(id, place.target).then((ok) => {
      if (!ok) setPending(null);
    });
  }

  const shown = drag ? placement(drag) : null;
  const line =
    shown && shown.target !== shown.from
      ? shown.target < shown.from
        ? rows[shown.target].y
        : rows[shown.target].y + rows[shown.target].height
      : null;

  return (
    <View style={{ position: "relative" }}>
      {folders.map((folder, index) => (
        <FolderRow
          key={folder.id}
          folder={folder}
          count={props.counts[folder.id] ?? 0}
          index={index}
          lastIndex={folders.length - 1}
          lift={shown && drag?.id === folder.id ? shown.dy : null}
          dragActive={drag !== null}
          alwaysActions={props.alwaysActions}
          styles={props.styles}
          theme={props.theme}
          onLayout={(layout) => layouts.current.set(folder.id, layout)}
          drag={{
            grab: () => {
              update({ id: folder.id, dy: 0 });
              props.onDragging(true);
            },
            move: (dy) => update({ id: folder.id, dy }),
            drop,
            cancel: () => {
              update(null);
              props.onDragging(false);
            },
          }}
          onRename={(name) => props.onRename(folder.id, name)}
          onDelete={() => props.onDelete(folder.id)}
          onMoveTo={(to) => void props.onMove(folder.id, to)}
        />
      ))}
      {line !== null ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: 12,
            right: 12,
            top: line - 1,
            height: 2,
            borderRadius: 1,
            backgroundColor: props.theme.colors.accent,
            zIndex: 20,
          }}
        />
      ) : null}
    </View>
  );
}

/**
 * A folder in the list: its name and workspace count; on hover (always on touch
 * screens) buttons to rename it in the row and to delete it at once, which sends its
 * workspaces to Unsorted. Press and hold the row to drag it to another place.
 * Unsorted can be renamed and moved but not deleted.
 */
function FolderRow(props: {
  folder: Folder;
  count: number;
  index: number;
  lastIndex: number;
  /** How far the row has been dragged from its place, or null when it is not being dragged. */
  lift: number | null;
  dragActive: boolean;
  alwaysActions: boolean;
  styles: Styles;
  theme: PluginScreenProps["theme"];
  onLayout(layout: { y: number; height: number }): void;
  drag: DragHandlers;
  /** Returns false when the name was refused. */
  onRename(name: string): boolean;
  onDelete(): void;
  /** Screen readers' move up and move down. */
  onMoveTo(index: number): void;
}) {
  const { folder, styles, theme } = props;
  const c = theme.colors;
  const isUnsorted = folder.id === UNSORTED_ID;
  const icon = isUnsorted ? "Inbox" : "Folder";
  const [mode, setMode] = useState<"view" | "rename">("view");
  const [draft, setDraft] = useState(folder.name);
  const [hovered, setHovered] = useState(false);
  const dragHandlers = useHoldToDrag(props.drag);
  const row = [styles.item, styles.divider];
  const measure = {
    onLayout: (e: { nativeEvent: { layout: { y: number; height: number } } }) =>
      props.onLayout({ y: e.nativeEvent.layout.y, height: e.nativeEvent.layout.height }),
  };

  if (mode === "rename") {
    const submit = () => {
      if (props.onRename(draft)) setMode("view");
    };
    return (
      <View style={row} {...measure}>
        <Icon name={icon} size={16} color={c.foregroundMuted} />
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

  const lifted = props.lift !== null;
  const showActions = !props.dragActive && (props.alwaysActions || hovered);
  const hover = {
    onMouseEnter: () => setHovered(true),
    onMouseLeave: () => setHovered(false),
  } as object;
  const moves = [
    ...(props.index > 0 ? [{ name: "moveUp", label: "Move up" }] : []),
    ...(props.index < props.lastIndex ? [{ name: "moveDown", label: "Move down" }] : []),
  ];
  return (
    <View
      style={[
        row,
        hovered && !props.dragActive ? { backgroundColor: tint(c.foreground, 0.03) } : null,
        webStyle({ cursor: lifted ? "grabbing" : "grab", userSelect: "none" }),
        lifted ? { zIndex: 10, backgroundColor: c.surface2, transform: [{ translateY: props.lift ?? 0 }] } : null,
        lifted ? webStyle({ boxShadow: "0 6px 18px rgba(0, 0, 0, 0.28)" }) : null,
      ]}
      accessibilityHint="Press and hold, then drag to reorder"
      accessibilityActions={moves}
      onAccessibilityAction={(event) => props.onMoveTo(props.index + (event.nativeEvent.actionName === "moveUp" ? -1 : 1))}
      {...measure}
      {...dragHandlers}
      {...hover}
    >
      {lifted ? (
        <View
          pointerEvents="none"
          style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, borderWidth: 1, borderColor: c.accent, borderRadius: 8 }}
        />
      ) : null}
      <Icon name={icon} size={16} color={c.foregroundMuted} />
      <Text style={[styles.text, { flex: 1 }]} numberOfLines={1}>
        {folder.name}
      </Text>
      {showActions ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
          <IconButton
            icon="Pencil"
            label={`Rename ${folder.name}`}
            onPress={() => {
              setDraft(folder.name);
              setMode("rename");
            }}
            theme={theme}
          />
          {isUnsorted ? null : (
            <IconButton icon="Trash2" label={`Delete ${folder.name}`} onPress={props.onDelete} theme={theme} />
          )}
        </View>
      ) : null}
      <Text style={styles.count}>{props.count}</Text>
    </View>
  );
}

/** The card's last row: “New folder”, which turns into a name field. Enter adds the folder; Escape cancels. */
function AddFolderRow(props: { styles: Styles; theme: PluginScreenProps["theme"]; onAdd(name: string): boolean }) {
  const { styles, theme } = props;
  const c = theme.colors;
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  if (!editing) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="New folder"
        onPress={() => {
          setName("");
          setEditing(true);
        }}
        style={(state: PressableStateCallbackType) => {
          const hovered = (state as PressableStateCallbackType & { hovered?: boolean }).hovered;
          return [styles.item, styles.divider, hovered || state.pressed ? { backgroundColor: tint(c.foreground, 0.03) } : null];
        }}
      >
        <Icon name="Plus" size={16} color={c.accent} />
        <Text style={[styles.text, { color: c.accent }]}>New folder</Text>
      </Pressable>
    );
  }
  const submit = () => {
    if (props.onAdd(name)) setEditing(false);
  };
  return (
    <View style={[styles.item, styles.divider]}>
      <Icon name="Folder" size={16} color={c.foregroundMuted} />
      <TextInput
        value={name}
        onChangeText={setName}
        autoFocus
        onSubmitEditing={submit}
        onKeyPress={(event) => {
          if (event.nativeEvent.key === "Escape") setEditing(false);
        }}
        placeholder="Folder name"
        placeholderTextColor={c.foregroundMuted}
        style={[styles.field, { flex: 1 }]}
        accessibilityLabel="New folder name"
      />
      <Button label="Add" primary disabled={!name.trim()} onPress={submit} styles={styles} />
      <Button label="Cancel" onPress={() => setEditing(false)} styles={styles} />
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
