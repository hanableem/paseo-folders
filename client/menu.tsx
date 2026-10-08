import type { PluginTheme } from "@getpaseo/plugin";
import { usePaseo } from "@getpaseo/plugin/client";
import { copyText, Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { useState } from "react";
import { Pressable, type PressableStateCallbackType, Text, TextInput, View } from "react-native";
import { type ListedWorkspace, moveWorkspace, resumeCommand, UNSORTED_ID, workspaceFolderOf } from "../shared/model";
import type { ReadyFolders } from "./data";

type Page = "main" | "move" | "rename" | "archive";

/**
 * Right-click (or long-press) menu for a workspace row: open, move to a folder,
 * rename, copy the resume command or agent ID like Paseo's tab menu, archive.
 */
export function RowMenu(props: {
  ws: ListedWorkspace;
  top: number;
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
      gap: 10,
      paddingHorizontal: 10,
      paddingVertical: 7,
      borderRadius: 6,
      backgroundColor: hovered || state.pressed ? c.surface2 : "transparent",
    };
  };
  const item = (key: string, icon: string, label: string, onPress: () => void, trailing?: string) => (
    <Pressable key={key} accessibilityRole="menuitem" accessibilityLabel={label} onPress={onPress} style={itemStyle}>
      <Icon name={icon} size={15} color={c.foreground} />
      <Text style={{ flex: 1, color: c.foreground, fontSize: 13 }} numberOfLines={1}>
        {label}
      </Text>
      {trailing ? <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>{trailing}</Text> : null}
    </Pressable>
  );
  const separator = (key: string) => <View key={key} style={{ height: 1, backgroundColor: c.border, marginVertical: 4 }} />;
  const back = item("back", "ChevronLeft", ws.title, () => setPage("main"));

  let body: React.ReactNode;
  if (page === "move") {
    const choices = [...folders.doc.folders, { id: UNSORTED_ID, name: "Unsorted" }];
    body = (
      <>
        {back}
        {separator("s1")}
        {choices.map((f) =>
          item(
            f.id,
            f.id === current ? "Check" : f.id === UNSORTED_ID ? "Inbox" : "Folder",
            f.name,
            () =>
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
    body = (
      <>
        {back}
        {separator("s1")}
        <View style={{ padding: 6, gap: 6 }}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            autoFocus
            selectTextOnFocus
            accessibilityLabel="Workspace title"
            style={{
              color: c.foreground,
              borderWidth: 1,
              borderColor: c.border,
              borderRadius: 6,
              paddingHorizontal: 8,
              paddingVertical: 6,
              fontSize: 13,
              backgroundColor: c.surface0,
            }}
            onSubmitEditing={() =>
              draft.trim() &&
              void act(() => paseo.workspaces.ref(ws.id).setTitle(draft.trim()), "Renamed", "Could not rename.")
            }
          />
          {item("save", "Check", "Save", () =>
            draft.trim()
              ? void act(() => paseo.workspaces.ref(ws.id).setTitle(draft.trim()), "Renamed", "Could not rename.")
              : undefined,
          )}
        </View>
      </>
    );
  } else if (page === "archive") {
    body = (
      <>
        {back}
        {separator("s1")}
        <Text style={{ color: c.foregroundMuted, fontSize: 12, paddingHorizontal: 10, paddingVertical: 6 }}>
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
        {single || resume ? separator("s1") : null}
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

  return (
    <>
      <Pressable
        accessibilityLabel="Close menu"
        onPress={props.onClose}
        style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }}
      />
      <View
        accessibilityRole="menu"
        style={{
          position: "absolute",
          top: props.top,
          left: 16,
          right: 8,
          maxWidth: 280,
          padding: 4,
          borderRadius: 10,
          borderWidth: 1,
          borderColor: c.border,
          backgroundColor: c.surface1,
          shadowColor: "#000",
          shadowOpacity: 0.18,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 },
          elevation: 8,
          zIndex: 50,
        }}
      >
        {body}
      </View>
    </>
  );
}
