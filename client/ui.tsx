import type { PluginTheme } from "@getpaseo/plugin";
import { Icon, Modal } from "@getpaseo/plugin/client/react-native";
import { type ReactNode, useMemo } from "react";
import { Platform, Pressable, type PressableStateCallbackType, Text, TextInput, View } from "react-native";
import { type Folder, type ListedWorkspace, UNSORTED_ID } from "../shared/model";
import { formatDay } from "./data";
import type { Mover } from "./move";
import { WorkspaceIcon } from "./status";

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
      // Laid out like Paseo's settings pages: a centred column of grouped cards.
      page: {
        width: "100%" as const,
        maxWidth: 720,
        alignSelf: "center" as const,
        paddingHorizontal: compact ? 12 : 16,
        paddingTop: compact ? 12 : 24,
        paddingBottom: 48,
      },
      sectionLabel: { color: c.foregroundMuted, fontSize: 13, marginTop: 24, marginBottom: 8, marginLeft: 4 },
      card: { borderWidth: 1, borderColor: c.border, borderRadius: 10, backgroundColor: c.surface1, overflow: "hidden" as const },
      item: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 10,
        minHeight: 48,
        paddingHorizontal: 16,
        paddingVertical: 8,
      },
      divider: { borderTopWidth: 1, borderTopColor: c.border },
      field: {
        color: c.foreground,
        borderWidth: 1,
        borderColor: c.border,
        borderRadius: 6,
        paddingHorizontal: 10,
        paddingVertical: 6,
        minHeight: 32,
        backgroundColor: c.surface0,
        fontSize: 14,
      },
      count: { color: c.foregroundMuted, fontSize: 13, minWidth: 24, textAlign: "right" as const, fontVariant: ["tabular-nums" as const] },
      sectionTitle: { color: c.foregroundMuted, fontSize: 12, fontWeight: "600" as const, marginTop: 8 },
      toolbar: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8, flexWrap: "wrap" as const },
    };
  }, [theme, compact]);
}

export type Styles = ReturnType<typeof useStyles>;

export function Button(props: {
  label: string;
  onPress(): void;
  styles: Styles;
  primary?: boolean;
  disabled?: boolean;
}) {
  const { styles } = props;
  const look = props.primary ? styles.primary : styles.button;
  const text = props.primary ? styles.primaryText : styles.buttonText;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      disabled={props.disabled}
      onPress={props.onPress}
      style={[look, props.disabled ? { opacity: 0.5 } : null]}
    >
      <Text style={text}>{props.label}</Text>
    </Pressable>
  );
}

/** A small borderless icon button, tinted on hover like Paseo's row actions. */
export function IconButton(props: {
  icon: string;
  label: string;
  onPress(): void;
  theme: PluginTheme;
  disabled?: boolean;
  color?: string;
}) {
  const c = props.theme.colors;
  const style = (state: PressableStateCallbackType) => {
    const hovered = (state as PressableStateCallbackType & { hovered?: boolean }).hovered;
    return {
      width: 28,
      height: 28,
      borderRadius: 6,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      opacity: props.disabled ? 0.3 : 1,
      backgroundColor: !props.disabled && (hovered || state.pressed) ? c.surface2 : "transparent",
    };
  };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      disabled={props.disabled}
      onPress={props.onPress}
      hitSlop={4}
      style={style}
    >
      <Icon name={props.icon} size={15} color={props.color ?? c.foregroundMuted} />
    </Pressable>
  );
}

/** A labelled group of rows in one card, as on Paseo's settings pages. */
export function Section(props: { label: string; styles: Styles; children: ReactNode }) {
  return (
    <View>
      <Text style={props.styles.sectionLabel}>{props.label}</Text>
      <View style={props.styles.card}>{props.children}</View>
    </View>
  );
}

