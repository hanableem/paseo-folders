import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { useEffect, useRef } from "react";
import { Text, View } from "react-native";

/**
 * Sidebar rows can only open plugin screens, so a conversation row opens this
 * screen, which immediately hands over to the conversation.
 */
export function OpenScreen({ theme, params, navigation }: PluginScreenProps) {
  const opened = useRef("");
  const agentId = params.agentId ?? "";
  useEffect(() => {
    if (!agentId || !navigation || opened.current === agentId) return;
    opened.current = agentId;
    navigation.openAgent({ agentId });
  }, [agentId, navigation]);
  return (
    <View style={{ flex: 1, padding: 24, backgroundColor: theme.colors.surface0 }}>
      <Text style={{ color: theme.colors.foregroundMuted }}>
        {navigation ? "Opening…" : "This version of Paseo cannot open conversations from plugins."}
      </Text>
    </View>
  );
}
