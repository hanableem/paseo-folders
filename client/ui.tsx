import type { PluginTheme } from "@getpaseo/plugin";
import { Icon, Modal } from "@getpaseo/plugin/client/react-native";
import { useMemo } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { type Folder, type ListedWorkspace, UNSORTED_ID } from "../shared/model";
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

/** Running spinner, attention dot, or the given icon. Mirrors Paseo's own row status. */
export function StatusIcon(props: { running: boolean; attention: boolean; icon: string; theme: PluginTheme; size?: number }) {
  const size = props.size ?? 14;
  if (props.running) return <ActivityIndicator size="small" color={props.theme.colors.accent} style={{ width: size, height: size }} />;
  if (props.attention) {
    return (
      <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: props.theme.colors.accent }} />
      </View>
    );
  }
  return <Icon name={props.icon} size={size} color={props.theme.colors.foregroundMuted} />;
}

export function WorkspaceRow(props: {
  workspace: ListedWorkspace;
  notes: Record<string, string>;
  folderName?: string;
  styles: Styles;
  theme: PluginTheme;
  onOpen?: () => void;
  onMove(): void;
}) {
  const { workspace, styles, theme } = props;
  const many = workspace.agents.length > 1;
  const detail = many
    ? `${workspace.agents.length} conversations: ${workspace.agents.map((a) => a.title).join(" · ")}`
    : props.notes[workspace.agents[0]?.id ?? ""] ?? "";
  const meta = [formatDay(workspace.activityAt), props.folderName ?? ""].filter(Boolean).join(" · ");
  return (
    <View style={styles.row}>
      <StatusIcon
        running={workspace.agents.some((a) => a.running)}
        attention={workspace.agents.some((a) => a.attention)}
        icon={many ? "MessagesSquare" : "MessageSquare"}
        theme={theme}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${workspace.title}`}
        accessibilityHint="Long press to move it to another folder"
        style={styles.rowMain}
        onPress={props.onOpen}
        onLongPress={props.onMove}
        delayLongPress={400}
      >
        <Text style={styles.title} numberOfLines={1}>
          {workspace.title}
        </Text>
        {detail ? (
          <Text style={styles.text} numberOfLines={2}>
            {detail}
          </Text>
        ) : null}
        <Text style={styles.muted} numberOfLines={1}>
          {meta}
        </Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`Move ${workspace.title}`} onPress={props.onMove} style={styles.button}>
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
