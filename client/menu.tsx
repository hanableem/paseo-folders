import type { PluginTheme } from "@getpaseo/plugin";
import { usePaseo, useRpc } from "@getpaseo/plugin/client";
import { copyText, Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  Dimensions,
  type LayoutChangeEvent,
  Modal,
  Platform,
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
  type ListedAgent,
  type ListedWorkspace,
  mergeTargets,
  moveWorkspace,
  pinWorkspaceRpc,
  holdInRecent,
  removeFromRecent,
  renameConversationRpc,
  renameFolder,
  resetRecentOrder,
  resumeCommand,
  UNSORTED_ID,
  withoutRecentPlace,
  withoutRecentRemoval,
  workspaceFolderOf,
} from "../shared/model";
import type { ReadyFolders, WorkspaceMeta } from "./data";
import type { Mover } from "./move";
import { rectOfId } from "./web-dom";

type Page = "move" | "rename" | "merge" | "split" | "more";
/** Pages under More, which holds what is mostly done by dragging. */
type MorePage = Exclude<Page, "rename" | "more">;
type ConversationPage = "rename" | "move" | "merge" | "more";
type FolderPage = "new" | "rename";

const PAGE_LABELS: Record<Page, string> = {
  move: "Move to folder",
  rename: "Rename workspace",
  merge: "Merge into workspace",
  split: "Split off a conversation",
  more: "More",
};
const CONVERSATION_PAGE_LABELS: Record<ConversationPage, string> = {
  rename: "Rename conversation",
  move: "Move to folder",
  merge: "Move into workspace",
  more: "More",
};
const FOLDER_PAGE_LABELS: Record<FolderPage, string> = {
  new: "New folder",
  rename: "Rename folder",
};

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
// A submenu opens 4 px beside its menu once the pointer has rested on its item for
// 90 ms. Moving on to another item leaves an open one 260 ms to be reached.
const SUBMENU_GAP = 4;
const SUBMENU_OPEN_MS = 90;
const SUBMENU_CLOSE_MS = 260;
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

/** The panel of a menu or submenu, styled like Paseo's. */
function surface(theme: PluginTheme) {
  const c = theme.colors;
  return {
    position: "absolute" as const,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surface1,
    overflow: "hidden" as const,
    shadowColor: "rgba(0, 0, 0, 0.20)",
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
    elevation: 8,
  };
}

/** A submenu shown beside its menu. */
interface Submenu {
  label: string;
  /** Window y of the item that opened it, so that its first row lines up with that item. */
  anchor: number;
  /** The pointer reached the submenu, so it stays open. */
  onEnter(): void;
  content: ReactNode;
}

/**
 * A menu at a window point, in a layer over the whole app like Paseo's own menus,
 * so nothing in the sidebar can clip it or show through it. It opens below and
 * right of the point, and goes up or left to stay in the window. A press or a
 * right-click outside it closes it, as does Escape.
 */
function Menu(props: {
  at: MenuPoint;
  label: string;
  theme: PluginTheme;
  onClose(): void;
  submenu?: Submenu | null;
  children: ReactNode;
}) {
  const { at, onClose } = props;
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
          style={{ ...surface(props.theme), left, top, width, opacity: height === null ? 0 : 1 }}
        >
          {props.children}
        </View>
        {props.submenu ? (
          <Flyout key={props.submenu.label} theme={props.theme} menu={{ left, width }} submenu={props.submenu} />
        ) : null}
      </View>
    </Modal>
  );
}

/** A submenu beside its menu: on the right, or on the left when the window has no room there. */
function Flyout(props: { theme: PluginTheme; menu: { left: number; width: number }; submenu: Submenu }) {
  const { menu, submenu } = props;
  const [height, setHeight] = useState<number | null>(null);
  const win = Dimensions.get("window");
  const width = MENU_WIDTH;
  const right = menu.left + menu.width + SUBMENU_GAP;
  const leftSide = menu.left - SUBMENU_GAP - width;
  const left =
    right + width <= win.width - EDGE ? right : leftSide >= EDGE ? leftSide : Math.max(EDGE, win.width - EDGE - width);
  // The panel's 1 px border and 4 px padding come before its first row.
  const wanted = submenu.anchor - 5;
  const top = height === null ? wanted : Math.max(EDGE, Math.min(wanted, win.height - EDGE - height));
  const keepOpen = { onMouseEnter: submenu.onEnter } as object;
  return (
    <View
      accessibilityRole="menu"
      accessibilityLabel={submenu.label}
      onLayout={(event: LayoutChangeEvent) => {
        const next = event.nativeEvent.layout.height;
        setHeight((h) => (h === next ? h : next));
      }}
      style={{ ...surface(props.theme), left, top, width, opacity: height === null ? 0 : 1 }}
      {...keepOpen}
    >
      {submenu.content}
    </View>
  );
}

