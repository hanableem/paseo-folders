import type { PluginTheme } from "@getpaseo/plugin";
import { usePaseo } from "@getpaseo/plugin/client";
import { copyText, Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { type ReactNode, useState } from "react";
import { Dimensions, Platform, Pressable, type PressableStateCallbackType, Text, TextInput, View } from "react-native";
import { type ListedWorkspace, moveWorkspace, resumeCommand, UNSORTED_ID, workspaceFolderOf } from "../shared/model";
import type { ReadyFolders } from "./data";

type Page = "main" | "move" | "rename" | "archive";

/** Where the pointer was, in window coordinates. */
export interface MenuPoint {
  x: number;
  y: number;
}

const MENU_WIDTH = 248;
const ITEM_HEIGHT = 36;

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
 * Right-click (or long-press) menu for a workspace row, styled after Paseo's
 * tab menu and opened at the pointer: open, move to a folder, rename, copy the
 * resume command or agent id, archive.
 */
export function RowMenu(props: {
  ws: ListedWorkspace;
  at: MenuPoint;
  theme: PluginTheme;
  folders: ReadyFolders;
  onOpen(): void;
  onClose(): void;
}) {
  const { ws, theme, folders } = props;
  const paseo = usePaseo();
  const toast = useToast();
  const [page, setPage] = useState<Page>("main");
  const [draft, setDraft] = useState(ws.title);
  const single = ws.agents.length === 1 ? ws.agents[0] : null;
  const resume = single ? resumeCommand(single.provider, single.sessionId) : null;
  const current = workspaceFolderOf(folders.doc, ws);
  const c = theme.colors;

  async function act(work: () => Promise<unknown>, done: string, failed: string) {
    try {
      await work();
      toast.show(done, { variant: "success" });
      props.onClose();
    } catch {
      toast.error(failed);
    }
  }

  const itemStyle = (state: PressableStateCallbackType) => {
    const hovered = (state as PressableStateCallbackType & { hovered?: boolean }).hovered;
    return {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      minHeight: ITEM_HEIGHT,
      paddingHorizontal: 12,
      paddingVertical: 8,
      gap: 8,
      backgroundColor: hovered || state.pressed ? c.surface2 : "transparent",
    };
  };
  const item = (key: string, icon: string, label: string, onPress: () => void, trailing?: string) => (
    <Pressable key={key} accessibilityRole="menuitem" accessibilityLabel={label} onPress={onPress} style={itemStyle}>
      <View style={{ width: 18, alignItems: "center", justifyContent: "center", marginRight: 4 }}>
        <Icon name={icon} size={16} color={c.foreground} />
      </View>
      <Text style={{ flex: 1, color: c.foreground, fontSize: 14 }} numberOfLines={1}>
        {label}
      </Text>
      {trailing ? <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>{trailing}</Text> : null}
    </Pressable>
  );
  const separator = (key: string) => <View key={key} style={{ height: 1, backgroundColor: c.border, marginVertical: 4 }} />;
  const back = item("back", "ChevronLeft", ws.title, () => setPage("main"));

  let body: ReactNode;
  let rows = 7;
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
        <View style={{ paddingHorizontal: 8, paddingVertical: 6 }}>
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
              paddingVertical: 6,
              fontSize: 14,
              backgroundColor: c.surface0,
            }}
          />
        </View>
        {item("save", "Check", "Save", save)}
      </>
    );
  } else if (page === "archive") {
    rows = 4;
    body = (
      <>
        {back}
        {separator("s1")}
        <Text style={{ color: c.foregroundMuted, fontSize: 12, paddingHorizontal: 12, paddingVertical: 6 }}>
          Archive this workspace? Its conversations stay in History and can be restored.
        </Text>
        {item("confirm", "Archive", "Archive", () =>
          void act(() => paseo.workspaces.archive(ws.id), "Archived", "Could not archive."),
        )}
      </>
    );
  } else {
    body = (
      <>
        {item("open", "ExternalLink", "Open", () => {
          props.onOpen();
          props.onClose();
        })}
        {item("move", "FolderInput", "Move to folder", () => setPage("move"), "›")}
        {item("rename", "Pencil", "Rename", () => {
          setDraft(ws.title);
          setPage("rename");
        })}
        {resume || single ? separator("s1") : null}
        {resume
          ? item("resume", "Copy", "Copy resume command", () =>
              void act(() => copyText(resume), "Resume command copied", "Could not copy."),
            )
          : null}
        {single
          ? item(
              "agent-id",
              "Copy",
              "Copy agent id",
              () => void act(() => copyText(single.id), "Agent id copied", "Could not copy."),
              single.id.slice(0, 7),
            )
          : null}
        {separator("s2")}
        {item("archive", "Archive", "Archive…", () => setPage("archive"))}
      </>
    );
  }

  // Keep the menu inside the window, flipping up or left near the edges.
  const win = Dimensions.get("window");
  const height = rows * ITEM_HEIGHT + 16;
  const left = Math.max(8, Math.min(props.at.x, win.width - MENU_WIDTH - 8));
  const top = props.at.y + height > win.height - 8 ? Math.max(8, props.at.y - height) : props.at.y;
  const closeOnContext = { onContextMenu: (e: { preventDefault?: () => void }) => (e.preventDefault?.(), props.onClose()) } as object;

  return (
    <>
      <Pressable
        accessibilityLabel="Close menu"
        onPress={props.onClose}
        style={{ position: layer, left: 0, top: 0, width: win.width, height: win.height, zIndex: 999 }}
        {...closeOnContext}
      />
      <View
        accessibilityRole="menu"
        style={{
          position: layer,
          left,
          top,
          width: MENU_WIDTH,
          paddingVertical: 4,
          borderRadius: 10,
          borderWidth: 1,
          borderColor: c.border,
          backgroundColor: c.surface1,
          overflow: "hidden",
          shadowColor: "#000",
          shadowOpacity: 0.16,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 6 },
          elevation: 12,
          zIndex: 1000,
        }}
      >
        {body}
      </View>
    </>
  );
}
