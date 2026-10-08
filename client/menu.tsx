import type { PluginTheme } from "@getpaseo/plugin";
import { usePaseo } from "@getpaseo/plugin/client";
import { copyText, Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Dimensions, Platform, Pressable, type PressableStateCallbackType, Text, TextInput, View } from "react-native";
import { type ListedWorkspace, moveWorkspace, resumeCommand, UNSORTED_ID, workspaceFolderOf } from "../shared/model";
import type { ReadyFolders, WorkspaceMeta } from "./data";
import { listenOutsidePress, nodeContains } from "./web-dom";

type Page = "main" | "move" | "rename";

/** Where the pointer was, in window coordinates. */
export interface MenuPoint {
  x: number;
  y: number;
}

// Paseo's own menu metrics (desktop): 28 px items, 4 px page padding, 220 px wide.
const MENU_WIDTH = 220;
const ITEM_HEIGHT = 28;

/** On the web a fixed layer escapes the sidebar's layout, like Paseo's own menus. */
const layer = (Platform.OS === "web" ? "fixed" : "absolute") as "absolute";

/** Translucent foreground, for hover and selection that read on light and dark themes. */
export function tint(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})/i.exec(hex.trim());
  if (!m) return "transparent";
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/**
 * Right-click (or long-press) menu for a workspace row. It follows Paseo's own
 * workspace menu (copy path and branch, rename, archive), puts Move to folder
 * where Paseo has Labels, and adds the tab menu's copy commands for a workspace
 * holding a single conversation.
 */
export function RowMenu(props: {
  ws: ListedWorkspace;
  meta: WorkspaceMeta | undefined;
  at: MenuPoint;
  /** Horizontal room the sidebar leaves, in window coordinates; the menu stays inside it. */
  bounds: { left: number; width: number } | null;
  theme: PluginTheme;
  folders: ReadyFolders;
  onClose(): void;
}) {
  const { ws, meta, theme, folders, onClose } = props;
  const paseo = usePaseo();
  const toast = useToast();
  const [page, setPage] = useState<Page>("main");
  const [draft, setDraft] = useState(ws.title);
  const surface = useRef<View | null>(null);
  const single = ws.agents.length === 1 ? ws.agents[0] : null;
  const resume = single ? resumeCommand(single.provider, single.sessionId) : null;
  const current = workspaceFolderOf(folders.doc, ws);
  const c = theme.colors;

  // Close on any press, right-click or Escape elsewhere in the window.
  useEffect(() => listenOutsidePress((target) => nodeContains(surface.current, target), onClose), [onClose]);

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

  const itemStyle = (state: PressableStateCallbackType) => {
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
  const item = (key: string, icon: string, label: string, onPress: () => void, trailing?: ReactNode) => (
    <Pressable key={key} accessibilityRole="menuitem" accessibilityLabel={label} onPress={onPress} style={itemStyle}>
      <View style={{ width: 16, alignItems: "center", justifyContent: "center" }}>
        <Icon name={icon} size={16} color={c.foreground} />
      </View>
      <Text style={{ flexShrink: 1, minWidth: 0, color: c.foreground, fontSize: 14, lineHeight: 18 }} numberOfLines={1}>
        {label}
      </Text>
      {trailing ? <View style={{ marginLeft: "auto", alignItems: "center", justifyContent: "center" }}>{trailing}</View> : null}
    </Pressable>
  );
  const separator = (key: string) => <View key={key} style={{ height: 1, backgroundColor: c.border, marginVertical: 4 }} />;
  const back = item("back", "ChevronLeft", ws.title, () => setPage("main"));
  const chevron = <Icon name="ChevronRight" size={14} color={c.foregroundMuted} />;

  let body: ReactNode;
  let rows: number;
  if (page === "move") {
    const choices = [...folders.doc.folders, { id: UNSORTED_ID, name: "Unsorted" }];
    rows = choices.length + 1;
    body = (
      <>
        {back}
        {separator("s1")}
        {choices.map((f) =>
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
    rows = 3;
    const save = () =>
      draft.trim() &&
      void act(() => paseo.workspaces.ref(ws.id).setTitle(draft.trim()), "Renamed", "Could not rename.");
    body = (
      <>
        {back}
        {separator("s1")}
        <View style={{ marginHorizontal: 4, paddingVertical: 4 }}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            autoFocus
            selectTextOnFocus
            onSubmitEditing={save}
            accessibilityLabel="Workspace title"
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
        {item("save", "Check", "Save", save)}
      </>
    );
  } else {
    const entries: ReactNode[] = [];
    if (meta?.directory) entries.push(item("path", "Copy", "Copy path", () => copy(meta.directory, "Path copied")));
    if (meta?.branch) entries.push(item("branch", "Copy", "Copy branch name", () => copy(meta.branch, "Branch name copied")));
    if (resume) entries.push(item("resume", "Copy", "Copy resume command", () => copy(resume, "Resume command copied")));
    if (single) entries.push(item("agent-id", "Copy", "Copy agent id", () => copy(single.id, "Agent id copied")));
    entries.push(
      item("rename", "Pencil", "Rename workspace", () => {
        setDraft(ws.title);
        setPage("rename");
      }),
    );
    entries.push(item("move", "FolderInput", "Move to folder", () => setPage("move"), chevron));
    entries.push(
      item("archive", "Archive", "Archive", () =>
        void act(() => paseo.workspaces.archive(ws.id), "Archived", "Could not archive."),
      ),
    );
    rows = entries.length;
    body = <>{entries}</>;
  }

  // Paseo clips the sidebar, so keep the menu inside it, opening up or left near the edges.
  const win = Dimensions.get("window");
  const minX = (props.bounds?.left ?? 0) + 4;
  const maxX = props.bounds ? props.bounds.left + props.bounds.width - 4 : win.width - 8;
  const width = Math.min(MENU_WIDTH, Math.max(160, maxX - minX));
  const height = rows * ITEM_HEIGHT + 8 + 9;
  const left = Math.max(minX, Math.min(props.at.x, maxX - width));
  const top = props.at.y + height > win.height - 8 ? Math.max(8, props.at.y - height) : props.at.y;

  return (
    <>
      {Platform.OS === "web" ? null : (
        <Pressable
          accessibilityLabel="Close menu"
          onPress={onClose}
          style={{ position: layer, left: 0, top: 0, width: win.width, height: win.height, zIndex: 999 }}
        />
      )}
      <View
        ref={surface}
        accessibilityRole="menu"
        style={{
          position: layer,
          left,
          top,
          width,
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
          zIndex: 1000,
        }}
      >
        {body}
      </View>
    </>
  );
}
