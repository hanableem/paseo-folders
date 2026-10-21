import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { renameConversationRpc } from "../shared/model";
import { daemonUrl } from "./daemon";

// Paseo's plugin API cannot rename a conversation, so this goes through Paseo's internal daemon
// client, as pins and moves do.
export async function renameConversation(
  input: RpcInput<typeof renameConversationRpc>,
): Promise<RpcOutput<typeof renameConversationRpc>> {
  const client = new DaemonClient({ url: daemonUrl(), clientId: "paseo-folders-rename", clientType: "cli" });
  try {
    await client.connect();
    await client.updateAgent(input.agentId, { name: input.title });
    return { ok: true };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`[folders] could not rename conversation ${input.agentId}: ${reason}`);
    return { ok: false, reason };
  } finally {
    await client.close().catch(() => undefined);
  }
}
