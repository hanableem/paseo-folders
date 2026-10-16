import type { PluginTheme } from "@getpaseo/plugin";
import { usePaseo } from "@getpaseo/plugin/client";
import { copyText, Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { type ReactNode, useState } from "react";
import {
  Dimensions,
  type LayoutChangeEvent,
  Modal,
  Pressable,
  type PressableStateCallbackType,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  addFolder,
  deleteFolder,
  type Folder,
  type FoldersDocument,
  folderName,
  folderOrder,
  type ListedWorkspace,
  mergeTargets,
  moveWorkspace,
  renameFolder,
  resumeCommand,
  UNSORTED_ID,
  workspaceFolderOf,
} from "../shared/model";
import type { ReadyFolders, WorkspaceMeta } from "./data";
import type { Mover } from "./move";

type Page = "main" | "move" | "rename" | "merge" | "split";
type FolderPage = "main" | "new" | "rename" | "delete";

/** Where the pointer was, in window coordinates. */
export interface MenuPoint {
  x: number;
  y: number;
}

// Paseo's own menu metrics (desktop): 28 px items, 4 px page padding, 220 px wide. A
// context menu opens 4 px below the pointer and keeps 8 px clear of the window's edges.
const MENU_WIDTH = 220;
const ITEM_HEIGHT = 28;
const OFFSET = 4;
const EDGE = 8;
/** Workspaces listed under Merge into workspace; typing narrows them down. */
const MAX_TARGETS = 7;

/** Translucent foreground, for hover and selection that read on light and dark themes. */
export function tint(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})/i.exec(hex.trim());
  if (!m) return "transparent";
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

type WebEvent = { preventDefault?: () => void };

/**
 * A menu at a window point, in a layer over the whole app like Paseo's own menus,
 * so nothing in the sidebar can clip it or show through it. It opens below and
 * right of the point, and goes up or left to stay in the window. A press or a
 * right-click outside it closes it, as does Escape.
 */
function Menu(props: { at: MenuPoint; label: string; theme: PluginTheme; onClose(): void; children: ReactNode }) {
  const { at, onClose } = props;
  const c = props.theme.colors;
  // Shown once its height is known, so that near the bottom it can open upwards.
  const [height, setHeight] = useState<number | null>(null);
  const win = Dimensions.get("window");
  const width = Math.min(MENU_WIDTH, win.width - 2 * EDGE);
  const left = Math.max(EDGE, Math.min(at.x, win.width - EDGE - width));
  const below = at.y + OFFSET;
  const above = at.y - OFFSET - (height ?? 0);
  const top =
    height === null || below + height <= win.height - EDGE
      ? below
      : above >= EDGE
        ? above
        : Math.max(EDGE, win.height - EDGE - height);
  // React Native Web passes onContextMenu to the page; the browser's own menu stays shut.
  const noBrowserMenu = { onContextMenu: (event: WebEvent) => event.preventDefault?.() } as object;
  const closeOnRightClick = {
    onContextMenu: (event: WebEvent) => {
      event.preventDefault?.();
      onClose();
    },
  } as object;
  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
      <View style={{ flex: 1 }} {...noBrowserMenu}>
        <Pressable
          accessibilityLabel="Close menu"
          onPress={onClose}
          style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }}
          {...closeOnRightClick}
        />
        <View
          accessibilityRole="menu"
          accessibilityLabel={props.label}
          onLayout={(event: LayoutChangeEvent) => {
            const next = event.nativeEvent.layout.height;
            setHeight((h) => (h === next ? h : next));
          }}
          style={{
            position: "absolute",
            left,
            top,
            width,
            opacity: height === null ? 0 : 1,
            paddingVertical: 4,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: c.border,
            backgroundColor: c.surface1,
            overflow: "hidden",
            shadowColor: "rgba(0, 0, 0, 0.20)",
            shadowOffset: { width: 0, height: 4 },
            shadowRadius: 8,
            elevation: 8,
          }}
        >
          {props.children}
        </View>
      </View>
    </Modal>
  );
}

