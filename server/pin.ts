import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { pinWorkspaceRpc } from "../shared/model";
import { daemonUrl } from "./daemon";

// Paseo's plugin API cannot pin a workspace, so this goes through Paseo's internal daemon
// client, as moves do.
export async function pinWorkspace(
  input: RpcInput<typeof pinWorkspaceRpc>,
): Promise<RpcOutput<typeof pinWorkspaceRpc>> {
  const client = new DaemonClient({ url: daemonUrl(), clientId: "paseo-folders-pin", clientType: "cli" });
  try {
    await client.connect();
    await client.setWorkspacePinned(input.workspaceId, input.pinned);
    return { ok: true };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`[folders] could not ${input.pinned ? "pin" : "unpin"} ${input.workspaceId}: ${reason}`);
    return { ok: false, reason };
  } finally {
    await client.close().catch(() => undefined);
  }
}
