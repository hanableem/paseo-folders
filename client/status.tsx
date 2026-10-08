import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useEffect, useMemo, useRef } from "react";
import { Animated, Easing, Image, Platform, View } from "react-native";
import { type ListedWorkspace, type StatusBucket, workspaceBucket } from "../shared/model";
import { PROVIDER_PATHS } from "./provider-paths";

// Paseo's status colours and ring geometry, so rows read like its own sidebar.
const LIGHT = { running: "#268ae0", warning: "#b37824", danger: "#f12e2f", success: "#299f51" };
const DARK = { running: "#5caaf6", warning: "#db932e", danger: "#f7796d", success: "#35c264" };
const DOT = 6;
const OVERLAY_DOT = 8;
const RING = 12;
const RING_FRAME = 14;
const RING_STROKE = 1.5;
const RING_PERIOD_MS = 900;

function isDark(hex: string): boolean {
  const m = /^#?([0-9a-f]{6})/i.exec(hex.trim());
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128;
}

export function statusColors(theme: PluginTheme) {
  return isDark(theme.colors.surface0) ? DARK : LIGHT;
}

/** Paseo's running indicator: a faint ring, a rotating head, and a centre dot. */
export function StatusRing({ theme }: { theme: PluginTheme }) {
  const color = statusColors(theme).running;
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: RING_PERIOD_MS,
        easing: Easing.linear,
        useNativeDriver: Platform.OS !== "web",
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [spin]);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  const circle = { width: RING, height: RING, borderRadius: RING / 2, borderWidth: RING_STROKE };
  return (
    <View style={{ width: RING_FRAME, height: RING_FRAME, alignItems: "center", justifyContent: "center" }}>
      <View style={[circle, { position: "absolute", borderColor: color, opacity: 0.3 }]} />
      <Animated.View style={{ position: "absolute", width: RING, height: RING, transform: [{ rotate }] }}>
        <View style={[circle, { borderColor: "transparent", borderTopColor: color, opacity: 0.9 }]} />
      </Animated.View>
      <View style={{ width: DOT, height: DOT, borderRadius: DOT / 2, backgroundColor: color }} />
    </View>
  );
}

/** A provider's mark where the platform can draw it (desktop and web); a generic icon elsewhere. */
export function ProviderMark({ provider, theme, size = 14 }: { provider: string; theme: PluginTheme; size?: number }) {
  const key = provider.split("/")[0];
  const path = PROVIDER_PATHS[key];
  const color = theme.colors.foregroundMuted;
  const uri = useMemo(() => {
    if (!path) return null;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="${color}" fill-rule="evenodd" d="${path}"/></svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }, [path, color]);
  if (Platform.OS === "web" && uri) {
    return <Image source={{ uri }} style={{ width: size, height: size }} accessibilityIgnoresInvertColors />;
  }
  return <Icon name={key === "claude" ? "Sparkle" : "Bot"} size={size} color={color} />;
}

function bucketColor(bucket: StatusBucket, theme: PluginTheme): string | null {
  const c = statusColors(theme);
  switch (bucket) {
    case "needs_input":
      return c.warning;
    case "failed":
      return c.danger;
    case "running":
      return c.running;
    case "attention":
      return c.success;
    default:
      return null;
  }
}

/**
 * A standalone status mark, as Paseo shows beside a group: the ring while
 * running, an alert when input is needed, and a dot for failed or unread results.
 */
export function BucketIndicator({ bucket, theme }: { bucket: StatusBucket; theme: PluginTheme }) {
  if (bucket === "done") return null;
  if (bucket === "running") return <StatusRing theme={theme} />;
  if (bucket === "needs_input") return <Icon name="CircleAlert" size={12} color={statusColors(theme).warning} />;
  const color = bucketColor(bucket, theme);
  return (
    <View style={{ width: RING_FRAME, height: RING_FRAME, alignItems: "center", justifyContent: "center" }}>
      <View style={{ width: DOT, height: DOT, borderRadius: DOT / 2, backgroundColor: color ?? "transparent" }} />
    </View>
  );
}

/** The most urgent status among several workspaces. */
export function mostUrgent(workspaces: readonly ListedWorkspace[]): StatusBucket {
  return workspaceBucket({ agents: workspaces.map((ws) => ({ bucket: workspaceBucket(ws) })) });
}

/**
 * The icon at the start of a workspace row. Running shows Paseo's ring; needing
 * input shows an alert. Otherwise a single conversation shows its provider's mark
 * and a shared workspace shows a stack icon, with a coloured dot for unread or
 * failed results. A workspace with no conversation yet shows an empty bubble.
 */
export function WorkspaceIcon({ workspace, theme }: { workspace: ListedWorkspace; theme: PluginTheme }) {
  const bucket = workspaceBucket(workspace);
  const frame = { width: RING_FRAME, height: 16, alignItems: "center" as const, justifyContent: "center" as const };
  if (bucket === "running") {
    return (
      <View style={frame}>
        <StatusRing theme={theme} />
      </View>
    );
  }
  if (bucket === "needs_input") {
    return (
      <View style={frame}>
        <Icon name="CircleAlert" size={12} color={statusColors(theme).warning} />
      </View>
    );
  }
  if (workspace.agents.length === 0) {
    return (
      <View style={frame}>
        <Icon name="MessageSquareDashed" size={14} color={theme.colors.foregroundMuted} />
      </View>
    );
  }
  const single = workspace.agents.length === 1;
  const dot = bucketColor(bucket, theme);
  return (
    <View style={[frame, { position: "relative" }]}>
      {single ? (
        <ProviderMark provider={workspace.agents[0].provider} theme={theme} />
      ) : (
        <Icon name="MessagesSquare" size={14} color={theme.colors.foregroundMuted} />
      )}
      {dot ? (
        <View
          style={{
            position: "absolute",
            right: -1,
            bottom: 0,
            width: OVERLAY_DOT,
            height: OVERLAY_DOT,
            borderRadius: OVERLAY_DOT / 2,
            borderWidth: 1,
            borderColor: theme.colors.surface0,
            backgroundColor: dot,
          }}
        />
      ) : null}
    </View>
  );
}