const itemId = (key: string) => `paseo-folders-menu:${key}`;

/**
 * Which submenu of a menu is open. With a mouse, on a window wide enough for two
 * menus side by side, a submenu opens beside the menu once the pointer rests on its
 * item, or at once when the item is pressed, as in Paseo's menus. Elsewhere (the
 * mobile apps, narrow windows) pressing the item shows the submenu in place of the
 * menu, with a row to go back.
 */
function useSubmenu<K extends string>() {
  const beside = Platform.OS === "web" && Dimensions.get("window").width >= 2 * MENU_WIDTH + SUBMENU_GAP + 2 * EDGE;
  const [open, setOpen] = useState<{ key: K; anchor: number } | null>(null);
  // The pointer handlers read these, so that they never act on a stale render.
  const openKey = useRef<K | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Once something is typed in a submenu, only a press closes it: a stray pointer cannot throw the text away.
  const typed = useRef(false);

  const cancel = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => cancel, []);
  const after = (ms: number, run: () => void) => {
    cancel();
    timer.current = setTimeout(() => {
      timer.current = null;
      run();
    }, ms);
  };
  const set = (next: { key: K; anchor: number } | null) => {
    cancel();
    typed.current = false;
    openKey.current = next?.key ?? null;
    setOpen(next);
  };
  const show = (key: K, prepare?: () => void) => {
    prepare?.();
    set({ key, anchor: rectOfId(itemId(key))?.y ?? 0 });
  };

  return {
    beside,
    open: open?.key ?? null,
    anchor: open?.anchor ?? 0,
    /** Props for the item that opens submenu `key`; `prepare` resets what the submenu edits. */
    opener(key: K, prepare?: () => void) {
      return {
        nativeID: itemId(key),
        active: beside && open?.key === key,
        onPress: () => show(key, prepare),
        onHoverIn: beside
          ? () => {
              if (openKey.current === key) cancel();
              else if (!typed.current)
                after(openKey.current === null ? SUBMENU_OPEN_MS : SUBMENU_CLOSE_MS, () => show(key, prepare));
            }
          : undefined,
        onHoverOut: beside
          ? () => {
              if (openKey.current !== key) cancel();
            }
          : undefined,
      };
    },
    /** For the menu's other items: an open submenu closes once the pointer rests on one. */
    onHoverOther: beside
      ? () => {
          if (openKey.current !== null && !typed.current) after(SUBMENU_CLOSE_MS, () => set(null));
          else cancel();
        }
      : undefined,
    /** The pointer reached the submenu. */
    keep: cancel,
    /** Something was typed in the submenu. */
    typing() {
      typed.current = true;
      cancel();
    },
    close: () => set(null),
  };
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
  /** Highlighted, as an item is while its submenu is open. */
  active?: boolean;
  nativeID?: string;
  onHoverIn?(): void;
  onHoverOut?(): void;
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
      backgroundColor: hovered || state.pressed || props.active ? c.surface2 : "transparent",
    };
  };
  return (
    <Pressable
      accessibilityRole="menuitem"
      accessibilityLabel={props.label}
      nativeID={props.nativeID}
      onPress={props.onPress}
      onHoverIn={props.onHoverIn}
      onHoverOut={props.onHoverOut}
      style={style}
    >
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
  /** Changing it puts the cursor back in the field, selecting the text with selectAll. */
  focusKey?: number;
  onSubmit?(): void;
}) {
  const c = props.theme.colors;
  const input = useRef<TextInput | null>(null);
  const { focusKey, selectAll } = props;
  useEffect(() => {
    if (!focusKey) return;
    // On the web the field is the page's input element, which can select its text.
    const field = input.current as unknown as { focus(): void; select?(): void } | null;
    field?.focus();
    if (selectAll) field?.select?.();
  }, [focusKey, selectAll]);
  return (
    <View style={{ marginHorizontal: 4, paddingVertical: 4 }}>
      <TextInput
        ref={input}
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

/** Runs a menu's action, then says it is done and closes the menu, or says it failed and keeps the menu open. */
function useAct(onClose: () => void) {
  const toast = useToast();
  return async (work: () => Promise<unknown>, done: string, failed: string) => {
    try {
      await work();
      toast.show(done, { variant: "success" });
      onClose();
    } catch {
      toast.error(failed);
    }
  };
}

/**
 * Right-click (or long-press) menu for a workspace row. It follows Paseo's own
 * workspace menu (copy path and branch, rename, pin, archive), and adds the tab
 * menu's copy commands for a workspace holding a single conversation, grouped as
 * in the tab menu. What is mostly done by dragging waits under More: Move to
 * folder, where Paseo has Labels, and with a mover, merging the workspace into
 * another one and splitting a conversation off into a workspace of its own; so
 * does putting In progress back in its own order.
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
  /** The workspaces Recent lists, in order; one listed there can be removed from it. */
  recent?: readonly string[];
  /** Recent is in an order the user dragged it into, which it can go back from. */
  recentOrdered?: boolean;
  onClose(): void;
  onArchived?(workspaceId: string): void;
}) {
  const { ws, meta, theme, folders, mover, onClose } = props;
  const paseo = usePaseo();
  const pin = useRpc(pinWorkspaceRpc);
  const renameTab = useRpc(renameConversationRpc);
  const toast = useToast();
  const sub = useSubmenu<Page>();
  const [draft, setDraft] = useState(ws.title);
  const [refocus, setRefocus] = useState(0);
  const [query, setQuery] = useState("");
  // The page chosen under More, shown there in place of its items.
  const [inner, setInner] = useState<MorePage | null>(null);
  const single = ws.agents.length === 1 ? ws.agents[0] : null;
  const resume = single ? resumeCommand(single.provider, single.sessionId) : null;
  const current = workspaceFolderOf(folders.doc, ws);
  const pinned = Boolean(meta?.pinnedAt);
  const inRecent = props.recent?.includes(ws.id) ?? false;
  const act = useAct(onClose);
  const copy = (text: string, done: string) => void act(() => copyText(text), done, "Could not copy.");

  const item = (key: string, icon: string, label: string, onPress: () => void, trailing?: ReactNode) => (
    <MenuItem key={key} theme={theme} icon={icon} label={label} onPress={onPress} trailing={trailing} />
  );
  // The menu's own items, unlike a submenu's, close an open submenu when the pointer rests on them.
  const action = (key: string, icon: string, label: string, onPress: () => void, trailing?: ReactNode) => (
    <MenuItem
      key={key}
      theme={theme}
      icon={icon}
      label={label}
      onPress={onPress}
      trailing={trailing}
      onHoverIn={sub.onHoverOther}
    />
  );
  const chevron = <Icon name="ChevronRight" size={14} color={theme.colors.foregroundMuted} />;
  const opener = (key: Page, icon: string, label: string, prepare?: () => void) => (
    <MenuItem key={key} theme={theme} icon={icon} label={label} trailing={chevron} {...sub.opener(key, prepare)} />
  );
  // An item under More that opens a page of its own there.
  const into = (key: MorePage, icon: string, label: string, prepare?: () => void) =>
    item(
      key,
      icon,
      label,
      () => {
        prepare?.();
        setInner(key);
      },
      chevron,
    );
  const mergeInto = (target: ListedWorkspace) => {
    onClose();
    if (mover) void mover.merge(ws, target);
  };

  // Paseo keeps a workspace's title apart from its conversations' titles, and a tab shows its
  // conversation's, so a workspace holding one conversation renames that conversation as well.
  const changes = (title: string) => title !== ws.title.trim() || (single !== null && single.title.trim() !== title);
  async function retitle(title: string) {
    if (title !== ws.title.trim()) await paseo.workspaces.ref(ws.id).setTitle(title);
    if (single && single.title.trim() !== title) {
      const result = await renameTab({ agentId: single.id, title });
      if (!result.ok) throw new Error(result.reason);
    }
  }

  function page(key: Page): ReactNode {
    if (key === "more") {
      if (inner) {
        return (
          <>
            {item("more-back", "ChevronLeft", "More", () => setInner(null))}
            <MenuSeparator theme={theme} />
            {page(inner)}
          </>
        );
      }
      return (
        <>
          {into("move", "FolderInput", "Move to folder")}
          {mover && ws.agents.length > 0 && (props.workspaces?.length ?? 0) > 1
            ? into("merge", "Merge", "Merge into workspace", () => setQuery(""))
            : null}
          {mover && ws.agents.length > 1 ? into("split", "SquareSplitHorizontal", "Split off a conversation") : null}
          {inRecent && props.recentOrdered
            ? item("recent-order", "ListRestart", "Reset In progress order", () =>
                void act(
                  async () => {
                    if (!(await folders.update(resetRecentOrder))) throw new Error("not saved");
                  },
                  "In progress is back in its own order",
                  "Could not reset the order.",
                ),
              )
            : null}
        </>
      );
    }
    if (key === "merge") {
      const targets = mergeTargets(folders.doc, props.workspaces ?? [], ws, query).slice(0, MAX_TARGETS);
      return (
        <>
          <MenuField
            theme={theme}
            value={query}
            onChangeText={(text) => {
              sub.typing();
              setQuery(text);
            }}
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
    }
    if (key === "split") {
      return ws.agents.map((a) =>
        item(a.id, "MessageSquare", a.title, () => {
          onClose();
          if (mover) void mover.split(ws, a);
        }),
      );
    }
    if (key === "move") {
      return folderOrder(folders.doc).map((f) =>
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
      );
    }
    const save = () => {
      const title = draft.trim();
      if (!title) return;
      // Saving the name as it was would say Renamed while nothing changed.
      if (!changes(title)) {
        toast.show("Type a new name first, then press Save.", { variant: "info" });
        setRefocus((n) => n + 1);
        return;
      }
      void act(() => retitle(title), "Renamed", "Could not rename.");
    };
    return (
      <>
        <MenuField
          theme={theme}
          value={draft}
          onChangeText={(text) => {
            sub.typing();
            setDraft(text);
          }}
          label="Workspace title"
          selectAll
          focusKey={refocus}
          onSubmit={save}
        />
        {item("save", "Check", "Save", save)}
      </>
    );
  }

  // Like Paseo's tab menu: what to copy and the name first, then what to do with the workspace.
  const main = (
    <>
      {meta?.directory ? action("path", "Copy", "Copy path", () => copy(meta.directory, "Path copied")) : null}
      {meta?.branch ? action("branch", "Copy", "Copy branch name", () => copy(meta.branch, "Branch name copied")) : null}
      {resume ? action("resume", "Copy", "Copy resume command", () => copy(resume, "Resume command copied")) : null}
      {single
        ? action(
            "agent-id",
            "Copy",
            "Copy agent id",
            () => copy(single.id, "Agent id copied"),
            <MenuHint theme={theme}>{single.id.slice(0, 7)}</MenuHint>,
          )
        : null}
      {opener("rename", "Pencil", "Rename workspace", () => setDraft(ws.title))}
      {/* Paseo's own pin, which Recent lists first; Paseo's menu puts it after Rename too. */}
      {action("pin", pinned ? "PinOff" : "Pin", pinned ? "Unpin from In progress" : "Pin to In progress", () =>
        void act(
          async () => {
            const result = await pin({ workspaceId: ws.id, pinned: !pinned });
            if (!result.ok) throw new Error(result.reason);
            // Pinned, it is back in Recent for good, not only until it is unpinned, and on top.
            if (!pinned) {
              await folders.update((d) => holdInRecent(withoutRecentPlace(withoutRecentRemoval(d, [ws.id]), [ws.id]), ws.id));
            }
          },
          pinned ? "Unpinned" : "Pinned to In progress",
          pinned ? "Could not unpin." : "Could not pin.",
        ),
      )}
      {inRecent
        ? action("unrecent", "ListX", "Remove from In progress", () =>
            void act(
              async () => {
                if (pinned) {
                  const result = await pin({ workspaceId: ws.id, pinned: false });
                  if (!result.ok) throw new Error(result.reason);
                }
                const at = new Date().toISOString();
                if (!(await folders.update((d) => removeFromRecent(d, ws.id, at, props.recent ?? [])))) {
                  throw new Error("not saved");
                }
              },
              "Removed from In progress",
              "Could not remove it from In progress.",
            ),
          )
        : null}
      <MenuSeparator theme={theme} />
      {opener("more", "Ellipsis", "More", () => setInner(null))}
      {action("archive", "Archive", "Archive", () =>
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

  const open = sub.open;
  return (
    <Menu
      at={props.at}
      label={`Menu for ${ws.title}`}
      theme={theme}
      onClose={onClose}
      submenu={
        sub.beside && open
          ? { label: PAGE_LABELS[open], anchor: sub.anchor, onEnter: sub.keep, content: page(open) }
          : null
      }
    >
      {!sub.beside && open ? (
        <>
          {item("back", "ChevronLeft", ws.title, sub.close)}
          <MenuSeparator theme={theme} />
          {page(open)}
        </>
      ) : (
        main
      )}
    </Menu>
  );
}

/**
 * Right-click (or long-press, or More) menu for a conversation listed under its workspace. It
 * has what the workspace's menu has, for this conversation alone: copy its path, branch, resume
 * command and agent id, rename it, and archive it, as closing its tab does. With a mover, More
 * moves the conversation, as dragging it does: to a folder, in a workspace of its own there;
 * into another workspace, as a tab; or to a new workspace beside its own. Pinning and In
 * progress are the workspace's, so they stay in the workspace's menu.
 */
export function ConversationMenu(props: {
  ws: ListedWorkspace;
  agent: ListedAgent;
  meta: WorkspaceMeta | undefined;
  at: MenuPoint;
  theme: PluginTheme;
  folders: ReadyFolders;
  /** Every listed workspace, for Move into workspace. */
  workspaces?: readonly ListedWorkspace[];
  /** Leave out to hide moving it. */
  mover?: Mover;
  onClose(): void;
}) {
  const { ws, agent, meta, theme, folders, mover, onClose } = props;
  const paseo = usePaseo();
  const renameTab = useRpc(renameConversationRpc);
  const toast = useToast();
  const sub = useSubmenu<ConversationPage>();
  const [draft, setDraft] = useState(agent.title);
  const [refocus, setRefocus] = useState(0);
  const [query, setQuery] = useState("");
  // The page chosen under More, shown there in place of its items.
  const [inner, setInner] = useState<"move" | "merge" | null>(null);
  const resume = resumeCommand(agent.provider, agent.sessionId);
  const current = workspaceFolderOf(folders.doc, ws);
  const act = useAct(onClose);
  const copy = (text: string, done: string) => void act(() => copyText(text), done, "Could not copy.");

  const item = (key: string, icon: string, label: string, onPress: () => void, trailing?: ReactNode) => (
    <MenuItem key={key} theme={theme} icon={icon} label={label} onPress={onPress} trailing={trailing} />
  );
  const action = (key: string, icon: string, label: string, onPress: () => void, trailing?: ReactNode) => (
    <MenuItem
      key={key}
      theme={theme}
      icon={icon}
      label={label}
      onPress={onPress}
      trailing={trailing}
      onHoverIn={sub.onHoverOther}
    />
  );
  const chevron = <Icon name="ChevronRight" size={14} color={theme.colors.foregroundMuted} />;
  const opener = (key: ConversationPage, icon: string, label: string, prepare?: () => void) => (
    <MenuItem key={key} theme={theme} icon={icon} label={label} trailing={chevron} {...sub.opener(key, prepare)} />
  );
  // An item under More that opens a page of its own there.
  const into = (key: "move" | "merge", icon: string, label: string, prepare?: () => void) =>
    item(
      key,
      icon,
      label,
      () => {
        prepare?.();
        setInner(key);
      },
      chevron,
    );
  /** Runs a move once the menu has closed; the mover says how it went. */
  const moving = (work: (m: Mover) => Promise<boolean>) => () => {
    onClose();
    if (mover) void work(mover);
  };

  const save = () => {
    const title = draft.trim();
    if (!title) return;
    // Saving the name as it was would say Renamed while nothing changed.
    if (title === agent.title.trim()) {
      toast.show("Type a new name first, then press Save.", { variant: "info" });
      setRefocus((n) => n + 1);
      return;
    }
    void act(
      async () => {
        const result = await renameTab({ agentId: agent.id, title });
        if (!result.ok) throw new Error(result.reason);
      },
      "Renamed",
      "Could not rename.",
    );
  };
  const renamePage = (
    <>
      <MenuField
        theme={theme}
        value={draft}
        onChangeText={(text) => {
          sub.typing();
          setDraft(text);
        }}
        label="Conversation title"
        selectAll
        focusKey={refocus}
        onSubmit={save}
      />
      <MenuItem theme={theme} icon="Check" label="Save" onPress={save} />
    </>
  );

  function page(key: ConversationPage): ReactNode {
    if (key === "more") {
      if (inner) {
        return (
          <>
            {item("more-back", "ChevronLeft", "More", () => setInner(null))}
            <MenuSeparator theme={theme} />
            {page(inner)}
          </>
        );
      }
      return (
        <>
          {into("move", "FolderInput", "Move to folder")}
          {(props.workspaces?.length ?? 0) > 1 ? into("merge", "Merge", "Move into workspace", () => setQuery("")) : null}
          {ws.agents.length > 1
            ? item("split", "SquareSplitHorizontal", "Move to a new workspace", moving((m) => m.split(ws, agent)))
            : null}
        </>
      );
    }
    if (key === "move") {
      // In any folder, its own workspace there; in its workspace's folder, that is a new workspace beside it.
      return folderOrder(folders.doc).map((f) =>
        item(
          f.id,
          f.id === current ? "Check" : f.id === UNSORTED_ID ? "Inbox" : "Folder",
          f.name,
          moving((m) => m.split(ws, agent, f.id)),
        ),
      );
    }
    if (key === "merge") {
      const targets = mergeTargets(folders.doc, props.workspaces ?? [], ws, query).slice(0, MAX_TARGETS);
      return (
        <>
          <MenuField
            theme={theme}
            value={query}
            onChangeText={(text) => {
              sub.typing();
              setQuery(text);
            }}
            label="Search workspaces"
            placeholder="Search workspaces"
          />
          {targets.length === 0 ? (
            <MenuNote theme={theme}>No other workspace matches.</MenuNote>
          ) : (
            targets.map((t) => {
              const where = workspaceFolderOf(folders.doc, t);
              const hint = where === current ? undefined : <MenuHint theme={theme}>{folderName(folders.doc, where)}</MenuHint>;
              return item(t.id, "PanelsTopLeft", t.title, moving((m) => m.merge(ws, t, [agent.id])), hint);
            })
          )}
        </>
      );
    }
    return renamePage;
  }

  // In the workspace menu's order, for this conversation alone.
  const main = (
    <>
      {meta?.directory ? action("path", "Copy", "Copy path", () => copy(meta.directory, "Path copied")) : null}
      {meta?.branch ? action("branch", "Copy", "Copy branch name", () => copy(meta.branch, "Branch name copied")) : null}
      {resume ? action("resume", "Copy", "Copy resume command", () => copy(resume, "Resume command copied")) : null}
      {action(
        "agent-id",
        "Copy",
        "Copy agent id",
        () => copy(agent.id, "Agent id copied"),
        <MenuHint theme={theme}>{agent.id.slice(0, 7)}</MenuHint>,
      )}
      {opener("rename", "Pencil", "Rename conversation", () => setDraft(agent.title))}
      <MenuSeparator theme={theme} />
      {mover ? opener("more", "Ellipsis", "More", () => setInner(null)) : null}
      {action("archive", "Archive", "Archive conversation", () =>
        void act(
          async () => {
            await paseo.agents.ref(agent.id).archive();
          },
          "Archived",
          "Could not archive.",
        ),
      )}
    </>
  );

  const open = sub.open;
  return (
    <Menu
      at={props.at}
      label={`Menu for ${agent.title}`}
      theme={theme}
      onClose={onClose}
      submenu={
        sub.beside && open
          ? { label: CONVERSATION_PAGE_LABELS[open], anchor: sub.anchor, onEnter: sub.keep, content: page(open) }
          : null
      }
    >
      {!sub.beside && open ? (
        <>
          <MenuItem theme={theme} icon="ChevronLeft" label={agent.title} onPress={sub.close} />
          <MenuSeparator theme={theme} />
          {page(open)}
        </>
      ) : (
        main
      )}
    </Menu>
  );
}

/**
 * Right-click (or More) menu for a folder in the sidebar: make a workspace in it,
 * rename it, add a folder below it, or delete it at once, which sends its workspaces
 * to Unsorted. Unsorted can be renamed but not deleted. Without a folder, as from
 * the Folders header, it adds a folder at the end.
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
  const sub = useSubmenu<FolderPage>();
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
  const type = (text: string) => {
    sub.typing();
    setDraft(text);
  };

  const item = (key: string, icon: string, label: string, onPress: () => void, danger?: boolean) => (
    <MenuItem key={key} theme={theme} icon={icon} label={label} onPress={onPress} danger={danger} />
  );
  const chevron = <Icon name="ChevronRight" size={14} color={theme.colors.foregroundMuted} />;
  const opener = (key: FolderPage, icon: string, label: string, prepare?: () => void) => (
    <MenuItem key={key} theme={theme} icon={icon} label={label} trailing={chevron} {...sub.opener(key, prepare)} />
  );

  const newFolder = (
    <>
      <MenuField theme={theme} value={draft} onChangeText={type} label="Folder name" placeholder="Folder name" onSubmit={create} />
      {item("add", "FolderPlus", "Add folder", create)}
    </>
  );
  if (!folder) {
    return (
      <Menu at={props.at} label="New folder" theme={theme} onClose={onClose}>
        {newFolder}
      </Menu>
    );
  }

  function page(key: FolderPage, f: Folder): ReactNode {
    if (key === "new") return newFolder;
    const rename = () => {
      const name = freeName(f.id);
      if (name) void save((d) => renameFolder(d, f.id, name), "Could not rename. Try again.");
    };
    return (
      <>
        <MenuField theme={theme} value={draft} onChangeText={type} label="Folder name" selectAll onSubmit={rename} />
        {item("save", "Check", "Save", rename)}
      </>
    );
  }

  async function remove(f: Folder) {
    const unsorted = folderName(folders.doc, UNSORTED_ID);
    if (!(await folders.update((d) => deleteFolder(d, f.id)))) {
      toast.error("Could not delete. Try again.");
      return;
    }
    onClose();
    const went = props.count === 1 ? "Its workspace went" : `Its ${props.count} workspaces went`;
    toast.show(props.count === 0 ? `Deleted “${f.name}”` : `Deleted “${f.name}”. ${went} to ${unsorted}.`, {
      variant: "success",
    });
  }

  const newWorkspace = props.onNewWorkspace;
  const main = (
    <>
      {newWorkspace ? (
        <MenuItem
          theme={theme}
          icon="Plus"
          label="New workspace"
          onPress={() => {
            onClose();
            newWorkspace();
          }}
          onHoverIn={sub.onHoverOther}
        />
      ) : null}
      {opener("rename", "Pencil", "Rename folder", () => setDraft(folder.name))}
      {opener("new", "FolderPlus", "New folder", () => setDraft(""))}
      {folder.id === UNSORTED_ID ? null : (
        <>
          <MenuSeparator theme={theme} />
          <MenuItem
            theme={theme}
            icon="Trash2"
            label="Delete folder"
            danger
            onPress={() => void remove(folder)}
            onHoverIn={sub.onHoverOther}
          />
        </>
      )}
    </>
  );

  const open = sub.open;
  return (
    <Menu
      at={props.at}
      label={`Menu for ${folder.name}`}
      theme={theme}
      onClose={onClose}
      submenu={
        sub.beside && open
          ? { label: FOLDER_PAGE_LABELS[open], anchor: sub.anchor, onEnter: sub.keep, content: page(open, folder) }
          : null
      }
    >
      {!sub.beside && open ? (
        <>
          {item("back", "ChevronLeft", folder.name, sub.close)}
          <MenuSeparator theme={theme} />
          {page(open, folder)}
        </>
      ) : (
        main
      )}
    </Menu>
  );
}