/** Row actions show on hover with a mouse, and always on touch screens and narrow layouts. */
export function showsActionsAlways(compact: boolean): boolean {
  return compact || Platform.OS !== "web";
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

export function WorkspaceRow(props: {
  workspace: ListedWorkspace;
  notes: Record<string, string>;
  folderName?: string;
  styles: Styles;
  theme: PluginTheme;
  /** Draw a line above it, as every row in a card but the first. */
  divider?: boolean;
  onOpen?: () => void;
  onMove(): void;
  /** Right-click, or long press on touch screens; falls back to the move dialog when absent. */
  onMenu?: (at: { x: number; y: number }) => void;
}) {
  const { workspace, styles, theme } = props;
  const pointer = (event: unknown) => {
    const e = event as { nativeEvent?: { clientX?: number; clientY?: number; pageX?: number; pageY?: number } };
    const n = e.nativeEvent ?? (event as { clientX?: number; clientY?: number; pageX?: number; pageY?: number });
    return { x: n.clientX ?? n.pageX ?? 0, y: n.clientY ?? n.pageY ?? 0 };
  };
  const contextMenu = props.onMenu
    ? ({
        onContextMenu: (event: { preventDefault?: () => void }) => {
          event.preventDefault?.();
          props.onMenu?.(pointer(event));
        },
      } as object)
    : {};
  const many = workspace.agents.length > 1;
  const detail = many
    ? `${workspace.agents.length} conversations: ${workspace.agents.map((a) => a.title).join(" · ")}`
    : props.notes[workspace.agents[0]?.id ?? ""] ?? "";
  const meta = [formatDay(workspace.activityAt), props.folderName ?? ""].filter(Boolean).join(" · ");
  const web = Platform.OS === "web";
  return (
    <View style={[styles.item, { alignItems: "flex-start", paddingVertical: 10 }, props.divider ? styles.divider : null]}>
      <View style={{ paddingTop: 2 }}>
        <WorkspaceIcon workspace={workspace} theme={theme} />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${workspace.title}`}
        accessibilityHint={web ? "Right-click for more" : "Long press for more"}
        style={{ flex: 1, gap: 2 }}
        onPress={props.onOpen}
        // With a mouse the menu is on right-click; holding the button does nothing.
        onLongPress={web ? undefined : (event) => (props.onMenu ? props.onMenu(pointer(event)) : props.onMove())}
        delayLongPress={400}
        {...contextMenu}
      >
        <Text style={[styles.text, { fontWeight: "500" }]} numberOfLines={1}>
          {workspace.title}
        </Text>
        {detail ? (
          <Text style={[styles.muted, { fontSize: 13 }]} numberOfLines={2}>
            {detail}
          </Text>
        ) : null}
        <Text style={styles.muted} numberOfLines={1}>
          {meta}
        </Text>
      </Pressable>
      <IconButton icon="FolderInput" label={`Move ${workspace.title} to a folder`} onPress={props.onMove} theme={theme} />
    </View>
  );
}

export function MoveModal(props: {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** In display order, Unsorted included. */
  folders: readonly Folder[];
  currentId: string;
  onPick(folderId: string): void;
  styles: Styles;
  theme: PluginTheme;
}) {
  const { styles, theme } = props;
  return (
    <Modal
      title="Move to folder"
      icon={<Icon name="FolderInput" size={18} color={theme.colors.foreground} />}
      open={props.open}
      onOpenChange={props.onOpenChange}
    >
      <Modal.Content>
        <View style={{ gap: 6 }}>
          {props.folders.map((f) => {
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

/** The mover's question, centred over the window: Cancel, or go ahead. */
export function MoveConfirm(props: { mover: Mover; theme: PluginTheme }) {
  const { mover, theme } = props;
  const styles = useStyles(theme, false);
  const question = mover.question;
  return (
    <Modal
      title={question?.title ?? ""}
      icon={<Icon name="ArrowRightLeft" size={18} color={theme.colors.foreground} />}
      open={question !== null}
      onOpenChange={(open) => {
        if (!open) mover.answer(false);
      }}
    >
      <Modal.Content>
        <Text style={[styles.text, { lineHeight: 20 }]}>{question?.message ?? ""}</Text>
        <View style={[styles.toolbar, { justifyContent: "flex-end" }]}>
          <Button label="Cancel" onPress={() => mover.answer(false)} styles={styles} />
          <Button label={question?.action ?? "OK"} primary onPress={() => mover.answer(true)} styles={styles} />
        </View>
      </Modal.Content>
    </Modal>
  );
}