/** A menu row like Paseo's: icon, label, and a hint or chevron at the end. */
function MenuItem(props: {
  theme: PluginTheme;
  icon: string;
  label: string;
  onPress(): void;
  trailing?: ReactNode;
  /** In the theme's danger colour, for deleting. */
  danger?: boolean;
}) {
  const c = props.theme.colors;
  const color = props.danger ? c.statusDanger : c.foreground;
  const style = (state: PressableStateCallbackType) => {
    const hovered = (state as PressableStateCallbackType & { hovered?: boolean }).hovered;
    return {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      minHeight: ITEM_HEIGHT,
      gap: 8,
      marginHorizontal: 4,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderWidth: 1,
      borderColor: "transparent",
      borderRadius: 6,
      backgroundColor: hovered || state.pressed ? c.surface2 : "transparent",
    };
  };
  return (
    <Pressable accessibilityRole="menuitem" accessibilityLabel={props.label} onPress={props.onPress} style={style}>
      <View style={{ width: 16, alignItems: "center", justifyContent: "center" }}>
        <Icon name={props.icon} size={16} color={color} />
      </View>
      <Text style={{ flexShrink: 1, minWidth: 0, color, fontSize: 14, lineHeight: 18 }} numberOfLines={1}>
        {props.label}
      </Text>
      {props.trailing ? (
        <View style={{ marginLeft: "auto", alignItems: "center", justifyContent: "center" }}>{props.trailing}</View>
      ) : null}
    </Pressable>
  );
}

/** Muted text at the end of an item, like the short agent id in Paseo's tab menu. */
function MenuHint({ theme, children }: { theme: PluginTheme; children: string }) {
  return (
    <Text numberOfLines={1} style={{ maxWidth: 72, color: theme.colors.foregroundMuted, fontSize: 12 }}>
      {children}
    </Text>
  );
}

function MenuSeparator({ theme }: { theme: PluginTheme }) {
  return <View style={{ height: 1, marginVertical: 4, backgroundColor: theme.colors.border }} />;
}

/** A line of explanation on a menu page. */
function MenuNote({ theme, children }: { theme: PluginTheme; children: string }) {
  return (
    <Text style={{ marginHorizontal: 12, paddingVertical: 6, color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 17 }}>
      {children}
    </Text>
  );
}

/** A text field on a menu page, focused when the page opens. */
function MenuField(props: {
  theme: PluginTheme;
  value: string;
  onChangeText(text: string): void;
  label: string;
  placeholder?: string;
  /** Selects the text, so typing replaces it. */
  selectAll?: boolean;
  onSubmit?(): void;
}) {
  const c = props.theme.colors;
  return (
    <View style={{ marginHorizontal: 4, paddingVertical: 4 }}>
      <TextInput
        value={props.value}
        onChangeText={props.onChangeText}
        autoFocus
        selectTextOnFocus={props.selectAll}
        placeholder={props.placeholder}
        placeholderTextColor={c.foregroundMuted}
        accessibilityLabel={props.label}
        onSubmitEditing={props.onSubmit}
        style={{
          color: c.foreground,
          borderWidth: 1,
          borderColor: c.border,
          borderRadius: 6,
          paddingHorizontal: 8,
          paddingVertical: 4,
          minHeight: ITEM_HEIGHT,
          fontSize: 14,
          backgroundColor: c.surface2,
        }}
      />
    </View>
  );
}

/**
 * Right-click (or long-press) menu for a workspace row. It follows Paseo's own
 * workspace menu (copy path and branch, rename, archive), puts Move to folder
 * where Paseo has Labels, and adds the tab menu's copy commands for a workspace
 * holding a single conversation, grouped as in the tab menu. With a mover it also
 * merges the workspace into another one and splits a conversation off into a
 * workspace of its own.
 */
