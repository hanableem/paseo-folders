import type { PluginTheme } from "@getpaseo/plugin";
import { Icon, Modal } from "@getpaseo/plugin/client/react-native";
import { useWorkspace } from "@getpaseo/plugin/client";
import { useMemo } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { type Folder, type ListedAgent, UNSORTED_ID } from "../shared/model";
import { formatDay } from "./data";

export function useStyles(theme: PluginTheme, compact: boolean) {
  return useMemo(() => {
    const c = theme.colors;
    return {
      screen: { flex: 1, backgroundColor: c.surface0 },
      body: { padding: compact ? 12 : 20, gap: 12 },
      row: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 10,
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: 8,
        backgroundColor: c.surface1,
        borderWidth: 1,
        borderColor: c.border,
      },
      rowMain: { flex: 1, gap: 2 },
      title: { color: c.foreground, fontSize: 14, fontWeight: "600" as const },
      text: { color: c.foreground, fontSize: 14 },
      muted: { color: c.foregroundMuted, fontSize: 12 },
      danger: { color: c.statusDanger, fontSize: 13 },
      input: {
        color: c.foreground,
        borderWidth: 1,
        borderColor: c.border,
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 8,
        backgroundColor: c.surface1,
        fontSize: 14,
      },
      button: {
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.surface2,
      },
      buttonText: { color: c.foreground, fontSize: 13 },
      primary: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 6, backgroundColor: c.accent },
      primaryText: { color: c.accentForeground, fontSize: 13, fontWeight: "600" as const },
      sectionTitle: { color: c.foregroundMuted, fontSize: 12, fontWeight: "600" as const, marginTop: 8 },
      toolbar: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8, flexWrap: "wrap" as const },
    };
  }, [theme, compact]);
}

export type Styles = ReturnType<typeof useStyles>;

export function Button(props: { label: string; onPress(): void; styles: Styles; primary?: boolean; disabled?: boolean }) {
  const { styles } = props;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      disabled={props.disabled}
      onPress={props.onPress}
      style={[props.primary ? styles.primary : styles.button, props.disabled ? { opacity: 0.5 } : null]}
    >
      <Text style={props.primary ? styles.primaryText : styles.buttonText}>{props.label}</Text>
    </Pressable>
  );
}

export function SearchBox(props: { value: string; onChange(text: string): void; styles: Styles; theme: PluginTheme }) {
  return (
    <TextInput
      value={props.value}
      onChangeText={props.onChange}
      placeholder="Search titles and notes"
      placeholderTextColor={props.theme.colors.foregroundMuted}
      style={props.styles.input}
      autoCorrect={false}
      accessibilityLabel="Search conversations"
    />
  );
}

export function AgentRow(props: {
  agent: ListedAgent;
  note: string;
  folderName?: string;
  styles: Styles;
  theme: PluginTheme;
  onOpen?: () => void;
  onMove(): void;
}) {
  const { agent, styles, theme } = props;
  const workspaceTitle = useWorkspace(agent.workspaceId, (w) => w.title);
  const title = agent.title === "Untitled" && workspaceTitle ? workspaceTitle : agent.title;
  const meta = [formatDay(agent.activityAt), agent.provider, agent.archived ? "archived" : "", props.folderName ?? ""]
    .filter(Boolean)
    .join(" · ");
  return (
    <View style={[styles.row, agent.archived ? { opacity: 0.75 } : null]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${title}`}
        style={styles.rowMain}
        disabled={!props.onOpen}
        onPress={props.onOpen}
      >
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {props.note ? (
          <Text style={styles.text} numberOfLines={2}>
            {props.note}
          </Text>
        ) : null}
        <Text style={styles.muted} numberOfLines={1}>
          {meta}
        </Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`Move ${title}`} onPress={props.onMove} style={styles.button}>
        <Icon name="FolderInput" size={16} color={theme.colors.foreground} />
      </Pressable>
    </View>
  );
}

export function MoveModal(props: {
  open: boolean;
  onOpenChange(open: boolean): void;
  folders: readonly Folder[];
  currentId: string;
  onPick(folderId: string): void;
  styles: Styles;
  theme: PluginTheme;
}) {
  const { styles, theme } = props;
  const choices = [...props.folders, { id: UNSORTED_ID, name: "Unsorted" }];
  return (
    <Modal
      title="Move to folder"
      icon={<Icon name="FolderInput" size={18} color={theme.colors.foreground} />}
      open={props.open}
      onOpenChange={props.onOpenChange}
    >
      <Modal.Content>
        <View style={{ gap: 6 }}>
          {choices.map((f) => {
            const current = f.id === props.currentId;
            return (
              <Pressable
                key={f.id}
                accessibilityRole="button"
                accessibilityLabel={`Move to ${f.name}`}
                disabled={current}
                onPress={() => props.onPick(f.id)}
                style={[styles.row, current ? { borderColor: theme.colors.accent } : null]}
              >
                <Icon name={f.id === UNSORTED_ID ? "Inbox" : "Folder"} size={16} color={theme.colors.foreground} />
                <Text style={styles.text}>{f.name}</Text>
                {current ? <Text style={styles.muted}>current</Text> : null}
              </Pressable>
            );
          })}
        </View>
      </Modal.Content>
    </Modal>
  );
}
