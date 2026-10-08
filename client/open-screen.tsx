import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { useEffect, useRef } from "react";
import { Text, View } from "react-native";

/**
 * Sidebar rows can only open plugin screens, so a workspace row opens this
 * screen, which immediately hands over to the workspace (or a single agent).
 */
export function OpenScreen({ theme, params, navigation }: PluginScreenProps) {
  const opened = useRef("");
  const workspaceId = params.workspaceId ?? "";
  const agentId = params.agentId ?? "";
  useEffect(() => {
    const key = workspaceId || agentId;
    if (!key || !navigation || opened.current === key) return;
    opened.current = key;
    if (workspaceId) navigation.openWorkspace({ workspaceId });
    else navigation.openAgent({ agentId });
  }, [workspaceId, agentId, navigation]);
  return (
    <View style={{ flex: 1, padding: 24, backgroundColor: theme.colors.surface0 }}>
      <Text style={{ color: theme.colors.foregroundMuted }}>
        {navigation ? "Opening…" : "This version of Paseo cannot open workspaces from plugins."}
      </Text>
    </View>
  );
}