export function RowMenu(props: {
  ws: ListedWorkspace;
  meta: WorkspaceMeta | undefined;
  at: MenuPoint;
  theme: PluginTheme;
  folders: ReadyFolders;
  /** Every listed workspace, for Merge into workspace. */
  workspaces?: readonly ListedWorkspace[];
  /** Leave out to hide merging and splitting. */
  mover?: Mover;
  onClose(): void;
  onArchived?(workspaceId: string): void;
}) {
  const { ws, meta, theme, folders, mover, onClose } = props;
  const paseo = usePaseo();
  const toast = useToast();
  const [page, setPage] = useState<Page>("main");
  const [draft, setDraft] = useState(ws.title);
  const [query, setQuery] = useState("");
  const single = ws.agents.length === 1 ? ws.agents[0] : null;
  const resume = single ? resumeCommand(single.provider, single.sessionId) : null;
  const current = workspaceFolderOf(folders.doc, ws);

  async function act(work: () => Promise<unknown>, done: string, failed: string) {
    try {
      await work();
      toast.show(done, { variant: "success" });
      onClose();
    } catch {
      toast.error(failed);
    }
  }
  const copy = (text: string, done: string) => void act(() => copyText(text), done, "Could not copy.");

  const item = (key: string, icon: string, label: string, onPress: () => void, trailing?: ReactNode) => (
    <MenuItem key={key} theme={theme} icon={icon} label={label} onPress={onPress} trailing={trailing} />
  );
  const back = (
    <>
      {item("back", "ChevronLeft", ws.title, () => setPage("main"))}
      <MenuSeparator theme={theme} />
    </>
  );
  const chevron = <Icon name="ChevronRight" size={14} color={theme.colors.foregroundMuted} />;
  const mergeInto = (target: ListedWorkspace) => {
    onClose();
    if (mover) void mover.merge(ws, target);
  };

  let body: ReactNode;
  if (page === "merge") {
    const targets = mergeTargets(folders.doc, props.workspaces ?? [], ws, query).slice(0, MAX_TARGETS);
    body = (
      <>
        {back}
        <MenuField
          theme={theme}
          value={query}
          onChangeText={setQuery}
          label="Search workspaces"
          placeholder="Search workspaces"
        />
        {targets.length === 0 ? (
          <MenuNote theme={theme}>No other workspace matches.</MenuNote>
        ) : (
          targets.map((t) => {
            const where = workspaceFolderOf(folders.doc, t);
            const hint = where === current ? undefined : <MenuHint theme={theme}>{folderName(folders.doc, where)}</MenuHint>;
            return item(t.id, "PanelsTopLeft", t.title, () => mergeInto(t), hint);
          })
        )}
      </>
    );
  } else if (page === "split") {
    body = (
      <>
        {back}
        {ws.agents.map((a) =>
          item(a.id, "MessageSquare", a.title, () => {
            onClose();
            if (mover) void mover.split(ws, a);
          }),
        )}
      </>
    );
  } else if (page === "move") {
    body = (
      <>
        {back}
        {folderOrder(folders.doc).map((f) =>
          item(f.id, f.id === current ? "Check" : f.id === UNSORTED_ID ? "Inbox" : "Folder", f.name, () =>
            void act(
              async () => {
                if (f.id === current) return;
                if (!(await folders.update((d) => moveWorkspace(d, ws.id, f.id)))) throw new Error("save failed");
              },
              `Moved to ${f.name}`,
              "Could not move. Try again.",
            ),
          ),
        )}
      </>
    );
  } else if (page === "rename") {
    const save = () => {
      const title = draft.trim();
      if (title) void act(() => paseo.workspaces.ref(ws.id).setTitle(title), "Renamed", "Could not rename.");
    };
    body = (
      <>
        {back}
        <MenuField theme={theme} value={draft} onChangeText={setDraft} label="Workspace title" selectAll onSubmit={save} />
        {item("save", "Check", "Save", save)}
      </>
    );
  } else {
    // Like Paseo's tab menu: what to copy and the name first, then what to do with the workspace.
    body = (
      <>
        {meta?.directory ? item("path", "Copy", "Copy path", () => copy(meta.directory, "Path copied")) : null}
        {meta?.branch ? item("branch", "Copy", "Copy branch name", () => copy(meta.branch, "Branch name copied")) : null}
        {resume ? item("resume", "Copy", "Copy resume command", () => copy(resume, "Resume command copied")) : null}
        {single
          ? item(
              "agent-id",
              "Copy",
              "Copy agent id",
              () => copy(single.id, "Agent id copied"),
              <MenuHint theme={theme}>{single.id.slice(0, 7)}</MenuHint>,
            )
          : null}
        {item("rename", "Pencil", "Rename workspace", () => {
          setDraft(ws.title);
          setPage("rename");
        })}
        <MenuSeparator theme={theme} />
        {item("move", "FolderInput", "Move to folder", () => setPage("move"), chevron)}
        {mover && ws.agents.length > 0 && (props.workspaces?.length ?? 0) > 1
          ? item(
              "merge",
              "Merge",
              "Merge into workspace",
              () => {
                setQuery("");
                setPage("merge");
              },
              chevron,
            )
          : null}
        {mover && ws.agents.length > 1
          ? item("split", "SquareSplitHorizontal", "Split off a conversation", () => setPage("split"), chevron)
          : null}
        {item("archive", "Archive", "Archive", () =>
          void act(
            async () => {
              await paseo.workspaces.archive(ws.id);
              props.onArchived?.(ws.id);
            },
            "Archived",
            "Could not archive.",
          ),
        )}
      </>
    );
  }

  return (
    <Menu at={props.at} label={`Menu for ${ws.title}`} theme={theme} onClose={onClose}>
      {body}
    </Menu>
  );
}

/**
 * Right-click (or More) menu for a folder in the sidebar: make a workspace in it,
 * rename it, add a folder below it, or delete it. Unsorted can be renamed but not
 * deleted. Without a folder, as from the Folders header, it adds a folder at the end.
 */
export function FolderMenu(props: {
  folder: Folder | null;
  /** How many workspaces the folder holds. */
  count: number;
  at: MenuPoint;
  theme: PluginTheme;
  folders: ReadyFolders;
  /** Makes a workspace in the folder; leave out where that is not possible. */
  onNewWorkspace?(): void;
  onClose(): void;
}) {
  const { folder, theme, folders, onClose } = props;
  const toast = useToast();
  const [page, setPage] = useState<FolderPage>(folder ? "main" : "new");
  const [draft, setDraft] = useState("");

  async function save(change: (doc: FoldersDocument) => FoldersDocument, failed: string) {
    if (await folders.update(change)) onClose();
    else toast.error(failed);
  }
  /** The typed name, trimmed, if no other folder has it; says so when one does. */
  function freeName(exceptId?: string): string | null {
    const name = draft.trim();
    if (!name) return null;
    if (folderOrder(folders.doc).some((f) => f.name === name && f.id !== exceptId)) {
      toast.show(`There is already a folder named “${name}”.`, { variant: "warning" });
      return null;
    }
    return name;
  }
  const create = () => {
    const name = freeName();
    if (name) void save((d) => addFolder(d, name, folder?.id), "Could not add the folder. Try again.");
  };

  const item = (key: string, icon: string, label: string, onPress: () => void, danger?: boolean) => (
    <MenuItem key={key} theme={theme} icon={icon} label={label} onPress={onPress} danger={danger} />
  );

  const back = folder ? (
    <>
      {item("back", "ChevronLeft", folder.name, () => setPage("main"))}
      <MenuSeparator theme={theme} />
    </>
  ) : null;

  let body: ReactNode;
  if (!folder || page === "new") {
    body = (
      <>
        {back}
        <MenuField theme={theme} value={draft} onChangeText={setDraft} label="Folder name" placeholder="Folder name" onSubmit={create} />
        {item("add", "FolderPlus", "Add folder", create)}
      </>
    );
  } else if (page === "rename") {
    const rename = () => {
      const name = freeName(folder.id);
      if (name) void save((d) => renameFolder(d, folder.id, name), "Could not rename. Try again.");
    };
    body = (
      <>
        {back}
        <MenuField theme={theme} value={draft} onChangeText={setDraft} label="Folder name" selectAll onSubmit={rename} />
        {item("save", "Check", "Save", rename)}
      </>
    );
  } else if (page === "delete") {
    const question = `Delete “${folder.name}”?`;
    const goes = props.count === 1 ? "workspace goes" : `${props.count} workspaces go`;
    body = (
      <>
        {back}
        <MenuNote theme={theme}>
          {props.count === 0 ? question : `${question} Its ${goes} back to ${folderName(folders.doc, UNSORTED_ID)}.`}
        </MenuNote>
        {item(
          "delete",
          "Trash2",
          "Delete folder",
          () => void save((d) => deleteFolder(d, folder.id), "Could not delete. Try again."),
          true,
        )}
      </>
    );
  } else {
    const newWorkspace = props.onNewWorkspace;
    body = (
      <>
        {newWorkspace
          ? item("workspace", "Plus", "New workspace", () => {
              onClose();
              newWorkspace();
            })
          : null}
        {item("rename", "Pencil", "Rename folder", () => {
          setDraft(folder.name);
          setPage("rename");
        })}
        {item("new", "FolderPlus", "New folder", () => {
          setDraft("");
          setPage("new");
        })}
        {folder.id === UNSORTED_ID ? null : (
          <>
            <MenuSeparator theme={theme} />
            {item("delete", "Trash2", "Delete folder", () => setPage("delete"), true)}
          </>
        )}
      </>
    );
  }

  return (
    <Menu at={props.at} label={folder ? `Menu for ${folder.name}` : "New folder"} theme={theme} onClose={onClose}>
      {body}
    </Menu>
  );
}
